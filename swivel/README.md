# SWIVEL rotation study

Correct rotation views of SWIVEL, the three-tier rotating pencil sharpener. Every view comes from one parametric 3D model, so all three tiers turn on the same vertical shaft.

![Bottom tier sweep and plan view](renders/swivel-rotation-board-1.png)
![Independent tiers and viewpoints](renders/swivel-rotation-board-2.png)
![Swing animation](renders/swivel-swing.gif)

## The mechanism as modelled

- **One shaft, three moving tiers.** A single steel shaft runs through the centre of every tier's right-hand rounded end, 33 mm from the tier centre. All three tiers turn on their own bushings, with a thrust washer in the 1 mm gap between tiers.
- **Anchored shaft.** The shaft stands in a rubber-footed anchor puck under the rounded ends, the "fixed base anchor" from the cutaway. The puck stays put on the desk while the bottom tier glides round it on its foot. The renders show the bottom tier's closed position as a dashed outline on the desk.
- **Top cap.** A domed, concentrically brushed steel button with a rounded edge, seated in a polished bezel.
- **Pencil entry on the free end.** The pencil hole is in the rounded end opposite the shaft, so turning a tier swings its entry out on a 92 mm radius.
- **Concentric ends.** The shaft sits at the centre of the rounded end, so the shaft ends of all three tiers stay on one circle at every angle. The plan views use this as a quick check that the tiers share an axis.
- **Angles.** Positive angles swing the pencil entry toward the window side, and negative angles swing it toward the back.
- **Centre of mass.** With equal tier weights, the combined centre of mass stays over the bottom tier at every combination of angles. In the star position (−120°, 0°, 120°) it sits on the shaft.

Study dimensions are scaled from the concept board: L 120 × W 54 mm, tier height 26 mm. Change them in `DIM` in `swivel-model.js` and re-render; every view, arc and readout follows.

## What corrects the concept board

Panel 02 "Rotated" on the original board shows tiers that slide sideways as well as rotate, so they don't share a pivot. It also shows the pencil going into the bottom tier at the end where the shaft would be. In these views each tier turns about the shaft only, and the pencil enters the free end.

## Files

| File | What it is |
| --- | --- |
| `swivel-model.js` | Parametric model: stadium-section tiers swept from a profile (ivory shell, nickel band, filleted lid), window with shavings, slider, pencil entry, cap, washers, pose helpers |
| `studio.js` | Studio lighting environment, shadow floor, camera framing |
| `rotation-sheet.html` | The two presentation boards (18 views): bottom-tier sweep, plan views, independent-tier positions, star position from four viewpoints |
| `animation.html` | Looping animation (top tier out, bottom tier out into the star, close), encoded as a GIF |
| `viewer.html` | Interactive viewer: a slider per tier, preset positions, camera viewpoints, live plan check |
| `render.mjs` | Headless renderer that writes everything to `renders/` |
| `renders/` | Boards, 18 individual views (1200 × 1000 PNG) and the GIF |

## Rendering

```sh
cd swivel
npm install
npm run render
```

This needs Playwright with Chromium; it uses a global install if `playwright` isn't installed locally. Rendering runs on software WebGL, so no GPU is needed. three.js, gifenc and the Jost font are served from `node_modules`, so it also works offline.

To use the viewer, serve the folder (for example `npx serve .`) and open `viewer.html`. It loads three.js from the jsDelivr CDN.
