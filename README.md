# Tracklock: tracking aim trainer

A browser aim trainer for **tracking** that uses your exact **Valorant sensitivity**. Type any value from
**0.0001 to 100** and the camera turns exactly as far as it would in Valorant for the same mouse movement.

## Features

- **Valorant-accurate sensitivity.** Tracklock uses Valorant's 0.07° per mouse count, so the same number gives
  the same cm/360. The default field of view is Valorant's 103° horizontal.
  - Accepts **0.0001 – 100** with up to 4 decimals. Values outside the range are clamped, and invalid input is
    rejected with a message.
  - A logarithmic slider covers the whole range: each sixth of the track is one power of ten. ↑/↓ in the number
    box nudge the value by a step that scales with it (hold Shift for ×10).
  - Live **cm/360, in/360, eDPI and °/count** readouts for your DPI.
  - Converters from CS2 / CS:GO, Apex Legends, Overwatch 2 and Call of Duty, and from a target cm/360.
  - **Raw input** (`unadjustedMovement` pointer lock) on Chrome and Edge, so OS pointer speed and acceleration
    don't affect aim. There is also an input multiplier to calibrate other browsers.
  - A **Sensitivity check room** with heading markers every 45° and readouts for heading, total turn and physical
    mouse distance, so you can check a full 360 with a ruler.
- **Six tracking scenarios:** Smooth Tracking, Strafe Bot (a humanoid bot A-D strafing at Valorant running speed),
  Reactive Tracking, Air Tracking, Close-Range Micro and 360 Orbit.
- **A precise target model.** The bot is an articulated range mannequin generated from a skeleton (head, neck,
  torso, shoulders, elbows, wrists, hips, knees, ankles) with high segment counts, painted panel seams and a
  visor. Its hitboxes are the same spheres and capsules the mesh is built from, so what you see is exactly what
  you can hit: head and neck count as head, torso and arms as body, legs and feet as legs. It faces you,
  side-steps with animated legs and arms the hitboxes follow, and wears a Valorant-style outline.
- **Real firing.** Choose a Vandal, Phantom, Spectre or Odin: each fires at its Valorant rate with its close-range
  damage. Each weapon is a distinct detailed model built from bevelled side-profile outlines (an AK-style Vandal
  with a curved magazine and gas tube, an angular Phantom with a skeleton stock and integrated suppressor, a
  Spectre with a vented suppressor shroud and wire stock, an Odin with a carry handle, box magazine, vented barrel
  shroud and bipod) with brushed-metal and stippled-polymer surfaces. It kicks with recoil and muzzle flash, shots leave tracers, sparks on the target and
  impact marks on the range, hits show a hit marker and a running damage number, and gunshots, damage ticks and
  headshot rings are synthesised in the browser. Everything can be switched off for a clean view.
- **Difficulty** presets (Easy, Normal, Hard, Insane) plus custom speed and size. Runs last **30, 60, 90 or 120 s**.
- **Scoring:** accuracy, time on target, longest streak, average recovery time and head share, plus shots, hits and
  damage from the weapon simulation. Score stays weapon-independent so runs are comparable. An accuracy-over-time
  chart comes with a data table view.
- **Stats:** history saved in the browser, personal bests per scenario, difficulty and length, a score progress
  chart, filters and CSV export.
- **Valorant-style crosshair editor:** color, outlines, center dot, inner and outer lines. Sizes are in real
  screen pixels, with a live preview and a 4× zoom. **Import your Valorant crosshair code** or copy a code for
  your Tracklock crosshair back into Valorant.
- **Gameplay options:** always-firing or hold-to-fire, countdown, target color presets, a glow while on target,
  hit sounds, render scale, fullscreen while playing and an FPS counter.
- **Controls:** Esc pauses (resuming gives a 1-second count to re-find the target), R restarts, Enter plays again,
  M returns to the menu. Hold the left mouse button in the check room to test-fire.
- **The range:** a lit arena with image-based lighting, shadows, distance markers, pillars and a backstop for depth
  cues. Shadows, render scale, the weapon and the shot effects are all optional for weaker GPUs.
- **Privacy:** no accounts, no tracking and no server. Everything stays in `localStorage`.

## Sensitivity math

```
degrees per count = sensitivity × 0.07
cm/360            = 360 ÷ (sensitivity × 0.07) ÷ DPI × 2.54
```

For example, 0.4 at 800 DPI is 40.82 cm/360, both here and in Valorant.

For true 1:1 input, use **Chrome or Edge on Windows or macOS** with *Raw input* enabled. Other browsers don't
support raw input yet. There, set the Windows pointer speed to 6/11, turn off *Enhance pointer precision*, and use
the Sensitivity check room to confirm. The in-game corner readout shows whether raw input is active.

## Getting started

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev       # local dev server at http://localhost:5173
npm test          # unit tests (Vitest)
npm run build     # production build in dist/
npm run preview   # serve the production build
```

The build uses relative asset paths, so `dist/` works from any static host or sub-path.

## Deploying

- **GitHub Pages:** `.github/workflows/deploy.yml` builds and deploys every push to `main`. Turn it on once in
  **Settings → Pages → Build and deployment → Source: GitHub Actions**.
- **Any static host** (Netlify, Vercel, Cloudflare Pages, S3…): build command `npm run build`, output directory
  `dist`.

## Project structure

```
index.html              Page shell: menu, stats, guide, game layer, settings dialog
src/main.js             App wiring: routing, launch panel, HUD, results, keyboard
src/styles.css          All styles
src/core/               Framework-free logic (unit tested)
  sensitivity.js        Valorant yaw, clamping, log slider, cm/360, conversions, FOV
  crosshairCode.js      Valorant crosshair profile code import/export
  scoring.js            Tracking session: accuracy, streaks, recovery, timeline, shots and damage
  weapons.js            Valorant weapon fire rates and damage
  settings.js           Defaults and validation of every setting
  stats.js              Run history, personal bests, CSV export
  store.js / storage.js Observable settings, safe localStorage access
  audio.js / random.js  Synthesized sound effects, seedable RNG
src/game/
  engine.js             three.js renderer, pointer-locked mouse input, run state machine
  scenarios.js          Target movement for the six scenarios, difficulties
  hit.js                Ray–sphere / capsule / box tests, bot hitboxes and pose
  bot.js                Humanoid target mesh built from the hitbox numbers
  effects.js            Tracers, sparks, impact marks, muzzle light
  viewmodel.js          First-person weapons with recoil, sway and muzzle flash
  arena.js              The range: room, lighting, props, targets, heading markers
  crosshair.js          Pixel-exact crosshair drawing
src/ui/                 Settings panel, sensitivity control, stats view, charts, results
tests/                  Vitest suites
```

## Browser support

Desktop Chrome, Edge, Firefox and Safari with WebGL and a mouse. Phones and tablets can browse the site but
can't play, because pointer lock isn't available there.

---

Tracklock is a fan-made practice tool. It is not affiliated with or endorsed by Riot Games. VALORANT is a trademark of
Riot Games, Inc.
