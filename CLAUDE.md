# CLAUDE.md

Silicon Code is a Chinese-first, DeepSeek-native terminal coding agent (`@brownsweet/siliconcode`, bin `brown`), derived from DeepSeek-Reasonix and productized for personal developer workflows. Architecture is opinionated around three pillars: immutable prefix caching, tool-call repair, and tiered flash→pro cost control.

## Canonical rules (authoritative — follow these)

- `AGENTS.md` — project rules, PR merge principles, naming/scope, license/attribution. Read before any non-trivial change.
- `SILICON.md` — working knowledge: stack, commands, product rules, watch points.
- The agent itself loads project rules from `AGENTS.md` then `SILICON.md` (read priority order in `src/memory/project.ts`: `AGENTS.md` → `SILICON.md` → legacy `REASONIX.md` → `AGENT.md`; the legacy two are read-only fallbacks and are not present in this repo).

This file complements those two with an architecture map of `src/`. It does not restate their rules.

## Dev workflow

Node 22+, ESM (`"type": "module"`). Scripts:

- `npm run build` — tsup + `scripts/copy-dashboard-vendor-css.mjs` (library + CLI + dashboard bundles, then dashboard CSS copy)
- `npm run dev` — `tsx src/cli/index.ts` (no subcommand); `npm run chat` — `tsx src/cli/index.ts chat`
- `npm run test` / `npm run test:watch` / `npm run test:coverage` — Vitest
- `npm run test:mutation` — Stryker on load-bearing modules (loop, context-manager, core, shell, plan, repair)
- `npm run lint` / `npm run lint:fix` / `npm run format` — Biome over `src tests`
- `npm run typecheck` — `tsc --noEmit` for src and `tsc --noEmit -p dashboard`
- `npm run verify` — build + lint + typecheck + test in one shot

**Run `npm run verify` before claiming work is done.** Git hooks (simple-git-hooks): pre-commit `lint`, pre-push `verify`.

## Architecture map (src/)

- **CLI & commands** — `src/cli/index.ts` (entry; imports `cli/heap-limit-launch.ts` FIRST for heap re-exec), Commander program, lazy-imported `src/cli/commands/*`. Top-level commands: setup, code, chat, run, acp, desktop (internal JSON-RPC for the desktop client), stats, doctor, commit, sessions, prune-sessions, events, replay, diff, mcp (list/search/install/browse/inspect), version, update, index. Interactive modes use Ink; `src/cli/ui/App.tsx` is the main TUI (~4.5k lines). `src/cli/resolve.ts` resolves precedence (per-setting flag > `--preset` > config.preset > `auto`).
- **Agent engine** — `src/loop.ts` `CacheFirstLoop.step(input)` is the turn loop (AsyncGenerator of `LoopEvent`); `src/loop/*` (types, escalation, healing, messages, force-summary, thinking, env), `src/context-manager.ts` (fold/force-summary/preflight thresholds 50/70/80/95% of ctxMax), `src/memory/runtime.ts` (ImmutablePrefix + AppendOnlyLog + VolatileScratch), `src/frame/` (TUI grid primitives — fixed-width cell/row frames), `src/core/` (events, inflight, pause-gate, pause-policy, reducers, event-redaction, eventize).
- **Repair** — `src/repair/` (`index.ts` orchestrates scavenge → truncation → storm passes for malformed DeepSeek tool calls; `flatten.ts` schema flatten runs at loop construction).
- **Tools** — `src/tools.ts` (`ToolRegistry` register/dispatch, plan-mode enforcement, schema flatten/re-nest, result post-processing), `src/tools/*` (filesystem, shell, shell-chain, web, memory, plan/plan-core, subagent, skills, choice, todo, scaffold, jobs), `src/tools/fs/` (edit with LCS diff, patch, glob, outline, search), `src/tools/shell/parse.ts` (allowlist) + `exec.ts`. Cross-cutting: `src/hooks.ts`, `src/skills.ts`, `src/at-mentions.ts`, `src/at-mentions-url.ts`.
- **Model client / net** — `src/client.ts` (DeepSeekClient: undici SSE streaming, ~11-min (660s) timeout, retry, cache-token usage), `src/retry.ts`, `src/tokenizer.ts` (encode-only V4 tokenizer, `data/deepseek-tokenizer.json.gz`), `src/net/proxy.ts`, `src/adapters/` (JSONL event sink/source), `src/ports/` (ModelClient/MemoryStore/CheckpointStore/EventSink/HookRunner/ToolHost interfaces).
- **Config / env** — `src/config.ts` (`~/.siliconcode/config.json`, API key bridge, presets, project permissions, sensitive-path config, MCP), `src/env.ts`, `src/workspaces.ts`, `src/frontmatter.ts`, `src/gitignore.ts`.
- **Context / memory / transcript** — `src/memory/` (session JSONL persistence, user/project/subdir memory, runtime prefix), `src/session-title.ts`, `src/transcript/` (log/replay/diff). Sessions/data live under `~/.siliconcode/sessions/`, `~/.siliconcode/memory/{global,<projectHash>}/`.
- **Semantic index** — `src/index/semantic/` (builder, store JSONL append-only + linear cosine scan, embedding via Ollama/OpenAI-compat, chunker, tool, ollama-launcher, preflight), `src/index/config.ts`. Complements lexical grep.
- **i18n** — `src/i18n/` (`index.ts` `t()`/`tObj()`, `types.ts` schema, `zh-CN.ts` primary, `EN.ts` fallback). Chinese is first-class; English is fallback only.
- **Integration surfaces** — `src/mcp/` (client + stdio/SSE/streamable-http transports, registry, spec, catalog, reconnect, latency), `src/acp/` (Agent Client Protocol over stdio: server/protocol/dispatch/gates), `src/qq/` (QQ bot WebSocket channel + access control), `src/server/` (loopback dashboard HTTP + `api/*` routes).
- **Telemetry** — `src/telemetry/` (usage JSONL at `~/.siliconcode/usage.jsonl`, pricing/stats, subagent distillation). Local-only, no network calls.
- **Library barrel** — `src/index.ts` re-exports the public API.

## Conventions

- **Style (Biome 1.9, `biome.json`):** 2-space indent, double quotes, semicolons always, trailing commas `all`, line width 100. Lint rules: `useImportType` warn, `noExplicitAny` off, `noNonNullAssertion` off; `organizeImports` enabled.
- TypeScript strict, ESM, Node 22, path alias `@/* → src/*`.
- **Prefer productizing imported Reasonix code over rewriting** the engine. Keep changes tightly scoped; do not bundle unrelated rewrites.

## Gotchas

- **Env var naming:** prefer `SILICONCODE_*`, keep `REASONIX_*` legacy fallbacks for existing external interfaces. Concrete pairs include `SILICONCODE_MEMORY`/`REASONIX_MEMORY`, `SILICONCODE_TOOL_DISPATCH`/`REASONIX_TOOL_DISPATCH` (`serial` forces serial dispatch), `SILICONCODE_PARALLEL_MAX`/`REASONIX_PARALLEL_MAX` (clamped 1–16, default 3), `SILICONCODE_TOKENIZER_PATH`/`REASONIX_TOKENIZER_PATH`. Non-fallback: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `OLLAMA_URL`, `HTTPS_PROXY`/`HTTP_PROXY`.
- **Never commit** API keys or anything under `~/.siliconcode/`.
- **User-visible copy is Chinese-first.** No "Reasonix" wording in prompts, docs, dashboard, or any user-facing text (legacy `REASONIX_*` interface names are the only exception).
- **Preserve upstream MIT notices:** `THIRD_PARTY_NOTICES.md`, `LICENSES/` (`DeepSeek-Reasonix-MIT.txt`). Do not strip copyright headers from derived files.
- **The command is `brown`.** Never install `cc` (shadows the system C compiler).
- Data dirs use `.siliconcode` with `.reasonix` legacy fallback. Shell-command allowlisting (`src/tools/shell/parse.ts`) matches on leading argv tokens (a command-prefix match, e.g. `git branch` matches `git branch -D ...`); matches are demoted back to the confirm gate when a destructive flag appears in the tail (`RISKY_ARGS`) or when an argument path is under a sensitive prefix (directory-boundary prefix match, e.g. `~/.ssh`) or matches a sensitive filename glob (e.g. `*.env`, `*.pem`).
