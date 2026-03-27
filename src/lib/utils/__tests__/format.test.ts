import { describe, test, expect } from "bun:test";
import { formatDuration, formatTokens } from "../format";

describe("formatDuration", () => {
  test("formats 0ms", () => {
    expect(formatDuration(0)).toBe("0ms");
  });

  test("formats sub-second values as milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1)).toBe("1ms");
  });

  test("formats 1000ms as seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
  });

  test("formats larger values as seconds with one decimal", () => {
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(60000)).toBe("60.0s");
    expect(formatDuration(12345)).toBe("12.3s");
  });
});

describe("formatTokens", () => {
  test("formats small numbers as-is", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(1)).toBe("1");
    expect(formatTokens(999)).toBe("999");
  });

  test("formats thousands with K suffix", () => {
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(999_999)).toBe("1000.0K");
  });

  test("formats millions with M suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
    expect(formatTokens(10_000_000)).toBe("10.0M");
  });
});
