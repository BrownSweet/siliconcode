# Security Policy

Report Silicon Code security issues privately to the repository owner.

Include:

- a clear description of the issue
- reproduction steps
- Silicon Code version (`brown --version`)
- platform and Node.js version

## Scope

In scope:

- the published `@brownsweet/siliconcode` npm package
- the local CLI/TUI and dashboard server
- shell approval, edit approval, config loading, and tool dispatch behavior

Out of scope:

- third-party MCP servers
- user-provided shell hooks or commands
- compromised local API keys or shell profiles

## Key Handling

DeepSeek API keys belong in environment variables or
`~/.siliconcode/config.json`. Treat that file as a credential store and do not
commit it.
