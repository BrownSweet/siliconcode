# Silicon Code Autonomous Delivery — PRD + SDD

Date: 2026-09-23

## PRD

### Problem

A one-shot coding agent can edit files, but it does not by itself provide a durable, auditable path from a vague requirement to a safely observed production release. Teams need bounded retries, independent review, real deployment evidence, human production control, rollback, and a resumable next iteration.

### Users and goals

- A developer records an imprecise requirement once and receives implementation-ready PRD, SDD, and observable acceptance criteria.
- A delivery operator can let the agent develop and validate unattended inside an isolated Git worktree.
- A human remains the only authority that can approve production deployment.
- Auditors can reconstruct stages, actors, artifacts, command evidence, failures, approvals, and iteration outcomes after a process restart.

### Non-goals

- Bypassing repository permissions, CI/CD permissions, or production credentials.
- Guessing deployment commands or declaring a deployment healthy without configured checks.
- Treating a submitted deployment command as proof of a successful or healthy release.
- Removing the human production approval gate.

### Required flow

1. Requirement intake through `prd-agent`.
2. Persist PRD, SDD, and stable `AC-*` criteria.
3. Human-created isolated branch/worktree.
4. Developer Agent edits only that worktree.
5. Configured validation commands with bounded debug retries.
6. Independent code, security, dependency, and configuration audit Skills.
7. Acceptance gate with evidence for every criterion.
8. Configured staging deploy, health checks, and regression commands.
9. Explicit human production approval through CLI or authenticated local Dashboard.
10. Configured canary percentage, observation window, and automatic rollback path.
11. Durable iteration summary; new issues start the next bounded development iteration.

## SDD

### Components

- `src/delivery/types.ts`: versioned run, stage, evidence, artifact, policy, approval, and workspace contracts.
- `src/delivery/store.ts`: atomic JSON state, JSONL events, and SHA-256-addressed Markdown artifacts under `.siliconcode/delivery/runs/<id>/`.
- `src/delivery/state-machine.ts`: ordered gates, evidence validation, retry bounds, human approval, iteration transitions, and rollback state.
- `src/delivery/config.ts`: validated, explicit command contract at `.siliconcode/delivery/config.json`.
- `src/delivery/workspace.ts`: real `git worktree` creation on `siliconcode/delivery-<id>`.
- `src/delivery/lock.ts`: one autonomous runner per delivery run, with dead-process recovery.
- `src/tools/delivery.ts`: model-facing state/evidence tools; it intentionally exposes no production-approval tool.
- `src/skills.ts`: `prd-agent`, `delivery-orchestrator`, and four isolated audit Skills.
- `src/cli/commands/delivery*.ts`: operator CLI and resumable headless runner.
- `src/server/api/delivery.ts` and `dashboard/src/panels/delivery.ts`: attached local-Web control surface.

### Safety boundaries

- `brown delivery run` requires explicit `--yolo`; the Dashboard requires an explicit unattended-edit/shell consent value.
- Production approval is available only through human CLI/Web endpoints, never through model tools.
- Shell `cwd` must be inside the primary workspace or a trusted added worktree.
- Validation and release stages require exact configured commands with `exitCode=0`; placeholders and missing config fail closed.
- Audit evidence must use fixed independent actors and the expected isolated Skill for each dimension.
- Canary or observation failure transitions to `rolling_back`; it cannot be represented as success.

### Persistence and recovery

`run.json` is the authoritative snapshot, `events.jsonl` is the append-only audit trail, and Markdown artifacts preserve product/design/acceptance/iteration outputs. A stopped runner can resume from `currentStage`. Atomic rename prevents partial snapshot writes; the runner lock prevents concurrent autonomous mutation. The store is local-file based and is not a distributed transaction system.

### Deployment configuration

Run `brown delivery init-config`, replace every `REPLACE_WITH_*` value, then validate it with `brown delivery config`. The canary command must contain `{percent}`. Secrets belong in the deployment environment or secret manager, not in the JSON file or recorded evidence.

## Acceptance criteria

- **AC-001:** A vague requirement can be persisted, and `prd-agent` can write PRD, SDD, and structured `AC-*` criteria without source-edit tools.
- **AC-002:** Development cannot begin until a human CLI/Web action creates a real isolated Git worktree.
- **AC-003:** Foreground and background shell commands reject `cwd` outside trusted roots and can execute inside the persisted worktree.
- **AC-004:** Validation cannot advance until every configured validation command has passing exact-command/exit-code evidence.
- **AC-005:** Audit cannot advance without code, security, dependency, and configuration results from the four expected independent Skills/actors.
- **AC-006:** Acceptance cannot advance while any stored criterion lacks passing evidence.
- **AC-007:** Staging deploy, staging health, and regression gates require exact configured command evidence.
- **AC-008:** No model-facing tool can approve production; CLI/Web approval requires a non-empty human actor.
- **AC-009:** Canary evidence must match the configured percentage and expanded command; observation must cover the configured window.
- **AC-010:** Canary/observation failure enters rollback, bounded validation/audit failure retries development, and retry exhaustion fails the run.
- **AC-011:** A completed iteration persists a numbered summary; new issues start the next iteration without reusing earlier evidence.
- **AC-012:** CLI and attached local Dashboard can create, inspect, run to a human gate, create the worktree, approve/reject production, and record rollback completion.
- **AC-013:** State survives process restart, and a concurrent autonomous runner for the same run is rejected.
- **AC-014:** Lint, TypeScript checks, focused delivery tests, full regression tests, build, and CLI help smoke tests pass before release.

## Operational limitation

The repository test suite verifies orchestration and safety behavior with local fixtures. A real staging or production deployment is only verified when a project supplies real commands/credentials and the resulting health and regression evidence is observed. This design never equates local mocked evidence with a live release.
