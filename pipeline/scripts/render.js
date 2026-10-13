// usage: node render.js <scene.html> <mode> <out.png> [dpr]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
(async () => {
  const [file, mode, out, dpr] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 1455, height: 2056 }, deviceScaleFactor: +(dpr || 2) });
  page.setDefaultTimeout(600000);
  page.on('console', m => console.log('console:', m.text()));
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto('file://' + path.resolve(file) + '#' + mode, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__built === true);
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => { await document.fonts.ready; });
  const st = await page.evaluate(() => [...document.fonts].filter(f => f.status !== 'unloaded').map(f => f.family + ':' + f.status).join(', '));
  console.log('fonts:', st);
  await page.screenshot({ path: out, omitBackground: mode === 'panels' });
  await browser.close();
})();
