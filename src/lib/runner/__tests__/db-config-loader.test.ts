import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock the db module before importing the loader
const mockSelect = mock(() => mockSelectChain);
const mockFrom = mock(() => mockSelectChain);
const mockWhere = mock(() => mockSelectChain);
const mockLimit = mock(() => Promise.resolve([] as unknown[]));

const mockSelectChain = {
  from: mockFrom,
  where: mockWhere,
  limit: mockLimit,
};

mock.module("@/lib/db", () => ({
  db: { select: mockSelect },
}));

mock.module("@/lib/db/schema", () => ({
  agents: { id: "id", projectId: "project_id" },
  projects: { id: "id", name: "name" },
}));

mock.module("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ field: a, value: b }),
}));

const { agentRowToDefinition, loadAgentDefinitionById } = await import(
  "../db-config-loader"
);

function makeFakeRow(overrides?: Record<string, unknown>) {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    projectId: "proj-1",
    name: "test-agent",
    enabled: true,
    schedule: "0 8 * * *",
    timezone: "America/New_York",
    soul: "You are a test agent.",
    skill: "Do the thing.",
    envVars: { API_KEY: "secret" },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("agentRowToDefinition", () => {
  test("maps all fields correctly", () => {
    const row = makeFakeRow();
    const def = agentRowToDefinition(row as never);

    expect(def.agentId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(def.config.name).toBe("test-agent");
    expect(def.config.enabled).toBe(true);
    expect(def.config.schedule).toBe("0 8 * * *");
    expect(def.config.timezone).toBe("America/New_York");
    expect(def.config.envVars).toEqual({ API_KEY: "secret" });
    expect(def.soul).toBe("You are a test agent.");
    expect(def.skill).toBe("Do the thing.");
  });

  test("sets timezone to undefined when null", () => {
    const row = makeFakeRow({ timezone: null });
    const def = agentRowToDefinition(row as never);
    expect(def.config.timezone).toBeUndefined();
  });

  test("defaults envVars to empty object when null", () => {
    const row = makeFakeRow({ envVars: null });
    const def = agentRowToDefinition(row as never);
    expect(def.config.envVars).toEqual({});
  });
});

describe("loadAgentDefinitionById", () => {
  beforeEach(() => {
    mockLimit.mockReset();
  });

  test("returns null when agent not found", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await loadAgentDefinitionById("nonexistent-id");
    expect(result).toBeNull();
  });

  test("returns null when agent is disabled", async () => {
    mockLimit.mockResolvedValueOnce([makeFakeRow({ enabled: false })]);
    const result = await loadAgentDefinitionById("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(result).toBeNull();
  });

  test("returns definition for enabled agent", async () => {
    mockLimit.mockResolvedValueOnce([makeFakeRow()]);
    const result = await loadAgentDefinitionById("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(result!.config.name).toBe("test-agent");
    expect(result!.config.schedule).toBe("0 8 * * *");
  });
});
