# Clean Selective Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable Silicon Code CLI by selectively importing Reasonix-style TypeScript/Node agent primitives into a clean repo.

**Architecture:** Keep Silicon Code small: CLI and config at the edge, a testable agent runner in the middle, and isolated workspace tools for file read/search/edit and approved shell commands. Use DeepSeek V4 model profiles verified from official docs, preserve MIT attribution for Reasonix-derived code, and defer Reasonix dashboard/MCP/server/desktop subsystems.

**Tech Stack:** TypeScript ESM, Node.js 22+, Commander, Vitest, tsup, built-in `fetch`, built-in `readline/promises`.

---

### Task 1: Project Skeleton And Red Tests

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `tests/*.test.ts`

- [ ] Create the Node/TS package skeleton for `@brownsweet/siliconcode` with `brown` and `brown` bins.
- [ ] Write failing tests for package metadata, model profiles, config, rules loading, filesystem tools, shell approval, session store, DeepSeek client payloads, and agent loop behavior.
- [ ] Run `npm test` and verify failures are caused by missing implementation modules.

### Task 2: Core Modules

**Files:**
- Create: `src/models.ts`
- Create: `src/config.ts`
- Create: `src/env.ts`
- Create: `src/rules.ts`
- Create: `src/session.ts`
- Create: `src/tools/filesystem.ts`
- Create: `src/tools/shell.ts`
- Create: `src/client.ts`
- Create: `src/agent.ts`
- Create: `src/cli/index.ts`
- Create: `src/index.ts`
- Create: `src/version.ts`

- [ ] Implement minimal code to satisfy tests.
- [ ] Keep file editing atomic and diff-visible.
- [ ] Require an approval callback for writes and shell commands.
- [ ] Support session resume through JSON files under `~/.siliconcode/sessions`.
- [ ] Provide Chinese default system prompts and CLI descriptions.

### Task 3: License And Attribution

**Files:**
- Create: `LICENSE`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `LICENSES/DeepSeek-Reasonix-MIT.txt`
- Create: `README.md`

- [ ] Add Silicon Code MIT license placeholder.
- [ ] Preserve Reasonix MIT text exactly in `LICENSES/DeepSeek-Reasonix-MIT.txt`.
- [ ] Document that selected code and architecture are derived from DeepSeek-Reasonix.
- [ ] Ensure npm package `files` includes notices.

### Task 4: Verification

**Files:**
- Modify as needed based on failures.

- [ ] Run `npm install`.
- [ ] Run `npm test` until all tests pass.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `node dist/cli/index.js --help` and verify the CLI boots.
