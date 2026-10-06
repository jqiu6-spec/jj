#!/usr/bin/env bash
# Install the photo-palette plugin into Codex. The CLI, desktop app and IDE
# extension all read the same ~/.codex, so one install covers all three.
#
#   bash install.sh              # plugin install (Codex 0.131+), else direct install
#   bash install.sh --manual     # always install the skill + MCP server directly
#   bash install.sh --uninstall  # remove everything this script installed
#
# Installed pieces, all under $CODEX_HOME (default ~/.codex):
#   photo-palette-marketplace/  stable copy of this folder that Codex installs from
#   photo-palette-venv/         private Python env with Pillow + NumPy (only if needed)
#   photo-palette/, skills/photo-palette/   the direct (--manual) install
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN="$ROOT/plugins/photo-palette"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$CODEX_HOME"  # Codex refuses a CODEX_HOME that does not exist
MARKETPLACE="jj"
STABLE="$CODEX_HOME/photo-palette-marketplace"
VENV="$CODEX_HOME/photo-palette-venv"
MANUAL_HOME="$CODEX_HOME/photo-palette"
MIN_PLUGIN_VERSION="0.131"

case "${1:-}" in
  "") MODE="auto" ;;
  --manual) MODE="manual" ;;
  --uninstall) MODE="uninstall" ;;
  -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) printf 'unknown option: %s (try --help)\n' "$1" >&2; exit 2 ;;
esac

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# --- Codex ------------------------------------------------------------------
command -v codex >/dev/null 2>&1 || die "the 'codex' command is not on your PATH.
Install or update it:  npm install -g @openai/codex@latest   (or: brew install --cask codex)"
CODEX_VERSION="$(codex --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
[ -n "$CODEX_VERSION" ] || die "'codex' is on your PATH but failed to run ('codex --version' gave no version).
Reinstall it:  npm install -g @openai/codex@latest   (or: brew install --cask codex)"

has_plugin_cmd() { codex plugin --help 2>/dev/null | grep -qE "^[[:space:]]+$1[[:space:]]"; }

# Run a codex command, show its useful output, and keep it in $OUT.
run_codex() {
  OUT="$(codex "$@" 2>&1 || true)"
  printf '%s\n' "$OUT" | grep -v -e 'PATH aliases' -e 'could not update PATH' \
    -e '<unknown>' -e 'Stack backtrace' -e '^[[:space:]]*$' | sed 's/^/    /' || true
}

# Leftovers from the other install route would show up as a second skill and
# shadow the MCP server, so each route removes the other's files.
remove_manual_install() {
  [ -e "$MANUAL_HOME" ] || [ -e "$CODEX_HOME/skills/photo-palette" ] || return 0
  say "Removing the direct install"
  rm -rf "$MANUAL_HOME" "$CODEX_HOME/skills/photo-palette"
  codex mcp remove photo-palette >/dev/null 2>&1 || true
}

remove_plugin_install() {
  has_plugin_cmd remove || return 0
  # Checked on disk: `codex plugin list` fails outright if any configured
  # marketplace folder has been deleted.
  if [ -d "$CODEX_HOME/plugins/cache/$MARKETPLACE/photo-palette" ] \
     || grep -qs "photo-palette@$MARKETPLACE" "$CODEX_HOME/config.toml"; then
    say "Removing the plugin install"
    codex plugin remove "photo-palette@$MARKETPLACE" >/dev/null 2>&1 || true
  fi
}

if [ "$MODE" = "uninstall" ]; then
  remove_plugin_install
  if has_plugin_cmd marketplace && grep -qsF "$STABLE" "$CODEX_HOME/config.toml"; then
    codex plugin marketplace remove "$MARKETPLACE" >/dev/null 2>&1 || true
  fi
  remove_manual_install
  rm -rf "$STABLE" "$VENV"
  say "Done: photo-palette removed. Restart Codex."
  exit 0
fi

[ -f "$PLUGIN/.codex-plugin/plugin.json" ] || die "run this script from the unzipped photo-palette folder (missing $PLUGIN)"
[ -f "$ROOT/.agents/plugins/marketplace.json" ] || die "the hidden .agents folder is missing from $ROOT.
Finder drops hidden folders when copying; unzip the original photo-palette.zip again and run install.sh from there."
say "Found Codex $CODEX_VERSION"

# --- Python + dependencies --------------------------------------------------
# Codex launches the MCP server outside your shell (the desktop app has its
# own PATH, activated venvs are not inherited), so the server is pinned to an
# absolute interpreter that is known to have Pillow and NumPy.
BASE_PY=""
for candidate in python3 python "py -3"; do
  # shellcheck disable=SC2086  # "py -3" is intentionally split into command + flag
  if command -v ${candidate%% *} >/dev/null 2>&1 \
     && exe="$($candidate -c 'import sys; assert sys.version_info >= (3, 9); print(sys.executable)' 2>/dev/null)" \
     && [ -n "$exe" ]; then
    BASE_PY="$exe"; break
  fi
done
[ -n "$BASE_PY" ] || die "Python 3.9+ not found. Install it from https://www.python.org/downloads/ and re-run."

venv_python() {
  local p
  for p in "$VENV/bin/python" "$VENV/Scripts/python.exe"; do
    if [ -x "$p" ]; then printf '%s\n' "$p"; return 0; fi
  done
  return 1
}
has_deps() { "$1" -c 'import PIL, numpy' >/dev/null 2>&1; }

PY=""
if [ -z "${VIRTUAL_ENV:-}${CONDA_PREFIX:-}" ] && has_deps "$BASE_PY"; then
  PY="$BASE_PY"  # a system/user Python that already has the packages
elif vp="$(venv_python)" && has_deps "$vp"; then
  PY="$vp"       # the private environment from an earlier run
else
  say "Setting up a private Python environment with Pillow and NumPy ($VENV)"
  rm -rf "$VENV"
  if "$BASE_PY" -m venv "$VENV" >/dev/null 2>&1 && vp="$(venv_python)" \
     && "$vp" -m pip install --quiet --disable-pip-version-check pillow numpy; then
    PY="$vp"
  else
    rm -rf "$VENV"
    if [ -n "${VIRTUAL_ENV:-}${CONDA_PREFIX:-}" ] && has_deps "$BASE_PY"; then
      warn "using the packages in your active environment; re-run install.sh if you delete it"
      PY="$BASE_PY"
    else
      die "could not install Pillow and NumPy automatically (no internet, or Python lacks venv).
Install them yourself, then re-run: bash install.sh
    $BASE_PY -m pip install --user pillow numpy
  Homebrew or Debian/Ubuntu Python ('externally-managed-environment' error):
    $BASE_PY -m pip install --user --break-system-packages pillow numpy
  or on macOS with Homebrew:
    brew install numpy pillow"
    fi
  fi
fi
"$PY" "$PLUGIN/skills/photo-palette/scripts/palette.py" --version >/dev/null || die "palette.py failed to start with $PY"
say "Using Python: $PY"

# --- Install ----------------------------------------------------------------
pin_mcp_python() {
  local cfg
  for cfg in "$CODEX_HOME"/plugins/cache/"$MARKETPLACE"/photo-palette/*/.mcp.json; do
    [ -f "$cfg" ] || continue
    "$PY" - "$cfg" "$PY" <<'PYEOF'
import json, sys
path, py = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
data["mcpServers"]["photo-palette"]["command"] = py
with open(path, "w") as f:
    json.dump(data, f, indent=2)
PYEOF
  done
}

# Returns 2 when this Codex has no plugin commands, 1 when they failed.
plugin_install() {
  has_plugin_cmd add || return 2
  # Install from a stable copy so deleting the download later doesn't break
  # `codex plugin list` (Codex re-reads every configured marketplace folder).
  if [ "$ROOT" != "$STABLE" ]; then
    rm -rf "$STABLE"
    mkdir -p "$STABLE"
    cp -R "$ROOT/.agents" "$ROOT/plugins" "$STABLE/"
  fi
  say "Adding marketplace '$MARKETPLACE'"
  run_codex plugin marketplace add "$STABLE"
  if grep -q "different source" <<<"$OUT"; then
    say "Replacing the '$MARKETPLACE' marketplace that was added from another folder"
    run_codex plugin marketplace remove "$MARKETPLACE"
    run_codex plugin marketplace add "$STABLE"
  fi
  grep -q "Added marketplace" <<<"$OUT" \
    || { grep -q "already added from" <<<"$OUT" && ! grep -q "different source" <<<"$OUT"; } \
    || return 1
  say "Installing plugin photo-palette@$MARKETPLACE"
  run_codex plugin add "photo-palette@$MARKETPLACE"
  grep -q "Added plugin" <<<"$OUT" || return 1
  pin_mcp_python
}

manual_install() {
  remove_plugin_install
  say "Installing the skill and MCP server into $MANUAL_HOME"
  rm -rf "$MANUAL_HOME" "$CODEX_HOME/skills/photo-palette"
  mkdir -p "$MANUAL_HOME" "$CODEX_HOME/skills"
  cp -R "$PLUGIN/." "$MANUAL_HOME/"
  cp -R "$MANUAL_HOME/skills/photo-palette" "$CODEX_HOME/skills/photo-palette"
  INSTALLED="skill only"
  if codex mcp --help >/dev/null 2>&1; then
    codex mcp remove photo-palette >/dev/null 2>&1 || true
    if codex mcp add photo-palette -- "$PY" "$MANUAL_HOME/mcp/server.py" >/dev/null 2>&1; then
      INSTALLED="skill + MCP server"
    else
      warn "could not register the MCP server; the skill still works on its own"
    fi
  else
    warn "this Codex has no 'codex mcp' command; installed the skill only"
  fi
}

if [ "$MODE" = "auto" ]; then
  if plugin_install; then
    remove_manual_install
    say "Done: photo-palette installed as a Codex plugin."
  else
    if [ $? -eq 2 ]; then
      warn "Codex $CODEX_VERSION can't install plugins from the command line (needs $MIN_PLUGIN_VERSION+). Installing the skill and MCP server directly instead."
    else
      warn "the plugin install failed (Codex's message is above). Installing the skill and MCP server directly instead."
    fi
    manual_install
    say "Done: photo-palette installed ($INSTALLED)."
  fi
else
  manual_install
  say "Done: photo-palette installed ($INSTALLED)."
fi
echo
echo "Restart Codex, then try:  Generate a clean color palette from ~/Pictures/photo.jpg"
