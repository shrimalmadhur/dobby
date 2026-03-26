import { spawn } from "node:child_process";
import { db } from "@/lib/db";
import { agentConversations } from "@/lib/db/schema";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";
import { buildChildEnv } from "./agent-memory";

// ── Constants ────────────────────────────────────────────────

const RESUME_TIMEOUT_MS = 5 * 60 * 1000; // 5 min per reply

// ── Create conversation record ───────────────────────────────

/**
 * Create an agent conversation record in the DB.
 * The conversation poller will pick this up and start listening for replies.
 */
export async function createConversation(opts: {
  agentId: string;
  agentRunId?: string;
  claudeSessionId: string;
  workspaceDir: string;
  botToken: string;
  chatId: string;
  botMessageId: number;
}): Promise<string> {
  const [row] = await db.insert(agentConversations).values({
    agentId: opts.agentId,
    agentRunId: opts.agentRunId,
    claudeSessionId: opts.claudeSessionId,
    workspaceDir: opts.workspaceDir,
    botToken: opts.botToken,
    chatId: opts.chatId,
    botMessageIds: [opts.botMessageId],
  }).returning({ id: agentConversations.id });
  return row.id;
}

// ── Resume a Claude session ──────────────────────────────────

/**
 * Resume an existing Claude CLI session with a new user message.
 * Spawns `claude -p --resume <sessionId>` and returns the response text.
 */
export async function resumeSession(
  sessionId: string,
  workspaceDir: string,
  userMessage: string,
  envVars?: Record<string, string>
): Promise<string> {
  const args = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
    "--resume", sessionId,
  ];

  const childEnv = buildChildEnv(envVars);

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(resolveClaudePath(), args, {
      cwd: workspaceDir,
      env: childEnv,
    });

    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, RESUME_TIMEOUT_MS);

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    proc.stdin!.write(userMessage);
    proc.stdin!.end();

    let buffer = "";
    let resultText = "";
    const assistantBlocks: string[] = [];

    let stderrOutput = "";
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      if (stderrOutput.length > 5000) stderrOutput = stderrOutput.slice(-5000);
    });

    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.length > 1_000_000) buffer = buffer.slice(-500_000);
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === "result" && event.result) {
            resultText = event.result;
          }
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                assistantBlocks.push(block.text);
              }
            }
          }
        } catch { /* skip non-JSON */ }
      }
    });

    proc.on("close", (code) => {
      settle(() => {
        if (timedOut) {
          reject(new Error("Claude session timed out"));
          return;
        }
        const output = resultText || assistantBlocks.join("\n\n");
        if (code === 0) {
          resolve(output);
        } else {
          const detail = stderrOutput || `exit code ${code}`;
          reject(new Error(`Claude CLI failed: ${detail}`));
        }
      });
    });

    proc.on("error", (err) => {
      settle(() => reject(err));
    });
  });
}

