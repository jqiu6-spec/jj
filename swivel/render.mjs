// Renders the rotation study boards and every individual view to ./renders.
//
//   npm install && npm run render
//
// Uses Playwright's Chromium with software WebGL, so it runs headless without a GPU.
// CDN requests for three.js and the Google Fonts stylesheet are answered from
// node_modules, so the render works offline.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function loadPlaywright() {
  try { return require('playwright'); } catch {}
  const { execSync } = await import('node:child_process');
  const globalRoot = execSync('npm root -g').toString().trim();
  return require(path.join(globalRoot, 'playwright'));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json' };
const CDN = {
  'https://cdn.jsdelivr.net/npm/three@0.160.0/': 'node_modules/three/',
  'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/': 'node_modules/gifenc/',
};
const ORIGIN = 'http://swivel.local/';

function fontCss() {
  return [300, 400, 500, 600].map((w) => `@font-face{font-family:'Jost';font-style:normal;font-weight:${w};font-display:block;src:url(${ORIGIN}node_modules/@fontsource/jost/files/jost-latin-${w}-normal.woff2) format('woff2');}`).join('\n');
}

export async function openPage(browser, file, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    let file = null;
    if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ contentType: 'text/css', body: fontCss() });
    if (url.startsWith(ORIGIN)) file = path.join(here, decodeURIComponent(new URL(url).pathname));
    for (const [prefix, dir] of Object.entries(CDN)) {
      if (url.startsWith(prefix)) file = path.join(here, dir, url.slice(prefix.length));
    }
    if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: await readFile(file) });
  });
  await page.goto(ORIGIN + file);
  return page;
}

export async function launch() {
  const { chromium } = await loadPlaywright();
  return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}

async function savePng(dataUrl, file) {
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

async function main() {
  const out = path.join(here, 'renders');
  await rm(path.join(out, 'views'), { recursive: true, force: true });
  await mkdir(path.join(out, 'views'), { recursive: true });
  const browser = await launch();
  const page = await openPage(browser, 'rotation-sheet.html', { width: 1640, height: 1200 });
  await page.waitForFunction(() => window.__done === true, null, { timeout: 15 * 60 * 1000, polling: 500 });
  const boards = await page.$$('.board');
  for (const board of boards) {
    const id = await board.getAttribute('id');
    await board.screenshot({ path: path.join(out, `${id}.png`) });
    console.log('board', id);
  }
  const views = await page.evaluate(() => window.__views);
  for (const v of views) {
    await savePng(v.png, path.join(out, 'views', `${v.id}.png`));
  }
  console.log(`${views.length} views`);
  await page.close();

  const anim = await openPage(browser, 'animation.html', { width: 700, height: 600 });
  await anim.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const gif = await anim.evaluate(() => window.__encode());
  await writeFile(path.join(out, 'swivel-swing.gif'), Buffer.from(gif, 'base64'));
  console.log('animation swivel-swing.gif');
  await browser.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
