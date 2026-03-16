import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  readWorkspaceMemory,
  formatMemoryForPrompt,
  extractMemorySection,
  MEMORY_CONTEXT_NOTE,
} from "../agent-memory";

const TEST_WORKSPACE = join(import.meta.dir, ".tmp-test-workspace");

beforeEach(() => {
  mkdirSync(TEST_WORKSPACE, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_WORKSPACE, { recursive: true, force: true });
});

describe("readWorkspaceMemory", () => {
  test("returns empty string for missing file", () => {
    expect(readWorkspaceMemory(TEST_WORKSPACE)).toBe("");
  });

  test("returns file contents when memory.md exists", () => {
    writeFileSync(join(TEST_WORKSPACE, "memory.md"), "## Topics\n- Apples\n");
    expect(readWorkspaceMemory(TEST_WORKSPACE)).toBe("## Topics\n- Apples");
  });

  test("truncates files > 8000 chars", () => {
    const longContent = "x".repeat(9000);
    writeFileSync(join(TEST_WORKSPACE, "memory.md"), longContent);
    const result = readWorkspaceMemory(TEST_WORKSPACE);
    expect(result.length).toBeLessThan(9000);
    expect(result).toContain("[memory truncated");
  });

  test("returns empty string for non-existent workspace dir", () => {
    expect(readWorkspaceMemory("/tmp/nonexistent-workspace-xyz")).toBe("");
  });
});

describe("formatMemoryForPrompt", () => {
  test("returns empty string for empty content", () => {
    expect(formatMemoryForPrompt("")).toBe("");
  });

  test("wraps content with heading and separators", () => {
    const result = formatMemoryForPrompt("## Topics\n- Apples");
    expect(result).toContain("## Your Memory (from previous runs)");
    expect(result).toContain("---");
    expect(result).toContain("## Topics\n- Apples");
  });

  test("includes usage guidance", () => {
    const result = formatMemoryForPrompt("some memory");
    expect(result).toContain("avoid repeating work");
  });
});

describe("extractMemorySection", () => {
  test("extracts ## Memory section from skill text", () => {
    const skill = [
      "## Task",
      "Do something interesting.",
      "",
      "## Memory",
      "Track which ingredients you've analyzed.",
      "Track the scores given.",
      "",
      "## Output Format",
      "Use markdown.",
    ].join("\n");

    const result = extractMemorySection(skill);
    expect(result).toBe("Track which ingredients you've analyzed.\nTrack the scores given.");
  });

  test("returns null when no Memory section exists", () => {
    const skill = "## Task\nDo something.\n\n## Output Format\nMarkdown.";
    expect(extractMemorySection(skill)).toBeNull();
  });

  test("handles Memory section at end of text", () => {
    const skill = "## Task\nDo stuff.\n\n## Memory\nTrack topics covered.";
    const result = extractMemorySection(skill);
    expect(result).toBe("Track topics covered.");
  });

  test("handles empty Memory section", () => {
    const skill = "## Task\nDo stuff.\n\n## Memory\n\n## Output\nMarkdown.";
    expect(extractMemorySection(skill)).toBeNull();
  });

  test("is case-insensitive for heading", () => {
    const skill = "## MEMORY\nTrack items.";
    expect(extractMemorySection(skill)).toBe("Track items.");
  });
});

describe("MEMORY_CONTEXT_NOTE", () => {
  test("does NOT contain write instructions (only prohibition)", () => {
    const lower = MEMORY_CONTEXT_NOTE.toLowerCase();
    // Should NOT tell the agent HOW to write memory
    expect(lower).not.toContain("update `./memory.md`");
    expect(lower).not.toContain("write_file");
    expect(lower).not.toContain("bash echo");
    expect(lower).not.toContain("before your final response");
    // Should explicitly tell the agent NOT to write
    expect(lower).toContain("do not write to memory.md");
    expect(lower).toContain("handled automatically");
  });

  test("mentions memory is handled automatically", () => {
    expect(MEMORY_CONTEXT_NOTE.toLowerCase()).toContain("handled automatically");
  });

  test("references previous runs section", () => {
    expect(MEMORY_CONTEXT_NOTE).toContain("Your Memory (from previous runs)");
  });
});
