# AGENTS.md

## Project Context

Silicon Code is a new terminal coding agent project in `BrownSweet/siliconcode`. The goal is to build a Chinese-first, DeepSeek-powered personal developer CLI similar to Codex.

The repository is intentionally early. The main design reference is:

- `docs/superpowers/specs/2026-05-18-siliconcode-cli-design.md`

## Current Status

- Local git repo is initialized on `main`.
- No Git remote is configured yet.
- Git identity for this repo:
  - `user.name=BrownSweet`
  - `user.email=455764041@qq.com`
- The repository starts from a clean Silicon Code rebranding commit.
- Current implementation direction:
  - 导入 Reasonix 主体，然后做 Silicon Code 产品化。

## Product Direction

Build a personal developer CLI for v1.

The intended user flow:

```bash
npm install -g @brownsweet/siliconcode
cd path/to/project
brown
```

The CLI should read the repository, plan work, edit files, request permission before shell commands, run validation when approved, and show diffs and a concise outcome summary.

## Chosen Base

Use DeepSeek-Reasonix as the preferred implementation base because it is TypeScript/Node, DeepSeek-native, npm-friendly, and already contains useful agent primitives.

DeepSeek-TUI and Deep Code are references for UX and feature ideas, but they are not the preferred v1 base.

Do not start the agent engine from scratch unless the user explicitly changes this decision.

## Naming Decisions

- Product name: Silicon Code
- npm package: `@brownsweet/siliconcode`
- Command: `brown`

Do not install `cc` by default. It commonly points to the system C compiler and may break native builds if shadowed.

## MVP Scope

Include:

- DeepSeek API configuration.
- DeepSeek V4 Pro / Flash model profiles, after verifying the current official model IDs.
- Interactive terminal session.
- Repository search and file reading.
- Safe file editing with visible diffs.
- Shell command approval.
- Test/build command execution when approved.
- Session resume.
- Project rules through `AGENTS.md` or `SILICON.md`.
- Chinese default prompts, errors, and command explanations.
- Basic token/cost visibility.
- MIT license compliance for upstream code.

## License And Attribution

If code is copied or derived from DeepSeek-Reasonix, preserve upstream MIT notices.

Expected files:

- `THIRD_PARTY_NOTICES.md`
- `LICENSES/DeepSeek-Reasonix-MIT.txt`

Attribution can be low-profile, but must remain discoverable in the repository and npm package. Do not remove upstream copyright notices from derived source files.

## Engineering Rules

- Prefer TypeScript/Node patterns for this project.
- Use existing upstream abstractions where they are sound.
- Keep early changes tightly scoped to branding, packaging, DeepSeek defaults, config, permission flow, and documentation.
- Do not add unrelated rewrites while importing the base.
- Keep local CLI code readable for local debugging and user trust.
- Before claiming a feature is done, run relevant verification commands and report what passed or failed.

## PR Merge Principles

A PR is mergeable only when it satisfies all of these checks:

- It is useful: it fixes a real issue, reduces maintenance risk, or clearly advances Silicon Code productization.
- It has no known bug: tests, typecheck, lint, and review should not reveal regressions, broken compatibility, or conflicting behavior.
- Its behavior is verifiable: prefer focused tests; at minimum, the changed code path must be clearly reachable in normal use.
- Its scope is clear: one PR should solve one understandable problem and avoid bundling unrelated UI, env, docs, and test changes.
- It is not duplicated: do not merge a PR that is already covered by a smaller, newer, or better-tested PR.
- Its compatibility story is intentional: prefer `SILICONCODE_*` names, but keep legacy `REASONIX_*` fallbacks for existing external interfaces such as env vars, public types, config fields, and historical data directories. Do not preserve Reasonix wording in user-visible copy, docs, comments, unused placeholders, or newly added internal names.

## Next Recommended Steps

1. Continue Silicon Code productization of imported Reasonix surfaces.
2. Replace remaining user-visible Reasonix wording in prompts, docs, dashboard, and desktop surfaces.
3. Finish `AGENTS.md` / `SILICON.md` project-rule loading behavior.
4. Verify current official DeepSeek model IDs before public release copy.
5. Tag a release only after npm Trusted Publishing is configured for `@brownsweet/siliconcode`.

## Important Open Decisions

- Public open-source release vs. private/internal alpha first.
- Exact current DeepSeek model IDs.
