import { db } from "./index";
import { projects, agents, notificationConfigs } from "./schema";
import { eq, and } from "drizzle-orm";
import { loadAgentDefinitions } from "@/lib/runner/config-loader";

let migrationRan = false;

/**
 * Auto-migrate filesystem agents to DB on first call.
 * Idempotent — skips agents that already exist in the "Default" project.
 * Called lazily (not at import time) to avoid blocking startup.
 */
export async function autoMigrateFilesystemAgents(): Promise<void> {
  if (migrationRan) return;
  migrationRan = true;

  try {
    const definitions = await loadAgentDefinitions(undefined, {
      includeDisabled: true,
      resolveEnv: false,
    });

    if (definitions.length === 0) return;

    // Check if any DB agents exist already — if so, migration was likely already done
    const existingAgents = await db.select({ id: agents.id }).from(agents).limit(1);
    if (existingAgents.length > 0) return;

    // Create or get "Default" project
    let projectId: string;
    const existingProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.name, "Default"))
      .limit(1);

    if (existingProjects.length > 0) {
      projectId = existingProjects[0].id;
    } else {
      const [created] = await db
        .insert(projects)
        .values({
          name: "Default",
          description: "Auto-migrated from filesystem agents",
        })
        .returning();
      projectId = created.id;
    }

    // Migrate each agent
    let migrated = 0;

    for (const def of definitions) {
      // Skip if already exists in this project
      const existing = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.name, def.config.name), eq(agents.projectId, projectId)))
        .limit(1);

      if (existing.length > 0) continue;

      const [created] = await db
        .insert(agents)
        .values({
          projectId,
          name: def.config.name,
          enabled: def.config.enabled,
          soul: def.soul,
          skill: def.skill,
          schedule: def.config.schedule,
          timezone: def.config.timezone || null,
          envVars: def.config.envVars || {},
        })
        .returning();

      // Migrate Telegram notification config
      const telegramRows = await db
        .select()
        .from(notificationConfigs)
        .where(eq(notificationConfigs.channel, `telegram-agent:${def.config.name}`))
        .limit(1);

      if (telegramRows.length > 0) {
        await db
          .update(notificationConfigs)
          .set({ channel: `telegram-agent:${created.id}` })
          .where(eq(notificationConfigs.id, telegramRows[0].id));
      }

      migrated++;
    }

    if (migrated > 0) {
      console.log(`[jarvis] Auto-migrated ${migrated} filesystem agent(s) to DB`);
    }
  } catch (err) {
    // Don't crash the app if migration fails — just log
    console.warn("[jarvis] Auto-migration of filesystem agents failed:", err);
  }
}
