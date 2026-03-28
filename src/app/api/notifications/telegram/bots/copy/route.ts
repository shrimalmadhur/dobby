import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notificationConfigs, agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { maskToken } from "@/lib/notifications/telegram";
import { upsertNotificationConfig } from "@/lib/db/notification-config";
import { withErrorHandler } from "@/lib/api/utils";

export const runtime = "nodejs";

export const POST = withErrorHandler(async (request: Request) => {
  const body = await request.json();
  const { sourceConfigId, targetAgentId } = body;

  if (!sourceConfigId || !targetAgentId) {
    return NextResponse.json(
      { error: "sourceConfigId and targetAgentId are required" },
      { status: 400 }
    );
  }

  // Validate source config exists AND is a telegram config
  const [source] = await db
    .select()
    .from(notificationConfigs)
    .where(eq(notificationConfigs.id, sourceConfigId))
    .limit(1);

  if (!source || !source.channel.startsWith("telegram")) {
    return NextResponse.json(
      { error: "Source config not found or not a Telegram config" },
      { status: 404 }
    );
  }

  // Validate target agent exists
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, targetAgentId))
    .limit(1);

  if (!agent) {
    return NextResponse.json(
      { error: "Target agent not found" },
      { status: 404 }
    );
  }

  // Extract credentials from source
  const srcCfg = source.config as Record<string, string>;
  if (!srcCfg.bot_token || !srcCfg.chat_id) {
    return NextResponse.json(
      { error: "Source config has incomplete credentials" },
      { status: 400 }
    );
  }

  upsertNotificationConfig(
    `telegram-agent:${targetAgentId}`,
    { bot_token: srcCfg.bot_token, chat_id: srcCfg.chat_id, bot_name: srcCfg.bot_name || "" }
  );

  // Return masked config (same shape as GET /api/agents/{agentId}/telegram)
  return NextResponse.json({
    success: true,
    config: {
      configured: true,
      enabled: true,
      botToken: maskToken(srcCfg.bot_token),
      chatId: srcCfg.chat_id,
      botName: srcCfg.bot_name || "",
    },
  });
});
