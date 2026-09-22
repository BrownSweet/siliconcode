# Silicon Code Working Knowledge

Silicon Code is a TypeScript/Node terminal coding agent derived from
DeepSeek-Reasonix and productized for Chinese-first personal developer use.

## Stack

- TypeScript, ESM, Node.js 22+
- Commander.js CLI with Ink TUI
- DeepSeek-native model client
- Vitest tests
- Biome lint/format
- tsup build

## Important Commands

```sh
npm run build
npm run lint
npm run typecheck
npm run test
npm run verify
```

## Product Rules

- npm package: `@brownsweet/siliconcode`
- command: `brown`
- do not install `cc`
- user config: `~/.siliconcode/config.json`
- primary docs/rules files: `AGENTS.md` and `SILICON.md`
- preserve DeepSeek-Reasonix MIT attribution

## Watch Points

- Do not commit API keys or local user config.
- Keep upstream MIT notices discoverable.
- Prefer productizing imported Reasonix code over rewriting the engine from
  scratch.
- Run `npm run verify` before claiming implementation work is complete.
