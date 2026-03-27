import { spawn } from "node:child_process";
import { resolveClaudePath } from "@/lib/utils/resolve-claude-path";
import { getSetting, setSetting } from "@/lib/db/app-settings";
import type { PipelinePhaseResult } from "../types";
import { PHASE_TIMEOUT_MS } from "../types";

export const MAX_FALLBACK_CHARS = 50_000;

/** Allowed env var prefixes/names for Claude CLI child processes. */
const ALLOWED_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "SHELL", "TERM", "LANG", "TMPDIR", "XDG_CONFIG_HOME",
  "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "CLAUDE_CODE_API_KEY",
  "GH_TOKEN", "GITHUB_TOKEN",
]);

/** Build a minimal env for Claude CLI — only pass through what's needed. */
export function buildClaudeEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env as unknown as NodeJS.ProcessEnv;
}

// ── Resume capability check (appSettings-cached, globalThis for HMR) ──

const _g = globalThis as unknown as { _resumeCheckPromise?: Promise<boolean>; _resumeCheckAt?: number };
const RESUME_CHECK_IN_MEMORY_TTL = 60 * 60 * 1000; // 1 hour — re-check DB after this

export async function isResumeSupported(): Promise<boolean> {
  // Clear stale in-memory cache so DB TTL takes effect for long-running processes
  if (_g._resumeCheckPromise && _g._resumeCheckAt && Date.now() - _g._resumeCheckAt > RESUME_CHECK_IN_MEMORY_TTL) {
    _g._resumeCheckPromise = undefined;
  }
  if (!_g._resumeCheckPromise) {
    _g._resumeCheckAt = Date.now();
    _g._resumeCheckPromise = doResumeCheck().catch((err) => {
      console.error("[pipeline] Resume check failed, will retry:", err);
      _g._resumeCheckPromise = undefined;
      return false;
    });
  }
  return _g._resumeCheckPromise;
}

async function doResumeCheck(): Promise<boolean> {
  // Check DB cache first (survives process restarts)
  const cached = getSetting("claude-resume-supported");
  const checkedAt = getSetting("claude-resume-checked-at");

  if (cached !== null && checkedAt) {
    const supported = cached === "true";
    const age = Date.now() - new Date(checkedAt).getTime();
    // Cache true for 7 days; cache false for only 1 hour (self-heals after transient failures)
    const ttl = supported ? 7 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    if (age < ttl) {
      console.log(`[pipeline] Resume capability cached: ${supported}`);
      return supported;
    }
  }

  console.log("[pipeline] Checking --resume capability...");

  // Run verification: create a session, then resume it
  const testId = crypto.randomUUID();
  const create = await runClaudePhase({
    workdir: "/tmp",
    prompt: "Reply with exactly: VERIFY_OK",
    timeoutMs: 30_000,
    sessionId: testId,
  });
  if (!create.success || !create.output.includes("VERIFY_OK")) {
    console.log("[pipeline] Resume check: create phase failed, marking unsupported");
    cacheResumeResult(false);
    return false;
  }

  const resume = await runClaudePhase({
    workdir: "/tmp",
    prompt: "Reply with exactly: RESUME_OK",
    timeoutMs: 30_000,
    resumeSessionId: testId,
  });
  const supported = resume.success && resume.output.includes("RESUME_OK");
  console.log(`[pipeline] Resume capability: ${supported}`);
  cacheResumeResult(supported);
  return supported;
}

function cacheResumeResult(supported: boolean) {
  setSetting("claude-resume-supported", String(supported));
  setSetting("claude-resume-checked-at", new Date().toISOString());
}

/**
 * Run a single Claude CLI phase.
 * Prompt is piped via stdin. Uses --session-id or --resume.
 * Parses stream-json output for result text.
 */
export async function runClaudePhase(opts: {
  workdir: string;
  prompt: string;
  systemPrompt?: string;
  timeoutMs?: number;
  sessionId?: string;
  resumeSessionId?: string;
}): Promise<PipelinePhaseResult> {
  // Compute once, use everywhere — no double-UUID risk
  const effectiveSessionId = opts.resumeSessionId || opts.sessionId || crypto.randomUUID();

  const args = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
  ];

  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  } else {
    args.push("--session-id", effectiveSessionId);
  }

  // System prompt only on creation (resumed sessions inherit it)
  if (opts.systemPrompt && !opts.resumeSessionId) {
    args.push("--append-system-prompt", opts.systemPrompt);
  }

  const timeout = opts.timeoutMs || PHASE_TIMEOUT_MS;

  return new Promise<PipelinePhaseResult>((resolve) => {
    const proc = spawn(resolveClaudePath(), args, {
      cwd: opts.workdir,
      env: buildClaudeEnv(),
    });

    proc.stdin!.write(opts.prompt);
    proc.stdin!.end();

    let buffer = "";
    let resultText = "";
    const assistantBlocks: string[] = [];
    let assistantBlocksSize = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      // Force kill if SIGTERM is ignored after 30s
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* already dead */ } }, 30000);
    }, timeout);

    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      // Cap buffer to prevent OOM from very long lines without newlines
      if (buffer.length > 1_000_000) {
        buffer = buffer.slice(-500_000);
      }
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
              if (block.type === "text" && block.text && assistantBlocksSize < MAX_FALLBACK_CHARS) {
                assistantBlocks.push(block.text);
                assistantBlocksSize += block.text.length;
              }
            }
          }
        } catch { /* skip non-JSON lines */ }
      }
    });

    let stderrOutput = "";
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      if (stderrOutput.length > 10000) stderrOutput = stderrOutput.slice(-10000);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          if (event.type === "result" && event.result) resultText = event.result;
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text && assistantBlocksSize < MAX_FALLBACK_CHARS) {
                assistantBlocks.push(block.text);
                assistantBlocksSize += block.text.length;
              }
            }
          }
        } catch { /* ignore */ }
      }

      // Cap resultText to prevent unbounded DB writes
      if (resultText.length > MAX_FALLBACK_CHARS) {
        resultText = resultText.substring(0, MAX_FALLBACK_CHARS);
      }

      let output = resultText.trim() || assistantBlocks.join("\n\n");
      if (timedOut) output = `[TIMEOUT after ${timeout / 1000}s] ${output}`;
      if (!output && stderrOutput) output = stderrOutput;

      const hasQuestions = /##\s*Questions/i.test(output);
      const questions = hasQuestions
        ? output.substring(output.search(/##\s*Questions/i))
        : undefined;

      resolve({
        success: code === 0 && !timedOut,
        output,
        sessionId: effectiveSessionId,
        hasQuestions,
        questions,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: err.message, sessionId: effectiveSessionId });
    });
  });
}
