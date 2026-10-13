#!/usr/bin/env node
// Usage: node render.js <scene.js relative to project> <out.png> [--w 768] [--h 1024] [--seed 1] [--quality preview|final] [--timeout 900] [--k=v ...]
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const args = process.argv.slice(2);
if (args.length < 2) { console.error('usage: node render.js <scene.js> <out.png> [--w N --h N --seed N --quality preview|final --timeout S --key=value]'); process.exit(2); }
let scene = args[0]; const out = args[1];
if (path.isAbsolute(scene)) { const rel = path.relative(__dirname, scene); if (rel.startsWith('..')) { console.error('scene must be under ' + __dirname); process.exit(2); } scene = rel; }
const opt = { w: 768, h: 1024, seed: 1, quality: 'preview', timeout: 900 };
const extra = {};
for (let i = 2; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq > 0) { extra[a.slice(2, eq)] = a.slice(eq + 1); }
    else { const k = a.slice(2); const v = args[i + 1]; opt[k] = isNaN(+v) ? v : +v; i++; }
  }
}
const root = __dirname;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.hdr': 'application/octet-stream', '.glsl': 'text/plain', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(root, u === '/' ? '/index.html' : u);
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=8192'] });
  const page = await browser.newPage({ viewport: { width: opt.w, height: opt.h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', m => { const t = m.text(); logs.push(t); if (t.includes('error') || t.includes('Error') || t.startsWith('[scene')) process.stderr.write(t.slice(0, 2000) + '\n'); });
  page.on('pageerror', e => { logs.push('PAGEERROR ' + e.message); process.stderr.write('PAGEERROR ' + e.message + '\n'); });
  const qs = new URLSearchParams({ scene, w: opt.w, h: opt.h, seed: opt.seed, quality: opt.quality, ...extra });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/index.html?${qs}`, { timeout: 120000 });
  try {
    await page.waitForFunction(() => window.__done === true, null, { timeout: opt.timeout * 1000, polling: 500 });
  } catch (e) {
    console.error('TIMEOUT waiting for scene to finish after', opt.timeout, 's');
    await browser.close(); server.close(); process.exit(3);
  }
  const err = await page.evaluate(() => window.__error);
  if (err) { console.error('SCENE ERROR:\n' + err); await browser.close(); server.close(); process.exit(4); }
  // Read pixels straight from the canvas (preserveDrawingBuffer must be true in the scene's renderer) via toDataURL
  const dataUrl = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buf);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`OK wrote ${out} (${opt.w}x${opt.h}, ${(buf.length / 1e6).toFixed(2)} MB) in ${dt}s`);
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
