# neon-render

Re-render of the flat colour-block collage (`1.png`) as a lit night scene: every block keeps
its source colour and traced outline, but becomes an LED matrix, a neon tube, or a matte
surface lit by its neighbours. Area lights sit on each emitter so the dark backdrop shows real
falloff, and the three yellow lines are physical light rails.

- `index.html` + `scene.js` – Three.js scene (orthographic, 1 unit = 1 source pixel), bloom, grading.
  Open through any static server (ES modules need http), e.g. `python3 -m http.server` in this folder.
  Add `?still=1&t=3.7` for the deterministic frame used by the render script.
- `render.mjs` – headless still: `node render.mjs output/neon-render.png --scale 2 --t 3.7`
  (uses Playwright + the pre-installed Chromium with software WebGL).
- `assets/` – drop the original dark-city photo here as `background.png` to use it as the backdrop;
  otherwise the same scene is painted procedurally.
- `output/neon-render.png` – the rendered frame (2x), `neon-render-preview.png` at source size.
- `vendor/` – three.js r170 (MIT) and the fonts (OFL) used by the canvas textures.
