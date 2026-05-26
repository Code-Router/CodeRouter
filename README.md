# CodeRouter

> **Route smarter. Ship faster.**
>
> CodeRouter is the planning and routing layer that sits between you (or your host agent) and the model fleet. It decides _which agent_, _which model_, _under what budget_, with _which context_ — for every step of a software task.

```
 ██████╗  ██████╗ ██████╗ ███████╗    ██████╗  ██████╗ ██╗   ██╗████████╗███████╗██████╗
██╔════╝ ██╔═══██╗██╔══██╗██╔════╝    ██╔══██╗██╔═══██╗██║   ██║╚══██╔══╝██╔════╝██╔══██╗
██║      ██║   ██║██║  ██║█████╗      ██████╔╝██║   ██║██║   ██║   ██║   █████╗  ██████╔╝
██║      ██║   ██║██║  ██║██╔══╝      ██╔══██╗██║   ██║██║   ██║   ██║   ██╔══╝  ██╔══██╗
╚██████╗ ╚██████╔╝██████╔╝███████╗    ██║  ██║╚██████╔╝╚██████╔╝   ██║   ███████╗██║  ██║
 ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝    ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝
```

## What CodeRouter is (and isn't)

[Claude Code Router (CCR)](https://github.com/musistudio/claude-code-router) answers **"how do I send a Claude Code request through a different provider?"** — it's a proxy that rewrites requests by token bucket / model name. That's the **transport layer**.

CodeRouter answers a different, higher-level question:

> _Which agent should do this part of the software task, with which model, using which context, under what budget?_

CodeRouter is the **orchestration layer** that delegates to Claude Code, Codex CLI, Anthropic / OpenAI / Google APIs, OpenAI-compatible providers (OpenRouter, DeepSeek, Groq), and local Ollama models. It plans, classifies, routes, validates, and remembers — across runs and across sessions.

You can run CodeRouter standalone (`coderouter` CLI), or expose it as an **MCP server** that any host agent (Claude Code, Codex) can call as `coderouter` tools.

## The five modes

CodeRouter exposes five operating modes that mirror how engineers actually work. They share workflow primitives but differ in stance and contract.

| Mode | Stance | Writes? | Output |
|------|--------|---------|--------|
| `plan` | Quick, Cursor-style planning | ✗ | `.coderouter/plans/<id>.plan.md` (3 phases) |
| `masterplan` | Research-grade, 6-phase plan with citations | ✗ | Plan with internal+external evidence |
| `agent` | Decisive execution | ✓ (worktree) | Diff + validators + report |
| `debug` | Evidence-gathering, hypothesis tree | ✗ | `.coderouter/debug/<id>.md` |
| `review` | Read-only diff/PR critique | ✗ | Structured review |

`plan` upgrades to `masterplan` when CodeRouter detects high-risk or architectural language. `agent` automatically invokes the **handoff workflow** (cheap fixer → strong reviewer) on validator failures.

## Why this is useful

- **You stop choosing models.** CodeRouter classifies each prompt across a cognitive shape (deep reasoning, long context, multi-file taste, adversarial, exploratory) and picks the right model from the providers you've enabled.
- **You don't lose memory.** Every run is persisted to `.coderouter/memory.db` (Node's built-in SQLite). The router learns which routes succeed on your repo, which fail, which patterns you keep overriding.
- **You see _why_.** Every decision carries a rationale: which classification stage fired, which shape axis dominated, which validator failed. Reports are colored in the CLI and JSON in MCP.
- **Two opinions when it matters.** Masterplan mode runs **dual planners** (e.g., Opus + GPT‑5) in parallel and uses a judge model to surface agreements + decision points. Tournament mode runs N strong models in isolated worktrees, validates each, and picks the winning diff.

## Install

```bash
pnpm i -g @coderouter/cli @coderouter/mcp
coderouter init
```

`init` detects Claude Code and/or Codex CLI on your machine and registers CodeRouter as an MCP server (`~/.claude.json`, `~/.codex/config.toml`). It also drops a `.coderouter/config.json` and `.coderouter/memory.md` in the current repo.

### Manual MCP install

Add to your host config:

**Claude Code** — `~/.claude.json`

```json
{
  "mcpServers": {
    "coderouter": { "command": "coderouter-mcp" }
  }
}
```

**Codex CLI** — `~/.codex/config.toml`

```toml
[mcp_servers.coderouter]
command = "coderouter-mcp"
```

## Use

### Standalone CLI

```bash
coderouter                         # interactive REPL
coderouter agent "rename getCwd"   # one-shot execution
coderouter masterplan "design L1-L5 memory"   # 6-phase plan
coderouter debug  "tests fail in CI but pass locally"
coderouter review                  # review current diff
coderouter route "fix typo"        # classify + show chosen route (no run)
coderouter memory show             # inspect L5 persistent memory
```

REPL slash commands: `/plan` `/masterplan` `/agent` `/debug` `/review` `/effort low|medium|high|max` `/apply` `/fast` `/clear` `/help` `/exit`.

### From inside Claude Code / Codex

Once the MCP server is registered, your host agent can call CodeRouter as a tool:

- `coderouter plan` — quick planning
- `coderouter masterplan` — 6-phase planning with citations
- `coderouter agent_run` — delegate execution
- `coderouter route` — classify without running
- `coderouter delegate` — generic single-call wrapper
- `coderouter validate` — run configured project validators
- `coderouter clarify` — surface clarification questions
- `coderouter research_web` / `research_github` / `research_docs` / `fetch_source`
- `coderouter memory_show` / `memory_forget` / `memory_export`

## Configuration

`coderouter.config.{ts,js,json}` at the repo root:

```ts
export default {
  providers: [
    {
      name: 'openrouter',
      adapter: 'openai_compat',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      models: {
        'anthropic/claude-sonnet-4.5': {
          pricePer1MIn: 3, pricePer1MOut: 15, contextWindow: 200_000
        }
      }
    }
  ],
  routes: { default: 'anthropic,claude-sonnet-4.5' },
  validators: { test: 'pnpm test', lint: 'pnpm lint', typecheck: 'pnpm typecheck' },
  workflows: { handoff: true, dualPlan: true, tournament: false, maxHandoffPasses: 3 },
  research:  { web: 'tavily', github: true, docs: true },
  costCeilings: { perRun: 2.50, perDay: 25.00 },
};
```

## Memory model (L1–L5)

| Layer | What it holds | Where it lives |
|-------|---------------|----------------|
| L1 | Per-task context manifest (`ripgrep` + git activity, token-budgeted) | in-memory per run |
| L2 | Project memory: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules`, `.coderouter/memory.md` | repo |
| L3 | Conversation session (multi-call MCP) | SQLite, 6 h TTL |
| L4 | `HandoffBrief` — structured payload between agents | per workflow |
| L5 | Persistent learning: runs, classifications, learned examples, route stats, failure patterns, overrides | `.coderouter/memory.db` |

L5 feeds the router two ways: **bias toward routes that have succeeded** for this task type, and **forbid routes that have failed repeatedly**. Both decay over time and per-task-type.

## Architecture

```
packages/
  core/        types, sandbox, adapters, transformers, providers,
               classify, router, validate, store, memory,
               context, clarify, research, handoff, workflows,
               modes (plan/masterplan/agent/debug/review), report
  cli/         coderouter / cr — REPL + 6 top-level commands
  mcp/         coderouter-mcp — stdio MCP server exposing all modes
eval/          tasks.yaml + fixtures + runner; classifier & latency baseline
```

Each `agent` run executes in a **git worktree** under `.coderouter/runs/<id>/` so the host repo is never modified mid-run. Diffs are produced, validated, and either applied (`--apply`) or returned for review.

## Evaluation

```bash
pnpm eval                          # offline classifier + budget tests
EVAL_LIVE=1 pnpm eval              # also runs mode-level tasks (requires API keys)
pnpm eval -- --filter classify-*   # filter to a subset
```

The harness exposes routing accuracy, classification source distribution, and pre-agent latency budget against `eval/tasks.yaml`. It is the regression net you tune the rules / seed corpus / router policy against.

## Development

```bash
pnpm i
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

## License

MIT
