# Neon Canyon

A single-file WebGL2 path tracer that rebuilds a rain-soaked neon tower canyon as a
low-poly block city, in the spirit of GTA1's chunky, flat-shaded look.

Open `index.html` in a current desktop browser (WebGL2 with float render targets is
required). The image starts noisy and refines every frame.

## What it does

- **Real light transport.** Every sign, window, LED strip, street lamp and headlight is
  an emitter. Light is traced with next-event estimation, so colour bleeds from the
  signs onto the facades, bounces between walls, reflects in window glass and in the
  wet street, and scatters in a thin haze along the camera ray.
- **Low-poly block city.** The whole scene is about a hundred axis-aligned boxes.
  Facades get a procedural window grid; signs are drawn once on a canvas atlas and
  used as textured emitters (Japanese and Chinese text included).
- **Retro pass.** The render runs at a reduced internal resolution and is upscaled
  with hard pixels, then quantised to a limited palette with ordered (Bayer) dithering.

## Controls

| Control | Effect |
| --- | --- |
| Camera | `Street, looking up` matches the reference photo. `GTA1 top-down` is the steep overhead view. `Bridge level` looks along the walkway. |
| Pixel | Size of the output pixels (1 = full resolution, 6 = very chunky). |
| Bounces | Maximum path length. 1 shows direct light only. |
| Lighting | `Full`, `Direct only` (light straight from emitters) or `Bounced only` (light that has reflected at least once). |
| Exposure | Stops of exposure before tone mapping. |
| Palette dither / Bloom / Haze | Toggle the retro quantisation, the glow around bright emitters and the atmospheric scattering. |

Drag on the image to look around, scroll to zoom. Every change restarts accumulation.

## Renders

`renders/` holds headless stills produced from the same page (Chromium + SwiftShader),
each accumulated for several hundred samples per pixel.
