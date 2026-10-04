# Silicon Code

Silicon Code is a Claude Code–style coding tool, and the first DeepSeek-based
coding tool from China — cutting token cost by over 90%. It does automatic task
breakdown, autonomous development, MCP testing, and multi-agent collaboration
with Claude or Codex, with capability approaching Claude Sonnet 4.6.

Silicon Code is aimed at personal developer workflows: open a repository, let the
agent read and search the codebase, review planned edits, approve shell commands,
run validation, and keep a concise session trail.

简体中文：[README.md](README.md)

## Install

Requires Node.js 22 or newer.

```bash
npm install -g @brownsweet/siliconcode
cd path/to/project
brown
```

On Windows PowerShell, if `npm` fails with a script execution policy error, use
`npm.cmd` instead:

```powershell
npm.cmd install -g @brownsweet/siliconcode
```

Short command:

```bash
brown
```

One-off usage without a global install:

```bash
npx @brownsweet/siliconcode
```

## Commands

| Command | Purpose |
| --- | --- |
| `brown` | Start the coding agent in the current project (same as `brown code`). |
| `brown code [dir]` | Start the coding agent in `[dir]`; omit `[dir]` for the current directory. |
| `brown chat` | Chat without filesystem or shell tools. |
| `brown run "task"` | Non-interactive one-shot task. |
| `brown init [dir]` | Analyze a project and generate a `SILICON.md` guide. |
| `brown doctor` | Local health check. |
| `brown update` | Check and install the latest CLI package. |

Silicon Code also installs `brown`. It intentionally does not install `cc`,
because that name commonly points to the system C compiler.

## Configuration

Silicon Code stores user configuration in:

```text
~/.siliconcode/config.json
```

Set a DeepSeek API key with the first-run setup wizard, or export it directly:

```bash
export DEEPSEEK_API_KEY=sk-...
```

Project rules should live in `AGENTS.md` or `SILICON.md` in the repository.

Initialize a rules file for an existing project:

```bash
brown init
brown init --dry-run
brown init --force --yes
```

The command reads repository manifests, directories, and tool configuration without
calling a model. Existing rules are protected unless `--force` is supplied.

Model presets use the official recommended API IDs: `flash` maps to
`deepseek-flash`, `pro` maps to `deepseek-v4-pro`, and `auto` starts on Flash
with one-turn Pro escalation for harder turns. Existing `deepseek-v4-flash` pins
remain supported aliases. Verified on 2026-10-03 against the
[official model and pricing documentation](https://api-docs.deepseek.com/quick_start/pricing/);
cost estimates use peak rates, while actual off-peak billing may be lower.

Desktop also supports standard OpenAI-compatible providers. Under
**Settings -> Models -> Add model provider**, enter the Base URL and API key first;
the app discovers `/models`, recommends an agent model, and safely adapts between
the Responses and Chat Completions APIs. Newly returned model IDs work without a
local capability-registry entry. See the
[OpenAI-compatible provider guide](docs/OPENAI-COMPATIBLE-PROVIDERS.md) for the
runtime contract, security boundary, and repeatable end-to-end verifier.

### Error diagnostics

Silicon Code collects redacted `error` and `fatal` metadata and stack traces by default to diagnose release failures. It does not upload chats, model output, file contents, full command arguments, API keys, tokens, cookies, or environment values. Offline events are kept in a bounded queue under `~/.siliconcode/diagnostics/pending/`.

Disable collection from Desktop under **Settings -> General -> Error diagnostics**, or through configuration/environment:

```json
{
  "diagnostics": { "enabled": false }
}
```

```bash
export SILICONCODE_DIAGNOSTICS=off
```

## License And Attribution

Silicon Code is MIT licensed.

Third-party MIT notices are preserved in:

- `THIRD_PARTY_NOTICES.md`
- `LICENSES/`

Do not remove copyright or MIT notices from derived files.
