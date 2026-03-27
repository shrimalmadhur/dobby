import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface IssuesSlackConfig {
  botToken: string;
  appToken: string;
  channelId?: string;
  updatedAt: number;
}

export type IssuesTransportConfig =
  | { kind: "telegram"; botToken: string; chatId: string }
  | { kind: "slack"; botToken: string; appToken: string; channelId?: string };

export async function getIssuesSlackConfig(): Promise<IssuesSlackConfig | null> {
  const rows = await db
    .select()
    .from(notificationConfigs)
    .where(eq(notificationConfigs.channel, "slack-issues"))
    .limit(1);

  const cfg = rows[0];
  if (!cfg?.enabled) return null;

  const config = cfg.config as Record<string, string>;
  if (!config.bot_token || !config.app_token) return null;

  return {
    botToken: config.bot_token,
    appToken: config.app_token,
    channelId: config.channel_id || undefined,
    updatedAt: cfg.updatedAt.getTime(),
  };
}
