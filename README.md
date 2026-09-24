# Trackline

A browser aim trainer in the style of KovaaK's, focused on tracking. It runs in a
3D arena with first-person mouse look, sensitivity matched to your game, a
customisable crosshair, and score history kept for each scenario. A set of
Valorant-movement scenarios uses agent-sized bots that run, counter-strafe,
crouch and jump like Valorant players. You can set the number of targets in
every scenario.

It also has a first-person weapon system: five guns (M4A1-S, AK-47, XM7, a
Phantom-style rifle and an AWP), skins you can edit, stickers, selectable fire
sounds, and Operator sniping drills where the AWP handles like Valorant's
Operator.

## Run it

It's a static site with no build step, but it uses ES modules, so you have to serve
it over HTTP. Opening `index.html` straight from disk won't work.

```sh
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>. GitHub Pages can host the repository root as is.

You need a desktop browser and a mouse. Chrome and Edge on Windows give you raw,
unaccelerated input (`unadjustedMovement`). In other browsers, set the OS pointer
speed to default (6/11 on Windows) and turn off "Enhance pointer precision" so the
sensitivity conversion comes out right.

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
turntable (drag to turn it). The models are original low-poly builds made from
primitives; no game assets are used.

| Gun | Fire rate | Notes |
|---|---|---|
| M4A1-S | 600 RPM | The suppressor comes off |
| AK-47 | 600 RPM | Wood furniture by default |
| XM7 | 800 RPM | The US Army's 6.8 mm rifle, with a Coyote tan preset |
| Phantom | 11 rounds/s | An original Phantom-style rifle with a blue laser module |
| AWP | Operator handling | Sniping scenarios only; the only gun that scopes |

Pick one of the first four with **Use for tracking and clicking**. While you
track, the gun cycles at its own fire rate; in clicking scenarios, clicks can't
come faster than that rate.

### Skins

- **Presets**: Fade (the default: crimson at the front, magenta and purple
  through the receiver, blue at the rear, a gold suppressor, black furniture),
  Recon Digital, Coyote, Factory, Woodland, Arctic Digital, Carbon Weave, Ember
  Tiger, Cobalt Hex, Neon Splatter and Damascus.
- **Pattern**: solid, fade, woodland camo, digital camo, carbon fibre, hex grid,
  tiger stripe, splatter or Damascus steel, each with three colours.
- **Finish** (matte, satin, gloss, anodized, metallic), **wear** (0–1, adding
  scratches and chipped paint), **pattern scale** and **pattern seed**.
- **Furniture** (stock, grip) and **accent** (suppressor, scope or magazine) can
  wear the skin or a solid black, gunmetal, tan, wood, gold or steel finish.

### Stickers

Each gun has five sticker slots on the side you see in first person. A slot takes
one of twelve designs, including a text sticker with your own text. You can set
its colour, finish (paper, glossy, holo or gold foil), size, rotation, position
and scrape.

### Fire sounds

Choose a sound for each gun: suppressed, rifle crack, heavy rifle, SMG snap,
sniper boom, laser, soft click or silent. **Match the gun** picks one
automatically, and taking the M4A1-S suppressor off switches it to the rifle
crack.

## Sniping (Valorant Operator)

The sniping scenarios use the AWP model with Valorant Operator numbers: 0.6
shots a second (1.67 s apart), 2.5x and 5x zoom, a 5-round magazine with a
3.7 s reload, and 255 head / 150 body / 120 leg damage against 150 HP agents. A
body shot kills; a leg shot doesn't. Crates block both shots and line of sight.

- **Right click** scopes to 2.5x, a second click goes to 5x and a third unscopes.
  Settings also has a hold-to-scope option.
- Shots fired before the scope settles carry hip-fire spread (about 5°).
- By default you drop out of the scope after each shot.
- **Scoped sensitivity** scales with the zoom (2.5x turns 2.5 times slower) times
  a multiplier you can set.
- **Scope-in time** defaults to 0.25 s. Riot doesn't publish this number, so it
  is an estimate you can change in Settings.

The results screen shows accuracy, kills, headshots, your average reaction time
(from an agent coming into view to killing it) and how many shots you fired
before the scope settled.

## Controls

- **Mouse 1**: fire (hold it in tracking scenarios, or turn on auto-fire in Settings)
- **Mouse 2**: scope with the AWP in sniping scenarios
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
js/guns.js            gun models, fire rates and sticker slots
js/skins.js           skin patterns, presets and sticker designs
js/weapon.js          first-person gun view, skins, stickers, turntable
vendor/               three.js r186 (MIT), bundled into one ES module
```

To add a scenario, add an entry to `SCENARIOS` in `js/scenarios.js`, reusing one of
the motion types in `js/motion.js`.
