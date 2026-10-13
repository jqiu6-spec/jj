// Headless still render: serves this folder, opens index.html?still=1 in Chromium
// (software WebGL) and saves the composited canvas as a PNG.
//   node render.mjs [out.png] [--scale 2] [--t 3.7]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); }

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = args.find(a => !a.startsWith('--')) || path.join(here, 'output', 'neon-render.png');
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const scale = parseFloat(flag('scale', '2'));
const t = flag('t', '3.7');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(here, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(here) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await playwright.chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-web-security'],
});
const page = await browser.newPage({ viewport: { width: 792, height: 1224 }, deviceScaleFactor: scale });
page.on('console', m => console.log('[page]', m.type(), m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?still=1&t=${t}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.waitForTimeout(500);
const backdrop = await page.evaluate(() => window.__backdrop);
fs.mkdirSync(path.dirname(out), { recursive: true });
// read the preserved drawing buffer directly (an element screenshot of a 2x software-GL canvas can exceed Playwright's capture timeout)
const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`wrote ${out} (backdrop: ${backdrop}, scale ${scale}, t ${t})`);
await browser.close();
server.close();
