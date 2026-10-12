// Builds the dashboard's photo set from a folder of originals.
//
//   ~/Pictures/home-dashboard/            (or PHOTOS_DIR=...)
//     2024-08 Cornwall/IMG_1234.HEIC  ->  caption "Cornwall", grouped together
//     Christmas 2025/DSC_0001.jpg     ->  caption "Christmas 2025"
//     loose.jpg                       ->  no caption
//
// Output: public/photos/<hash>.jpg (resized for the tablet, all metadata incl. GPS stripped)
// and public/photos/index.json. Vite copies public/ into dist/, so the photos are served
// behind the same key gate as the rest of the dashboard. Originals are never modified.
// Needs ImageMagick 7 (`magick`).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';

const SRC = process.env.PHOTOS_DIR || join(homedir(), 'Pictures', 'home-dashboard');
const OUT = new URL('../public/photos/', import.meta.url).pathname;
const MAX_EDGE = 1920; // tablet screen is 1920x1200
const QUALITY = 82;
const EXT = /\.(jpe?g|png|heic|heif|webp|avif)$/i;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith('.')) return [];
    const p = join(dir, d.name);
    return d.isDirectory() ? walk(p) : EXT.test(d.name) ? [p] : [];
  });
}

// "2024-08 Cornwall" -> { date: '2024-08-01', place: 'Cornwall' }; "Cornwall" -> { place: 'Cornwall' }
function parseFolder(name) {
  const m = name.match(/^(\d{4})(?:[-_.](\d{2}))?(?:[-_.](\d{2}))?\s*[-–_]?\s*(.*)$/);
  if (!m) return { place: name.trim() };
  const [, y, mo = '01', d = '01', rest] = m;
  return { date: `${y}-${mo}-${d}`, place: rest.trim() };
}

function exifDate(file) {
  try {
    const s = execFileSync('magick', ['identify', '-format', '%[EXIF:DateTimeOriginal]', file + '[0]'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = s.match(/^(\d{4}):(\d{2}):(\d{2})/);
    return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}` : null;
  } catch {
    return null;
  }
}

mkdirSync(OUT, { recursive: true });

if (!existsSync(SRC)) {
  mkdirSync(SRC, { recursive: true });
  console.log(`photos: created ${SRC}. Add photos (in subfolders named like "2024-08 Cornwall") and rebuild.`);
}

const files = walk(SRC).sort();
const photos = [];
const keep = new Set(['index.json']);
let made = 0;

for (const file of files) {
  const rel = relative(SRC, file);
  const folder = rel.includes(sep) ? rel.split(sep)[0] : '';
  const meta = folder ? parseFolder(folder) : {};
  // Name by content + settings, so unchanged photos are skipped and filenames don't leak.
  const hash = createHash('sha1').update(readFileSync(file)).update(`${MAX_EDGE}:${QUALITY}`).digest('hex').slice(0, 16);
  const name = hash + '.jpg';
  const out = join(OUT, name);
  keep.add(name);

  try {
    if (!existsSync(out)) {
      execFileSync('magick', [file + '[0]', '-auto-orient', '-resize', `${MAX_EDGE}x${MAX_EDGE}>`, '-strip',
        '-interlace', 'JPEG', '-quality', String(QUALITY), out], { stdio: ['ignore', 'ignore', 'pipe'] });
      made++;
    }
    const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', out], { encoding: 'utf8' }).split(' ').map(Number);
    photos.push({
      src: '/photos/' + name,
      o: w >= h ? 'l' : 'p',
      // No guessing from file times: copies and downloads get today's date, which would
      // make them all "on this day". Undated photos just show without a date.
      date: exifDate(file) || meta.date || null,
      place: meta.place || '',
      tag: folder || 'loose',
    });
  } catch (err) {
    console.warn(`photos: skipped ${rel}: ${String(err.stderr || err.message).split('\n')[0]}`);
  }
}

// Remove outputs whose originals were deleted or changed.
let removed = 0;
for (const f of readdirSync(OUT)) if (!keep.has(f)) { rmSync(join(OUT, f)); removed++; }

writeFileSync(join(OUT, 'index.json'), JSON.stringify(photos));
console.log(`photos: ${photos.length} in set (${made} new, ${removed} removed) from ${SRC}`);
