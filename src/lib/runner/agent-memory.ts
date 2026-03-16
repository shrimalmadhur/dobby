import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";

const MEMORY_FILE = "memory.md";

/**
 * Env var keys that must not be overridden by agent config.
 * Shared between main agent and memory sub-agent.
 */
export const DENIED_ENV_KEYS = new Set([
  "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "NODE_OPTIONS",
  "HOME", "SHELL", "USER", "LOGNAME", "DYLD_INSERT_LIBRARIES",
]);

/** Build a child process env by merging agent envVars (with deny-list) into process.env. */
export function buildChildEnv(envVars?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "0" };
  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      if (!DENIED_ENV_KEYS.has(key.toUpperCase())) {
        env[key] = value;
      }
    }
  }
  return env;
}
const MAX_MEMORY_CHARS = 8000; // Cap injected memory to avoid blowing up context
const MEMORY_SUB_AGENT_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Read an agent's memory file from its workspace directory.
 * Returns the file contents, or empty string if no memory exists yet.
 */
export function readWorkspaceMemory(workspaceDir: string): string {
  const memoryPath = join(workspaceDir, MEMORY_FILE);
  if (!existsSync(memoryPath)) return "";

  try {
    const content = readFileSync(memoryPath, "utf-8").trim();
    if (content.length > MAX_MEMORY_CHARS) {
      return content.substring(0, MAX_MEMORY_CHARS) + "\n\n[memory truncated — keep this file concise]";
    }
    return content;
  } catch {
    return "";
  }
}

/**
 * Format workspace memory for injection into the agent's prompt.
 */
export function formatMemoryForPrompt(memoryContent: string): string {
  if (!memoryContent) return "";

  return [
    "## Your Memory (from previous runs)",
    "This is your persistent memory file (`memory.md` in your workspace).",
    "It contains what you chose to remember from past runs.",
    "Use this to avoid repeating work and to build on what you've already done.",
    "",
    "---",
    memoryContent,
    "---",
    "",
  ].join("\n");
}

/**
 * Read-only memory context note appended to the agent's system prompt.
 * Tells the agent memory exists and is handled automatically — no write instructions.
 */
export const MEMORY_CONTEXT_NOTE = `

## Persistent Memory
Your memory from previous runs is provided in the prompt under "Your Memory (from previous runs)".
Use it to avoid repeating work and to build on what you've done before.
Memory updates are handled automatically by the system — do not write to memory.md yourself.
`;

/**
 * Extract the ## Memory section from skill text.
 * Returns the section content (without the heading), or null if not found.
 */
export function extractMemorySection(skill: string): string | null {
  // Split skill text into sections by ## headings, find the Memory section
  const sections = skill.split(/^(?=##\s)/m);
  const memorySection = sections.find((s) => /^##\s+Memory\s*$/im.test(s.split("\n")[0]));
  if (!memorySection) return null;
  // Remove the heading line and trim
  const content = memorySection.replace(/^##\s+Memory\s*\n?/im, "").trim();
  return content || null;
}

/**
 * Spawn a memory sub-agent to update the agent's memory.md after a successful run.
 * This is a separate Claude CLI invocation with no tools — pure text generation.
 * The sub-agent receives the current memory + truncated run output + tracking instructions,
 * and returns the updated memory content which is written to memory.md.
 *
 * Best-effort: failures are logged but do not affect the run result.
 */
export async function updateMemoryAfterRun(opts: {
  workspaceDir: string;
  currentMemory: string;
  runOutput: string;
  skill: string;
  envVars?: Record<string, string>;
}): Promise<void> {
  const { workspaceDir, currentMemory, runOutput, skill, envVars } = opts;

  const memorySection = extractMemorySection(skill);
  const trackingInstructions = memorySection
    ? `Follow these tracking instructions from the agent's task:\n${memorySection}`
    : "Track what was done so future runs can avoid repeating work. Track topics covered, approaches that worked, and any useful state.";

  // Truncate run output to avoid blowing up the sub-agent's context
  const maxOutputChars = 4000;
  const truncatedOutput = runOutput.length > maxOutputChars
    ? runOutput.substring(0, maxOutputChars) + "\n\n[output truncated]"
    : runOutput;

  const prompt = [
    "You are a memory management assistant. Your job is to update an agent's persistent memory file based on what it just did.",
    "",
    "## Current Memory",
    currentMemory || "(empty — this is the first run)",
    "",
    "## Agent's Latest Output",
    truncatedOutput,
    "",
    "## Instructions",
    trackingInstructions,
    "",
    "## Rules",
    "- Output ONLY the updated memory.md content — no commentary, no markdown fences, no preamble.",
    "- Keep it concise — this file is injected into every future run's prompt.",
    "- Update incrementally — add new info, remove stale entries.",
    "- Do NOT store the full output or restate task instructions.",
    "- Use markdown format with clear sections.",
  ].join("\n");

  const args = [
    "-p",
    "--output-format", "text",
    "--no-session-persistence",
    "--max-turns", "1",
  ];

  const childEnv = buildChildEnv(envVars);

  // Cap on sub-agent output to prevent memory exhaustion
  const maxSubAgentOutput = MAX_MEMORY_CHARS * 2;

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const proc = spawn(resolveClaudePath(), args, {
      env: childEnv,
      cwd: workspaceDir,
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGTERM");
      reject(new Error("memory sub-agent timed out after 30s"));
    }, MEMORY_SUB_AGENT_TIMEOUT_MS);

    proc.stdin!.write(prompt);
    proc.stdin!.end();

    let output = "";

    proc.stdout!.on("data", (chunk: Buffer) => {
      if (output.length >= maxSubAgentOutput) return;
      output += chunk.toString();
      if (output.length > maxSubAgentOutput) {
        output = output.substring(0, maxSubAgentOutput);
      }
    });

    proc.stderr!.on("data", () => {
      // Ignore stderr from sub-agent
    });

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (settled) return; // Don't write after timeout or error — promise already settled
      settled = true;

      const trimmed = output.trim();

      if (code === 0 && trimmed) {
        try {
          writeFileSync(join(workspaceDir, MEMORY_FILE), trimmed + "\n", "utf-8");
        } catch (err) {
          console.warn("[memory sub-agent] failed to write memory.md:", err);
        }
      } else if (code !== 0) {
        console.warn(`[memory sub-agent] exited with code ${code}, skipping memory update`);
      }

      resolve();
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new Error(`memory sub-agent spawn error: ${err.message}`));
    });
  });
}
