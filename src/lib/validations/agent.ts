import { z } from "zod";

const cronRegex = /^(\S+\s+){4}\S+$/;

export const createAgentSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  soul: z.string().min(1, "System prompt is required"),
  skill: z.string().min(1, "Task instructions are required"),
  schedule: z.string().min(1).regex(cronRegex, "Invalid cron expression (expected 5 fields)"),
  timezone: z.string().optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
});

export const updateAgentSchema = createAgentSchema.partial();
