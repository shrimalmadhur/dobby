import { describe, test, expect, mock, beforeEach } from "bun:test";

// Capture exec calls
let execCalls: Array<{ cmd: string; opts: Record<string, unknown> }> = [];

mock.module("node:child_process", () => ({
  exec: (cmd: string, opts: Record<string, unknown>, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    execCalls.push({ cmd, opts });
    // Simulate success by default
    cb(null, "Added: test-agent [0 8 * * *]\nCrontab updated.", "");
  },
}));

const { syncCrontab } = await import("../sync");

beforeEach(() => {
  execCalls = [];
});

describe("syncCrontab", () => {
  test("calls install-cron.sh after debounce", async () => {
    syncCrontab();

    // Should not fire immediately (debounced)
    expect(execCalls.length).toBe(0);

    // Wait for debounce to fire (1.5s + buffer)
    await new Promise((r) => setTimeout(r, 2000));

    expect(execCalls.length).toBe(1);
    expect(execCalls[0].cmd).toContain("install-cron.sh");
    expect(execCalls[0].cmd).toStartWith("bash ");
  });

  test("sets a timeout on the exec call", async () => {
    syncCrontab();
    await new Promise((r) => setTimeout(r, 2000));

    expect(execCalls[0].opts.timeout).toBe(15_000);
  });

  test("debounces multiple rapid calls into one exec", async () => {
    syncCrontab();
    syncCrontab();
    syncCrontab();

    await new Promise((r) => setTimeout(r, 2000));

    // Only one exec despite three calls
    expect(execCalls.length).toBe(1);
  });

  test("does not throw when exec fails", () => {
    mock.module("node:child_process", () => ({
      exec: (cmd: string, opts: Record<string, unknown>, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        execCalls.push({ cmd, opts });
        cb(new Error("crontab: permission denied"), "", "permission denied");
      },
    }));

    // Should not throw
    expect(() => syncCrontab()).not.toThrow();
  });
});
