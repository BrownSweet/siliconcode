# Codex Parity Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic regression coverage and two Codex-like UX hardening changes: interrupt cleanup and visible project rules.

**Architecture:** Keep production changes small and local. Add pure helpers for rule display and interrupt cleanup so they can be tested without a live terminal, then wire them into the existing App/state flow. Add the real-task harness under `tests/` as deterministic integration coverage.

**Tech Stack:** TypeScript, Vitest, Ink state reducers, existing Silicon Code CLI/tool abstractions.

---

### Task 1: Rule Loading Visibility

**Files:**
- Create: `src/cli/ui/rule-summary.ts`
- Modify: `src/cli/ui/App.tsx`
- Test: `tests/rule-summary.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests for formatting no rules, root rules, and nested module rules:

```ts
expect(formatRuleSummary([])).toBeNull();
expect(formatRuleSummary([{ path: "/repo/AGENTS.md", root: "/repo" }])).toBe("rules · AGENTS.md");
expect(formatRuleSummary([
  { path: "/repo/AGENTS.md", root: "/repo" },
  { path: "/repo/pkg/AGENTS.md", root: "/repo" },
])).toBe("rules · AGENTS.md, pkg/AGENTS.md");
```

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- tests/rule-summary.test.ts`

Expected: FAIL because `src/cli/ui/rule-summary.ts` does not exist.

- [ ] **Step 3: Implement helper and App wiring**

Add a pure formatter, gather loaded project/module rule files from existing
memory helpers, and push one quiet info row only when the formatter returns text.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- tests/rule-summary.test.ts`

Expected: PASS.

### Task 2: Interrupt/Resume Cleanup

**Files:**
- Create: `src/cli/ui/interrupt-cleanup.ts`
- Modify: `src/cli/ui/App.tsx`
- Test: `tests/interrupt-cleanup.test.ts`

- [ ] **Step 1: Write failing tests**

Test that cleanup removes active assistant/tool rows, preserves completed rows,
and is idempotent.

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- tests/interrupt-cleanup.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement helper and wire abort path**

Add a pure `cleanupInterruptedCards(cards)` helper and call it from the existing
Esc/Ctrl+C turn-abort path before rendering the interruption notice.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- tests/interrupt-cleanup.test.ts tests/turn-interrupt.test.ts`

Expected: PASS.

### Task 3: Deterministic Real-Task Harness

**Files:**
- Create: `tests/codex-parity-harness.test.ts`
- Create: `tests/helpers/codex-parity-harness.ts`

- [ ] **Step 1: Write failing harness test**

Build a temporary Node fixture whose first `npm test` fails, drive a scripted
patch through the same patch tool Silicon Code exposes, run `npm test` again, and
assert the transcript includes inspect, patch, failed test, passing test, and
summary steps.

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- tests/codex-parity-harness.test.ts`

Expected: FAIL because the harness helper does not exist.

- [ ] **Step 3: Implement harness helper**

Create helpers for temp project setup, command execution, patch application, and
compact transcript assertions.

- [ ] **Step 4: Run test to verify GREEN**

Run: `npm test -- tests/codex-parity-harness.test.ts`

Expected: PASS.

### Task 4: Verification

**Files:**
- Modify only if targeted tests expose gaps.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npm test -- tests/rule-summary.test.ts tests/interrupt-cleanup.test.ts tests/turn-interrupt.test.ts tests/codex-parity-harness.test.ts
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run verify
```

- [ ] **Step 3: Run one real Silicon Code task**

Run built Silicon Code against a temp fixture with a failing test, approve shell
commands/edits in the TUI, and confirm it uses `apply_patch` then `npm test`.
