# Trackline

A browser aim trainer in the style of KovaaK's, focused on tracking. It runs in a
3D arena with first-person mouse look, sensitivity matched to your game, a
customisable crosshair, and score history kept for each scenario. A set of
Valorant-movement scenarios uses agent-sized bots that run, counter-strafe,
crouch and jump like Valorant players. You can set the number of targets in
every scenario.

It also has a first-person weapon system: six guns (M4A1-S, AK-47, XM7,
Phantom, the Champions 2021 Vandal and an AWP) and a karambit, skins you can
edit, stickers, selectable fire and kill sounds, and AWP sniping drills with CS2 handling (or Valorant's Operator).

## Run it

**Easiest, on a Mac or Windows PC:** download `dist/trackline.html` and
`dist/trackline-models.js` into the same folder and double-click the HTML file.
It opens straight from disk in Chrome, Edge, Firefox or Safari. The second file
holds the detailed gun models; without it the trainer still runs, with the
simple built-in guns. Your settings, skins and scores are saved in that browser.

**From the source:** the site uses ES modules, so serve the folder over HTTP.
Opening `index.html` straight from disk won't work.

```sh
# macOS (python3 is built in) or Windows (install Python, or use `py`)
python3 -m http.server 8000
# or, with Node
npm start
```

Then open <http://localhost:8000>. GitHub Pages can host the repository root as is.
To rebuild the single file after changing the source: `npm install && npm run build`.

### Mac and Windows notes

- You need a mouse and a desktop browser. The **fullscreen** button in the top bar
  hides the browser chrome; press Esc to leave it.
- **Raw input**: Chrome and Edge, on both macOS and Windows, report raw,
  unaccelerated mouse counts, so the sensitivity conversion is exact. Safari and
  Firefox apply the OS pointer acceleration, so the cm/360 figure is approximate
  there. On Windows, set pointer speed to 6/11 and turn off "Enhance pointer
  precision". The Settings tab tells you which mode you got.
- **Scoping on a Mac trackpad**: right-click is a two-finger click. Ctrl+click and
  the Shift key also scope, and Ctrl+click never fires the gun.
- **Retina and slow laptops**: the render scale defaults to **Auto**: if a run
  drops under 50 fps, the resolution steps down (at most once every 2 s, since
  each change resizes the drawing buffer), and it steps back up between runs
  when the last one held 58 fps. Settings also has fixed Full, 75% and 50%.
- Keys use the physical position (R, Space, Esc, Shift), so any keyboard layout
  works, and Cmd/Ctrl shortcuts are left to the browser.

## Scenarios

| Category | Scenario | What it trains |
|---|---|---|
| Tracking | Smoothbot | Smooth, curving mid-range orb |
| Tracking | Strafe Track | Player-sized bot doing ADAD strafes and jumps |
| Tracking | Close Strafes | The same bot at close range, big angular swings |
| Tracking | Air Track | Ballistic hops with mid-air direction changes |
| Tracking | Precise Orb | Small, slow, distant orb: micro-adjustment |
| Tracking | Orbit | Orb circling the player, sudden reversals |
| Switching | Switch Track | 3 orbs with 70 HP; track, kill, switch |
| Switching | Strafe Switch | 3 strafing bots with 100 HP at staggered range |
| Clicking | Six Shot | 6 small static targets on a close wall |
| Clicking | Wide Flick | 3 targets spread across a wide wall |
| Clicking | Bounce Shot | 5 targets drifting and bouncing on a wall |
| Clicking | Micro Flick | One tiny target at a time |
| Valorant movement | Horizontal Tracking | Left-right only at head level; Easy / Medium / Hard |
| Valorant movement | ADAD Strafes | Short run strafes with counter-strafe stops |
| Valorant movement | Crouch Spam | Strafes, stops and crouch spam; the head drops 0.44 m |
| Valorant movement | Jump Peeks | Strafes and jumps with weak air control |
| Valorant movement | Duel Mix | 3 agents with 150 HP and every movement type |
| Valorant movement | Close Duel | 2 agents with 150 HP at 5–8 m |
| Sniping | Op Angles | Agents wide-swing, jiggle and swap crates 26–46 m out |
| Sniping | Op Flicks | Agents appear anywhere on an open field at 18–42 m |
| Sniping | Op Crossing | Agents sprint across the gaps between crates |

### Valorant movement bots

Each bot is a 1.79 m agent with a separate head hitbox (0.28 m across) on top of
a body capsule. It chains weighted actions the way a player does in a duel:

- **ADAD strafes and wide swings** at run speed (6.75 m/s)
- **Counter-strafe stops**: from full speed to a dead stop in about 75 ms
- **Shift-walks** (3.73 m/s) and **crouch-walks** (2.03 m/s)
- **Crouch spam**, often mid-strafe, so speed flickers between run and crouch
  speed and the head drops 0.44 m each time
- **Jumps**: about 1 m high and 0.6 s in the air, with weak air control, so the
  arc is committed once the bot leaves the ground

**Horizontal Tracking** is modelled on KovaaK's horizontal strafe-tracking drills.
The agent only strafes left and right at a fixed 10 m range. It never jumps,
crouches or changes distance, so the head stays at crosshair height and every
correction is horizontal. The hitbox is head-only by default (the head spans 1.6°).
Difficulty changes how it strafes:

- **Easy**: shift-walk speed (3.73 m/s), long strafes, few stops
- **Medium**: run speed (6.75 m/s), a mix of short and long strafes
- **Hard**: run speed, ADAD spam (0.12–0.42 s strafes) and snap counter-strafes

The run, walk and crouch speeds are community-measured Valorant values. The
acceleration, jump and crouch timings are tuned to feel like the game, not
taken from it.

### Setup: target count, health and hitbox

The scenario panel has a setup row:

- **Targets**: 1–10 in tracking scenarios, 1–12 in clicking scenarios. With
  several targets you are doing multi-target tracking.
- **Health** (tracking only): unlimited, or 50–500 HP. A killed target respawns
  somewhere else.
- **Hitbox** (Valorant bots only): head and body, or head only. In head-only mode
  the body turns dark and only time on the head counts.
- **Difficulty** (Horizontal Tracking): Easy, Medium or Hard.

Personal bests and history are kept separately for each setup, so a 5-target run
is never compared with a 3-target run.

Tracking scenarios use a beam that fires while you hold mouse 1 and does 100 damage
per second on target. Your score is the damage you deal, and accuracy is time on
target divided by time firing. The results screen also reports your average offset
from the target's centre, and whether you tend to trail or lead the target along
its path. Against Valorant bots it also shows how much of your time on target was
on the head. The Valorant beam does 150 damage per second, so a 150 HP agent
takes one second of tracking.

Clicking scenarios are hitscan: a kill is worth +100 and a miss costs −20.

## Weapons

Open the **Weapon** tab to pick a gun, edit its skin and preview it on a
turntable (drag to turn it). Each gun has a **detailed model**, a real mesh with
its own textures and normal maps, and a **simple model** built from primitives
in code. The simple one shows while the detailed one loads, and stays if it
can't load. **Gun models** under First-person view switches between them; Simple
is lighter on older machines. See [Gun models](#gun-models) for where the meshes
come from.

| Gun | Fire rate | Notes |
|---|---|---|
| M4A1-S | 600 RPM | The suppressor comes off |
| AK-47 | 600 RPM | Wood furniture by default |
| XM7 | 800 RPM | The US Army's 6.8 mm rifle, with a Coyote tan preset |
| Phantom | 11 rounds/s | Valorant's suppressed rifle (the simple model is an original take with a laser module) |
| Vandal 2021 | 9.75 rounds/s | Valorant's Vandal in the Champions 2021 finish, with its recorded fire sound and a kill sound that climbs through a streak |
| AWP | CS2 AWP or Operator handling | Sniping scenarios only; the only gun that scopes |
| Karambit | Knife | Scroll the mouse wheel to draw it in any scenario; see [Karambit](#karambit) |

Pick one of the first four with **Use for tracking and clicking**. While you
track, the gun cycles at its own fire rate; in clicking scenarios, clicks can't
come faster than that rate.

**Picking up.** Each run starts with the gun being picked up, and so does every
swap back from the knife: as in CS2, it swings up from low on the right, turned
to show its side, the charging handle is pulled back and let go, and it settles
into the resting pose, with the recorded draw sound in time (the AWP rolls
over to check its bolt instead). After each AWP shot the bolt is worked, the
gun rolling over and back in time with the recorded bolt sounds. The keyframes
are `GUN_ANIMS` in `js/weapon.js`.

**Moving.** Hold **W A S D** to run around the arena during a run. Speeds are
CS2's (250 units/s with the knife, 225 with the M4A1-S, 215 with the AK-47, 200
with the AWP and half that scoped; Valorant's 5.4 m/s for the Phantom and
Vandal), with quick starts and stops so counter-strafing works. Walls and
crates stop you, the gun bobs as you run, and every run starts from the
scenario's spot. Moving doesn't cost accuracy.

### Skins

- **Champions 2021**: the finish of the Champions Vandal, for every gun and the
  knife. Gold claw stripes on black with red flecks, silver furniture, and the
  gold "CHAMPIONS" wordmark with its X emblem on the side of the receiver you
  see. The colours are sampled from the Vandal's texture; the stripes are drawn
  in code, because that texture is a patchwork that doesn't tile.
- **Case Hardened**: heat-quenched steel like CS2's: blue pools with sky-blue
  centres and purple rims on silver and gold, with silver halos around them.
  The pattern seed picks the layout, and **Blue share** sets how much of the
  steel turned blue (the Blue Gem preset is 80%). Furniture keeps its own
  finish, so the AK's wood stays wood.
- **Presets**: Original (the model's own factory textures), Fade (the default:
  crimson at the front, magenta and purple through the receiver, blue at the
  rear, a gold suppressor, black furniture), Recon Digital, Coyote, Gunmetal,
  Woodland, Arctic Digital, Carbon Weave, Ember Tiger, Cobalt Hex, Neon Splatter,
  Clear Ice, Doppler, Tiger Tooth, Smoke Glass, Case Hardened, Blue Gem and
  Damascus.
- **Pattern**: original textures, Champions 2021, Case Hardened, solid, fade, woodland camo, digital camo,
  carbon fibre, hex grid, tiger stripe, splatter or Damascus steel, each with
  three colours. On the detailed models the paint keeps the model's normal maps,
  so it follows every machined edge and screw, and barrels, sights and small
  metal parts stay metal.
- **Finish** (matte, satin, gloss, anodized, metallic, or clear glossy
  plastic), **wear** (0–1, adding scratches and chipped paint), **pattern
  scale** and **pattern seed**. Clear glossy plastic turns the paint into
  see-through plastic tinted by the pattern, with a clear coat: you see the
  gun's insides through it, and it gets denser and shinier toward the edges and
  where it catches the light.
- **Parts**: every part a gun has (handguard, stock, grip, foregrip, magazine,
  suppressor, scope, butt pad) wears the pattern or a solid finish: black, gunmetal,
  silver, tan, wood, gold, steel, clear plastic, or clear plastic tinted with the skin's
  first colour (a see-through magazine, for example). Detailed models add **Factory**, the part's own
  textures, so you can paint the receiver and keep the AK's real wood. The list
  changes with the gun.
- **Fade direction**: run the fade back to front or front to back.
- **Randomise** makes a new skin from one hue and its complement; **Apply this
  skin to every gun** copies the pattern, colours, finish and fire effect (parts
  and stickers stay per gun). A preview swatch shows the pattern at the gun's
  scale.

### Fire effects

Every shot shows a bullet in every mode (tracking, clicking and sniping, scoped
or not). Skins without an effect fire the **standard bullet**, a thin warm
tracer like CS2's with a puff of sparks where it lands. A skin can instead have
a fire effect, the way Valorant skins do: **tracer**, **plasma bolt**,
**flame**, **spectral** or **lightning**, in any colour, with an optional glow
on the skin that brightens with every shot. The muzzle flash takes the
effect's colour, shots fly from the muzzle to wherever they land (a target, a
crate or the wall), a burst marks the impact, and kills pop in the effect's
colour. Shots start exactly at the muzzle as drawn, whatever the gun, pose,
sway or recoil, and start barrel-thin before widening, so nothing spills off
the gun. Hits are instant, so each shot is drawn as one: on the frame it is
fired, the streak runs in a straight line from the muzzle to where it lands and
the impact bursts with it. It doesn't travel, drop or sway: it stays put, its
start held on the muzzle while the gun recoils, and fades out over 70 ms. The
view never kicks, so the shot lands exactly where the crosshair was. It is
timed in seconds, not frames, so every shot looks the same at 30, 60 or 144
fps. (The spectral wave and the bolts' flight show only on the Weapon tab's
slow-motion test shot.)
Held fire is timed on the game clock too: the first round leaves as you press,
the rest exactly one fire interval apart. Guns are
held level and aimed so the barrel points at the crosshair, and each shot
continues the barrel's line. **Test fire** in the Weapon tab fires one shot from the turntable gun in slow
motion, with its flash, glow and sound.
Presets come with effects (Fade is a plasma bolt, Ember Tiger flame, Cobalt Hex
lightning, Neon Splatter spectral).

### Stickers

Each gun has five sticker slots. A slot takes one of twenty designs drawn in
code (among them a warning plate, stained glass, a team-style holo logo, an ace,
a dragon and a text sticker with your own words) or an image of your own. You
can set its colour, finish (paper, glossy, holo or gold foil), size, rotation
and scrape.

- **Size**: stickers come at CS2 scale, about as tall as a rifle's receiver.
- **Placing**: drag a sticker across the gun on the turntable to move it, onto
  either side; click the gun to put the selected sticker there. "Back to its
  slot" returns it. The sliders nudge it along and up or down.
- **Your own images**: "Add your own sticker" takes any image file (a PNG with
  a transparent background looks best). It is kept in this browser only.
- Stickers are projected onto the mesh, so they wrap around curved magazines
  and receivers.

The Weapon tab's designs are original. Stickers from CS2 and csgoskins.gg are
Valve's and the teams' artwork, so none are bundled; add any you own with
"Add your own sticker".

### Gun sounds

Choose a fire sound for each gun: Champions 2021 Vandal, M4A1-S, AK-47 and AWP
(all recorded), or suppressed, rifle crack, heavy rifle, SMG snap, sniper boom,
laser, soft click or silent (made in code). **Match the gun** picks one
automatically, and taking the M4A1-S suppressor off switches it to the rifle
crack. The AWP is the loudest by far, like in CS2, about 12 dB over the
rifles, with its long echo and then the bolt worked by hand. Its shot also
throws a bigger muzzle blast and smoke.

Each gun also has a **kill sound**: the classic ping, or the Champions 2021
streak, where kills less than 2.5 s apart climb a step each, up to a five-kill
fanfare. The Vandal uses it by default.

**Headshots** play CS:GO's headshot sound on top of the kill sound (and on an
AWP hit to the head that doesn't kill). Turn it off, or play it, under Sound in
the Weapon tab.

The recordings are cut from clips the project owner supplied, stored in
`js/gun-sounds.js` as base64 WAV (32 kHz: the clips carry nothing above
16 kHz) and played with a slight random pitch change so sprays don't repeat.
Each gun's variants are levelled to the same loudness. They are Riot Games and
Valve audio, used here in a free, non-commercial fan project.

- **The Vandal's fire sound** is three single shots from VALORANT.
- **The AK-47** is three single taps from CS2, and its draw (charging handle
  and all) doubles as the draw sound for the other rifles.
- **The AWP** is CS2's shot with its full echo (2.8 s), its bolt going back and
  forward (0.5 s and 0.92 s after the shot) and its draw.
- **The headshot** is two of CS:GO's headshot sounds.
- **The karambit's draw** is CS2's flip, two takes, also used for the flips in
  its inspect. The clip had music under the slashes, so the slash and heavy
  whooshes are made in code.
- **The M4A1-S's suppressed shot** is recorded too (Valve audio from CS2). The
  clip was a full-auto burst, so no shot stood alone: the sound is the burst's
  first shot, up to where the next one starts, crossfaded into the burst's
  final tail. Taking the suppressor off switches to the synthesised rifle crack.
- **The Champions kill sound** is made in code, as an approximation: the
  recording had gunfire only.
- **Your own sound files**: "Add your own sound file" takes an MP3, WAV or OGG
  under 1.5 MB (trim it to the shot). It is kept in this browser and can be
  picked for firing or kills on any gun.

### Gun models

The detailed meshes live in `models/` as `.glb` files, all in one frame:
metres, +X toward the muzzle, +Y up, +Z the gun's right side.

| File | Source | Notes |
|---|---|---|
| `ak47.glb` | AK-47 `.usdz` supplied by the project owner | Wood and steel textures |
| `m4a1s.glb` | M4A1 `.usdz` supplied by the project owner | The model has a bare flash hider; Trackline adds the M4A1-S suppressor in code |
| `awp.glb` | AWP `.usdz` supplied by the project owner | Spec/gloss textures converted to metal/rough |
| `xm7.glb` | SIG XM7 `.obj` supplied by the project owner | Plain materials, no textures |
| `phantom.glb` | "VALORANT Weapon Phantom Rifle" `.fbx` supplied by the project owner | A Riot Games asset from Valorant |
| `karambit.glb` | "Karambit Standoff 2 Eye of God" `.fbx` and texture supplied by the project owner | An Axlebolt asset from Standoff 2; origin on the ring |
| `vandal.glb` | "Champions Vandal" `.glb` and texture supplied by the project owner | An AI-reconstructed mesh (Tripo) of Riot's Champions 2021 Vandal; reduced from 223,000 to 67,000 triangles with `--decimate 0.3` |

The original authors and licences of the four real-world rifles have not been
recorded yet; add them here before publishing the models anywhere. The Phantom is
Riot Games' artwork, as are the Champions Vandal's look and its recorded shot:
Riot's fan content policy allows free, non-commercial fan
projects that credit Riot, so keep Trackline free and don't redistribute the
mesh on its own. Trackline isn't endorsed by Riot Games.

The karambit and its "Eye of God" finish are Axlebolt's artwork from Standoff 2.
Keep them in a free, non-commercial project, credit Axlebolt, and don't
redistribute the mesh on its own.

`js/models.js` loads each file, sorts its triangles into skin zones (by part
name, material, position, or the texture's own colour), lines it up with the
built-in gun, and lists its sticker spots.

To add or replace a model, convert it with `tools/convert_model.py`:

```sh
pip install usd-core numpy pillow pygltflib   # plus `npm install fbx2gltf` for .fbx
python3 tools/convert_model.py AK-47.usdz models/ak47.glb --max-texture 1024 --scale 0.459
python3 tools/convert_model.py awp.usdz models/awp.glb --max-texture 1024 --rotate y90 --scale 0.0798
```

It reads `.usdz`/`.usdc`/`.usda`, `.obj` + `.mtl`, `.glb`/`.gltf` and `.fbx`,
bakes every transform, converts spec/gloss and DirectX normal maps, and writes a
static `.glb`. Use `--rotate` and `--scale` to bring a model into the frame
above (the script prints the resulting size), `--tex` to point a material at a
texture set, and `--help` for the rest. Then add an entry to `MODEL_INFO` in
`js/models.js` and run `npm run build`.

### Karambit

Every scenario has a knife as well as the gun. In a run, **scroll the mouse
wheel** to swap between them (or press **3** for the knife, **1** for the gun,
**Q** to swap). The animations follow CS2's karambit: drawn, it comes up on
the right, flipping round the finger, and drops into the grip; **left click**
whips it across the screen, backhand then forehand (hold it to keep slashing);
**right click** is the heavy, the fist raised high on the right and driven
down; **F** inspects: a flip up into an upright hold in front of you, the
blade curving down and round, a turn of the wrist, and a flip back down.
Knives don't shoot, so nothing scores while it's out, and every run starts
with the gun.

The animations are keyframed in `js/knife.js`: each key sets where the ring
sits, the hand's grip or turn, and extra spins around the ring. The knife is held the CS2 way: finger through the ring at the left of the
fist, blade out to the right and curling up. Blade and handle are separate
parts, each with its own finish; a skin paints the blade and leaves the
knife's own handle unless you pick otherwise, and Fade runs along the blade
from bolster to tip.

## Sniping

The sniping scenarios use the AWP. Settings picks how it handles: **CS2 AWP**
(the default) or the **Valorant Operator**. Ammo is infinite with both: no
magazine and no reload, so the whole run is aiming. A body shot kills; a leg
shot doesn't. Crates block both shots and line of sight.

**CS2 AWP**, built for CS2-style flicks:

- **Zoom** goes to CS2's own 40° and then 10° field of view, so the scoped view
  matches CS2 whatever FOV you play at (about 2.9x and 12x at 103°).
- **Scoped sensitivity** is your sensitivity times the zoom FOV over 90, times
  a ratio, exactly as CS2 computes it. Set the ratio to your CS2
  `zoom_sensitivity_ratio` (1.00 by default) and a flick that lands in CS2
  lands here.
- **Quick-scopes work**: a shot is fully accurate once the scope has been up
  0.1 s. Earlier shots, and no-scopes, carry up to 8° of spread.
- **1.455 s** between shots. After a shot it unscopes and zooms back in to the
  same level when the bolt is back, as in CS2.
- **Damage** per 100 HP: head 459, chest 115, legs 86, scaled to the target's
  health.
- The zoom-in time (0.06 s) and the settle time are estimates.

**Valorant Operator**: 0.6 shots a second (1.67 s apart), 2.5x and 5x zoom,
255 head / 150 body / 120 leg damage against 150 HP agents, scoped sensitivity
divided by the zoom, and a scope-in time you set (0.25 s by default, an
estimate).

- **Right click** scopes, a second click goes to the second zoom and a third
  unscopes. Settings also has a hold-to-scope option.
- A shot fires the moment you click, with your aim at that instant.

The results screen shows accuracy, kills, headshots, your average reaction time
(from an agent coming into view to killing it) and how many shots you fired
before the scope settled.

## Controls

- **Mouse 1**: fire (hold it in tracking scenarios, or turn on auto-fire in Settings); slash with the knife
- **Mouse 2**, **Shift**, or **Ctrl+click** on a Mac: scope with the AWP in sniping scenarios (CS2 or Operator handling); stab with the knife
- **W A S D**: move
- **Mouse wheel**, **1**, **3**, **Q**: swap between the gun and the knife
- **F**: inspect the knife
- **Esc**: pause. Press Esc again to go back to the scenario list
- **R**: restart the current run
- **Space / Enter** on the results screen: play again

## Settings

- **Sensitivity**: match a game (CS2 / Apex / Source 0.022°, Valorant 0.07°,
  Overwatch 2 / CoD 0.0066° per count × sens) or enter cm/360 directly, plus your
  DPI. The readout shows cm/360, in/360 and degrees per count.
- **Horizontal FOV**: 60–130°, converted to vertical FOV for your aspect ratio.
- **Crosshair**: style, colour, length, thickness, gap, dot size and outline, with
  a live preview.
- **Target and on-hit colours**, volume, auto-fire, and an FPS counter.

Settings and run history are saved in `localStorage`.

## Layout

```
index.html            page shell, HUD and menus
css/style.css         styles
js/main.js            UI wiring: menus, settings, results
js/game.js            renderer, arena, camera, weapons, run state machine
js/motion.js          target movement models (wander, strafe, Valorant agent, air, orbit, bounce)
js/scenarios.js       scenario definitions
js/settings.js        settings storage and sensitivity maths
js/stats.js           run history
js/chart.js           pace chart and history sparkline (SVG)
js/crosshair.js       crosshair drawing
js/audio.js           synthesized sound effects and fire sounds
js/guns.js            simple gun models, zones, fire rates and sticker slots
js/models.js          detailed gun models: loading, skin zones, sticker decals
js/knife.js           karambit animations: draw, slashes, stab, inspect
js/gun-sounds.js      recorded shots: Champions Vandal, M4A1-S (base64 WAV)
js/skins.js           skin patterns, presets, random skins and sticker designs
js/effects.js         fire effects: tracers, impacts, muzzle glow
js/weapon.js          first-person gun view, skins, stickers, turntable
models/               detailed gun meshes (.glb)
tools/convert_model.py  converts .usdz, .obj, .gltf and .fbx guns into Trackline .glb files
build.mjs             bundles everything into dist/trackline.html
dist/trackline.html   the single-file build, opens from disk
dist/trackline-models.js  the detailed models for the single-file build
vendor/               three.js r186 (MIT) and its GLTFLoader and DecalGeometry
```

To add a scenario, add an entry to `SCENARIOS` in `js/scenarios.js`, reusing one of
the motion types in `js/motion.js`.
