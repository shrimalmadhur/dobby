# Codebase Simplification Plan

**Date**: 2026-03-27
**Goal**: Clean up the entire Dobby codebase for clarity, consistency, and maintainability while preserving all functionality.

## Overview

The codebase is ~24K lines across 173 files. It's generally well-structured but has accumulated duplication, oversized files, inconsistent patterns, and minor cleanup debt. This plan organizes cleanup into 6 phases, ordered by impact and safety (easy wins first, structural refactors last).

---

## Codebase Analysis

### Key Problem Areas

| Area | Issue | Files | Impact |
|------|-------|-------|--------|
| `pipeline.ts` | 1,536 lines, monolithic | `src/lib/issues/pipeline.ts` | Hard to test/maintain |
| Timeline builders | Two functions with 3 structural differences | `src/lib/claude/session-detail-reader.ts` | 200+ lines of near-duplication |
| Notification upserts | Same upsert pattern 4x in API routes | telegram, slack API routes | ~200 lines repeated |
| Shared CSS classes | `inputClasses` duplicated exactly | `agent-form.tsx`, `env-vars-editor.tsx` | Divergence risk |
| `formatTokens` | Identical function in 2 session pages | `sessions/page.tsx`, `sessions/[id]/page.tsx` | Copy-paste |
| Metadata extraction | Same loop appears 2x | `session-detail-reader.ts` | Copy-paste |
| Settings page | 990 lines, multiple concerns | `src/app/(app)/settings/page.tsx` | Hard to maintain |
| Large pages | 5 pages over 700 lines each | issues/, agents/, settings pages | Readability |
| MCP PATCH validation | No input validation on update | `mcp/servers/[id]/route.ts` | Security gap |

### Architecture Notes

- **Agent core** (`src/lib/agent/core.ts`) is an agentic loop: gather tools → call LLM → execute tool_calls → loop
- **Claude session module** (`src/lib/claude/`) reads JSONL session files and stores summaries in DB — two readers share some logic
- **Issues pipeline** (`src/lib/issues/pipeline.ts`) orchestrates GitHub issue processing through 8 phases (plan → review → fix → implement → code review → code fix → PR → notify) — biggest single file
- **API routes** use a consistent `withErrorHandler` wrapper but have inconsistent validation depth
- **MCP client** manages subprocess-based tool servers with a 5-min failure cache

### Critical Files to Reference

- `src/lib/claude/session-detail-reader.ts` (447 lines) — `buildTimeline()` vs `buildSubAgentTimeline()` have 3 structural differences
- `src/lib/claude/session-utils.ts` — canonical `TokenUsage` definition (only place it's defined)
- `src/lib/issues/pipeline.ts` (1,536 lines) — the main refactoring target, exports `runIssuePipeline` and `buildWorktreePath`
- `src/app/api/agents/[agentId]/telegram/route.ts` — canonical upsert pattern duplicated across routes
- `src/app/(app)/sessions/page.tsx` and `sessions/[id]/page.tsx` — both define `formatTokens()`

---

## Phase 1: Dead Code & Unused Exports

**Risk**: Low — removing unused code can't break anything if verified unused.

### Steps

1. **Audit all exports across `src/lib/`** — For each exported function/type, grep for imports. Any export with zero external references should be either un-exported (made module-private) or removed entirely. Do NOT assume anything is dead without verifying via grep first.

2. **Run a comprehensive unused-export scan** — Use `bun run tsc --noEmit` combined with grep to identify truly orphaned exports. Only remove code confirmed to have zero importers.

### Verification
- `bun run tsc --noEmit` must pass after each deletion
- `bun test` must pass — all 32 existing test files must remain green
- Grep each name before removing to confirm zero external references

---

## Phase 2: Type & Constant Deduplication

**Risk**: Low — extracting shared constants is mechanical.

### Steps

1. **Extract shared CSS class constants** — create `src/components/shared/form-classes.ts`:
   ```typescript
   export const inputClasses = "w-full border border-border bg-background px-3 py-2 text-[15px] font-mono text-foreground placeholder:text-muted/40 outline-none transition-all focus:border-accent input-focus";
   export const labelClasses = "block text-[13px] font-medium text-foreground/70 mb-1.5";
   ```
   Update `src/components/agents/agent-form.tsx` and `src/components/agents/env-vars-editor.tsx` to import from there.

2. **Add shared `formatTokens()` utility** — add to the existing `src/lib/utils/format.ts` (which already contains `formatDuration()`). Also update the existing test file `src/lib/utils/__tests__/format.test.ts` with tests for the new `formatTokens()` function. Update:
   - `src/app/(app)/sessions/page.tsx`
   - `src/app/(app)/sessions/[id]/page.tsx`

3. **Move `DENIED_ENV_KEYS`** from `src/lib/runner/agent-memory.ts` to `src/lib/validations/constants.ts` to break the cross-layer import from `src/lib/validations/agent.ts` into the runner module. Co-locating with the validations layer avoids creating a generic top-level `constants.ts` dumping ground. Update both `agent-memory.ts` and `agent.ts` to import from the new location.

### Verification
- `bun run tsc --noEmit` must pass
- `bun test` must pass
- `bun run dev` — spot-check the UI renders correctly

---

## Phase 3: Function-Level Deduplication in `src/lib/claude/`

**Risk**: Medium — these are data-processing functions, bugs would show as incorrect session displays.

### Steps

1. **Write regression tests for timeline builders before merging** — Verify test coverage for `buildTimeline` and `buildSubAgentTimeline` in `src/lib/claude/__tests__/`. Currently, no tests cover these functions. Before any refactoring, write regression tests that capture the current output of both functions (including edge cases for all 3 structural differences). This ensures the merge doesn't silently break session display.

2. **Merge `buildTimeline()` and `buildSubAgentTimeline()`** in `session-detail-reader.ts`:
   - These share ~80% of their logic but have **3 structural differences**:
     1. Sidechain filtering (`buildTimeline` filters out sidechains, `buildSubAgentTimeline` does not)
     2. User message type filtering (`buildTimeline` uses `external` only, `buildSubAgentTimeline` uses `external || internal`)
     3. Sub-agent launch deduplication (present in `buildTimeline`, absent in `buildSubAgentTimeline`)
   - **Action**: Parameterize with options: `buildTimeline(entries, { filterSidechain?: boolean, includeInternalMessages?: boolean, trackSubAgentLaunches?: boolean })`
   - Default values should match current `buildTimeline` behavior so existing callers don't change
   - `buildSubAgentTimeline` callers switch to `buildTimeline(entries, { includeInternalMessages: true })`

3. **Extract shared metadata extraction helper** — `session-detail-reader.ts` has the same metadata-extraction loop (slug, model, gitBranch, cwd) appearing **2 times** (lines ~260-270 and ~331-341). Extract to `extractSessionMetadata(entries)` helper in `src/lib/claude/session-utils.ts`.

### Verification
- `bun run tsc --noEmit`
- Run claude session tests: `bun test src/lib/claude/`
- Verify the new timeline regression tests pass after the merge
- Manual: open the sessions page and verify timeline renders correctly

---

## Phase 4: API Route Cleanup

**Risk**: Medium — API changes could break the frontend.

### Steps

1. **Add unique constraint on `notificationConfigs.channel`** — the `channel` column in `src/lib/db/schema.ts` currently has no unique constraint. Before building the upsert helper, a migration is required:
   - Verify data uniqueness: query `SELECT channel, COUNT(*) FROM notification_configs GROUP BY channel HAVING COUNT(*) > 1` to confirm no duplicates exist. Channel values use composite keys like `telegram-agent:{agentId}` and `slack-issues`, so they should be unique in practice.
   - Add `.unique()` to the `channel` column in `src/lib/db/schema.ts`
   - Run `bun run db:generate` to create a migration file
   - The migration will be auto-applied on next startup

   **This is a prerequisite for Step 2** — the `ON CONFLICT(channel)` clause requires a unique constraint to function.

2. **Extract notification config upsert helper** — the select-then-insert/update upsert pattern repeats in 4+ routes:
   - `src/app/api/agents/[agentId]/telegram/route.ts`
   - `src/app/api/issues/telegram/route.ts`
   - `src/app/api/issues/slack/route.ts`
   - `src/app/api/notifications/telegram/bots/copy/route.ts`

   **Action**: Create `src/lib/db/notification-config.ts` with:
   ```typescript
   export async function upsertNotificationConfig(channel: string, config: Record<string, string>) {
     // Use SQLite's INSERT ... ON CONFLICT(channel) DO UPDATE SET ...
     // This requires the unique constraint added in Step 1.
     // The current select-then-branch pattern is vulnerable to TOCTOU race conditions
     // where concurrent requests both find no row and both try to insert.
   }
   ```
   The shared helper **must** use `INSERT ... ON CONFLICT(channel) DO UPDATE SET ...` rather than reproducing the existing select-then-branch pattern. Replace all 4 inline upsert blocks.

3. **Fix missing validation in MCP server PATCH** — `src/app/api/mcp/servers/[id]/route.ts` accepts arbitrary PATCH bodies with no validation and passes raw `body` directly to `.set(body)`. Add a Zod schema that allowlists only the mutable fields from the `mcpServers` schema:
   - **Allowed**: `name`, `command`, `args`, `env`, `enabled`
   - **Excluded**: `id`, `createdAt` (immutable fields must not be settable via PATCH)

   ```typescript
   const mcpServerUpdateSchema = z.object({
     name: z.string().optional(),
     command: z.string().optional(),
     args: z.array(z.string()).optional(),
     env: z.record(z.string()).optional(),
     enabled: z.boolean().optional(),
   });
   ```

### Verification
- `bun run tsc --noEmit`
- `bun test` must pass
- `bun run dev` — test the telegram config save, MCP server edit, and issue config pages
- Verify the migration applies cleanly: restart dev server and check no errors

---

## Phase 5: Large Component Decomposition

**Risk**: Medium — UI changes are visible but straightforward to verify.

### Steps

1. **Audit shared state and component boundaries before splitting** — Before extracting any sections, audit each target component for:
   - Shared state (e.g., global loading/saving flags, form state shared across sections)
   - Event handlers passed between sections
   - Server vs. client component boundaries (the settings page is `"use client"`, so all extracted sections will also be client components)
   - Document the prop interfaces each extracted section will need

2. **Split `settings/page.tsx` (990 lines)** into:
   - `src/components/settings/mcp-servers-section.tsx` — MCP server list/add/edit/delete
   - `src/components/settings/env-vars-section.tsx` — environment variable management
   - `src/components/settings/session-retention-section.tsx` — retention config
   - `src/app/(app)/settings/page.tsx` — thin page that composes the sections
   - All extracted sections are client components (parent is `"use client"`). Pass shared state (loading flags, refresh callbacks) as props.

3. **Split `projects/[id]/agents/[agentId]/page.tsx` (925 lines)** into:
   - `src/components/agents/agent-detail-header.tsx` — name, status, edit toggle
   - `src/components/agents/agent-runs-list.tsx` — run history table
   - `src/components/agents/telegram-config-section.tsx` — telegram setup/test UI
   - Keep the page as a composer. Audit server/client boundary before splitting.

4. **Split `claude-panel.tsx` (369 lines)**:
   - Extract streaming chat logic into `useClaudeChat()` custom hook
   - Extract message rendering into a subcomponent
   - Target: page component < 200 lines

### Verification
- `bun run tsc --noEmit`
- `bun test` must pass
- `bun run dev` — visually verify settings page, agent detail page, and issues pages
- Side-by-side visual comparison before and after to catch layout regressions

---

## Phase 6: `pipeline.ts` Refactor (1,536 lines)

**Risk**: Higher — this is the core issue-processing engine. Must be done carefully. **Recommend as a separate PR.**

### Steps

1. **Map actual phase boundaries** — the pipeline has **8 numbered phases** (from `PHASE_STATUS_MAP` in `types.ts`):
   - Phase 0: `pending` — Initial state
   - Phase 1: `planning` — Create implementation plan via LLM
   - Phase 2: `reviewing_plan_1` — Adversarial plan review (runs in parallel with Phase 3)
   - Phase 3: `reviewing_plan_2` — Completeness plan review (runs in parallel with Phase 2)
   - Phase 4: `implementing` — Code implementation via Claude session
   - Phase 5-6: `reviewing_code_1` / `reviewing_code_2` — **3 parallel specialist reviewers** (Bugs & Logic, Security & Edge Cases, Design & Performance) dispatched via `Promise.allSettled()`. The PHASE_STATUS_MAP has only 2 status entries for code review, but the implementation runs 3 specialists tracked as sessions `5a`, `5b`, `5c`.
   - Phase 7: `creating_pr` — PR creation and git operations

   Plus iterative fix loops (plan fix up to 5 iterations, code fix up to 3 iterations) and notification at the end.

2. **Extract into phase modules** under `src/lib/issues/pipeline/`:
   - `orchestrator.ts` — main `runIssuePipeline()` function that calls phases in order, manages session state
   - `planning.ts` — plan generation phase (Phase 1)
   - `plan-review.ts` — adversarial + completeness review, run in parallel (Phases 2-3)
   - `plan-fix.ts` — iterative plan fix loop with convergence detection (up to 5 iterations)
   - `implementation.ts` — Claude session execution (Phase 4)
   - `code-review.ts` — 3 parallel code review specialists (Bugs & Logic, Security & Edge Cases, Design & Performance) with read-only enforcement (Phases 5-6)
   - `code-fix.ts` — code fix loop with convergence detection (up to 3 iterations)
   - `pr.ts` — PR creation and git operations (Phase 7)
   - `notifications.ts` — Telegram/Slack message formatting and sending

3. **Handle cross-cutting concerns** — the pipeline has several concerns that span phases:
   - **`isCancelled()` polling** — checked at ~10 points throughout the pipeline. Must be passed to or accessible from each phase module.
   - **`getUserAnswers()` for Q&A** — used in plan fix and code fix loops for interactive user input. Pass as a dependency to fix-loop modules.
   - **Session resumption** (`resumeSessionId`) — used to resume Claude sessions across iterations. The orchestrator tracks session IDs and passes them to relevant phases.

   These should either live in the orchestrator (preferred, since they manage shared state) or be passed as a context/dependencies object to phase modules.

4. **Keep the public API identical** — `src/lib/issues/pipeline.ts` becomes a thin re-export:
   ```typescript
   export { runIssuePipeline } from "./pipeline/orchestrator";
   export { buildWorktreePath } from "./pipeline/orchestrator";
   ```
   This means no callers need to change.

5. **Move shared pipeline types** to `src/lib/issues/types.ts` (many are likely already there).

### Verification
- `bun run tsc --noEmit`
- Run pipeline tests: `bun test src/lib/issues/`
- `bun test` — all 32 test files must pass
- Manual: trigger an issue pipeline run and verify it completes

---

## Dependencies

No new runtime dependencies needed. All changes use existing libraries (drizzle-orm, zod, react). Phase 4 Step 1 requires a Drizzle schema migration (`bun run db:generate`) for the unique constraint on `notificationConfigs.channel`.

## Testing Strategy

1. **Type-check gate**: `bun run tsc --noEmit` after every phase
2. **Automated test gate**: `bun test` after every phase — all 32 existing test files must pass. Key test locations:
   - `src/lib/claude/__tests__/` — claude session tests
   - `src/lib/issues/__tests__/pipeline.test.ts` — pipeline tests
   - `src/lib/runner/` — runner tests
   - `src/lib/validations/` — validation tests
   - `src/lib/utils/__tests__/format.test.ts` — format utility tests
3. **Dev server smoke test**: `bun run dev` and verify key pages render
4. **Manual verification** for UI-facing changes (phases 4-5)
5. **Pipeline integration test** (phase 6): Run a test issue through the pipeline after refactoring

## Execution Order & Estimates

| Phase | Description | Files Changed | Risk |
|-------|-------------|---------------|------|
| 1 | Dead code audit & removal | 2-5 | Low |
| 2 | Constant/utility dedup | 8-10 | Low |
| 3 | Claude module dedup | 4-6 (includes new tests) | Medium |
| 4 | API route cleanup (includes migration) | 7-9 | Medium |
| 5 | Component decomposition | 8-12 | Medium |
| 6 | Pipeline refactor (separate PR) | 10-12 (new) + 1 (rewrite) | Higher |

**Total**: ~39-54 files touched across all phases.

## Risks & Mitigations

- **Regression risk**: Mitigated by running type-checker, `bun test`, and dev server after each phase. Commit after each phase so rollback is easy.
- **Pipeline breakage (Phase 6)**: This is the highest-risk phase. Keep the public API (`runIssuePipeline`, `buildWorktreePath`) identical. Do as a separate PR.
- **UI visual regressions (Phase 5)**: Component extraction shouldn't change rendered output. Side-by-side visual comparison recommended. Audit shared state and prop interfaces before splitting.
- **Import path breaks**: Using `@/` aliases consistently avoids relative-path confusion.
- **Notification race condition (Phase 4)**: Current upsert pattern has TOCTOU vulnerability — the shared helper must use `ON CONFLICT` to fix this. Requires adding a unique constraint on `notificationConfigs.channel` first (via Drizzle migration).
- **Schema migration (Phase 4)**: Adding `.unique()` to `channel` will fail if duplicate rows exist. Verify data uniqueness before applying the migration.
- **Timeline merge regression (Phase 3)**: No existing tests cover `buildTimeline`/`buildSubAgentTimeline`. Regression tests must be written before the merge to catch silent breakage.

---

VERDICT: READY
