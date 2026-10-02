// Copies the collection into public/ so Remotion can read it, and writes
// public/reel.json: the newest works, each with a picture only if its file exists.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const pub = resolve(here, '../public');
const LIMIT = Number(process.env.REEL_LIMIT || 6);

const catalog = JSON.parse(readFileSync(join(root, 'catalog.json'), 'utf8'));
const refs = [...(catalog.references || [])].sort((a, b) =>
  (b.date_added || '').localeCompare(a.date_added || '') || b.id.localeCompare(a.id));

rmSync(pub, { recursive: true, force: true });
mkdirSync(pub, { recursive: true });

const items = refs.slice(0, LIMIT).map((r) => {
  const paths = [...(r.images || []).map((i) => i.path), ...(r.local_asset_paths || [])].filter(Boolean);
  const found = paths.find((p) => /\.(jpe?g|png|webp|gif|svg)$/i.test(p) && existsSync(join(root, p)));
  if (found) {
    mkdirSync(dirname(join(pub, found)), { recursive: true });
    copyFileSync(join(root, found), join(pub, found));
  }
  return { id: r.id, title: r.title || r.id, creator: r.creator || null, date: r.work_date || r.year || null, image: found || null };
});

writeFileSync(join(pub, 'reel.json'), JSON.stringify({ total: refs.length, items }, null, 2));
const withImg = items.filter((i) => i.image).length;
console.log(`reel.json: ${items.length} works (${withImg} with pictures) of ${refs.length}`);
