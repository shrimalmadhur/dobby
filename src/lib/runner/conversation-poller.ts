import nodeFetch from "node-fetch";
import { db } from "@/lib/db";
import { agentConversations, agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ipv4Agent, type TelegramMessage } from "@/lib/telegram/api";
import {
  markdownToTelegramHtml,
  sendTelegramReply,
  TELEGRAM_SAFE_MSG_LEN,
} from "@/lib/notifications/telegram";
import { resumeSession } from "./agent-conversation";

// ── Globals (survive HMR in dev) ────────────────────────────

const g = globalThis as unknown as {
  _conversationPoller?: { running: boolean; starting: boolean };
};
g._conversationPoller ??= { running: false, starting: false };

// ── Constants ───────────────────────────────────────────────

const POLL_TIMEOUT_SEC = 5;
const STALE_CONVERSATION_MS = 7 * 24 * 60 * 60 * 1000; // Auto-close after 7 days
const IDLE_PAUSE_MS = 30_000;  // 30s when no active conversations
const ACTIVE_PAUSE_MS = 2_000; // 2s when conversations exist
const MAX_BOT_MESSAGE_IDS = 50;

// Per-conversation concurrency guard — prevents duplicate resumeSession calls.
// Also stores queued messages for conversations that are busy.
const activeResumes = new Set<string>();
const pendingReplies = new Map<string, { text: string; messageId: number }>();

// ── Public entry point ──────────────────────────────────────

/**
 * Ensure the conversation poller is running in-process.
 * Safe to call multiple times — only one poller loop will run.
 */
export function ensureConversationPollerRunning(): void {
  if (g._conversationPoller!.running || g._conversationPoller!.starting) return;
  g._conversationPoller!.starting = true;

  setTimeout(() => {
    runPoller().catch((err) => {
      console.error("[conversation-poller] Fatal error:", err);
      g._conversationPoller!.running = false;
      g._conversationPoller!.starting = false;
    });
  }, 7000);
}

// ── Poller loop ─────────────────────────────────────────────

async function runPoller() {
  console.log("[conversation-poller] Starting...");
  g._conversationPoller!.running = true;
  g._conversationPoller!.starting = false;

  const offsets = new Map<string, number>();

  while (true) {
    try {
      const hadActive = await runPollerIteration(offsets);
      // Back off when idle to avoid unnecessary DB queries
      await sleep(hadActive ? ACTIVE_PAUSE_MS : IDLE_PAUSE_MS);
    } catch (err) {
      console.error("[conversation-poller] Iteration error:", err);
      await sleep(ACTIVE_PAUSE_MS);
    }
  }
}

// ── Single iteration ────────────────────────────────────────

async function runPollerIteration(offsets: Map<string, number>): Promise<boolean> {
  // 1. Load all active conversations
  const conversations = await db.select().from(agentConversations)
    .where(eq(agentConversations.status, "active"));

  if (conversations.length === 0) return false;

  // 2. Close stale conversations (older than 7 days)
  const now = Date.now();
  for (const conv of conversations) {
    if (now - conv.updatedAt.getTime() > STALE_CONVERSATION_MS) {
      await db.update(agentConversations)
        .set({ status: "closed", updatedAt: new Date() })
        .where(eq(agentConversations.id, conv.id));
      console.log(`[conversation-poller] Closed stale conversation ${conv.id.substring(0, 8)}`);
    }
  }

  const active = conversations.filter(
    c => now - c.updatedAt.getTime() <= STALE_CONVERSATION_MS
  );
  if (active.length === 0) return false;

  // 3. Group by bot token
  const byBot = new Map<string, typeof active>();
  for (const conv of active) {
    const key = conv.botToken;
    if (!byBot.has(key)) byBot.set(key, []);
    byBot.get(key)!.push(conv);
  }

  // 4. Poll each unique bot token
  for (const [botToken, convos] of byBot) {
    try {
      await pollBot(botToken, convos, offsets);
    } catch (err) {
      console.error(`[conversation-poller] Poll error for bot:`, err);
    }
  }

  return true;
}

// ── Poll a single bot token ─────────────────────────────────

async function pollBot(
  botToken: string,
  conversations: Array<typeof agentConversations.$inferSelect>,
  offsets: Map<string, number>
) {
  const offset = offsets.get(botToken) || 0;

  const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
  const response = await nodeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offset,
      timeout: POLL_TIMEOUT_SEC,
      allowed_updates: ["message"],
    }),
    agent: ipv4Agent,
    timeout: (POLL_TIMEOUT_SEC + 5) * 1000,
  } as never);

  if (!response.ok) {
    throw new Error(`getUpdates error: ${response.status}`);
  }

  const data = await response.json() as {
    ok: boolean;
    result: Array<{ update_id: number; message?: TelegramMessage }>;
  };

  const updates = data.result || [];
  if (updates.length === 0) return;

  // Advance offset
  const nextOffset = updates[updates.length - 1].update_id + 1;
  offsets.set(botToken, nextOffset);

  // Build a lookup: botMessageId → conversation
  const msgToConv = new Map<number, typeof agentConversations.$inferSelect>();
  for (const conv of conversations) {
    const ids = conv.botMessageIds as number[] || [];
    for (const msgId of ids) {
      msgToConv.set(msgId, conv);
    }
  }

  // Build chatId → conversation map for non-reply hint
  const chatConvs = new Map<string, typeof agentConversations.$inferSelect>();
  for (const conv of conversations) {
    chatConvs.set(conv.chatId, conv);
  }

  // Process updates
  for (const update of updates) {
    const msg = update.message;
    if (!msg) continue;

    const text = msg.text || msg.caption;
    if (!text) continue;

    // Check if this is a reply to one of our tracked messages
    if (msg.reply_to_message) {
      const conv = msgToConv.get(msg.reply_to_message.message_id);
      if (conv) {
        // SECURITY: Validate chat_id matches the conversation's chat
        if (String(msg.chat.id) !== conv.chatId) continue;

        // Concurrency guard: set synchronously before fire-and-forget
        if (activeResumes.has(conv.id)) {
          // Queue this reply — it will be processed after the current one finishes
          pendingReplies.set(conv.id, { text, messageId: msg.message_id });
          try {
            await sendTelegramReply(
              { botToken: conv.botToken, chatId: conv.chatId },
              `<i>Still processing your previous message, I'll get to this one next.</i>`,
              msg.message_id
            );
          } catch { /* best effort */ }
          continue;
        }

        activeResumes.add(conv.id);
        handleReply(conv, text, msg.message_id).catch((err) => {
          console.error(`[conversation-poller] handleReply error:`, err);
        });
        continue;
      }
    }

    // Non-reply message from a tracked chat — send a hint
    const conv = chatConvs.get(String(msg.chat.id));
    if (conv) {
      const lastBotMsgId = getLastBotMessageId(conv);
      if (lastBotMsgId) {
        try {
          await sendTelegramReply(
            { botToken: conv.botToken, chatId: conv.chatId },
            `<i>Reply to one of my messages to continue the conversation.</i>`,
            lastBotMsgId
          );
        } catch { /* best effort */ }
      }
    }
  }
}

// ── Handle a matched reply ──────────────────────────────────

async function handleReply(
  conv: typeof agentConversations.$inferSelect,
  userText: string,
  userMessageId: number
) {
  const telegramConfig = { botToken: conv.botToken, chatId: conv.chatId };

  console.log(`[conversation-poller] Reply on ${conv.id.substring(0, 8)}: "${userText.substring(0, 80)}${userText.length > 80 ? "..." : ""}"`);

  try {
    const envVars = await getAgentEnvVars(conv.agentId);

    const response = await resumeSession(
      conv.claudeSessionId,
      conv.workspaceDir,
      userText,
      envVars
    );

    // Send response as a reply to the user's message
    const truncated = response.length > TELEGRAM_SAFE_MSG_LEN
      ? response.substring(0, TELEGRAM_SAFE_MSG_LEN) + "..."
      : response;
    const responseHtml = markdownToTelegramHtml(truncated);
    const newBotMsgId = await sendTelegramReply(telegramConfig, responseHtml, userMessageId);

    // Re-read conversation from DB to avoid stale botMessageIds race
    const [fresh] = await db.select().from(agentConversations)
      .where(eq(agentConversations.id, conv.id)).limit(1);
    if (fresh) {
      const currentIds = (fresh.botMessageIds as number[]) || [];
      const updatedIds = [...currentIds, newBotMsgId].slice(-MAX_BOT_MESSAGE_IDS);
      await db.update(agentConversations)
        .set({ botMessageIds: updatedIds, updatedAt: new Date() })
        .where(eq(agentConversations.id, conv.id));
    }

    console.log(`[conversation-poller] Sent response (msgId: ${newBotMsgId})`);
  } catch (err) {
    console.error(`[conversation-poller] Error handling reply:`, err);
    try {
      await sendTelegramReply(
        telegramConfig,
        `<i>Something went wrong processing your reply. Please try again.</i>`,
        userMessageId
      );
    } catch { /* best effort */ }
  } finally {
    activeResumes.delete(conv.id);

    // Process queued reply if one was waiting
    const pending = pendingReplies.get(conv.id);
    if (pending) {
      pendingReplies.delete(conv.id);
      // Re-read conversation to get updated botMessageIds
      const [freshConv] = await db.select().from(agentConversations)
        .where(eq(agentConversations.id, conv.id)).limit(1);
      if (freshConv && freshConv.status === "active") {
        activeResumes.add(conv.id);
        handleReply(freshConv, pending.text, pending.messageId).catch((err) => {
          console.error(`[conversation-poller] queued handleReply error:`, err);
        });
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────

async function getAgentEnvVars(agentId: string): Promise<Record<string, string> | undefined> {
  const [agent] = await db.select({ envVars: agents.envVars })
    .from(agents).where(eq(agents.id, agentId)).limit(1);
  return (agent?.envVars as Record<string, string>) || undefined;
}

function getLastBotMessageId(conv: typeof agentConversations.$inferSelect): number | null {
  const ids = (conv.botMessageIds as number[]) || [];
  return ids.length > 0 ? ids[ids.length - 1] : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
