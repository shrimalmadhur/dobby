import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  isValidSlackAppToken,
  isValidSlackBotToken,
  maskSlackToken,
  testSlackConnection,
} from "@/lib/notifications/slack";
import { ensureSlackIssuesSocketRunning, stopSlackIssuesSocket } from "@/lib/issues/slack-socket";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

const CHANNEL = "slack-issues";

export const GET = withErrorHandler(async () => {
  const [config] = await db
    .select()
    .from(notificationConfigs)
    .where(eq(notificationConfigs.channel, CHANNEL))
    .limit(1);

  if (!config) {
    return NextResponse.json({ configured: false });
  }

  const cfg = config.config as Record<string, string>;
  return NextResponse.json({
    configured: true,
    enabled: config.enabled,
    botToken: cfg.bot_token ? maskSlackToken(cfg.bot_token) : null,
    appToken: cfg.app_token ? maskSlackToken(cfg.app_token) : null,
    channelId: cfg.channel_id || null,
  });
});

export const POST = withErrorHandler(async (request: Request) => {
  const body = await request.json();
  const { botToken, appToken, channelId, test } = body;

  if (!botToken || !appToken) {
    return NextResponse.json(
      { error: "botToken and appToken are required" },
      { status: 400 }
    );
  }

  if (!isValidSlackBotToken(botToken)) {
    return NextResponse.json({ error: "Invalid Slack bot token format" }, { status: 400 });
  }

  if (!isValidSlackAppToken(appToken)) {
    return NextResponse.json({ error: "Invalid Slack app token format" }, { status: 400 });
  }

  if (test) {
    await testSlackConnection(botToken, appToken, channelId || undefined);
  }

  const [existing] = await db
    .select()
    .from(notificationConfigs)
    .where(eq(notificationConfigs.channel, CHANNEL))
    .limit(1);

  const config = {
    bot_token: botToken,
    app_token: appToken,
    ...(channelId ? { channel_id: channelId } : {}),
  };

  if (existing) {
    await db.update(notificationConfigs)
      .set({ enabled: true, config, updatedAt: new Date() })
      .where(eq(notificationConfigs.id, existing.id));
  } else {
    await db.insert(notificationConfigs).values({
      channel: CHANNEL,
      enabled: true,
      config,
    });
  }

  ensureSlackIssuesSocketRunning();

  return NextResponse.json({ success: true });
});

export const DELETE = withErrorHandler(async () => {
  await db.delete(notificationConfigs).where(eq(notificationConfigs.channel, CHANNEL));
  stopSlackIssuesSocket();
  return NextResponse.json({ success: true });
});
