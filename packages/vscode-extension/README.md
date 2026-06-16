# CodeRouter for VS Code & Cursor

Route every coding task to the best model, without leaving your editor. This
extension is a thin shell around the [`coderouter`](https://www.npmjs.com/package/coderouter)
CLI: it opens the chat REPL in an integrated terminal and embeds the live
usage/cost dashboard in an editor panel.

## Features

- **Open Chat** — launches the CodeRouter REPL in an integrated terminal scoped
  to your workspace folder.
- **Open Dashboard** — starts the local dashboard server and embeds it in an
  editor-side panel (usage, cost, runs, and provider settings).
- **Dashboard in Browser** — opens the same dashboard in your default browser.
- **Activity-bar launcher** — a sidebar with one-click buttons for the above.

The extension never re-implements the agent — the CLI and its `core` engine
remain the single source of truth. This is just a convenient surface on top.

## Requirements

Install the CodeRouter CLI so the `coderouter` command is on your `PATH`:

```bash
npm install -g coderouter
```

If it isn't installed globally, set the **`coderouter.cliPath`** setting to an
absolute path (either the `coderouter` binary or a built `cli.js`). When run
from a CodeRouter monorepo checkout, the extension automatically falls back to
the workspace's `packages/cli/dist/cli.js` build.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `coderouter.cliPath` | `coderouter` | Command used to launch the CLI. |
| `coderouter.dashboardPort` | `4319` | Preferred dashboard port (falls through if taken). |

## Development

```bash
pnpm --filter coderouter-vscode build   # bundle to dist/extension.js
```

Then press <kbd>F5</kbd> in VS Code with this folder open to launch an Extension
Development Host. Works the same in Cursor (it runs VS Code extensions).
