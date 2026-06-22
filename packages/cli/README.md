# coderouter-cli

**Route smarter. Ship faster.** CodeRouter is a coding-agent orchestration layer: it classifies each task by its *cognitive shape*, picks the best model from the providers you've enabled, runs edits safely in a git-worktree sandbox, validates the result, and remembers what works on your repo.

It works with your existing **Claude Code** / **Codex** CLI, or with any API key — **OpenAI, Anthropic, OpenRouter, DeepSeek, Groq** — via a built-in first-party coding agent.

## Install

Requires **Node 24+** (uses Node's built-in SQLite).

```bash
npm install -g coderouter-cli
```

Then run:

```bash
coderouter
```

That's the whole setup — a prebuilt `ripgrep` is bundled in, and first launch walks you through adding an API key or auto-detects a local Claude Code / Codex CLI.

Prefer no global install?

```bash
npx coderouter-cli
```

## Usage

```bash
coderouter                         # interactive REPL
coderouter agent "rename getCwd"   # one-shot execution
coderouter plan "design a cache layer"
coderouter masterplan "design L1-L5 memory"   # research-grade, cited plan
coderouter debug "tests fail in CI but pass locally"
coderouter review                  # review the current diff
coderouter route "fix typo"        # classify + show the chosen route (no run)
coderouter dashboard               # local usage + settings dashboard
coderouter memory show             # inspect persistent memory
```

In the REPL, type `/` for commands and `@` to reference files. Slash commands include
`/plan` `/masterplan` `/agent` `/debug` `/review` `/effort low|medium|high|max` `/apply` `/fast` `/clear` `/help` `/exit`.

## How it works

- **You stop choosing models.** Each prompt is scored across a cognitive shape (deep reasoning, long context, multi-file taste, adversarial, exploratory) and routed to the right model among the providers you've configured. Set preferred "strong" and "cheap" models in the dashboard if you want to steer it.
- **Edits are sandboxed.** Every `agent` run executes in a git worktree under `.coderouter/runs/<id>/`, so your repo is never touched mid-run. You get a diff, validators, and a report; changes apply only when you accept them.
- **It remembers.** Runs, classifications, route stats, and failure patterns persist to `.coderouter/memory.db` so routing improves on your repo over time.
- **You see why.** Every decision carries a rationale — which classifier fired, which shape axis dominated, which validator failed.

## Links

- Repository & full docs: <https://github.com/EfeAcar6431/CodeRouter>
- Issues: <https://github.com/EfeAcar6431/CodeRouter/issues>

## License

MIT
