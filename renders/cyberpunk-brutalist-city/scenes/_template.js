// Scene module contract for render.js / index.html
// export default async function(canvas, opts) — must finish rendering into `canvas` before returning.
// opts = { width, height, seed, quality: 'preview'|'final', log(...), params: {all query params as strings} }
// RULES: renderer MUST be created with { canvas, preserveDrawingBuffer: true } (the harness reads pixels via toDataURL).
//        Call renderer.setSize(width, height, false). Do NOT animate/loop; render once (or a few accumulation passes) then return.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Deterministic PRNG so renders are reproducible for a given seed
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export default async function (canvas, opts) {
  const { width, height, seed, quality, log } = opts;
  const rnd = mulberry32(seed);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060b);
  scene.fog = new THREE.FogExp2(0x070a12, 0.004);

  // Portrait 3:4, low dramatic angle looking up (iPhone 24mm-equiv ≈ 73° vertical FOV in portrait)
  const camera = new THREE.PerspectiveCamera(73, width / height, 0.5, 4000);
  camera.position.set(0, 1.7, 0); camera.lookAt(0, 60, -120);

  // ... build geometry here (towers, windows, holograms, figures) ...

  // Post: bloom for holograms + iPhone-style look pass (grain, vignette, slight CA)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.5, 0.9));
  composer.addPass(new OutputPass()); // tone mapping + sRGB
  composer.render();
  log('done');
}
