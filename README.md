# jj

Codex plugins.

| Plugin | What it does |
| --- | --- |
| [photo-palette](plugins/photo-palette) | Generates clean, perceptually balanced color palettes from photographs, with UI roles and CSS / Tailwind / SCSS / JSON / SVG / GIMP exports. |

## Install photo-palette

You need [Codex](https://developers.openai.com/codex) and Python 3.9 or newer.

### Easiest: the install script (macOS / Linux)

Open Terminal in the unzipped `photo-palette` folder. On a Mac, the simplest
way is to open Terminal, type `cd ` (with a space after it), drag the
`photo-palette` folder into the Terminal window, and press Return. Then run:

```bash
bash install.sh
```

What the script does:

- If your Python doesn't already have Pillow and NumPy, it installs them into
  a private environment at `~/.codex/photo-palette-venv`. Nothing is installed
  system-wide.
- It keeps a copy of itself at `~/.codex/photo-palette-marketplace`, so you
  can delete the download afterwards.
- On Codex 0.131 or newer, it installs a plugin from that copy.
- On older Codex, it puts the skill and the MCP server in place directly.

Restart Codex afterwards (the CLI, the desktop app or the IDE extension).
`bash install.sh --manual` forces the direct install.

To repair the install later, for example after upgrading Python, run
`bash ~/.codex/photo-palette-marketplace/install.sh`. Add `--uninstall` to
remove everything instead.

To install from git rather than the zip, clone the branch that has the
plugin:
`git clone -b claude/quirky-thompson-7o7tvm https://github.com/jqiu6-spec/jj`,
then run `bash jj/install.sh`.

### By hand (Codex 0.131 or newer)

```bash
python3 -m pip install --user pillow numpy   # Homebrew Python: add --break-system-packages
cd ~/Downloads/photo-palette                  # the folder that contains install.sh
codex plugin marketplace add .
codex plugin add photo-palette@jj
```

Keep that folder: Codex reads the marketplace from it. The install script
avoids this by copying the folder into `~/.codex` first.

From GitHub instead of a local folder (the plugin is on a branch for now):

```bash
codex plugin marketplace add jqiu6-spec/jj --ref claude/quirky-thompson-7o7tvm
codex plugin add photo-palette@jj
```

Check your version with `codex --version`. To update Codex, run
`npm install -g @openai/codex@latest` or `brew upgrade --cask codex`.

### Windows

`install.sh` is written for macOS and Linux and hasn't been tested on Windows.
In PowerShell, from the unzipped folder:

```powershell
py -m pip install --user pillow numpy
codex plugin marketplace add .
codex plugin add photo-palette@jj
```

Windows installs of Python usually have no `python3` command, so point the
plugin at `py`. Open
`%USERPROFILE%\.codex\plugins\cache\jj\photo-palette\<version>\.mcp.json` (the version folder, e.g. `0.2.0`) and
change `"python3"` to `"py"`. Repeat this after each `codex plugin add`.

## Troubleshooting

| What you see | Cause | Fix |
| --- | --- | --- |
| `error: unexpected argument 'marketplace' found` | Codex is older than 0.121. | Update Codex, or run `bash install.sh`. It falls back to a direct install. |
| `error: unrecognized subcommand 'add'` | Codex is older than 0.131. | Update Codex, or run `bash install.sh`. |
| `error: unrecognized subcommand 'install'` | The command is `codex plugin add`, not `install`. | Use `codex plugin add photo-palette@jj`. |
| `marketplace root does not contain a supported manifest` | Codex was pointed at the wrong folder, or at GitHub without `--ref`. | Point it at the folder that contains `install.sh` and `.agents/`, or add `--ref claude/quirky-thompson-7o7tvm`. |
| `git clone https://github.com/Downloads/…` fails | A path like `Downloads/photo-palette` looks like a GitHub `owner/repo`. | `cd` into the folder and use `codex plugin marketplace add .`, or give the full path, e.g. `~/Downloads/photo-palette`. |
| `invalid marketplace source format` | Only the folder name was given. | Same fix: `cd` into the folder and use `.`, or give the full path. |
| ``plugin `photo-palette` was not found in marketplace `jj` `` | The marketplace wasn't added, or adding it failed. | Run the `codex plugin marketplace add …` step first. |
| `marketplace 'jj' is already added from a different source` | An earlier attempt added it from another folder. | `codex plugin marketplace remove jj`, then add it again. The script does this for you. |
| `this Python can't create virtual environments` from the script | Debian/Ubuntu/WSL ship Python without `venv`. | `sudo apt install python3-venv`, then re-run the script. |
| `failed to load configured marketplace snapshot(s)` | A marketplace folder you added was deleted. | `codex plugin marketplace remove jj` (or the name shown), or re-run the install script, which cleans this up. |
| `error: externally-managed-environment` from pip | Homebrew or Linux distro Python blocks pip installs. | Run `bash install.sh`, which uses a private environment, or `python3 -m pip install --user --break-system-packages pillow numpy`, or `brew install numpy pillow`. |
| Palettes fail with `No module named 'numpy'` or `'PIL'` | The Python Codex uses has no Pillow/NumPy, or Python was upgraded. | `bash ~/.codex/photo-palette-marketplace/install.sh` repairs it. |
| `.agents folder is missing` from the script, or you can't see `.agents` in Finder | Finder hides folders whose names start with a dot, and drops them when copying. | Unzip the original zip again. To see hidden folders in Finder, press <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd>. |

## Uninstall

Run `bash ~/.codex/photo-palette-marketplace/install.sh --uninstall`. To do it by hand instead:

```bash
codex plugin remove photo-palette@jj
codex plugin marketplace remove jj
codex mcp remove photo-palette                 # only after a direct install
rm -rf ~/.codex/photo-palette ~/.codex/skills/photo-palette \
       ~/.codex/photo-palette-marketplace ~/.codex/photo-palette-venv
```

The marketplace definition lives in `.agents/plugins/marketplace.json`.
