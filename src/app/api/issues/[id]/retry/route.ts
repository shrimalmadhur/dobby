import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { issues } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PHASE_STATUS_MAP } from "@/lib/issues/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [issue] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, id))
      .limit(1);

    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    if (issue.status !== "failed") {
      return NextResponse.json(
        { error: "Only failed issues can be retried" },
        { status: 400 }
      );
    }

    // Reset to the phase that failed
    const resumeStatus = PHASE_STATUS_MAP[issue.currentPhase] || "pending";

    const [updated] = await db
      .update(issues)
      .set({
        status: resumeStatus,
        error: null,
        lockedBy: null,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(issues.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error retrying issue:", error);
    return NextResponse.json({ error: "Failed to retry issue" }, { status: 500 });
  }
}
