import { NextResponse } from "next/server";
import { maskToken, testTelegramNotification } from "@/lib/notifications/telegram";
import { ensurePollerRunning } from "@/lib/issues/poller-manager";
import { isValidBotToken } from "@/lib/telegram/api";
import { upsertNotificationConfig, getNotificationConfig, deleteNotificationConfig } from "@/lib/db/notification-config";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

const CHANNEL = "telegram-issues";

export const GET = withErrorHandler(async () => {
  const config = getNotificationConfig(CHANNEL);

  if (!config) {
    return NextResponse.json({ configured: false });
  }

  const cfg = config.config as Record<string, string>;
  return NextResponse.json({
    configured: true,
    enabled: config.enabled,
    botToken: cfg.bot_token ? maskToken(cfg.bot_token) : null,
    chatId: cfg.chat_id || null,
  });
});

export const POST = withErrorHandler(async (request: Request) => {
  const body = await request.json();
  const { botToken, chatId, test } = body;

  if (!botToken || !chatId) {
    return NextResponse.json(
      { error: "botToken and chatId are required" },
      { status: 400 }
    );
  }

  if (!isValidBotToken(botToken)) {
    return NextResponse.json(
      { error: "Invalid bot token format" },
      { status: 400 }
    );
  }

  // Test connection if requested
  if (test) {
    const result = await testTelegramNotification(botToken, chatId);
    if (!result.success) {
      return NextResponse.json(
        { error: `Connection test failed: ${result.error}` },
        { status: 400 }
      );
    }
  }

  upsertNotificationConfig(CHANNEL, { bot_token: botToken, chat_id: chatId });

  // Start poller now that config is available
  ensurePollerRunning();

  return NextResponse.json({ success: true });
});

export const DELETE = withErrorHandler(async () => {
  deleteNotificationConfig(CHANNEL);
  return NextResponse.json({ success: true });
});
