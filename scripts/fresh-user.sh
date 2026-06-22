#!/usr/bin/env bash
#
# fresh-user.sh - test the *published* coderouter-cli the way a brand-new
# user (e.g. someone who just ran `npm install -g coderouter-cli`) would
# experience it, in a fully isolated sandbox.
#
# It redirects $HOME to a throwaway directory, so CodeRouter sees:
#   - no saved API keys      (~/.coderouter/credentials.json)
#   - no trusted folders     (~/.coderouter/trust.json)
#   - a fresh memory db       (./.coderouter/memory.db inside the sandbox)
# Your real ~/.coderouter is never touched.
#
# It runs the package straight from the npm registry via `npx`, so you
# always test the published artifact - never a local/linked dev build.
#
# Usage:
#   scripts/fresh-user.sh                     # latest published, interactive REPL
#   scripts/fresh-user.sh -v 0.1.2            # pin a specific version
#   scripts/fresh-user.sh route "fix a typo"  # run a subcommand instead of the REPL
#   scripts/fresh-user.sh -v 0.1.2 --help     # pin version + pass args
#
# Env:
#   KEEP=1   keep the sandbox dir after exit (default: delete it)
#
set -euo pipefail

PKG="coderouter-cli"
VERSION="latest"

# Optional leading -v/--version flag; everything else is passed to the CLI.
if [[ "${1:-}" == "-v" || "${1:-}" == "--version" ]]; then
  VERSION="${2:?missing version after $1}"
  shift 2
fi

REAL_HOME="$HOME"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/coderouter-sandbox.XXXXXX")"

cleanup() {
  if [[ -n "${KEEP:-}" ]]; then
    echo ""
    echo "kept sandbox: $SANDBOX"
  else
    rm -rf "$SANDBOX"
  fi
}
trap cleanup EXIT

echo "──────────────────────────────────────────────"
echo " coderouter fresh-user sandbox"
echo "   package : ${PKG}@${VERSION}"
echo "   HOME    : $SANDBOX  (isolated)"
echo "   keep    : ${KEEP:+yes}${KEEP:-no}"
echo "──────────────────────────────────────────────"

cd "$SANDBOX"

# Isolate CodeRouter state by moving HOME, but keep the npm cache on the
# real home so npx doesn't re-download the package every single run.
export HOME="$SANDBOX"
export npm_config_cache="$REAL_HOME/.npm"
export npm_config_update_notifier=false

exec npx -y "${PKG}@${VERSION}" "$@"
