# CodeRouter

<img width="1024" height="191" alt="CodeRouter banner" src="https://github.com/user-attachments/assets/d8eacfbd-1d65-4546-982f-16a15718e670" />

**Route smarter. Build faster.**

Orchestration layer that routes each coding task to the right agent, model, context, and budget — across Claude Code, Codex, and provider APIs. Run it as a CLI or expose it as an MCP server to any host agent.

## Install

Requires **Node 24+** (CodeRouter uses Node's built-in SQLite).

```bash
npm install -g coderouter-cli
```

Then just run:

```bash
coderouter
```

That's the whole setup — no separate ripgrep, no extra services. A prebuilt `ripgrep` is bundled in, and on first launch CodeRouter walks you through adding an API key (OpenAI, Anthropic, OpenRouter, DeepSeek, Groq, …) or auto-detects a Claude Code / Codex CLI you already have.

Don't want a global install? Use npx:

```bash
npx coderouter-cli
```

> Advanced: to expose CodeRouter as an MCP server inside Claude Code / Codex, run `coderouter init` (see [From inside Claude Code / Codex](#from-inside-claude-code--codex)).

## Quick start

```bash
coderouter                         # interactive REPL
coderouter agent "rename getCwd"   # one-shot execution
coderouter masterplan "design L1-L5 memory"
coderouter debug  "tests fail in CI but pass locally"
coderouter review                  # review current diff
coderouter route "fix typo"        # classify + show chosen route (no run)
coderouter memory show             # inspect L5 persistent memory
```

REPL slash commands: `/plan` `/masterplan` `/agent` `/debug` `/review` `/effort low|medium|high|max` `/apply` `/fast` `/clear` `/help` `/exit`.

## The five modes

| Mode | Stance | Writes? | Output |
|------|--------|---------|--------|
| `plan` | Quick, Cursor-style planning | ✗ | `.coderouter/plans/<id>.plan.md` (3 phases) |
| `masterplan` | Research-grade, 6-phase plan with citations | ✗ | Plan with internal+external evidence |
| `agent` | Decisive execution | ✓ (worktree) | Diff + validators + report |
| `debug` | Evidence-gathering, hypothesis tree | ✗ | `.coderouter/debug/<id>.md` |
| `review` | Read-only diff/PR critique | ✗ | Structured review |

`plan` upgrades to `masterplan` when CodeRouter detects high-risk or architectural language. `agent` automatically invokes the **handoff workflow** (cheap fixer → strong reviewer) on validator failures.

## From inside Claude Code / Codex

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

### Manual MCP install

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

## Why CodeRouter

- **You stop choosing models.** CodeRouter classifies each prompt across a cognitive shape (deep reasoning, long context, multi-file taste, adversarial, exploratory) and picks the right model from the providers you've enabled.
- **You don't lose memory.** Every run is persisted to `.coderouter/memory.db` (Node's built-in SQLite). The router learns which routes succeed on your repo, which fail, which patterns you keep overriding.
- **You see _why_.** Every decision carries a rationale: which classification stage fired, which shape axis dominated, which validator failed. Reports are colored in the CLI and JSON in MCP.
- **Two opinions when it matters.** Masterplan mode runs **dual planners** (e.g., Opus + GPT‑5) in parallel and uses a judge model to surface agreements + decision points. Tournament mode runs N strong models in isolated worktrees, validates each, and picks the winning diff.

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

The harness exposes routing accuracy, classification source distribution, and pre-agent latency budget against `eval/tasks.yaml`.

## Development

```bash
pnpm i
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

## Why routing pays off

Most of a coding session isn't hard. Renames, boilerplate, test scaffolding, "where is X?" questions — none of these need a frontier model. The premium models only earn their price on the genuinely hard slice: deep reasoning, large-context refactors, architecture, taste-sensitive multi-file edits.

CodeRouter scores every prompt by its **cognitive shape** and sends it to the cheapest model that can do the job well:

- **Lower cost.** Trivial and mechanical work goes to fast, cheap models (or your local Ollama); only the hard 10–20% reaches the expensive tier. That's the difference between paying frontier prices for *everything* and paying them only for the part that needs it — often a multiple-x reduction on a mixed workload.
- **Higher productivity.** Cheap models are also *faster*, so the routine majority of your tasks finish in a fraction of the time. The router also runs handoffs automatically (cheap fixer → strong reviewer on validator failure), so you're not babysitting a model or hand-picking one per task.
- **No model micromanagement.** You stop maintaining a mental table of "which model for which task." You describe the work; CodeRouter picks, explains *why*, and learns from what actually succeeds on your repo (L1–L5 memory). Set preferred "strong" / "cheap" models in the dashboard if you want to steer it — the default already optimizes the cost/quality tradeoff.

## Masterplan: planning you can trust

Bad code usually starts with cheap planning. `masterplan` is CodeRouter's research-grade planning mode for high-stakes work — migrations, new subsystems, anything you'd want a senior engineer to think hard about before a line is written.

- **Evidence-backed.** It gathers internal context (your code, conventions, prior runs) *and* external evidence (docs, GitHub, the web), and cites it — so the plan reflects how things actually work instead of a confident guess.
- **Two opinions when it matters.** It runs **dual planners** (e.g. Opus + GPT‑5) in parallel and uses a judge model to surface where they *agree* (just do it) and where they *diverge* (a decision you should make) — turning one fallible plan into a reviewed one.
- **Straight to execution.** The output is a phased plan you can hand directly to `agent`, which runs each step in a sandboxed git worktree, validates it, and hands off on failure.

`plan` (the quick, Cursor-style mode) auto-upgrades to `masterplan` when CodeRouter detects high-risk or architectural language — so you get the heavyweight treatment exactly when it's warranted, and not a second sooner.

## License

MIT
