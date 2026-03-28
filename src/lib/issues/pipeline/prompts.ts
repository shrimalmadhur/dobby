// ── Prompt builders ──────────────────────────────────────────
// Pure functions that generate prompt strings for each pipeline phase.
// Extracted from pipeline.ts — no imports needed.

/** Build a prompt for resumed planning sessions (only new context, no duplicate planning prompt). */
export function buildResumePlanningPrompt(
  reviewFeedback: string | null | undefined,
  completenessReview: string | null | undefined,
  userAnswers: string | null,
  attachmentPaths: string[] = [],
): string {
  const attachmentReminder = attachmentPaths.length > 0
    ? `\n\n## Attached Images (still available)\nUse the Read tool to view these images for visual context:\n${attachmentPaths.map(p => `- ${p}`).join("\n")}\n`
    : "";

  if (reviewFeedback) {
    return `Your previous plan was reviewed and found to have issues. Create a REVISED plan addressing all feedback below.

## Review Feedback
${reviewFeedback}
${completenessReview ? `\n## Completeness Review Feedback\n${completenessReview}` : ""}
${userAnswers ? `\n## User's Answers to Your Questions\n${userAnswers}` : ""}
${attachmentReminder}
Revise your implementation plan to address all the review feedback. Include the "## Codebase Analysis" section again.
End with "VERDICT: READY" or "## Questions" if you need more information.`;
  }
  if (userAnswers) {
    return `Here are the answers to your questions:

${userAnswers}
${attachmentReminder}
Please update your implementation plan based on these answers. Include the "## Codebase Analysis" section.
End with "VERDICT: READY" or "## Questions" if you need more information.`;
  }
  // Resuming after crash with no new context — ask to continue
  return `Continue your implementation plan where you left off. Include the "## Codebase Analysis" section.
${attachmentReminder}
End with "VERDICT: READY" or "## Questions" if you need more information.`;
}

/** Build a full planning prompt with all available context (for fresh sessions). */
export function buildFullPlanningPrompt(
  description: string,
  planOutput: string,
  reviewFeedback: string | null | undefined,
  completenessReview: string | null | undefined,
  userAnswers: string | null,
  attachmentPaths: string[] = [],
): string {
  let prompt = buildPlanningPrompt(description, attachmentPaths);
  if (planOutput && reviewFeedback) {
    prompt += `\n\n## Previous Plan Review Feedback\n${reviewFeedback}`;
  }
  if (planOutput && completenessReview) {
    prompt += `\n\n## Completeness Review Feedback\n${completenessReview}`;
  }
  if (userAnswers) {
    prompt += `\n\n## User's Answers to Questions\n${userAnswers}`;
  }
  return prompt;
}

export function buildPlanningPrompt(description: string, attachmentPaths: string[] = []): string {
  const attachmentSection = attachmentPaths.length > 0
    ? `\n\n## Attached Images\nThe following images were provided with this issue. Use the Read tool to view them for visual context:\n${attachmentPaths.map(p => `- ${p}`).join("\n")}`
    : "";

  return `You are tasked with creating a detailed implementation plan for the following issue.

## Issue Description
${description}
${attachmentSection}

## Instructions
1. Analyze the codebase to understand the existing architecture and patterns
2. Create a step-by-step implementation plan
3. Identify files that need to be created or modified
4. Note any potential risks or edge cases
5. If you have questions that would significantly affect the plan, add a "## Questions" section at the end

## Output Format
Provide a structured plan with:
- Overview of the approach
- Detailed steps with file paths
- Any new dependencies needed
- Testing strategy

**Important**: Include a "## Codebase Analysis" section with:
- Key file paths you examined and their purposes
- Relevant code patterns and conventions observed
- Critical code snippets that the implementer must reference
- Architecture notes (how components connect)

This analysis will be used by the implementation phase, so be thorough.

End with either:
- "VERDICT: READY" if the plan is complete
- "## Questions" section if you need clarification`;
}

export function buildAdversarialReviewPrompt(plan: string, priorFindings?: string): string {
  const priorSection = priorFindings ? `
## Prior Review Findings (from previous rounds)
The following CRITICAL issues were found in earlier review rounds. You MUST verify that EACH of these has been addressed in the current plan. If any remain unaddressed, re-list them as CRITICAL.

${priorFindings}

` : "";

  return `You are an adversarial plan reviewer. Your job is to find problems, not validate.

## Plan to Review
${plan}
${priorSection}
## Instructions
Review this plan for:
1. Security vulnerabilities
2. Missing error handling
3. Race conditions or concurrency issues
4. Incorrect assumptions about the codebase
5. Missing steps or dependencies
6. Breaking changes
${priorFindings ? "7. Verify ALL prior findings listed above have been addressed" : ""}

For each issue found, classify as:
- CRITICAL: Must be fixed before implementation
- WARNING: Should be addressed but not blocking

## Output Format
List each issue with its severity, description, and suggested fix.

End with:
- "VERDICT: PASS" if no CRITICAL issues found
- "VERDICT: FAIL" if CRITICAL issues exist`;
}

export function buildCompletenessReviewPrompt(plan: string, priorFindings?: string): string {
  const priorSection = priorFindings ? `
## Prior Review Findings (from previous rounds)
The following issues were found in earlier review rounds. You MUST verify that EACH of these has been addressed in the current plan. If any remain unaddressed, re-list them as blocking gaps.

${priorFindings}

` : "";

  return `You are a completeness and feasibility reviewer.

## Plan
${plan}
${priorSection}
## Instructions
Check the plan for:
1. Missing implementation steps
2. Incorrect assumptions about the existing code
3. Missing test coverage
4. Integration gaps
5. Deployment or migration concerns
${priorFindings ? "6. Verify ALL prior findings listed above have been addressed" : ""}

For each gap found, classify as:
- MISSING_STEP: A required step is not in the plan
- WRONG_ASSUMPTION: The plan assumes something incorrect about the codebase

## Output Format
List each finding with classification and description.

End with:
- "VERDICT: PASS" if the plan is complete and feasible
- "VERDICT: FAIL" if there are blocking gaps`;
}

export function buildPlanFixPrompt(plan: string, adversarialReview: string, completenessReview: string, priorFindings?: string): string {
  const priorSection = priorFindings ? `
## Previously Identified Issues (from earlier rounds)
These issues were found in earlier review rounds. Ensure they are ALSO addressed in your revision, not just the latest findings.

${priorFindings}
` : "";

  return `You are an expert plan fixer. Your job is to surgically revise an implementation plan to address ALL findings from two independent reviewers.

## Current Plan
${plan}

## Adversarial Review Findings
${adversarialReview}

## Completeness Review Findings
${completenessReview}
${priorSection}
## Instructions
1. Read EVERY finding from both reviewers — CRITICAL, WARNING, and NOTE severity
2. For each finding, make a concrete change to the plan that fully addresses it
3. Do NOT rewrite the plan from scratch — preserve all parts that were not flagged
4. If a finding suggests a specific fix, incorporate it directly
5. If two findings conflict, prefer the safer/more correct approach
6. Ensure the revised plan is still coherent and self-consistent after all fixes
${priorFindings ? "7. Also verify that ALL previously identified issues (listed above) remain addressed" : ""}

## Output Format
Output the COMPLETE revised plan (not just the diffs). The output must be a standalone, clean plan that can be handed directly to an implementer. Do NOT include a changelog, commentary, or summary of what was changed — just output the revised plan text and nothing else.`;
}

export function buildImplementationPrompt(plan: string, review1: string, review2: string, attachmentPaths: string[] = []): string {
  const attachmentSection = attachmentPaths.length > 0
    ? `\n\n## Attached Images\nUse the Read tool to view these images for visual context:\n${attachmentPaths.map(p => `- ${p}`).join("\n")}`
    : "";

  return `Implement the following plan. Follow it precisely, incorporating the review feedback.

## Implementation Plan
${plan}

## Review Feedback to Address
### Adversarial Review
${review1}

### Completeness Review
${review2}
${attachmentSection}

## Instructions
1. Implement each step of the plan
2. Address all review feedback
3. Write tests for new functionality
4. Ensure all existing tests still pass
5. CRITICAL: You MUST commit all changes before finishing. Run \`git add -A && git commit -m "feat: <description>"\`. Uncommitted changes will be lost.

Do NOT create a PR — that will be done in a separate step.`;
}

// ── Specialist code review prompts (READ-ONLY) ──────────────

export function buildBugsLogicReviewPrompt(defaultBranch: string): string {
  return `You are a specialist code reviewer focused on BUGS AND LOGIC ERRORS.
Your job is to FIND defects — do NOT modify any files.

## Instructions
1. Run \`git diff ${defaultBranch}...HEAD\` to see all changes
2. Read every changed file in full for context
3. For each change, actively try to break it:
   - Logic errors, wrong conditions, inverted booleans, off-by-one
   - Null/undefined handling gaps
   - Race conditions and concurrency bugs
   - Missing error handling, swallowed errors
   - Boundary conditions (empty, zero, MAX_INT, very large inputs)
4. DO NOT modify any files. You are a READ-ONLY reviewer.

## Output Format
For each issue found:
- **Severity**: CRITICAL / WARNING / NOTE
- **File**: exact file path and line number
- **Bug**: What's wrong (be specific)
- **Proof**: Input or scenario that triggers the bug
- **Fix**: Suggested code change

End with:
- "VERDICT: PASS" if no CRITICAL issues found
- "VERDICT: FAIL" if CRITICAL issues exist`;
}

export function buildSecurityEdgeCasesReviewPrompt(defaultBranch: string): string {
  return `You are a specialist code reviewer focused on SECURITY AND EDGE CASES.
Your job is to FIND vulnerabilities — do NOT modify any files.

## Instructions
1. Run \`git diff ${defaultBranch}...HEAD\` to see all changes
2. Read every changed file in full for context
3. Analyze from an attacker's perspective:
   - Injection (SQL, command, XSS, path traversal, SSRF)
   - Authentication/authorization bypasses
   - Sensitive data exposure in logs, errors, responses
   - Input validation gaps (malformed input, special chars, huge strings)
   - Denial of service vectors (regex DoS, unbounded queries)
   - Edge cases: empty inputs, concurrent requests, partial failures
4. DO NOT modify any files. You are a READ-ONLY reviewer.

## Output Format
For each issue found:
- **Severity**: CRITICAL / WARNING / NOTE
- **File**: exact file path and line number
- **Vulnerability**: What's the issue
- **Attack scenario**: How to exploit it
- **Fix**: Suggested remediation

End with:
- "VERDICT: PASS" if no CRITICAL issues found
- "VERDICT: FAIL" if CRITICAL issues exist`;
}

export function buildDesignPerformanceReviewPrompt(defaultBranch: string): string {
  return `You are a specialist code reviewer focused on DESIGN AND PERFORMANCE.
Your job is to FIND design issues — do NOT modify any files.

## Instructions
1. Run \`git diff ${defaultBranch}...HEAD\` to see all changes
2. Read changed files and related files for context
3. Evaluate:
   - Violations of existing code patterns and conventions
   - Missing or inadequate test coverage
   - API design issues (breaking changes, inconsistent interfaces)
   - Performance problems (N+1 queries, unnecessary work, large allocations)
   - Code duplication or missing abstractions
   - Backwards compatibility concerns
4. DO NOT modify any files. You are a READ-ONLY reviewer.

## Output Format
For each issue found:
- **Severity**: CRITICAL / WARNING / NOTE
- **File**: exact file path and line number
- **Issue**: What's wrong
- **Impact**: Concrete consequence
- **Fix**: Suggested improvement

End with:
- "VERDICT: PASS" if no CRITICAL issues found
- "VERDICT: FAIL" if CRITICAL issues exist`;
}

export function buildCodeFixPrompt(
  defaultBranch: string,
  bugsReview: string,
  securityReview: string,
  designReview: string,
): string {
  return `Fix ALL issues identified by the code reviewers below.

## Review Findings

### Bugs & Logic Review
${bugsReview}

### Security & Edge Cases Review
${securityReview}

### Design & Performance Review
${designReview}

## Instructions
1. Run \`git diff ${defaultBranch}...HEAD\` to see current changes
2. Fix every CRITICAL finding listed above
3. Fix WARNING findings where the fix is straightforward
4. Run tests after each fix to ensure no regressions
5. CRITICAL: You MUST commit all fixes before finishing. Run \`git add -A && git commit -m "fix: <description>"\`. Uncommitted changes will be lost.
6. Do NOT create a PR

End with:
- "VERDICT: FIXED" if all CRITICAL issues were addressed
- "VERDICT: PARTIAL" if some could not be fixed (explain why)`;
}

export function buildPrCreationPrompt(title: string, description: string, defaultBranch: string, attachmentPaths: string[] = []): string {
  const attachmentSection = attachmentPaths.length > 0
    ? `\n\n## Attached Images\nUse the Read tool to view these images for visual context when writing the PR description:\n${attachmentPaths.map(p => `- ${p}`).join("\n")}`
    : "";

  return `Create a pull request for the changes on this branch.

## Issue Details
Title: ${title}
Description: ${description}
${attachmentSection}

## Instructions
1. Push the current branch to the remote
2. Create a PR using \`gh pr create\` targeting ${defaultBranch}
3. Use a descriptive title based on the issue
4. Include a summary of changes in the PR body
5. Include the issue description for context

Output the PR URL when done.`;
}
