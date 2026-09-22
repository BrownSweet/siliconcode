# Silicon Code CLI Design

Date: 2026-05-18

## Summary

Silicon Code is a DeepSeek-powered terminal coding agent for individual developers. The first version should feel close to Codex in daily use: a developer enters a project directory, starts the CLI, describes a task, and the agent reads code, plans work, edits files, runs approved commands, validates changes, and shows a diff.

The project should not start from scratch. The recommended path is to fork or derive from DeepSeek-Reasonix, keep the useful agent engine, and rebuild the product layer around Silicon Code's brand, Chinese developer workflow, DeepSeek defaults, npm distribution, and license compliance.

## Goals

- Ship a personal developer CLI.
- Use DeepSeek API as the default and primary model provider.
- Provide a Chinese-first experience while working well on English codebases.
- Support Codex-like agent behavior: inspect, plan, edit, run, verify, summarize.
- Publish as an npm package owned by Silicon Code.
- Keep the legal posture clean under MIT attribution requirements.
- Preserve trust and debuggability for a local npm-distributed CLI.

## Base Project

Use DeepSeek-Reasonix as the preferred base because it is TypeScript/Node, DeepSeek-native, suitable for npm distribution, and already includes many required agent primitives. DeepSeek-TUI and Deep Code are reference projects for UX and feature ideas, but not the first implementation base.

The fork should not remain a thin rebrand. Silicon Code should own the user-facing CLI, configuration, prompts, documentation, release process, and default workflow.

## Product Naming

- Product name: Silicon Code
- Repository: `BrownSweet/siliconcode`
- npm package: `@brownsweet/siliconcode`
- Main command: `brown`
- Short command: `brown`
- Optional alias: `carbon`

Do not install `cc` by default. On Unix-like systems, `cc` is commonly used as the C compiler entrypoint, and replacing it could break native builds.

## User Workflow

The expected first-run flow:

```bash
npm install -g @brownsweet/siliconcode
cd path/to/project
siliconcode
```

The CLI should then guide the user through API key setup if needed. After setup, the user can give a task in natural language. Silicon Code should inspect the repository, propose or maintain a plan, request permission for shell commands, edit files, run validation, and present a final summary with changed files and test results.

## Core MVP Capabilities

- DeepSeek API configuration.
- Default model profile for DeepSeek V4 Pro and V4 Flash, subject to current API availability.
- Interactive terminal session.
- Repository file search and reading.
- Safe file editing with visible diffs.
- Shell command execution with confirmation.
- Test/build command execution when approved.
- Session resume.
- Project rule file support through `AGENTS.md` or `SILICON.md`.
- Chinese default prompts, explanations, and error messages.
- Basic cost and token visibility.
- License and third-party notice files included in npm output.

## Agent Flow

The default mode should be agentic:

1. Understand the user's task.
2. Inspect project files and local rules.
3. Build a short plan.
4. Apply focused code edits.
5. Ask before running shell commands that can affect the workspace.
6. Run relevant validation when available.
7. Show a concise diff and outcome summary.

The agent should allow user interruption and correction at any point. It should avoid broad refactors unless the task requires them.

## Permission Model

The first version should use conservative local permissions:

- Reading files in the current project is allowed.
- Writing files requires the agent to present the intended edit path and then apply it through the CLI's editing tool.
- Shell commands require explicit user confirmation.
- Destructive commands require stronger confirmation and should be avoided by default.
- Network access should be explicit when a command depends on it.

This is important because the tool will operate inside user repositories and may run commands on the user's machine.

## Configuration

Global config:

```text
~/.siliconcode/config.json
```

Project config or rules:

```text
SILICON.md
AGENTS.md
```

Environment variable:

```text
DEEPSEEK_API_KEY
```

The CLI should support both environment-based configuration and an interactive setup flow.

## Distribution

The first release should be distributed through npm:

```bash
npm install -g @brownsweet/siliconcode
npx @brownsweet/siliconcode
```

Other distribution channels such as Homebrew or shell installers can wait until the CLI is stable.

## License Compliance

If code is derived from DeepSeek-Reasonix, Silicon Code must preserve the upstream MIT license notice. This can be handled without making it prominent in product marketing.

Required files:

- `THIRD_PARTY_NOTICES.md`
- `LICENSES/DeepSeek-Reasonix-MIT.txt`

Recommended README placement:

- A short acknowledgements section near the bottom.

The project should not remove upstream copyright notices from copied source files unless those files are fully rewritten and no longer derived from upstream code.

## Security and Trust

Local CLI code should stay readable so stack traces, debugging, and user trust stay strong.

## Milestones

### Milestone 1: Repository and Base Import

- Initialize `BrownSweet/siliconcode`.
- Add project documentation.
- Import or fork the selected Reasonix base.
- Preserve MIT license notices.
- Rename package, command, config, and branding.

### Milestone 2: DeepSeek-First CLI

- Confirm model configuration.
- Implement Silicon Code command names.
- Implement first-run API key setup.
- Verify basic chat, file read, file edit, and shell approval flow.

### Milestone 3: Codex-Like MVP

- Improve planning loop.
- Improve diff display.
- Add project rule file loading.
- Add session resume.
- Add validation summary.

### Milestone 4: Chinese Developer Experience

- Chinese system prompts and terminal copy.
- Better command explanations.
- Chinese skills starter set.
- Domestic documentation and install guide.

## Open Decisions

- Whether the upstream source is imported as a forked history or selectively copied into a clean repository.
- Whether the first public release should be open source or private npm/internal alpha.
- Exact DeepSeek V4 model identifiers available at implementation time.
- Whether `carbon` should be installed by default or only provided as an opt-in alias.

## Recommendation

Proceed with a clean Silicon Code repository, use Reasonix as the implementation base, publish the user-facing CLI as `@brownsweet/siliconcode`, and keep the first MVP narrow: local agent, DeepSeek API, file edits, command approval, diff, validation, and Chinese-first workflow.
