import { telegramApi, isValidBotToken } from "./api";
import type { TelegramUser, TelegramUpdate } from "./api";

export interface ValidateResult {
  valid: boolean;
  error?: string;
  botName?: string;
  botUsername?: string;
}

export interface PollResult {
  found: boolean;
  chatId?: string;
  chatTitle?: string;
  chatType?: string;
}

export async function validateBotToken(botToken: string): Promise<ValidateResult> {
  if (!isValidBotToken(botToken)) {
    return { valid: false, error: "Invalid bot token format" };
  }

  const resp = await telegramApi<TelegramUser>(botToken, "getMe");

  if (!resp.ok) {
    return { valid: false, error: resp.description || "Invalid bot token" };
  }

  return {
    valid: true,
    botName: resp.result!.first_name,
    botUsername: resp.result!.username || "",
  };
}

/**
 * Drain all pending updates so subsequent polls only see new messages.
 * Called once after validation, before the polling loop begins.
 */
export async function clearPendingUpdates(botToken: string): Promise<void> {
  const resp = await telegramApi<TelegramUpdate[]>(
    botToken, "getUpdates", { limit: 100 }
  );
  if (resp.ok && resp.result && resp.result.length > 0) {
    const lastId = resp.result[resp.result.length - 1].update_id;
    // Confirm all existing updates by requesting offset = lastId + 1
    await telegramApi(botToken, "getUpdates", { offset: lastId + 1, limit: 1 });
  }
}

export async function pollForChat(botToken: string): Promise<PollResult> {
  const resp = await telegramApi<TelegramUpdate[]>(
    botToken,
    "getUpdates",
    { limit: 10, timeout: 3 }
  );

  if (!resp.ok || !resp.result) {
    return { found: false };
  }

  // Look for a /start message (most recent first)
  for (let i = resp.result.length - 1; i >= 0; i--) {
    const update = resp.result[i];
    if (update.message?.chat && update.message.text?.startsWith("/start")) {
      const chat = update.message.chat;
      // Confirm this update so it's not picked up again
      await telegramApi(botToken, "getUpdates", { offset: update.update_id + 1, limit: 1 });
      return {
        found: true,
        chatId: String(chat.id),
        chatTitle: chat.title || chat.first_name || chat.username || "Unknown",
        chatType: chat.type,
      };
    }
  }

  return { found: false };
}
