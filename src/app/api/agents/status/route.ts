import { NextResponse } from "next/server";
import { scanSessions } from "@/lib/claude/session-reader";
import {
  persistSessions,
  loadHistoricalSessions,
} from "@/lib/claude/session-store";
import type { AgentSession } from "@/lib/claude/types";

export async function GET() {
  try {
    const status = await scanSessions();

    // Persist live sessions to DB
    try {
      persistSessions(status.sessions);
    } catch (e) {
      console.error("Failed to persist sessions:", e);
    }

    // Merge with historical sessions from DB
    try {
      const liveIds = new Set(status.sessions.map((s) => s.sessionId));
      const historical = loadHistoricalSessions();
      const historicalOnly = historical.filter(
        (h) => !liveIds.has(h.sessionId)
      );

      const allSessions: AgentSession[] = [
        ...status.sessions,
        ...historicalOnly,
      ];

      return NextResponse.json({
        ...status,
        sessions: allSessions,
        summary: {
          ...status.summary,
          completedCount:
            status.summary.completedCount + historicalOnly.length,
        },
      });
    } catch (e) {
      console.error("Failed to load historical sessions:", e);
      return NextResponse.json(status);
    }
  } catch (error) {
    // If live scanning fails entirely, serve from DB
    try {
      const historical = loadHistoricalSessions();
      return NextResponse.json({
        sessions: historical,
        summary: {
          activeCount: 0,
          idleCount: 0,
          completedCount: historical.length,
          totalTokensToday: 0,
          totalSessionsToday: 0,
        },
        scannedAt: new Date().toISOString(),
      });
    } catch {
      console.error("Error scanning agent sessions:", error);
      return NextResponse.json(
        { error: "Failed to scan agent sessions" },
        { status: 500 }
      );
    }
  }
}
