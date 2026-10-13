# BRIEF — "Cyberpunk brutalist metropolis, shot on iPhone 17"

## The user's request (verbatim)
> render it into cyber punk style futuristic city shot on iphone 17. here are some references. The building should be metropolis movie
> like concrete core style, everything is huge and show small human figure in black coat to make the scale look real, the buildings are
> brutalism concrete core and the lights and ads are in holographic style. use a more dramatic view. the white sketch is my composition
> with 3 huge buildings in brutalism, add a lot of concrete windows with variation in size and depth

## Inputs (LOOK AT THEM with the Read tool before building anything)
- `refs/5.png`  — THE USER'S SKETCH. This is the composition you must honor. Portrait (862x1108).
- `refs/1.webp` — flat-illustration Osaka cyberpunk: dense holographic ads (Japanese + English), elevated rail, Metropolis-like massing.
- `refs/2.webp` — a colossal dark machine-tower with a glowing orange core; tiny hooded/robed figures in black at its base give scale.
- `refs/3.webp` — ring-shaped mega-structure seen from above, holographic billboards on the skyline behind, rain/haze.
- `refs/4.webp` — green "matrix" city: towers whose facades are mostly tiny glowing windows, fog between blocks.

## Reading of the sketch (refs/5.png)
Three colossal buildings seen from a LOW, dramatic camera (looking up), plus a dome/sphere:
1. LEFT tower: very tall, slightly leaning/curving top edge that bows to the left; a horizontal band/ledge near its top-left. Its face
   runs from the left edge up and off the top of the frame.
2. CENTER tower (the largest): rises from lower-left; its top is a wedge — a diagonal facet climbs up-right to a sharp peak near the
   upper right, then a shorter sloped face comes back down. Think a chamfered/faceted concrete monolith (Metropolis "New Tower of Babel"
   energy, brutalist not glass).
3. RIGHT tower: a zig-zag / stepped silhouette, like a "Z" or stacked cantilevers — slabs jutting out then stepping back, with a
   kinked edge on the right side.
4. BOTTOM CENTER: a large sphere / dome with latitude-longitude grid lines (a geodesic dome / spherical hall / planetarium-like
   structure) sitting in front of the center tower's base, partly behind the foreground.
5. A diagonal blue line from mid-left to lower-right: read it as an elevated expressway / rail viaduct (as in ref 1 & 3) or a tilted
   horizon crossing the frame — EITHER way, it should be a strong diagonal in the lower half.
6. A diagonal line at lower-left: foreground ground/plaza edge.
The view is strongly dramatic: a Dutch-ish low angle with converging verticals (keystone), buildings running off the top of the frame.

## Art direction
- MATERIAL: brutalist cast concrete — board-formed texture, weathering streaks, cold grey/blue-grey, matte. Concrete cores à la
  Metropolis (1927): monumental, stepped, setbacks, ribbed fins, ledges. NOT glass curtain walls.
- WINDOWS: "a lot of concrete windows with variation in size and depth" — deep punched openings of many sizes (slits, squares, tall
  bays, double-height voids), actually recessed into the concrete (visible reveals/jambs catching light), some lit warm, some dark,
  some with hologram glow spilling out. Variation must be visible: mix small dense grids with big single voids; vary reveal depth.
- SCALE: "everything is huge" — the towers must dwarf everything. Show SMALL HUMAN FIGURES IN BLACK COATS (dark silhouettes, long
  coats, walking on the plaza/viaduct in the lower part of the frame) so the scale reads as real. Several figures, tiny vs the buildings.
- LIGHTS & ADS: holographic — translucent, additive, scan-lined, slightly flickering/ghosted planes floating in front of facades, with
  logos/text (English + Japanese glyph-like marks are fine; if CJK fonts are unavailable, use abstract glyph-like bars/kana-shaped
  strokes), cyan/magenta/amber/red palette, volumetric-ish glow in the haze, reflections on wet ground. Bloom on these only.
- PHOTO LOOK ("shot on iPhone 17"): 3:4 portrait, wide lens (24mm-equiv, or 13mm ultra-wide for extra drama) tilted upward so
  verticals converge; night mode: deep but readable shadows, strong HDR highlight rolloff, subtle sensor grain/noise, slight vignette,
  faint chromatic aberration at edges, mild haze/fog layering for depth, wet reflective ground. Looks like a photo, not a game screenshot.

## Technical harness (already working — use it exactly like this)
Project dir: /tmp/claude-0/-home-user-jj/c235cd29-9280-5115-a896-6aa3efb22676/scratchpad/render
- Write your scene as an ES module in `scenes/<yourname>.js` following `scenes/_template.js` (default export async fn(canvas, opts)).
  three@0.170.0 is installed; import 'three' and 'three/addons/...' (examples/jsm). No network access — everything procedural
  (CanvasTexture for text/ads, DataTexture or canvas-drawn noise for concrete, geometry built in code). Node modules only via importmap.
- Render preview:   node render.js scenes/<yourname>.js out/<yourname>_v1.png --w 768 --h 1024 --seed 1
  Final resolution:  node render.js scenes/<yourname>.js out/<yourname>_final.png --w 3024 --h 4032 --quality final --timeout 1500
  The harness prints `[scene] ...` logs and any SCENE ERROR with stack trace. Then LOOK at the PNG with the Read tool and iterate.
- Renderer is SwiftShader (CPU). A 768x1024 preview of a moderately heavy scene takes seconds to ~1-2 min; keep total triangles
  under ~2-3M, use InstancedMesh for windows/fins/figures, keep shadow maps ≤ 2048, avoid dozens of full-screen passes. Use `quality`
  to lower counts in 'preview' if needed but keep the look identical.
- Determinism: use the provided seed with a seeded PRNG (mulberry32 in the template), never Math.random for layout.
- The renderer MUST be created with preserveDrawingBuffer: true and you must finish rendering before returning (no animation loop).
