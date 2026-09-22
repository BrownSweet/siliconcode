# Codex-Parity Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Silicon Code's coding loop closer to Codex in edit reliability,
review ergonomics, output summaries, and low-noise terminal flow.

**Architecture:** Add focused helpers for patch application and command-result
summaries, then wire them into the existing filesystem tools, edit gate, tool
cards, and prompt. Keep existing tools compatible and preserve confirmation and
undo semantics.

**Tech Stack:** TypeScript, Node.js, Ink, Vitest, existing Silicon Code
ToolRegistry and edit history APIs.

---

### Task 1: Patch-Style Edit Tool

**Files:**
- Create: `src/tools/fs/patch.ts`
- Modify: `src/tools/filesystem.ts`
- Modify: `src/cli/ui/edit-tool-gate.ts`
- Modify: `src/cli/ui/App.tsx`
- Test: `tests/patch-tool.test.ts`
- Test: `tests/edit-tool-gate.test.ts`

- [ ] Add failing tests for applying a unified patch to an existing file, creating
  a new file, and rejecting failed hunks without writing any files.
- [ ] Implement a small unified patch parser for `diff --git` patches with
  `---` / `+++` file headers and `@@` hunks.
- [ ] Register `apply_patch` as a filesystem write tool.
- [ ] Route `apply_patch` through the edit gate by converting patch hunks to
  reviewable `EditBlock[]` where possible.
- [ ] Preserve undo history and atomic failure behavior.

### Task 2: Batch Edit Review

**Files:**
- Modify: `src/cli/ui/App.tsx`
- Modify: `src/cli/ui/EditConfirm.tsx`
- Test: `tests/edit-tool-gate.test.ts`
- Test: `tests/ui-codex-style.test.tsx`

- [ ] Add failing tests showing a multi-block edit is exposed as one batch review.
- [ ] Add batch metadata to the pending edit review state.
- [ ] Render concise batch headers and per-file diff blocks.
- [ ] Apply or reject the full batch as one user action.

### Task 3: Command And Test Summaries

**Files:**
- Create: `src/tools/output-summary.ts`
- Modify: `src/cli/ui/tool-summary.ts`
- Modify: `src/cli/ui/cards/ToolCard.tsx`
- Test: `tests/tool-summary.test.ts`

- [ ] Add failing tests for Vitest/Jest/TAP/pytest/tsc/go/cargo failure snippets.
- [ ] Parse command output into `status`, `headline`, `failures`, and `tail`.
- [ ] Render failure summaries before raw tail lines.
- [ ] Keep successful command cards short.

### Task 4: Quiet UI And Compact Approval

**Files:**
- Modify: `src/cli/ui/App.tsx`
- Modify: `src/cli/ui/ShellConfirm.tsx`
- Modify: `src/cli/ui/cards/LiveCard.tsx`
- Modify: `src/i18n/zh-CN.ts`
- Modify: `src/i18n/EN.ts`
- Test: `tests/ui-codex-style.test.tsx`
- Test: `tests/shell-confirm-render.test.tsx`

- [ ] Add failing tests for hiding dashboard/resume noise from the main timeline.
- [ ] Add failing tests for compact shell approval copy.
- [ ] Replace internal status copy with task-oriented labels.
- [ ] Keep detailed connection/dashboard info accessible through slash commands.

### Task 5: Prompt And Schema Tightening

**Files:**
- Modify: `src/code/prompt.ts`
- Modify: `src/tools/filesystem.ts`
- Modify: `src/tools/shell.ts`
- Test: `tests/code-prompt.test.ts`
- Test: `tests/filesystem-tools.test.ts`

- [ ] Add failing prompt tests for `apply_patch` preference and inspect-patch-verify
  workflow.
- [ ] Clarify `search_files`, `glob`, and shell command usage.
- [ ] Update tool descriptions so common model mistakes are less likely.
- [ ] Keep shell behavior explicit without overpromising real shell semantics.

### Task 6: Verification And Real Task Runs

**Files:**
- Modify if needed: `tests/ui-codex-style.test.tsx`

- [ ] Run targeted tests for each changed layer.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run full `npm test`.
- [ ] Run Silicon Code on a temporary fixture for a feature task, a failing-test fix,
  and a shell verification task.
- [ ] Commit the final changes.
