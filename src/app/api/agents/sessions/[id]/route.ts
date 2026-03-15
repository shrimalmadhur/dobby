import { NextResponse } from "next/server";
import {
  readSessionDetail,
  readSubAgentDetail,
} from "@/lib/claude/session-detail-reader";
import {
  persistSessionDetail,
  loadSessionDetailFromDB,
} from "@/lib/claude/session-store";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const { searchParams } = new URL(request.url);
  const projectDir = searchParams.get("project");
  const subagentId = searchParams.get("subagent");

  if (!projectDir) {
    return NextResponse.json(
      { error: "Missing 'project' query parameter" },
      { status: 400 }
    );
  }

  try {
    // Try reading from disk first
    const detail = subagentId
      ? await readSubAgentDetail(sessionId, projectDir, subagentId)
      : await readSessionDetail(sessionId, projectDir);

    if (detail) {
      // Persist to DB for future retrieval
      try {
        persistSessionDetail(detail, projectDir, subagentId);
      } catch (e) {
        console.error("Failed to persist session detail:", e);
      }
      return NextResponse.json(detail);
    }

    // Disk file gone — fall back to DB
    const fromDB = loadSessionDetailFromDB(sessionId, projectDir, subagentId);
    if (fromDB) {
      return NextResponse.json(fromDB);
    }

    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  } catch (error) {
    // Disk read failed — try DB
    try {
      const fromDB = loadSessionDetailFromDB(sessionId, projectDir, subagentId);
      if (fromDB) {
        return NextResponse.json(fromDB);
      }
    } catch {
      // DB also failed
    }

    console.error("Error reading session detail:", error);
    return NextResponse.json(
      { error: "Failed to read session detail" },
      { status: 500 }
    );
  }
}
