// Bundles the site into one HTML file, dist/trackline.html, that opens
// straight from disk on macOS and Windows (double-click it). Run: npm run build
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });

const bundle = await esbuild.build({
  entryPoints: [path.join(root, 'js/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
  write: false,
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>\n${css}</style>`)
  .replace(/<script type="module" src="js\/main.js"><\/script>/, () => `<script>\n/* three.js r186 (c) 2010-2026 Three.js Authors, MIT License */\n${js}</script>`);
const file = path.join(out, 'trackline.html');
fs.writeFileSync(file, html);
console.log(`wrote ${path.relative(root, file)} (${(html.length / 1024).toFixed(0)} KB)`);
