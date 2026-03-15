import { spawn } from "node:child_process";

/**
 * POST /api/claude/prompt
 *
 * Spawns `claude -p` CLI to generate a response, streamed back via SSE.
 * Body: { prompt: string, systemPrompt?: string, model?: string }
 */
export async function POST(request: Request) {
  const { prompt, systemPrompt, model } = await request.json();

  if (!prompt) {
    return new Response(JSON.stringify({ error: "Prompt is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const args = [
    "-p",
    "--verbose",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions",
  ];

  if (systemPrompt) {
    args.push("--append-system-prompt", systemPrompt);
  }

  if (model) {
    args.push("--model", model);
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const proc = spawn("claude", args, {
        env: { ...process.env, FORCE_COLOR: "0" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      proc.stdin.write(prompt);
      proc.stdin.end();

      let buffer = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();

        // stream-json outputs one JSON object per line
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const event = JSON.parse(trimmed);

            // Extract text content from assistant messages
            if (event.type === "assistant" && event.message) {
              const msg = event.message;
              if (msg.content && Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block.type === "text" && block.text) {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: "text", text: block.text })}\n\n`)
                    );
                  }
                }
              } else if (typeof msg.content === "string" && msg.content) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: "text", text: msg.content })}\n\n`)
                );
              }
            }

            // result event has the final complete text
            if (event.type === "result" && event.result) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "result", text: event.result })}\n\n`)
              );
            }
          } catch {
            // Not valid JSON yet, skip
          }
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        // Only forward actual errors, not progress messages
        if (text.includes("Error") || text.includes("error")) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", text })}\n\n`)
          );
        }
      });

      proc.on("close", (code) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done", code })}\n\n`)
        );
        controller.close();
      });

      proc.on("error", (err) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", text: err.message })}\n\n`)
        );
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
