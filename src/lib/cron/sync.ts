import { exec } from "node:child_process";
import { resolve } from "node:path";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Re-sync the crontab with the current database state by running install-cron.sh.
 * Debounced (1.5s) to coalesce rapid mutations into a single sync.
 * Best-effort — failures are logged but don't propagate.
 */
export function syncCrontab(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const scriptPath = resolve(process.cwd(), "scripts", "install-cron.sh");

    exec(`bash "${scriptPath}"`, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        console.warn("[cron-sync] failed to sync crontab:", err.message);
        if (stderr) console.warn("[cron-sync] stderr:", stderr);
        return;
      }
      if (stdout.trim()) {
        console.log("[cron-sync]", stdout.trim());
      }
    });
  }, 1500);
}
