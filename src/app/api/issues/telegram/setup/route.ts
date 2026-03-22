import { NextResponse } from "next/server";
import { validateBotToken, pollForChat, clearPendingUpdates } from "@/lib/telegram/setup";

export async function POST(request: Request) {
  try {
    const { botToken, action } = await request.json();

    if (!botToken) {
      return NextResponse.json({ error: "Bot token is required" }, { status: 400 });
    }

    if (action === "validate") {
      const result = await validateBotToken(botToken);
      // Drain stale updates so polling only sees new messages
      if (result.valid) {
        await clearPendingUpdates(botToken);
      }
      return NextResponse.json(result);
    }

    if (action === "poll") {
      return NextResponse.json(await pollForChat(botToken));
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "validate" or "poll".' },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error in Telegram setup:", error);
    return NextResponse.json({ error: "Setup request failed" }, { status: 500 });
  }
}
