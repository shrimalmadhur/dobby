/**
 * Shared HP-themed phase labels for the issues pipeline UI.
 *
 * The list-page array is 0-indexed (index 0 = "Pending" / "Awaiting Owl").
 * The detail-page array is 1-indexed (phase 1–7, no Pending entry).
 * Both are derived from the same vocabulary so they stay in sync.
 */

/** Phase labels for the list page (0-indexed, includes Pending at index 0) */
export const PHASE_LABELS = [
  "Awaiting Owl",        // 0: Pending
  "Plotting",            // 1: Planning
  "Snape's Check",       // 2: Review #1
  "McGonagall's Check",  // 3: Review #2
  "Casting Spell",       // 4: Implementing
  "O.W.L. Exam",         // 5: Code Review #1
  "N.E.W.T. Exam",       // 6: Code Review #2
  "Mischief Managed",    // 7: Creating PR
];

/** Phase definitions for the detail page pipeline bar (1-indexed phases) */
export const PIPELINE_PHASES = [
  { phase: 1, label: "Plotting" },
  { phase: 2, label: "Snape's Check" },
  { phase: 3, label: "McGonagall's Check" },
  { phase: 4, label: "Casting Spell" },
  { phase: 5, label: "O.W.L. Exam" },
  { phase: 6, label: "N.E.W.T. Exam" },
  { phase: 7, label: "Mischief Managed" },
];

/** Display names for the StatusBadge — maps raw DB status values to themed labels */
export const STATUS_DISPLAY_NAMES: Record<string, string> = {
  pending: "awaiting owl",
  planning: "plotting",
  reviewing_plan_1: "snape's check",
  reviewing_plan_2: "mcgonagall's check",
  implementing: "casting spell",
  reviewing_code_1: "o.w.l. exam",
  reviewing_code_2: "n.e.w.t. exam",
  creating_pr: "mischief managed",
  completed: "mischief managed",
  failed: "caught by filch",
  waiting_for_input: "awaiting owl",
};
