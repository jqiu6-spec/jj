# jj

Codex plugins.

| Plugin | What it does |
| --- | --- |
| [photo-palette](plugins/photo-palette) | Generates clean, perceptually balanced color palettes from photographs, with UI roles and CSS / Tailwind / SCSS / JSON / SVG / GIMP exports. |

## Install photo-palette

You need [Codex](https://developers.openai.com/codex) and Python 3.9 or newer.

### Easiest: the install script (macOS / Linux)

From the unzipped `photo-palette` folder (or a clone of this repo):

```bash
bash install.sh
```

The script installs Pillow and NumPy if they're missing. On Codex 0.135 or
newer it installs the plugin with `codex plugin add`. On older Codex it puts
the skill and the MCP server in place directly. Restart Codex afterwards.
To skip the plugin system and do the direct install anyway, run
`bash install.sh --manual`.

### By hand (Codex 0.135 or newer)

```bash
python3 -m pip install pillow numpy
codex plugin marketplace add /path/to/photo-palette      # the folder that contains install.sh
codex plugin add photo-palette@jj
```

From GitHub instead of a local folder (the plugin is on a branch for now):

```bash
codex plugin marketplace add jqiu6-spec/jj --ref claude/quirky-thompson-7o7tvm
codex plugin add photo-palette@jj
```

Check your version with `codex --version`. To update, run
`npm install -g @openai/codex@latest` or `brew upgrade --cask codex`.

### Windows

`install.sh` needs bash (Git Bash or WSL both work). In plain PowerShell, run:

```powershell
py -m pip install pillow numpy
codex plugin marketplace add C:\path\to\photo-palette
codex plugin add photo-palette@jj
```

If the palette tool doesn't start, edit the installed plugin's `.mcp.json`
(under `%USERPROFILE%\.codex\plugins\cache\jj\photo-palette\`) and change
`"python3"` to `"py"`.

## Troubleshooting

| What you see | Cause | Fix |
| --- | --- | --- |
| `error: unexpected argument 'marketplace' found` | Codex is older than 0.125. | Update Codex, or run `bash install.sh` (falls back to a direct install). |
| `unrecognized subcommand 'add'` or `'install'` | Codex is older than 0.135. Also, the command is `plugin add`, not `plugin install`. | Update Codex, or run `bash install.sh`. |
| `marketplace root does not contain a supported manifest` | Codex was pointed at the wrong folder, or at GitHub without `--ref`. | Point it at the folder that contains `install.sh` and `.agents/`, or add `--ref claude/quirky-thompson-7o7tvm`. |
| ``plugin `photo-palette` was not found in marketplace `jj` `` | The marketplace wasn't added (or the add failed). | Run the `codex plugin marketplace add …` step first, then `codex plugin add photo-palette@jj`. |
| `marketplace 'jj' is already added from a different source` | An earlier attempt added it from another folder. | `codex plugin marketplace remove jj`, then add again (the script does this for you). |
| The skill shows up but palettes fail with `No module named 'PIL'` | Python is missing the dependencies. | `python3 -m pip install --user pillow numpy` (Homebrew Python: add `--break-system-packages`). |
| Can't see the `.agents` folder in Finder | Folders starting with a dot are hidden. | Press <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> in Finder. The folder is there; Codex finds it. |

To uninstall, run `codex plugin remove photo-palette@jj` for a plugin install.
For the direct install, delete `~/.codex/skills/photo-palette` and
`~/.codex/photo-palette`, then run `codex mcp remove photo-palette`.

The marketplace definition lives in `.agents/plugins/marketplace.json`.
