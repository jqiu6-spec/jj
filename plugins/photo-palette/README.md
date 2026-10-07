# Photo Palette: a Codex plugin

Turns photographs into clean, usable color palettes. Ask Codex for "the color
palette from `beach.jpg`" and you get named hex colors, UI roles
(background, surface, text, primary, accent) and ready-to-paste CSS,
SCSS, Tailwind, JSON, SVG or GIMP/Inkscape/Krita palettes.

![A photo with its extracted palette](assets/example.jpg)

## What's in the plugin

| Part | Path | What it does |
| --- | --- | --- |
| Skill | `skills/photo-palette/SKILL.md` | Tells Codex when and how to build a palette and how to present or apply it. |
| Extractor | `skills/photo-palette/scripts/palette.py` | The palette engine, also usable as a standalone CLI. |
| MCP server | `mcp/server.py` (wired up in `.mcp.json`) | Exposes an `extract_palette` tool to Codex. It has no extra dependencies. |
| Manifest | `.codex-plugin/plugin.json` | Plugin metadata, and pointers to the skill and the MCP server. |

## Why the palettes look clean

Naive extractors (k-means in RGB, or median cut) often give muddy, near-duplicate
colors on real photos, or miss small but important colors. This one fixes that
in eight ways:

1. **It works in a perceptual color space.** It clusters in OKLab, where
   distance matches how different two colors look.
2. **It ignores edge blends.** Pixels on edges mix two surfaces (a red petal
   on a green leaf blurs to brown), so they get less weight. It smooths the
   image slightly first, so sensor noise doesn't count as an edge.
3. **It avoids mud.** Each color is a trimmed mean of the cluster's core
   pixels. The saturation that averaging different hues removes is then put
   back.
4. **It keeps the colors that matter.** The picker weighs how much of the
   photo a color covers against how colorful it is, so a 3% red accent can
   beat a fifth shade of sky blue. Near-duplicates are penalized.
5. **Shading isn't a new color.** Lightness differences count half as much as
   hue and saturation differences. A side-lit wall stays one color, which
   leaves room for the skin tone next to it, and each palette color is the
   surface's typical shade. A gray and a tinted color are never treated as
   duplicates.
6. **Nothing is silently dropped.** The palette size adapts to the photo by
   default (`auto`, 4–12 colors). Notable colors that still don't fit are
   listed under "also in this photo" (`extras` in JSON).
7. **It discounts camera artefacts.** Clipped highlights and crushed shadows
   count less.
8. **It finishes the colors.** You choose `clean`, `natural`, `vivid` or
   `muted`. Every color is gamut-mapped back to sRGB by reducing chroma, so
   hue and lightness stay put.

Each palette also comes with UI roles and WCAG contrast numbers. Photos rarely
contain a usable page background or body-text color. When a photo has none, the
plugin derives a quiet tint in the photo's dominant hue and labels that role as
derived.

## Install

The quickest way is to run `bash install.sh` from the repository root (or
from the unzipped folder). It sets up Pillow and NumPy in a private
environment if needed, and works on any Codex version. The
[root README](../../README.md) has the manual steps, Windows notes, a
troubleshooting table and uninstall steps.

By hand, on Codex 0.131 or newer:

```bash
python3 -m pip install --user pillow numpy   # Homebrew Python: add --break-system-packages
cd /path/to/jj                                # the repository root, not this folder
codex plugin marketplace add .
codex plugin add photo-palette@jj
```

From GitHub instead, while the plugin is on a branch:
`codex plugin marketplace add jqiu6-spec/jj --ref claude/quirky-thompson-7o7tvm`.

Restart Codex afterwards so it loads the skill and the MCP server.

## Use it in Codex

```
Generate a clean color palette from ~/Pictures/kyoto.jpg
Give me 8 vivid colors from hero.jpg as Tailwind theme variables
Build one muted moodboard palette from every image in ./refs and add it to src/styles/tokens.css
```

## Use the CLI directly

```bash
S=plugins/photo-palette/skills/photo-palette/scripts
python3 $S/palette.py photo.jpg                          # readable table, palette sized to the photo
python3 $S/palette.py photo.jpg -n 6 -s vivid -f css     # exactly 6 colors, as CSS custom properties
python3 $S/palette.py photo.jpg -f tailwind --prefix brand -o theme.css
python3 $S/palette.py a.jpg b.jpg c.jpg --preview board.png   # one moodboard palette
python3 $S/palette.py photo.jpg -f json --no-neutrals --sort hue
```

| Option | Default | Choices |
| --- | --- | --- |
| `-n, --count` | `auto` (4–12, fits the photo) | `auto` or 1–16 |
| `-s, --style` | `clean` | `clean`, `natural`, `vivid`, `muted` |
| `-f, --format` | `text` | `text`, `json`, `css`, `scss`, `tailwind`, `gpl`, `svg` |
| `--sort` | `weight` | `weight`, `lightness`, `hue` |
| `--no-neutrals` | off | skip grays, near-blacks and near-whites |
| `--prefix` | `palette` | variable prefix for css/scss/tailwind |
| `-o, --output` | stdout | write the formatted output to a file |
| `--preview` | – | save the photo with its swatch strip as an image |

Example JSON (trimmed):

```json
{
  "style": "clean",
  "count": 9,
  "colors": [
    {"hex": "#325416", "name": "forest green", "share": 0.2747, "roles": ["primary"],
     "oklch": [0.4055, 0.0979, 133.8], "contrast": {"white": 8.69, "black": 2.42}, "text_on": "#FFFFFF"}
  ],
  "roles": {"background": "#F5F8F3", "surface": "#E5ECE2", "text": "#493863",
            "primary": "#325416", "accent": "#CC2A1D"},
  "derived_roles": ["background", "surface"],
  "extras": []
}
```

The output is deterministic: the same image and options always give the same
palette.

## Development

```bash
cd plugins/photo-palette
python3 -m unittest discover -s tests -v
```

The tests cover color recovery, small-accent survival, edge-blend suppression,
transparency, 16-bit input, styles staying in gamut, role contrast, moodboards,
every output format, the CLI and the MCP JSON-RPC handshake.
