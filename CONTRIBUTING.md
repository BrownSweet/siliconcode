# Contributing To Silicon Code

Silicon Code is currently early-stage and developed directly on `main`.

## Setup

```bash
npm install
npm run verify
```

## Development Rules

- Keep changes focused on Silicon Code productization and agent reliability.
- Preserve upstream DeepSeek-Reasonix MIT notices in derived code.
- Do not commit API keys, local config files, build caches, or generated secrets.
- Run `npm run verify` before pushing implementation changes.

## Pull Requests

Use clear commits and include the relevant verification output. If a change
touches package identity, publishing, config paths, command names, permissions,
or agent prompts, call that out explicitly.
