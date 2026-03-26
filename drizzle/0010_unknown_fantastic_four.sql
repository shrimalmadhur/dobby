CREATE TABLE `agent_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`agent_run_id` text,
	`claude_session_id` text NOT NULL,
	`workspace_dir` text NOT NULL,
	`bot_token` text NOT NULL,
	`chat_id` text NOT NULL,
	`bot_message_ids` text DEFAULT '[]',
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE set null
);
