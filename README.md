# Art Inspo

A personal collection of favorite artwork and design, with a website to browse it.

## The website

`index.html` is the whole site. It reads `catalog.json` when it opens and shows
each reference's pictures from `references/<id>/`. There is no build step:
when `scripts/archive_reference.py` adds a work to `catalog.json`, the site
shows it.

- **Search** titles, artists, tags and notes; filter by tag or group; sort by
  date, artist or title.
- **Click a work** for all its views, observations, source-page notes, your
  comments, related works and links. Each work has its own link
  (`…/#ref-0014`). Arrow keys move between works; `[` and `]` switch views.
- **Live updates:** an open page checks `catalog.json` every 10 seconds and
  adds new works without a reload, marked **New**.
- If a picture file isn't in the folder, the site falls back to the original
  web image where the catalog has one, or shows a placeholder.

### View it on your computer

Browsers block `catalog.json` when `index.html` is opened as a file, so serve
the folder:

```sh
cd path/to/this/folder
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Keep the tab open while you add references;
they appear within a few seconds.

### Publish it online

`.github/workflows/pages.yml` publishes the folder to GitHub Pages on every
push to `main`. One-time setup: in the repository on GitHub, open
**Settings → Pages** and set **Source** to **GitHub Actions**. After that,
commit and push new references (the `references/` folder and the updated
`catalog.json`) and the site updates within a minute or two.

Everything in this folder is published, including `references/` and notes.
GitHub Pages sites are public unless your plan supports private Pages.

## Animation

`animation/` is a Remotion project for making videos from the collection. See
`animation/README.md`.

## Collection workflow

See `AGENTS.md` for how references are archived and how the style profile is
kept.
