import { Color, Fog, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { horizontalToVerticalFov, VALORANT_YAW } from '../core/sensitivity.js';
import { TrackingSession } from '../core/scoring.js';
import { createRng } from '../core/random.js';
import { buildHeadingMarkers, buildRoom, buildTargets } from './arena.js';
import { directionFromAngles, hitTest } from './hit.js';
import { EYE_HEIGHT, getScenario } from './scenarios.js';
import { renderCrosshairOverlay } from './crosshair.js';

const MAX_PITCH = (89 * Math.PI) / 180;
const MAX_FRAME_TIME = 0.1; // longer hitches slow the run down instead of teleporting targets
const COUNTDOWN_SECONDS = 3;
const SHOT_INTERVAL = 0.1; // hit sound cadence while tracking (≈ rifle fire rate)
const BACKGROUND = '#0b0f14';

function isChromium() {
  const brands = navigator.userAgentData?.brands;
  if (brands) return brands.some((b) => /Chromium|Google Chrome|Microsoft Edge|Opera/.test(b.brand));
  return /Chrome\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent);
}

/**
 * Owns the WebGL scene, pointer-locked mouse input and the run state machine:
 *
 *   idle → waiting (needs pointer lock) → countdown → running → finished
 *                     ↑__________ paused ←________|  (Esc / focus loss)
 *
 * The sensitivity check room uses the same flow with a `sandbox` state instead
 * of countdown/running.
 */
export class Engine {
  constructor({ canvas, crosshairCanvas, audio, settings, onState, onHud, onFinish, onLockError }) {
    this.canvas = canvas;
    this.crosshairCanvas = crosshairCanvas;
    this.audio = audio;
    this.settings = settings;
    this.onState = onState;
    this.onHud = onHud;
    this.onFinish = onFinish;
    this.onLockError = onLockError;

    this.state = 'idle';
    this.mode = 'run';
    this.resumeState = null;
    this.locked = false;
    this.rawActive = false;
    this.mouseDown = false;
    this.yaw = 0;
    this.pitch = 0;
    this.run = null;
    this.frameHandle = 0;
    this.lastTime = 0;
    this.glow = 0;
    this.shotClock = 0;
    this.countdownLeft = 0;
    this.fps = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.sandbox = { counts: 0, countsY: 0, turned: 0 };
    this.hud = {};

    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.scene = new Scene();
    this.scene.background = new Color(BACKGROUND);
    this.scene.fog = new Fog(BACKGROUND, 35, 95);
    this.camera = new PerspectiveCamera(70, 16 / 9, 0.05, 200);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, EYE_HEIGHT, 0);

    buildRoom(this.scene, this.renderer.capabilities.getMaxAnisotropy());
    this.targets = buildTargets(this.scene);
    this.markers = buildHeadingMarkers(this.scene);
    this.#hideTargets();

    this.frame = this.frame.bind(this);
    this.#bindInput();
    this.applySettings(settings);
    this.resize();
  }

  // ---------------------------------------------------------------- settings

  applySettings(settings) {
    this.settings = settings;
    this.targets.setColor(settings.targetColor);
    this.audio.setVolume(settings.volume);
    this.resize();
  }

  resize() {
    // Re-read devicePixelRatio every time: it changes when the window moves between monitors.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2) * this.settings.renderScale;
    if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.#updateProjection();
    this.drawCrosshair();
    if (this.state !== 'idle') this.render();
  }

  #updateProjection() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    // Horizontal FOV stays fixed (like Valorant); vertical follows the window shape.
    const vertical = horizontalToVerticalFov(this.settings.fov, this.camera.aspect);
    this.camera.fov = Math.min(150, Math.max(20, vertical));
    this.camera.updateProjectionMatrix();
  }

  drawCrosshair() {
    renderCrosshairOverlay(this.crosshairCanvas, this.settings.crosshair);
  }

  // ------------------------------------------------------------------- input

  #bindInput() {
    document.addEventListener('pointerlockchange', () => this.#onLockChange());
    document.addEventListener('pointerlockerror', () => {
      this.onLockError?.('The browser refused to lock the mouse. Click again to retry.');
    });
    document.addEventListener('mousemove', (e) => this.#onMouseMove(e));
    document.addEventListener('mousedown', (e) => {
      if (this.locked && e.button === 0) this.mouseDown = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    document.addEventListener('keydown', (e) => this.#onKeyDown(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.resize());
  }

  #onMouseMove(event) {
    if (!this.locked) return;
    const multiplier = this.settings.inputMultiplier;
    const dx = event.movementX * multiplier;
    const dy = event.movementY * multiplier;
    const degreesPerCount = this.settings.sensitivity * VALORANT_YAW;
    const radiansPerCount = (degreesPerCount * Math.PI) / 180;
    this.yaw -= dx * radiansPerCount;
    const ySign = this.settings.invertY ? -1 : 1;
    this.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, this.pitch - dy * radiansPerCount * ySign));
    if (this.mode === 'sandbox') {
      this.sandbox.counts += dx;
      this.sandbox.countsY += dy;
      this.sandbox.turned += dx * degreesPerCount;
    }
  }

  #onKeyDown(event) {
    if (!this.locked || event.repeat) return;
    if (event.code === 'KeyR') {
      event.preventDefault();
      if (this.mode === 'sandbox') this.#resetView();
      else this.restart();
    } else if (event.code === 'Space' && this.mode === 'sandbox') {
      event.preventDefault();
      this.resetSandboxCounters();
    }
  }

  /**
   * Must be called from a user gesture (click / key press). Tries raw input
   * first and falls back to a normal lock when the platform doesn't support it.
   */
  async requestLock() {
    if (this.locked) return true;
    this.audio.unlock();
    try {
      if (this.settings.rawInput) {
        try {
          await this.canvas.requestPointerLock({ unadjustedMovement: true });
          this.rawActive = isChromium();
          return true;
        } catch (error) {
          if (error?.name !== 'NotSupportedError') throw error;
        }
      }
      await this.canvas.requestPointerLock();
      this.rawActive = false;
      return true;
    } catch (error) {
      const message =
        error?.name === 'SecurityError'
          ? 'Mouse lock was blocked (the browser needs a moment after Esc). Click again.'
          : 'Could not lock the mouse. Click again to retry.';
      this.onLockError?.(message);
      return false;
    }
  }

  exitLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  #onLockChange() {
    const locked = document.pointerLockElement === this.canvas;
    this.locked = locked;
    this.mouseDown = false;
    if (locked) {
      if (this.state === 'waiting' || this.state === 'paused') this.#afterLock();
    } else if (this.state === 'countdown' || this.state === 'running' || this.state === 'sandbox') {
      this.resumeState = this.state;
      this.#setState('paused');
    }
  }

  #afterLock() {
    if (this.mode === 'sandbox') {
      this.#setState('sandbox');
    } else if (this.resumeState === 'running') {
      this.#setState('running');
    } else {
      this.#beginCountdown();
    }
    this.resumeState = null;
  }

  // ------------------------------------------------------------------- flow

  /** Set up a scored run; the run starts once the pointer is locked. */
  prepareRun({ scenarioId, difficulty, duration }) {
    const scenario = getScenario(scenarioId);
    this.mode = 'run';
    this.config = { scenarioId: scenario.id, difficulty, duration };
    const instance = scenario.create({ rng: createRng(), speed: difficulty.speed, size: difficulty.size });
    this.run = {
      scenario,
      difficulty,
      duration,
      instance,
      session: new TrackingSession({ duration, tracksHead: instance.target.kind === 'bot' }),
    };
    this.markers.visible = false;
    this.glow = 0;
    this.shotClock = 0;
    this.#resetView();
    this.#syncTargets();
    this.resumeState = null;
    if (this.locked) this.#beginCountdown();
    else this.#setState('waiting');
    this.#startLoop();
  }

  prepareSandbox() {
    this.mode = 'sandbox';
    this.run = null;
    this.#hideTargets();
    this.markers.visible = true;
    this.#resetView();
    this.resetSandboxCounters();
    this.resumeState = null;
    this.#setState(this.locked ? 'sandbox' : 'waiting');
    this.#startLoop();
  }

  restart() {
    if (this.mode === 'sandbox') return this.prepareSandbox();
    if (this.config) this.prepareRun(this.config);
  }

  quit() {
    this.#setState('idle');
    this.exitLock();
    this.#stopLoop();
    this.run = null;
  }

  resetSandboxCounters() {
    this.sandbox = { counts: 0, countsY: 0, turned: 0 };
  }

  #resetView() {
    this.yaw = 0;
    this.pitch = 0;
  }

  #beginCountdown() {
    if (!this.settings.countdown) {
      this.#setState('running');
      if (this.settings.uiSounds) this.audio.go();
      return;
    }
    this.countdownLeft = COUNTDOWN_SECONDS;
    if (this.settings.uiSounds) this.audio.countdown();
    this.#setState('countdown');
  }

  #finish() {
    const { session, scenario, difficulty, duration } = this.run;
    this.#setState('finished');
    this.exitLock();
    this.#stopLoop();
    this.render();
    this.onFinish?.({
      ...session.results(),
      scenario: scenario.id,
      scenarioName: scenario.name,
      difficulty: difficulty.key,
      difficultyLabel: difficulty.label,
      duration,
      rawInput: this.rawActive,
    });
  }

  #setState(state) {
    const previous = this.state;
    this.state = state;
    if (previous !== state) this.onState?.(state, previous);
  }

  // -------------------------------------------------------------------- loop

  #startLoop() {
    if (this.frameHandle) return;
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  #stopLoop() {
    cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  frame(now) {
    this.frameHandle = requestAnimationFrame(this.frame);
    const rawDt = Math.max(0, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const dt = Math.min(rawDt, MAX_FRAME_TIME);
    this.#measureFps(rawDt);

    let zone = null;
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdownLeft);
      this.countdownLeft -= dt;
      const after = Math.ceil(this.countdownLeft);
      if (this.countdownLeft <= 0) {
        this.#setState('running');
        if (this.settings.uiSounds) this.audio.go();
      } else if (after !== before && this.settings.uiSounds) {
        this.audio.countdown();
      }
      zone = this.#aimZone();
    } else if (this.state === 'running' && this.run) {
      const { instance, session } = this.run;
      instance.update(dt);
      zone = this.#aimZone();
      const firing = this.settings.fireMode === 'auto' || this.mouseDown;
      session.update(dt, { firing, zone });
      this.#hitSounds(dt, firing, zone);
      if (session.finished) {
        this.#syncTargets(zone, dt);
        this.#emitHud(zone);
        this.#finish();
        return;
      }
    }

    this.#syncTargets(zone, dt);
    this.render();
    this.#emitHud(zone);
  }

  #aimZone() {
    if (!this.run) return null;
    const direction = directionFromAngles(this.yaw, this.pitch);
    return hitTest(this.camera.position, direction, this.run.instance.target);
  }

  #hitSounds(dt, firing, zone) {
    if (!firing || !this.settings.hitSounds) {
      this.shotClock = 0;
      return;
    }
    this.shotClock += dt;
    while (this.shotClock >= SHOT_INTERVAL) {
      this.shotClock -= SHOT_INTERVAL;
      if (zone) this.audio.hit();
    }
  }

  #measureFps(dt) {
    this.fpsFrames += 1;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  #hideTargets() {
    this.targets.sphere.visible = false;
    this.targets.bot.visible = false;
    this.targets.shadow.visible = false;
  }

  #syncTargets(zone = null, dt = 0) {
    if (!this.run) return;
    const { sphere, bot, shadow, shadowMaterial } = this.targets;
    const target = this.run.instance.target;
    const p = target.position;
    let footprint;
    let height;
    if (target.kind === 'sphere') {
      sphere.visible = true;
      bot.visible = false;
      sphere.position.set(p.x, p.y, p.z);
      sphere.scale.setScalar(target.radius);
      footprint = target.radius * 1.5;
      height = p.y - target.radius;
    } else {
      sphere.visible = false;
      bot.visible = true;
      bot.position.set(p.x, p.y, p.z);
      bot.scale.setScalar(target.scale);
      footprint = 0.55 * target.scale;
      height = 0;
    }
    shadow.visible = true;
    shadow.position.set(p.x, 0.02, p.z);
    shadow.scale.setScalar(footprint * (1 + height * 0.08));
    shadowMaterial.opacity = Math.max(0.15, 0.7 - height * 0.08);

    const goal = zone && this.settings.hitFeedback ? 1 : 0;
    this.glow += (goal - this.glow) * (1 - Math.exp(-25 * dt));
    this.targets.setGlow(this.glow);
  }

  render() {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.renderer.render(this.scene, this.camera);
  }

  #emitHud(zone) {
    const hud = this.hud;
    hud.state = this.state;
    hud.mode = this.mode;
    hud.fps = this.fps;
    hud.onTarget = Boolean(zone);
    hud.zone = zone;
    hud.countdown = Math.ceil(this.countdownLeft);
    hud.rawInput = this.rawActive;
    if (this.run) {
      const { session } = this.run;
      hud.remaining = session.remaining;
      hud.score = session.score;
      hud.accuracy = session.accuracy;
      hud.streak = session.streak;
    }
    if (this.mode === 'sandbox') {
      const heading = ((((-this.yaw * 180) / Math.PI) % 360) + 360) % 360;
      hud.heading = heading;
      hud.pitch = (this.pitch * 180) / Math.PI;
      hud.counts = this.sandbox.counts;
      hud.countsY = this.sandbox.countsY;
      hud.turned = this.sandbox.turned;
    }
    this.onHud?.(hud);
  }
}
