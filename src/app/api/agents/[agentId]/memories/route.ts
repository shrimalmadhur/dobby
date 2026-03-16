import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAgentWorkspaceDir } from "@/lib/runner/agent-runner";

function getDefinitionForAgent(agent: typeof agents.$inferSelect) {
  return {
    config: {
      name: agent.name,
      enabled: agent.enabled,
      schedule: agent.schedule,
      timezone: agent.timezone || undefined,
      envVars: (agent.envVars as Record<string, string>) || {},
    },
    soul: agent.soul,
    skill: agent.skill,
    agentId: agent.id,
  };
}

/**
 * GET /api/agents/:agentId/memories - Read an agent's memory file
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const definition = getDefinitionForAgent(rows[0]);
  const workspaceDir = getAgentWorkspaceDir(definition);
  const memoryPath = join(workspaceDir, "memory.md");

  let content = "";
  if (existsSync(memoryPath)) {
    try {
      content = readFileSync(memoryPath, "utf-8");
    } catch {
      content = "";
    }
  }

  return NextResponse.json({
    agentId,
    agentName: rows[0].name,
    workspacePath: memoryPath,
    content,
    exists: existsSync(memoryPath),
  });
}

/**
 * DELETE /api/agents/:agentId/memories - Clear an agent's memory file
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const definition = getDefinitionForAgent(rows[0]);
  const workspaceDir = getAgentWorkspaceDir(definition);
  const memoryPath = join(workspaceDir, "memory.md");

  if (existsSync(memoryPath)) {
    writeFileSync(memoryPath, "", "utf-8");
  }

  return NextResponse.json({ cleared: true });
}
