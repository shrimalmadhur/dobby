import { describe, test, expect } from "bun:test";
import type { ClaudeSessionEntry } from "../types";
import { buildTimeline } from "../session-detail-reader";

// Helper to create minimal entries
function entry(overrides: Partial<ClaudeSessionEntry>): ClaudeSessionEntry {
  return {
    type: "assistant",
    sessionId: "test-session",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildTimeline (default / parent mode)", () => {
  test("returns empty array for empty entries", () => {
    expect(buildTimeline([])).toEqual([]);
  });

  test("skips entries without timestamp", () => {
    const result = buildTimeline([
      entry({ timestamp: undefined as unknown as string, type: "assistant", message: { role: "assistant", content: "hi" } }),
    ]);
    expect(result).toEqual([]);
  });

  test("captures external user text messages", () => {
    const result = buildTimeline([
      entry({ type: "user", userType: "external", message: { role: "user", content: "Hello" } }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("user");
    expect(result[0].text).toBe("Hello");
  });

  test("skips internal user messages in default mode", () => {
    const result = buildTimeline([
      entry({ type: "user", userType: "internal", message: { role: "user", content: "Internal prompt" } }),
    ]);
    // Internal user messages are treated as tool results (not user text)
    // They should not produce a "user" kind entry
    const userEntries = result.filter((e) => e.kind === "user");
    expect(userEntries).toHaveLength(0);
  });

  test("captures assistant text blocks", () => {
    const result = buildTimeline([
      entry({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I will help you." }],
        },
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("assistant");
    expect(result[0].text).toBe("I will help you.");
  });

  test("captures tool_use blocks", () => {
    const result = buildTimeline([
      entry({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
        },
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("tool_use");
    expect(result[0].toolName).toBe("Bash");
    expect(result[0].text).toContain("ls -la");
  });

  test("captures tool_result blocks from user entries", () => {
    const result = buildTimeline([
      entry({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "file.txt", is_error: false }],
        },
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("tool_result");
    expect(result[0].isError).toBe(false);
  });

  test("skips sidechain entries in default mode", () => {
    const result = buildTimeline([
      entry({
        type: "assistant",
        isSidechain: true,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Sidechain work" }],
        },
      }),
    ]);
    expect(result).toHaveLength(0);
  });

  test("deduplicates sub-agent launches", () => {
    const result = buildTimeline([
      entry({
        type: "progress",
        data: { type: "agent_progress", agentId: "agent-1", prompt: "Do task" },
      }),
      entry({
        type: "progress",
        data: { type: "agent_progress", agentId: "agent-1", prompt: "Do task again" },
      }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("sub_agent");
    expect(result[0].agentId).toBe("agent-1");
  });

  test("handles string content on assistant messages", () => {
    const result = buildTimeline([
      entry({ type: "assistant", message: { role: "assistant", content: "Plain text" } }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("assistant");
    expect(result[0].text).toBe("Plain text");
  });

  test("includes token usage from message.usage", () => {
    const result = buildTimeline([
      entry({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Response" }],
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
        },
      }),
    ]);
    expect(result[0].tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
    });
  });
});

describe("buildTimeline (sub-agent mode: includeInternalMessages)", () => {
  test("includes internal user messages", () => {
    const result = buildTimeline(
      [entry({ type: "user", userType: "internal", message: { role: "user", content: "Internal prompt" } })],
      { includeInternalMessages: true }
    );
    const userEntries = result.filter((e) => e.kind === "user");
    expect(userEntries).toHaveLength(1);
    expect(userEntries[0].text).toBe("Internal prompt");
  });

  test("does not skip sidechain entries", () => {
    const result = buildTimeline(
      [
        entry({
          type: "assistant",
          isSidechain: true,
          message: { role: "assistant", content: [{ type: "text", text: "Sub-agent work" }] },
        }),
      ],
      { includeInternalMessages: true }
    );
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Sub-agent work");
  });

  test("does not track sub-agent launches", () => {
    const result = buildTimeline(
      [
        entry({
          type: "progress",
          data: { type: "agent_progress", agentId: "agent-1", prompt: "Do task" },
        }),
      ],
      { includeInternalMessages: true }
    );
    expect(result).toHaveLength(0);
  });
});

describe("buildTimeline (mixed options)", () => {
  test("default options match parent timeline behavior", () => {
    const entries = [
      entry({ type: "user", userType: "external", message: { role: "user", content: "Hi" } }),
      entry({ type: "user", userType: "internal", message: { role: "user", content: "Internal" } }),
      entry({ type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "Side" }] } }),
      entry({ type: "progress", data: { type: "agent_progress", agentId: "a1", prompt: "p" } }),
      entry({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Reply" }] } }),
    ];

    const result = buildTimeline(entries);
    // Should have: 1 user, 1 sub_agent, 1 assistant = 3 entries
    // Internal user message is not a "user" kind (treated as tool result container with no tool_results)
    // Sidechain is filtered out
    expect(result.map((e) => e.kind)).toEqual(["user", "sub_agent", "assistant"]);
  });
});
