# Trackline

A browser aim trainer in the style of KovaaK's, focused on tracking. It runs in a
3D arena with first-person mouse look, sensitivity matched to your game, a
customisable crosshair, and score history kept for each scenario. A set of
Valorant-movement scenarios uses agent-sized bots that run, counter-strafe,
crouch and jump like Valorant players. You can set the number of targets in
every scenario.

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
| Valorant movement | ADAD Strafes | Short run strafes with counter-strafe stops |
| Valorant movement | Crouch Spam | Strafes, stops and crouch spam; the head drops 0.44 m |
| Valorant movement | Jump Peeks | Strafes and jumps with weak air control |
| Valorant movement | Duel Mix | 3 agents with 150 HP and every movement type |
| Valorant movement | Close Duel | 2 agents with 150 HP at 5–8 m |

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

## Controls

- **Mouse 1**: fire (hold it in tracking scenarios, or turn on auto-fire in Settings)
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
js/audio.js           synthesized sound effects
vendor/               three.js r186 (MIT), bundled into one ES module
```

To add a scenario, add an entry to `SCENARIOS` in `js/scenarios.js`, reusing one of
the motion types in `js/motion.js`.
