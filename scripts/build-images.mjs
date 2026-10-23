// Reads edited exports from originals/ (or $PHOTOS_SRC), writes web sizes to
// site/photos/ and metadata to content/manifest.json. Incremental: unchanged
// files are skipped using a size + mtime cache, and outputs are named by a
// content hash so they can be cached forever.
//
//   originals/
//     2026-07 San Diego & Big Bear Lake/DSC_3447.jpg   -> album
//     Astrophotography/M31 2026-10-19.jpg              -> Deep Sky, no album
//     DSC_1929.jpg                                     -> loose photo, no album

import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, stat, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';
import sharp from 'sharp';
import exifReader from 'exif-reader';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = process.env.PHOTOS_SRC || join(ROOT, 'originals');
const OUT = join(ROOT, 'site/photos');
const MANIFEST = join(ROOT, 'content/manifest.json');
const CONTENT = join(ROOT, 'content/photos.json');
const CACHE = join(ROOT, '.cache/images.json');

// Bump when output settings change, so every photo is regenerated.
// Quality per width: thumbnails are seen small, so they can be lighter; astro gets more
// headroom everywhere to avoid banding in dark gradients.
const SETTINGS = {
  v: 3, widths: [400, 900, 1600], effort: 6,
  quality: { 400: 70, 900: 76, 1600: 80 },
  astroQuality: { 400: 80, 900: 85, 1600: 88 },
};
const SETTINGS_KEY = JSON.stringify(SETTINGS);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);
const ASTRO_DIR = /^astro(photography)?$/i;
const SKIP_DIR = /^(\.|_|ipod photo cache$)/i;

const slugify = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['’]/g, '').replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const readJson = async (path, fallback) => {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
};

async function listPhotos() {
  const found = [];
  for (const entry of await readdir(SRC, { withFileTypes: true })) {
    const path = join(SRC, entry.name);
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (await stat(path)).isDirectory());
    if (isDir) {
      if (SKIP_DIR.test(entry.name)) continue;
      const astro = ASTRO_DIR.test(entry.name);
      for (const f of await readdir(path)) {
        if (IMAGE_EXT.has(extname(f).toLowerCase())) found.push({ path: join(path, f), folder: astro ? null : entry.name, astro });
      }
    } else if (IMAGE_EXT.has(extname(entry.name).toLowerCase())) {
      found.push({ path, folder: null, astro: false });
    }
  }
  return found;
}

// "2026-07 San Diego & Big Bear Lake" -> { title: "San Diego & Big Bear Lake", slug: "san-diego-big-bear-lake" }
function parseFolder(folder) {
  const m = folder.match(/^(\d{4})(?:-(\d{2}))?\s+(.+)$/);
  const title = m ? m[3].trim() : folder.trim();
  return { title, slug: slugify(title), prefix: m ? `${m[1]}${m[2] ? '-' + m[2] : ''}` : null };
}

// "M31 2026-10-19", "NGC7000", "ngc 7000_2026-10-12" -> { target: "NGC 7000", date: "2026-10-12" }
function parseAstroName(stem) {
  const m = stem.match(/^([a-z]+)[\s_-]*(\d+[a-z]?)(?:[\s_-]+(\d{4}-\d{2}-\d{2}))?/i);
  if (!m) return { target: stem, date: null };
  const cat = m[1].toUpperCase();
  // Messier is written without a space (M31), other catalogs with one (NGC 7000).
  return { target: cat === 'M' ? `M${m[2]}` : `${cat} ${m[2].toUpperCase()}`, date: m[3] || null };
}

// exif-reader returns local wall-clock times as UTC Dates; keep them as local "YYYY-MM-DDTHH:MM:SS".
const localIso = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 19) : null);

function readExif(buf) {
  if (!buf) return {};
  let e;
  try { e = exifReader(buf); } catch { return {}; }
  const img = e.Image || e.image || {};
  const p = e.Photo || e.exif || {};
  return {
    dateOriginal: localIso(p.DateTimeOriginal),
    dateModified: localIso(img.DateTime),
    make: img.Make?.trim() || null,
    model: img.Model?.trim() || null,
    lens: p.LensModel?.trim() || null,
    exposure: p.ExposureTime ?? null,
    fNumber: p.FNumber ?? null,
    iso: p.ISOSpeedRatings ?? p.PhotographicSensitivity ?? null,
    focal: p.FocalLength ?? null,
  };
}

async function processPhoto(file, cached) {
  const buf = await readFile(file.path);
  const hash = createHash('sha1').update(buf).update(SETTINGS_KEY).digest('hex').slice(0, 10);
  const meta = await sharp(buf).metadata();
  const exif = readExif(meta.exif);
  const stem = basename(file.path, extname(file.path));
  const oriented = (meta.orientation || 1) >= 5;
  const width = oriented ? meta.height : meta.width;
  const height = oriented ? meta.width : meta.height;

  const photo = {
    stem, source: relative(SRC, file.path).split('\\').join('/'),
    albumFolder: file.folder, astro: file.astro, width, height, hash,
    camera: [exif.make, exif.model].filter(Boolean).join(' ').replace(/^NIKON CORPORATION NIKON/i, 'Nikon') || null,
    lens: exif.lens, exposure: exif.exposure, fNumber: exif.fNumber, iso: exif.iso, focal: exif.focal,
  };

  if (file.astro) {
    const { target, date } = parseAstroName(stem);
    photo.target = target;
    // Seestar exports carry total integration time in the exposure field and no capture date.
    photo.integrationSec = exif.exposure && exif.exposure > 30 ? Math.round(exif.exposure) : null;
    photo.date = date ? `${date}T00:00:00` : exif.dateOriginal || exif.dateModified;
    photo.dateSource = date ? 'filename' : exif.dateOriginal ? 'exif' : 'export';
  } else {
    photo.date = exif.dateOriginal || exif.dateModified;
    photo.dateSource = exif.dateOriginal ? 'exif' : 'export';
  }

  if (cached?.hash === hash && cached.outputs && existsSync(join(ROOT, 'site', cached.outputs.at(-1).src))) {
    return { ...photo, outputs: cached.outputs, placeholder: cached.placeholder, color: cached.color, reused: true };
  }

  const base = sharp(buf).rotate().toColorspace('srgb');
  const outputs = [];
  const seen = new Set();
  for (const w of SETTINGS.widths) {
    const target = Math.min(w, width);
    if (seen.has(target)) continue;
    seen.add(target);
    const h = Math.round((height * target) / width);
    outputs.push({ w: target, h, quality: (file.astro ? SETTINGS.astroQuality : SETTINGS.quality)[w] });
  }

  // Average color, used as the background of photos further down the page.
  const { data } = await base.clone().resize(1, 1, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const color = '#' + [...data.subarray(0, 3)].map((n) => n.toString(16).padStart(2, '0')).join('');
  const lqip = await base.clone().resize(16).webp({ quality: 40 }).toBuffer();

  return { ...photo, pendingOutputs: outputs, base, placeholder: `data:image/webp;base64,${lqip.toString('base64')}`, color };
}

function makeId(photo, used) {
  let id;
  if (photo.astro) {
    id = slugify(photo.target.replace(/\s+/g, ''));
  } else {
    const day = (photo.date || '').slice(0, 10).replace(/-/g, '');
    id = `${day}-${slugify(photo.stem).replace(/-/g, '')}`;
  }
  if (used.has(id)) id = `${id}-${(photo.date || '').slice(0, 10)}`;
  let n = 2, unique = id;
  while (used.has(unique)) unique = `${id}-${n++}`;
  used.add(unique);
  return unique;
}

async function main() {
  if (!existsSync(SRC)) {
    console.error(`No source folder at ${SRC}. Create originals/ (see README) or set PHOTOS_SRC.`);
    process.exit(1);
  }
  const cache = await readJson(CACHE, {});
  const files = await listPhotos();
  const photos = [];
  let made = 0, reused = 0;

  for (const file of files) {
    const s = await stat(file.path);
    const key = relative(SRC, file.path);
    const cached = cache[key];
    // Fast path: same size, mtime and settings means same photo.
    if (cached && cached.size === s.size && cached.mtimeMs === s.mtimeMs && cached.settings === SETTINGS_KEY &&
        existsSync(join(ROOT, 'site', cached.photo.outputs.at(-1).src))) {
      photos.push(cached.photo);
      reused++;
      continue;
    }
    const p = await processPhoto(file, cached?.photo);
    photos.push(p);
    p._cacheKey = key;
    p._stat = { size: s.size, mtimeMs: s.mtimeMs };
  }

  // Stable ids, assigned in date order so collisions resolve the same way each run.
  photos.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.source.localeCompare(b.source));
  const used = new Set();
  for (const p of photos) p.id = makeId(p, used);

  for (const p of photos) {
    if (p.pendingOutputs) {
      const dir = join(OUT, p.id);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      p.outputs = [];
      for (const o of p.pendingOutputs) {
        const name = `${p.hash}-${o.w}.webp`;
        await p.base.clone().resize(o.w).webp({ quality: o.quality, effort: SETTINGS.effort }).toFile(join(dir, name));
        p.outputs.push({ w: o.w, h: o.h, src: `photos/${p.id}/${name}` });
      }
      delete p.pendingOutputs; delete p.base;
      made++;
      process.stdout.write(`  made ${p.id}\n`);
    } else {
      // Content unchanged: keep outputs, and move them if the photo's id changed.
      const want = `photos/${p.id}/`;
      if (!p.outputs[0].src.startsWith(want)) {
        const dir = join(OUT, p.id);
        await mkdir(dir, { recursive: true });
        for (const o of p.outputs) {
          const next = `${want}${basename(o.src)}`;
          await writeFile(join(ROOT, 'site', next), await readFile(join(ROOT, 'site', o.src)));
          o.src = next;
        }
      }
      if (p.reused) reused++;
      delete p.reused;
    }
  }

  // Remove output folders that no longer belong to any photo.
  const keep = new Set(photos.map((p) => p.id));
  if (existsSync(OUT)) {
    for (const d of await readdir(OUT)) {
      if (!keep.has(d)) await rm(join(OUT, d), { recursive: true, force: true });
    }
  }

  const newCache = {};
  for (const p of photos) {
    const key = p._cacheKey || relative(SRC, join(SRC, p.source));
    const s = p._stat || await stat(join(SRC, p.source)).then((x) => ({ size: x.size, mtimeMs: x.mtimeMs }));
    delete p._cacheKey; delete p._stat;
    newCache[key] = { ...s, settings: SETTINGS_KEY, photo: p };
  }
  await mkdir(join(ROOT, '.cache'), { recursive: true });
  await writeFile(CACHE, JSON.stringify(newCache));

  // Albums come from folder names; dates from their photos.
  const albums = new Map();
  for (const p of photos) {
    if (!p.albumFolder) continue;
    const f = parseFolder(p.albumFolder);
    if (!albums.has(f.slug)) albums.set(f.slug, { slug: f.slug, title: f.title, folder: p.albumFolder, photos: [] });
    albums.get(f.slug).photos.push(p.id);
  }
  for (const p of photos) p.album = p.albumFolder ? parseFolder(p.albumFolder).slug : null;

  const manifest = {
    albums: [...albums.values()].map((a) => {
      const dates = a.photos.map((id) => photos.find((p) => p.id === id).date).filter(Boolean).sort();
      return { ...a, start: dates[0]?.slice(0, 10) ?? null, end: dates.at(-1)?.slice(0, 10) ?? null };
    }).sort((a, b) => (b.start || '').localeCompare(a.start || '')),
    photos,
  };
  await mkdir(join(ROOT, 'content'), { recursive: true });
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');

  // Add a stub content entry for each new photo, keeping everything already written.
  const content = await readJson(CONTENT, {});
  let added = 0;
  for (const p of photos) {
    if (content[p.id]) continue;
    content[p.id] = { alt: '', title: '', place: '', collections: p.astro ? ['deep-sky'] : [], favorite: false };
    added++;
  }
  const sorted = Object.fromEntries(Object.keys(content).sort().map((k) => [k, content[k]]));
  await writeFile(CONTENT, JSON.stringify(sorted, null, 2) + '\n');

  console.log(`\n${photos.length} photos: ${made} generated, ${reused} unchanged, ${added} new content entries.`);
  const orphans = Object.keys(content).filter((id) => !keep.has(id));
  if (orphans.length) console.log(`Content entries with no matching photo (renamed or removed?): ${orphans.join(', ')}`);
  const noAlt = photos.filter((p) => !content[p.id]?.alt).map((p) => p.id);
  if (noAlt.length) console.log(`Missing alt text (${noAlt.length}): ${noAlt.join(', ')}`);
  const guessed = photos.filter((p) => p.dateSource === 'export').map((p) => p.source);
  if (guessed.length) console.log(`No capture date, using export time (add the night to the filename, e.g. "M31 2026-10-19.jpg"):\n  ${guessed.join('\n  ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
