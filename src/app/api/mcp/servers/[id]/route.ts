import { NextResponse } from "next/server";
import { z } from "zod";
import { db, mcpServers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { withErrorHandler, badRequest } from "@/lib/api/utils";

export const runtime = "nodejs";

const mcpServerUpdateSchema = z.object({
  name: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
}).strict();

export const PATCH = withErrorHandler(async (
  request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { id } = await params;
  const raw = await request.json();
  const parsed = mcpServerUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(parsed.error.issues.map(i => i.message).join(", "));
  }

  const [updated] = await db
    .update(mcpServers)
    .set(parsed.data)
    .where(eq(mcpServers.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: "Server not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(updated);
});

export const DELETE = withErrorHandler(async (
  _request: Request,
  { params }: { params: Promise<Record<string, string>> }
) => {
  const { id } = await params;

  await db.delete(mcpServers).where(eq(mcpServers.id, id));

  return NextResponse.json({ success: true });
});
