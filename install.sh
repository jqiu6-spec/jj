#!/usr/bin/env bash
# Install the photo-palette plugin into Codex (CLI, desktop app and IDE
# extension all share ~/.codex).
#
#   bash install.sh            # plugin install (Codex 0.135+), else manual fallback
#   bash install.sh --manual   # always install the skill + MCP server directly
#
# The manual route works on any Codex version that supports skills and
# `codex mcp add`, and does not depend on the plugin system.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$ROOT/plugins/photo-palette"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
MARKETPLACE="jj"
MODE="auto"
[ "${1:-}" = "--manual" ] && MODE="manual"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$PLUGIN/.codex-plugin/plugin.json" ] || die "run this script from the unzipped folder (missing $PLUGIN)"

# --- Python + dependencies --------------------------------------------------
PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null; then
    PY="$(command -v "$candidate")"; break
  fi
done
[ -n "$PY" ] || die "Python 3.9+ not found. Install it from https://www.python.org/downloads/ and re-run."
say "Using Python: $PY"

if ! "$PY" -c 'import PIL, numpy' 2>/dev/null; then
  say "Installing Pillow and NumPy"
  "$PY" -m pip install --user --quiet pillow numpy 2>/dev/null \
    || "$PY" -m pip install --quiet pillow numpy 2>/dev/null \
    || true
  if ! "$PY" -c 'import PIL, numpy' 2>/dev/null; then
    die "could not install Pillow/NumPy automatically. Try one of:
    $PY -m pip install --user pillow numpy
    $PY -m pip install --user --break-system-packages pillow numpy   (Homebrew/Debian Python)
    brew install numpy pillow                                        (macOS Homebrew)
then re-run: bash install.sh"
  fi
fi
"$PY" "$PLUGIN/skills/photo-palette/scripts/palette.py" --version >/dev/null || die "palette.py failed to start"

# --- Codex ------------------------------------------------------------------
command -v codex >/dev/null 2>&1 || die "the 'codex' command is not on your PATH.
Install or update it:  npm install -g @openai/codex@latest   (or: brew install --cask codex)"
CODEX_VERSION="$(codex --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
[ -n "$CODEX_VERSION" ] || die "'codex' is on your PATH but failed to run ('codex --version' gave no version).
Reinstall it:  npm install -g @openai/codex@latest   (or: brew install --cask codex)"
say "Found Codex $CODEX_VERSION"

# Run a codex command, echo its useful output, and keep it in $OUT.
run_codex() {
  OUT="$(codex "$@" 2>&1 || true)"
  printf '%s\n' "$OUT" | grep -v -e 'PATH aliases' -e 'could not update PATH' \
    -e '<unknown>' -e 'Stack backtrace' -e '^[[:space:]]*$' | sed 's/^/    /' || true
}

plugin_install() {
  codex plugin --help 2>/dev/null | grep -qE '^[[:space:]]+add[[:space:]]' || return 1
  say "Adding marketplace '$MARKETPLACE' from $ROOT"
  run_codex plugin marketplace add "$ROOT"
  if ! grep -qE "Added marketplace|already added from $ROOT" <<<"$OUT"; then
    # A marketplace with this name exists from another location: replace it.
    say "Replacing the existing '$MARKETPLACE' marketplace"
    run_codex plugin marketplace remove "$MARKETPLACE"
    run_codex plugin marketplace add "$ROOT"
    grep -q "Added marketplace" <<<"$OUT" || return 1
  fi
  say "Installing plugin photo-palette@$MARKETPLACE"
  run_codex plugin add "photo-palette@$MARKETPLACE"
  grep -q "Added plugin" <<<"$OUT" || return 1
  if [ "$PY" != "$(command -v python3 2>/dev/null || true)" ]; then
    # .mcp.json launches "python3"; point Codex at the interpreter that has the deps.
    local cache="" dir
    for dir in "$CODEX_HOME"/plugins/cache/"$MARKETPLACE"/photo-palette/*/; do
      [ -d "$dir" ] && cache="$dir"
    done
    if [ -n "$cache" ]; then
      "$PY" - "$cache/.mcp.json" "$PY" <<'PYEOF'
import json, sys
path, py = sys.argv[1], sys.argv[2]
data = json.load(open(path))
data["mcpServers"]["photo-palette"]["command"] = py
json.dump(data, open(path, "w"), indent=2)
PYEOF
    fi
  fi
  return 0
}

# Leftovers from the other install route would show up as a second skill
# and shadow the MCP server, so each route removes the other's files.
remove_manual_install() {
  [ -f "$CODEX_HOME/photo-palette/mcp/server.py" ] || return 0
  say "Removing the earlier manual install"
  rm -rf "$CODEX_HOME/photo-palette" "$CODEX_HOME/skills/photo-palette"
  codex mcp remove photo-palette >/dev/null 2>&1 || true
}

remove_plugin_install() {
  codex plugin --help 2>/dev/null | grep -qE '^[[:space:]]+remove[[:space:]]' || return 0
  codex plugin list 2>/dev/null | grep -q "photo-palette@$MARKETPLACE  *installed" || return 0
  say "Removing the earlier plugin install"
  codex plugin remove "photo-palette@$MARKETPLACE" >/dev/null 2>&1 || true
}

manual_install() {
  local home="$CODEX_HOME/photo-palette"
  remove_plugin_install
  say "Installing manually into $home"
  rm -rf "$home"
  mkdir -p "$home" "$CODEX_HOME/skills"
  cp -R "$PLUGIN/." "$home/"
  rm -rf "$CODEX_HOME/skills/photo-palette"
  cp -R "$home/skills/photo-palette" "$CODEX_HOME/skills/photo-palette"
  say "Skill installed at $CODEX_HOME/skills/photo-palette"
  if codex mcp --help >/dev/null 2>&1; then
    codex mcp remove photo-palette >/dev/null 2>&1 || true
    if codex mcp add photo-palette -- "$PY" "$home/mcp/server.py" >/dev/null 2>&1; then
      say "MCP server 'photo-palette' registered"
      INSTALLED="skill + MCP server"
    else
      warn "could not register the MCP server; the skill still works on its own"
    fi
  else
    warn "this Codex has no 'codex mcp' command; installed the skill only"
  fi
}

if [ "$MODE" = "auto" ] && plugin_install; then
  remove_manual_install
  say "Done: photo-palette installed as a Codex plugin."
else
  [ "$MODE" = "auto" ] && warn "this Codex can't install plugins from the command line (needs 0.135+); using the manual install"
  INSTALLED="skill only"
  manual_install
  say "Done: photo-palette installed ($INSTALLED)."
fi
echo
echo "Restart Codex, then try:  Generate a clean color palette from ~/Pictures/photo.jpg"
