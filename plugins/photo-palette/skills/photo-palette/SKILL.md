---
name: photo-palette
description: Generate a clean, harmonious color palette from a photograph or any image file, with hex codes, color names, UI roles (background, surface, text, primary, accent) and exports for CSS variables, SCSS, Tailwind v4, JSON, SVG swatches or GIMP/Inkscape/Krita palettes. Use when the user asks for colors, a palette, a color scheme or a theme taken from a photo, picture, screenshot, artwork or moodboard.
---

# Photo Palette

Turns photographs into clean, usable color palettes. The bundled extractor
works in the perceptual OKLab color space and is tuned for real photos:
it suppresses the muddy averages, edge-blend colors (e.g. the brown
between a red petal and a green leaf), sensor noise and clipped highlights
that make naive palettes look dirty, and it picks colors that are both
representative and clearly distinct from each other.

## When to use

- "Get the color palette from this photo / picture / image."
- "Make a theme / CSS variables / Tailwind colors from `hero.jpg`."
- "One palette for all the images in `./moodboard`."
- Restyling a page, slide or illustration to match a photograph.

## How to run it

If the `photo-palette` MCP server from this plugin is connected, call its
`extract_palette` tool with absolute image paths. It takes the same options as
the script below and already runs with the right Python.

Otherwise, run the extractor `scripts/palette.py` next to this file. It needs
Python 3.9+ with Pillow and NumPy. If they're installed in the private
environment that install.sh creates, the script switches to that Python by
itself. If it still reports missing packages, ask the user to run `install.sh`
from the photo-palette download, or to run
`python3 -m pip install --user pillow numpy`.

```bash
python3 <this-skill-dir>/scripts/palette.py IMAGE [IMAGE ...] [options]
```

| Option | Meaning |
| --- | --- |
| `-n, --count N` | Number of colors, 1–16 (default 6; 5–8 suits most photos). |
| `-s, --style` | `clean` (default): de-muddied, balanced. `natural`: as captured. `vivid`: punchier. `muted`: soft, desaturated. |
| `-f, --format` | `text` (default), `json`, `css`, `scss`, `tailwind` (v4 `@theme`), `gpl`, `svg`. |
| `--sort` | `weight` (coverage, default), `lightness`, `hue`. |
| `--no-neutrals` | Skip grays, near-blacks and near-whites. Use this to get only the photo's chromatic colors. |
| `--prefix NAME` | Variable prefix for css/scss/tailwind (default `palette`). |
| `-o FILE` | Write the formatted output to a file instead of stdout. |
| `--preview FILE.png` | Save the photo with its swatch strip so the user can see the result. |

If you pass several images, you get one combined palette, and each image
counts equally regardless of its size.

Use `-f json` when you need to reason about the result. Each color has `hex`,
`name`, `rgb`, `hsl`, `oklch`, `share` (fraction of the image), `roles`,
WCAG `contrast` against white and black, and `text_on` (the readable text color
on top of it). The top-level `roles` object maps background, surface, text,
primary and accent to hex values. Roles listed in `derived_roles` were not in
the photo. The extractor generated them as quiet tints of the photo's
dominant hue, because photos rarely contain a usable page background or
body-text color.

## Workflow

1. **Find the image file.** It must be on disk. If the user only attached the
   image in chat, ask for its path, or for permission to save it into the
   workspace. Don't guess colors by looking at the image yourself when the
   script can measure them.
2. **Pick the settings from the request.** Use 6 colors and `clean` unless the
   user asks for something else. "True to the photo" means `natural`.
   "Bold / poppy" means `vivid`. "Soft / pastel / calm / editorial" means
   `muted`. "Only the colors, no grays" means `--no-neutrals`.
3. **Run it** with `-f json`, plus `--preview` when the user would benefit
   from seeing the swatches next to the photo.
4. **Present the palette.** Show a compact table with hex, name, share and
   role. Mention which roles were derived. Point out anything useful, for
   example: "accent #CF251A is only 3.6% of the photo but carries its energy",
   or "primary fails 4.5:1 on the background, so use it for large text and
   fills, not body copy".
5. **Export or apply it** if the user wants. Re-run with the format they need
   (`css`, `scss`, `tailwind`, `gpl`, `svg`), or write the variables straight
   into their stylesheet or theme file. Keep their existing naming
   conventions, and use `--prefix` to match them.

## Tips

- Results are deterministic, so the same image and options always give the
  same palette.
- For a photo dominated by one tone (fog, snow, night), raise `--count`
  or use `--no-neutrals` to bring out the smaller color accents.
- If the user wants different colors, re-run with another `--style` or
  `--count`. Don't hand-edit hex values unless they ask you to.
