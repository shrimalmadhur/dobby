import { NextResponse } from "next/server";
import { testTelegramNotification } from "@/lib/notifications/telegram";

export async function POST(request: Request) {
  try {
    const { botToken, chatId } = await request.json();

    if (!botToken || !chatId) {
      return NextResponse.json(
        { error: "Bot token and chat ID are required" },
        { status: 400 }
      );
    }

    const result = await testTelegramNotification(botToken, chatId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error testing Telegram:", error);
    return NextResponse.json(
      { success: false, error: "Failed to test connection" },
      { status: 500 }
    );
  }
}
