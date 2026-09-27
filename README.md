# CodeRouter

<img width="1024" height="191" alt="CodeRouter banner" src="https://github.com/user-attachments/assets/d8eacfbd-1d65-4546-982f-16a15718e670" />

**Route smarter. Build faster.**

One assistant that picks the right model for every task: fast, cheap models for the easy 80%, frontier models for the hard 20%. Ask it anything and it just answers. Point it at a project and it becomes a coding agent that runs each change in a safe sandbox, checks it, and learns what works on your repo.

Works with your existing **Claude Code** or **Codex** CLI, or any API key: OpenAI, Anthropic, OpenRouter, DeepSeek, Groq, or a local Ollama model.

## Download

### Desktop app

**[Download the latest release](https://github.com/Code-Router/CodeRouter/releases/latest)**

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `CodeRouter-<version>-arm64.dmg` |
| Windows | `CodeRouter Setup <version>.exe` |

The app is self-contained (no separate Node or CLI install needed) and updates itself: when a new version is out, a card appears bottom-left with **Update / Later**.

> Builds aren't code-signed yet. On macOS, right-click the app, choose **Open** and confirm. On Windows, if SmartScreen appears, click **More info**, then **Run anyway**.

### CLI

Requires **Node 24+**.

```bash
npm install -g coderouter-cli
coderouter          # or the short alias: cr
```

First launch walks you through adding an API key (or auto-detects a Claude Code / Codex CLI you already have). `coderouter app` launches the desktop app from the terminal.

### Inside Claude Code / Codex (MCP)

Run `coderouter init` to register CodeRouter as an MCP server for your host agent.

## Quick start

```bash
coderouter                            # interactive REPL
coderouter run "rename getCwd"        # one-shot, non-interactive
coderouter route "fix typo"           # show the chosen route (no run)
coderouter logs                       # browse run journals and decision timelines
coderouter loop "make CI green"       # generate + run a self-correcting loop
```

In the REPL, type `/` for commands and `@` to reference files.

## Bugs and feature requests

[Open an issue](https://github.com/Code-Router/CodeRouter/issues/new/choose). Include your OS, the app or CLI version (Settings, then About, or `coderouter --version`), and steps to reproduce.

## License

CodeRouter is proprietary software, free to download and use. This repository hosts releases and issue tracking only; the source code is not public. See [LICENSE](LICENSE).
