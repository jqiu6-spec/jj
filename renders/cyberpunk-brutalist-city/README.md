# Cyberpunk brutalist metropolis — procedural render from a sketch

A Three.js scene built from the composition sketch in `refs/sketch.png` and rendered headlessly
(Chromium + SwiftShader via Playwright) to a 3:4 portrait frame at iPhone resolution (3024×4032).

- `scenes/final.js` — the scene: three brutalist concrete towers, gridded dome, elevated viaduct,
  holographic ads, tiny figures in black coats, night-mode phone post-processing.
- `out/` — rendered frames: `cyberpunk-city_3024x4032.{png,jpg}` (seed 1, the main image),
  `cyberpunk-city_alt-seed2_3024x4032.jpg` (same scene, different window/figure layout) and a 768×1024 preview.
- `render.js` / `index.html` — the headless render harness.
- `BRIEF.md` — the brief the scene was built against.

## Re-render

```bash
npm install                       # installs three@0.170.0
node render.js scenes/final.js out/preview.png --w 768 --h 1024 --seed 1
node render.js scenes/final.js out/final.png --w 3024 --h 4032 --seed 1 --quality final --timeout 1500
```

Requires Node 22 and Playwright with a Chromium build (set `PLAYWRIGHT_BROWSERS_PATH` if needed; the
harness loads Playwright from `/opt/node-tools/node_modules/playwright` — adjust the `require` in
`render.js` for your machine). Change `--seed` for layout variations.
