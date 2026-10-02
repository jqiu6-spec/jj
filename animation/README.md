# Animation (Remotion)

Videos for the Art Inspo website, made with [Remotion](https://www.remotion.dev).
Remotion renders React components into video files (MP4/WebM); the site then
plays those files. It does not animate the live page itself (hover effects,
scroll reveals, opening a work); that is done in `index.html` with CSS/JS.

## Setup

```sh
cd animation
npm install
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run studio` | Opens Remotion Studio in the browser to preview and scrub the animation. |
| `npm run render` | Renders `CollectionReel` to `../media/collection-reel.mp4`. |
| `npm run sync` | Copies `catalog.json` and the newest works' pictures into `public/` (run by both commands above). |

`sync` reads the collection from the parent folder, so new references show up
the next time you preview or render. Set `REEL_LIMIT=10` to include more works.
Works whose picture file isn't in `references/` get a gray placeholder.

## Compositions

- **CollectionReel** (1920×1080, 30 fps): the wordmark draws in, then each of
  the newest works appears with its picture on white and its title on a gray
  panel, matching the site's style, and ends on the collection count.
  Timings are the `INTRO`, `PER_WORK` and `OUTRO` constants in
  `src/CollectionReel.tsx`.
