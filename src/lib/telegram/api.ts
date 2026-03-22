import https from "node:https";
import nodeFetch from "node-fetch";

const ipv4Agent = new https.Agent({ family: 4 });

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  first_name?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export async function telegramApi<T>(
  botToken: string,
  method: string,
  params?: Record<string, string | number>
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const url = new URL(`https://api.telegram.org/bot${botToken}/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }

  const response = await nodeFetch(url.toString(), {
    agent: ipv4Agent,
  } as never);

  return (await response.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };
}

const BOT_TOKEN_REGEX = /^\d+:[A-Za-z0-9_-]{35,}$/;

export function isValidBotToken(token: string): boolean {
  return BOT_TOKEN_REGEX.test(token);
}
