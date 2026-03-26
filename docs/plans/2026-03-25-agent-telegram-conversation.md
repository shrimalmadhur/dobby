# Agent Telegram Conversation Mode (Persistent)

After an agent run completes and sends results to Telegram, the user can reply at any time — minutes, hours, or days later — to continue the conversation in the same Claude session.

## Architecture

```
scripts/run-agents.ts                   Dobby Web Server (long-running)
┌──────────────────────┐               ┌─────────────────────────────────┐
│ 1. Run agent         │               │  Conversation Poller            │
│ 2. Send to Telegram  │               │  (like issues poller)           │
│    (get message_id)  │               │                                 │
│ 3. Insert row into   │──DB──────────▶│  Loop:                          │
│    agent_conversations│               │  1. Load active conversations   │
│ 4. Exit              │               │  2. Group by bot token          │
└──────────────────────┘               │  3. Poll getUpdates per bot     │
                                       │  4. Match reply → conversation  │
                                       │  5. Resume Claude session       │
                                       │  6. Send response to Telegram   │
                                       │  7. Update conversation record  │
                                       └─────────────────────────────────┘
```

**Key insight**: The run script is short-lived (fire-and-forget). The poller runs in the Dobby web server (same as issues poller), listening for replies indefinitely.

---

## Task 1: Add `agent_conversations` table

**File**: `src/lib/db/schema.ts`

Add after the `agentRunToolUses` table:

```typescript
export const agentConversations = sqliteTable("agent_conversations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "cascade" }).notNull(),
  agentRunId: text("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  claudeSessionId: text("claude_session_id").notNull(),
  workspaceDir: text("workspace_dir").notNull(),
  botToken: text("bot_token").notNull(),
  chatId: text("chat_id").notNull(),
  botMessageIds: text("bot_message_ids", { mode: "json" }).$type<number[]>().default([]),
  status: text("status").notNull().default("active"), // 'active' | 'closed'
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});
```

Then run: `bun run db:generate`

---

## Task 2: Add `sendTelegramReply()` to telegram.ts

**File**: `src/lib/notifications/telegram.ts`

```typescript
export async function sendTelegramReply(
  config: TelegramConfig,
  text: string,
  replyToMessageId: number
): Promise<number> {
  const truncated = text.length > TELEGRAM_MAX_MSG_LEN
    ? text.substring(0, TELEGRAM_MAX_MSG_LEN - 3) + "..."
    : text;
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const response = await nodeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: truncated,
      parse_mode: "HTML",
      reply_parameters: { message_id: replyToMessageId },
    }),
    agent: ipv4Agent,
  } as never);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram API error: ${response.status} ${body}`);
  }
  const result = await response.json() as { ok: boolean; result: { message_id: number } };
  return result.result.message_id;
}
```

---

## Task 3: Modify `sendAgentResult()` to return message_id + hint

**File**: `src/lib/runner/telegram-sender.ts`

- Add `sendTelegramMessageWithId` to imports
- Return `Promise<number>` instead of `Promise<void>`
- Add optional `includeConversationHint` parameter
- Reduce budget by 100 chars when hint included

---

## Task 4: Create `src/lib/runner/agent-conversation.ts`

Core module with:
- `resumeSession(sessionId, workspaceDir, userMessage, envVars)` → spawns `claude -p --resume`
- `createConversation(...)` → inserts row into `agent_conversations`

---

## Task 5: Create `src/lib/runner/conversation-poller.ts`

Poller that runs in the web server, same pattern as issues poller:
- `ensureConversationPollerRunning()` — idempotent startup
- `runConversationPoller()` — infinite loop
- Polls each unique bot token for updates
- Matches replies to active conversations via `botMessageIds`
- Resumes Claude, sends response, updates record

---

## Task 6: Wire up in `scripts/run-agents.ts`

After sending result to Telegram, create a conversation record.

---

## Task 7: Wire up in `src/instrumentation.ts`

Start the conversation poller alongside the issues poller.
