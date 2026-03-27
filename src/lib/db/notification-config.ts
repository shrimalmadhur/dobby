import { db } from "@/lib/db";
import { notificationConfigs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Upsert a notification config by channel key.
 * Uses ON CONFLICT to avoid TOCTOU race conditions.
 */
export function upsertNotificationConfig(
  channel: string,
  config: Record<string, string>,
  enabled = true
): void {
  db.insert(notificationConfigs)
    .values({ channel, enabled, config })
    .onConflictDoUpdate({
      target: notificationConfigs.channel,
      set: { enabled, config, updatedAt: new Date() },
    })
    .run();
}

/**
 * Get a notification config by channel key. Returns null if not found.
 */
export function getNotificationConfig(channel: string) {
  return db
    .select()
    .from(notificationConfigs)
    .where(eq(notificationConfigs.channel, channel))
    .get() ?? null;
}

/**
 * Delete a notification config by channel key.
 */
export function deleteNotificationConfig(channel: string): void {
  db.delete(notificationConfigs)
    .where(eq(notificationConfigs.channel, channel))
    .run();
}
