import dotenv from "dotenv";
import fs from "node:fs";

// Load env
if (fs.existsSync(".env.local")) {
  dotenv.config({ path: ".env.local" });
} else if (fs.existsSync("/etc/jarvis/env")) {
  dotenv.config({ path: "/etc/jarvis/env" });
}

import { db } from "../src/lib/db";
import { projects, agents, notificationConfigs } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import { loadAgentDefinitions } from "../src/lib/runner/config-loader";

async function main() {
  console.log("Migrating filesystem agents to database...\n");

  // Load all filesystem agents
  const definitions = await loadAgentDefinitions(undefined, {
    includeDisabled: true,
    resolveEnv: false,
  });

  if (definitions.length === 0) {
    console.log("No filesystem agents found to migrate.");
    return;
  }

  // Create or get "Default" project
  let projectId: string;
  const existing = await db
    .select()
    .from(projects)
    .where(eq(projects.name, "Default"))
    .limit(1);

  if (existing.length > 0) {
    projectId = existing[0].id;
    console.log(`Using existing "Default" project (${projectId})`);
  } else {
    const [created] = await db
      .insert(projects)
      .values({
        name: "Default",
        description: "Migrated from filesystem agents",
      })
      .returning();
    projectId = created.id;
    console.log(`Created "Default" project (${projectId})`);
  }

  // Migrate each agent
  let migrated = 0;
  let skipped = 0;

  for (const def of definitions) {
    // Check if agent already exists in DB
    const existingAgent = await db
      .select()
      .from(agents)
      .where(eq(agents.name, def.config.name))
      .limit(1);

    if (existingAgent.length > 0) {
      console.log(`  SKIP: "${def.config.name}" already exists in DB`);
      skipped++;
      continue;
    }

    // Insert agent
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

    console.log(`  OK: "${def.config.name}" -> agent ID ${created.id}`);

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
      console.log(`       Telegram config migrated to agent ID key`);
    }

    migrated++;
  }

  console.log(`\nDone! Migrated: ${migrated}, Skipped: ${skipped}`);
  console.log(
    "\nRecommendation: After verifying DB agents work correctly,\n" +
    "disable or remove the filesystem agent folders in agents/ to prevent duplicate runs."
  );
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
