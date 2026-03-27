import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

describe("instrumentation register()", () => {
  let originalBun: string | undefined;
  let originalNextRuntime: string | undefined;

  beforeEach(() => {
    originalBun = process.versions.bun;
    originalNextRuntime = process.env.NEXT_RUNTIME;
    // Simulate the Next.js Node.js server runtime
    process.env.NEXT_RUNTIME = "nodejs";
    // Reset the globalThis poller state so ensurePollerRunning is callable
    const g = globalThis as unknown as { _issuePoller?: { running: boolean; starting: boolean } };
    g._issuePoller = { running: false, starting: false };
    const slack = globalThis as unknown as { _slackIssueSocket?: { running: boolean; starting: boolean } };
    slack._slackIssueSocket = { running: false, starting: false };
  });

  afterEach(() => {
    // Restore bun version
    Object.defineProperty(process.versions, "bun", {
      value: originalBun,
      writable: true,
      configurable: true,
    });
    // Restore NEXT_RUNTIME
    if (originalNextRuntime === undefined) {
      delete process.env.NEXT_RUNTIME;
    } else {
      process.env.NEXT_RUNTIME = originalNextRuntime;
    }
  });

  test("starts issue transports in bun runtime", async () => {
    // We're running under bun, so process.versions.bun is already set
    expect(process.versions.bun).toBeTruthy();

    const { register } = await import("../instrumentation");
    await register();

    // Both transport managers set starting=true on the global state
    const g = globalThis as unknown as { _issuePoller?: { running: boolean; starting: boolean } };
    expect(g._issuePoller!.starting).toBe(true);
    const slack = globalThis as unknown as { _slackIssueSocket?: { running: boolean; starting: boolean } };
    expect(slack._slackIssueSocket!.starting).toBe(true);
  });

  test("skips in non-bun runtime", async () => {
    // Simulate Node.js environment
    Object.defineProperty(process.versions, "bun", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const { register } = await import("../instrumentation");
    await register();

    // Transport managers should NOT have been called
    const g = globalThis as unknown as { _issuePoller?: { running: boolean; starting: boolean } };
    expect(g._issuePoller!.starting).toBe(false);
    const slack = globalThis as unknown as { _slackIssueSocket?: { running: boolean; starting: boolean } };
    expect(slack._slackIssueSocket!.starting).toBe(false);
  });
});
