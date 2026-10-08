#!/usr/bin/env node
// Regenerates the files in ../model from the geometry code embedded in ../index.html,
// so the editor and the committed model files always come from one source.
//
//   node tools/export-models.mjs                 drawing dimensions
//   node tools/export-models.mjs my-state.json   { "params": {...}, "material": "birch", ... }
//
// Then run tools/export_3dm.py for the Rhino file.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const block = html.match(/\/\/ ---- SOUNDBOX CORE START[^\n]*\n([\s\S]*?)\/\/ ---- SOUNDBOX CORE END/);
if (!block) throw new Error('SOUNDBOX CORE block not found in index.html');
new Function(block[1])();
const core = globalThis.SoundBoxCore;

const opts = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : {};
const model = core.build({ ...core.DEFAULTS, ...(opts.params || {}) });
const looks = core.looks(model, { material: 'foam', ...opts });
const enc = new TextEncoder();
const { obj, mtl } = core.toOBJ(model, looks);

const files = {
  'hinged_sound_box.glb': core.toGLB(model, looks),
  'hinged_sound_box.obj': enc.encode(obj),
  'hinged_sound_box.mtl': enc.encode(mtl),
  'hinged_sound_box.stl': core.toSTL(model),
  'hinged_sound_box.scad': enc.encode(core.toSCAD(model, looks)),
  'parameters.json': enc.encode(core.toJSON(model, looks)),
};

const out = join(root, 'model');
mkdirSync(out, { recursive: true });
for (const [name, data] of Object.entries(files)) {
  writeFileSync(join(out, name), data);
  console.log(`${name.padEnd(24)} ${String(data.length).padStart(7)} bytes`);
}
console.log(core.summary(model));
for (const c of model.checks) console.log(`  ${c.level.padEnd(5)} ${c.label}: ${c.value}`);
