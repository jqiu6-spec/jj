// usage: node b2_texrender.js tex/list.json  -> renders each {name,w,h,file} html to tex/<name>.png (transparent bg)
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path');
(async () => {
  const list = require(path.resolve(process.argv[2]));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
  for (const t of list) {
    await page.setViewportSize({ width: t.w, height: t.h });
    await page.goto('file://' + path.resolve(t.file));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.resolve(path.dirname(t.file), t.name + '.png'), omitBackground: true });
    process.stdout.write(t.name + ' ');
  }
  await browser.close();
  console.log('\ndone');
})();
