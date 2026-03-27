import { loadEnv } from "./lib/load-env";
loadEnv();

import { db } from "../src/lib/db";
import { issues } from "../src/lib/db/schema";
import { runIssuePipeline } from "../src/lib/issues/pipeline";
import { getIssuesTelegramConfig } from "../src/lib/issues/telegram-poller";
import { getIssuesSlackConfig } from "../src/lib/issues/slack";
import { eq } from "drizzle-orm";

async function main() {
  const args = process.argv.slice(2);
  const issueIdx = args.indexOf("--issue");
  if (issueIdx === -1 || !args[issueIdx + 1]) {
    console.error("Usage: bun run scripts/issue-pipeline.ts --issue <issue-id>");
    process.exit(1);
  }
  const issueId = args[issueIdx + 1];

  const [issue] = await db.select({
    slackChannelId: issues.slackChannelId,
    slackThreadTs: issues.slackThreadTs,
  }).from(issues).where(eq(issues.id, issueId)).limit(1);

  if (!issue) {
    console.error(`Issue not found: ${issueId}`);
    process.exit(1);
  }

  const useSlack = Boolean(issue.slackChannelId && issue.slackThreadTs);

  if (useSlack) {
    const slackConfig = await getIssuesSlackConfig();
    if (!slackConfig) {
      console.error("No Slack issues app configured. Set it up via Issues > Config in the UI.");
      process.exit(1);
    }

    console.log(`Running pipeline for issue: ${issueId}`);
    await runIssuePipeline(issueId, { kind: "slack", ...slackConfig });
    console.log("Pipeline complete.");
    return;
  }

  const config = await getIssuesTelegramConfig();
  if (!config) {
    console.error("No Telegram issues bot configured. Set up via Issues > Config in the UI.");
    process.exit(1);
  }

  console.log(`Running pipeline for issue: ${issueId}`);
  await runIssuePipeline(issueId, { kind: "telegram", ...config });
  console.log("Pipeline complete.");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
