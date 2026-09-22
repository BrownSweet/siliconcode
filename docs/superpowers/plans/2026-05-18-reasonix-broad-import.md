# Reasonix Broad Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the small Silicon Code core with a broad DeepSeek-Reasonix import and apply the first Silicon productization patch.

**Architecture:** Treat upstream Reasonix as the product engine and Silicon Code as the branded package/distribution layer. Import the upstream body first, then patch package metadata, command names, config paths, notices, and release workflow without deleting legal attribution.

**Tech Stack:** TypeScript, Node.js 22+, npm, tsup, Vitest, GitHub Actions Trusted Publishing.

---

### Task 1: Import Baseline

**Files:**
- Modify: repository root
- Preserve: `AGENTS.md`
- Preserve: `.github/workflows/publish.yml`
- Preserve: `docs/superpowers/specs/*`
- Preserve: `THIRD_PARTY_NOTICES.md`
- Preserve: `LICENSES/DeepSeek-Reasonix-MIT.txt`

- [ ] Refresh `/tmp/siliconcode-reasonix` from `https://github.com/esengine/DeepSeek-Reasonix.git`.
- [ ] Record upstream commit hash.
- [ ] Copy upstream files into this repository, excluding `.git`, `node_modules`, generated dist, and release artifacts.
- [ ] Keep Silicon repository-only docs and workflow files.

### Task 2: Silicon Package Patch

**Files:**
- Modify: `package.json`
- Modify: `src/cli/index.ts`
- Modify: `src/config.ts`
- Modify: `README.md`
- Modify: `THIRD_PARTY_NOTICES.md`

- [ ] Rename package to `@brownsweet/siliconcode`.
- [ ] Rename bin command from `reasonix` to `brown` and add `brown`.
- [ ] Keep `prepack: npm run verify`.
- [ ] Ensure npm `files` includes `THIRD_PARTY_NOTICES.md` and `LICENSES`.
- [ ] Change config path from `~/.reasonix/config.json` to `~/.siliconcode/config.json`.
- [ ] Replace the primary CLI name/description with Silicon Code.

### Task 3: Verification Pass

**Files:**
- Modify as required by failures.

- [ ] Run `npm install`.
- [ ] Run `npm run build`.
- [ ] Run focused tests for package metadata, config path, CLI help, and license notices.
- [ ] Run `npm pack --dry-run`.
- [ ] If full `npm run verify` is too large or fails from upstream baseline issues, record the exact failure and fix the highest-priority blocker first.
