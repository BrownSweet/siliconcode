# Silicon Code Codex-Parity Follow-Up Design

## Goal

Make Silicon Code closer to Codex in three areas that affect real coding work
more than surface polish: repeatable real-task regression coverage, clean
interruption/resume state, and visible project-rule loading.

## Scope

This pass adds:

- A deterministic Codex-parity harness that can drive Silicon Code through common
  coding workflows without spending model tokens.
- A small interruption/resume hardening pass so aborted turns do not leave stale
  active rows in the terminal timeline.
- A startup rules row that tells the user which project instructions were loaded
  from `AGENTS.md` / `SILICON.md` and nested module rules.

This pass does not add a new agent engine, change provider behavior, or alter
the default shell safety policy.

## Architecture

### Real-Task Harness

Add a test helper that creates temporary projects and runs the CLI with scripted
tool decisions. The harness should cover the same shape as a Codex session:
inspect files, propose/apply a patch, run tests, handle a failed test, and
finish with a concise summary. The first version should be deterministic and
cheap; real DeepSeek smoke runs remain manual release checks.

### Interrupt/Resume State

Keep interruption logic in the TUI layer. When Esc or Ctrl+C aborts an active
turn, the UI should clear pending assistant/tool activity and record a compact
interruption row. Resumed sessions should hydrate only durable history, not stale
in-flight rows.

### Rule Loading Visibility

Rules are already injected into prompts through the memory stack. Add a compact
startup event that lists loaded rule files in priority order. The UI should show
one quiet row, for example: `rules · AGENTS.md, pkg/AGENTS.md`. When no rules are
loaded, the UI should stay quiet.

## Error Handling

- Harness failures must preserve the temporary project path and transcript path
  in assertion output.
- Interrupt cleanup must be idempotent; repeated Esc/Ctrl+C should not duplicate
  rows or crash.
- Rule-file rendering must tolerate deleted files between scan and display.

## Testing

Tests must prove:

- The harness can exercise a failing-test-then-patch-then-pass workflow.
- Interrupt cleanup removes active transient rows while preserving completed
  cards.
- Resumed sessions do not display stale in-flight rows.
- Startup rule visibility shows `AGENTS.md` / nested `AGENTS.md` in order and
  stays quiet when none exist.

## Real Task Verification

After implementation, run:

- Targeted unit/integration tests for the three changed areas.
- Full `npm run verify`.
- One real Silicon Code task against a temporary fixture that starts with a
  failing test and requires `apply_patch` plus `npm test`.
