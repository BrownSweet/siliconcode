# Silicon Code Codex-Parity Experience Design

## Goal

Make Silicon Code feel and behave closer to Codex during real coding tasks:
quiet timeline, reliable patch-style edits, useful failure summaries, compact
approvals, and task-oriented status text.

## Scope

This pass covers the 11 observed gaps:

- Reduce timeline noise from startup, resume, dashboard, and internal upload rows.
- Replace model-internal status language with task-oriented activity labels.
- Keep command and tool results compact when successful.
- Surface failure summaries before raw tails.
- Add a patch-style edit path so edits are not limited to fragile SEARCH/REPLACE.
- Show multi-file edits as one reviewable batch.
- Tighten tool schemas and prompt guidance to reduce common misuse.
- Improve test/build failure extraction for common Node, Python, TypeScript, Go,
  and Rust outputs.
- Keep shell approval compact while preserving deny and always-allow flows.
- Move the default model workflow toward inspect, patch, verify, summarize.
- Reduce post-tool overthinking with stronger prompt constraints and better
  structured tool summaries.

## Architecture

The work is split into four layers.

1. Edit layer: add a patch parser/applicator and route patch edits through the
   existing edit gate and undo history.
2. Review layer: add a batch edit review model that renders multi-block diffs
   together while preserving atomic application semantics.
3. Output layer: add command/test summarizers and use them in tool cards before
   raw output tails.
4. UX/prompt layer: make startup/status/approval copy quieter and update the
   code prompt so the model defaults to Codex-style task flow.

## Compatibility

Existing `edit_file`, `write_file`, and `multi_edit` remain available. The new
patch path is additive. Legacy shell behavior remains the default safe path; any
shell compatibility improvements must not bypass confirmation or workspace
path safety.

## Testing

Tests must cover:

- Patch application success, new-file creation, and failed hunks leaving disk
  unchanged.
- Edit gate interception for patch and multi-edit batches.
- Tool-card summaries for test failures and command failures.
- Quiet UI behavior for dashboard/resume/startup and shell confirmations.
- Prompt text naming `apply_patch` as preferred for non-trivial edits.

## Real Task Verification

After implementation, run Silicon Code against a temporary fixture with at least:

- A multi-file feature addition.
- A failing test that requires a fix.
- A command approval.
- A verification run.

The final assessment must compare actual terminal output against the design
goals, not just unit tests.
