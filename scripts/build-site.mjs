// Generates every HTML page into site/ from content/manifest.json (made by
// `npm run photos`) and the hand-edited files in content/. Templates are plain
// template literals; CSS is inlined, JS is one small hashed file.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { transform } from 'esbuild';
import { geoAlbersUsa } from 'd3-geo';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE = join(ROOT, 'site');
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));

const manifest = await read('content/manifest.json');
const content = await read('content/photos.json');
const site = await read('content/site.json');
const albumMeta = strip(await read('content/albums.json'));
const collectionMeta = strip(await read('content/collections.json'));
const placeData = strip(await read('content/places.json'));
const astroNames = strip(await read('content/astro-targets.json'));
const warnings = [];

// ---------- helpers ----------
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso) => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7) - 1, d: +iso.slice(8, 10) });
const fmtDate = (iso) => { const { y, m, d } = parts(iso); return `${MONTHS[m]} ${d}, ${y}`; };
function fmtRange(a, b) {
  if (!a) return '';
  if (!b || a === b) return fmtDate(a);
  const x = parts(a), y = parts(b);
  if (x.y !== y.y) return `${fmtDate(a)} – ${fmtDate(b)}`;
  if (x.m !== y.m) return `${MONTHS[x.m]} ${x.d} – ${MONTHS[y.m]} ${y.d}, ${y.y}`;
  return `${MONTHS[x.m]} ${x.d}–${y.d}, ${x.y}`;
}
function shiftHours(iso, h) {
  if (!iso || !h) return iso;
  const t = new Date(iso + 'Z');
  t.setUTCHours(t.getUTCHours() + h);
  return t.toISOString().slice(0, 19);
}
const fmtExposure = (s) => (s >= 0.3 ? `${+s.toFixed(1)}s` : `1/${Math.round(1 / s)}`);
const fmtDuration = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const fmtLens = (l) => l && l.replace(/(\d+)\.0/g, '$1').replace(/^(\d+)-(\d+) mm.*/, '$1–$2mm');
const fmtCamera = (c) => c && c.replace(/^ZWO /, '').replace(/ Pro$/, '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const svgIcon = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
const ICON = {
  s: svgIcon('<path d="M1 1h4v4H1zM6 1h4v4H6zM11 1h4v4h-4zM1 6h4v4H1zM6 6h4v4H6zM11 6h4v4h-4zM1 11h4v4H1zM6 11h4v4H6zM11 11h4v4h-4z"/>'),
  m: svgIcon('<path d="M1 1h6.5v6.5H1zM8.5 1H15v6.5H8.5zM1 8.5h6.5V15H1zM8.5 8.5H15V15H8.5z"/>'),
  l: svgIcon('<path d="M1 1h14v14H1z"/>'),
};

// ---------- model ----------
const places = placeData.places || {};
const regions = placeData.regions || {};

const albums = manifest.albums.map((a) => {
  const meta = albumMeta[a.slug] || {};
  return { ...a, title: meta.title || a.title, description: meta.description || '', region: meta.region || null, offset: meta.clockOffsetHours || 0, url: `/a/${a.slug}/`, photos: [] };
});
const albumBySlug = Object.fromEntries(albums.map((a) => [a.slug, a]));

const collections = Object.entries(collectionMeta).map(([slug, c]) => ({ slug, ...c, url: `/c/${slug}/`, photos: [] }));
const collectionBySlug = Object.fromEntries(collections.map((c) => [c.slug, c]));

const photos = manifest.photos.map((m) => {
  const c = content[m.id] || {};
  const album = m.album ? albumBySlug[m.album] : null;
  const date = m.dateSource === 'export' ? null : shiftHours(m.date, album?.offset);
  const place = c.place ? places[c.place] : null;
  if (c.place && !place) warnings.push(`${m.id}: unknown place "${c.place}"`);
  const common = m.astro ? astroNames[m.target] : null;
  const title = c.title || (m.astro ? (common ? `${m.target} · ${common}` : m.target) : '');
  const p = {
    ...m, ...c, album, date, title, common,
    sortDate: date || m.date,
    place: place ? { slug: c.place, ...place, region: regions[place.region] ? { slug: place.region, ...regions[place.region] } : null } : null,
    collections: (c.collections || []).map((s) => collectionBySlug[s] || (warnings.push(`${m.id}: unknown collection "${s}"`), null)).filter(Boolean),
    url: `/p/${m.id}/`,
  };
  if (!c.alt) {
    warnings.push(`${m.id}: missing alt text`);
    p.alt = `Photo${title ? ': ' + title : ''}${place ? ', ' + place.title : ''}`;
  }
  return p;
});
photos.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
const byNewest = photos;
const byOldest = [...photos].reverse();

for (const p of byOldest) p.album?.photos.push(p);
for (const p of byNewest) for (const c of p.collections) c.photos.push(p);
for (const a of albums) {
  const dates = a.photos.map((p) => p.date).filter(Boolean).sort();
  a.start = dates[0]?.slice(0, 10) || a.start;
  a.end = dates.at(-1)?.slice(0, 10) || a.end;
  a.places = [...new Map(a.photos.filter((p) => p.place).map((p) => [p.place.slug, p.place])).values()];
}
albums.sort((a, b) => (b.start || '').localeCompare(a.start || ''));
const liveCollections = collections.filter((c) => c.photos.length);

const years = new Map();
for (const p of byNewest) {
  const y = p.sortDate.slice(0, 4);
  if (!years.has(y)) years.set(y, []);
  years.get(y).push(p);
}

const placeList = Object.entries(places).map(([slug, pl]) => ({
  slug, ...pl, url: `/places/${slug}/`, region: regions[pl.region] ? { slug: pl.region, ...regions[pl.region] } : null,
  photos: byNewest.filter((p) => p.place?.slug === slug),
})).filter((pl) => pl.photos.length);

const favorites = byNewest.filter((p) => p.favorite);

// Each photo's "home" sequence for prev/next on its page: album, else first collection, else everything.
for (const p of photos) {
  const seq = p.album ? p.album.photos : p.collections[0] ? p.collections[0].photos : byNewest;
  const i = seq.indexOf(p);
  p.prev = seq[i - 1] || null;
  p.next = seq[i + 1] || null;
  p.home = p.album ? { title: p.album.title, url: p.album.url } : p.collections[0] ? { title: p.collections[0].title, url: p.collections[0].url } : { title: 'All photos', url: '/photos/all/' };
}

// ---------- assets ----------
const css = (await transform(await readFile(join(ROOT, 'src/site.css'), 'utf8'), { loader: 'css', minify: true })).code.trim();
const js = (await transform(await readFile(join(ROOT, 'src/main.js'), 'utf8'), { loader: 'js', minify: true, format: 'esm', target: 'es2020' })).code;
const jsName = `main.${createHash('sha1').update(js).digest('hex').slice(0, 8)}.js`;
const mini = async (code) => (await transform(code, { loader: 'js', minify: true, target: 'es2020' })).code.trim();
// Applies the saved grid size before first paint.
const headScript = await mini(`try{var s=localStorage.getItem('size');if(s)document.documentElement.dataset.size=s}catch(e){}`);

// ---------- partials ----------
const srcset = (p) => p.outputs.map((o) => `/${o.src} ${o.w}w`).join(', ');
const small = (p) => `/${p.outputs[0].src}`;
const ar = (list) => {
  // The most common aspect ratio of a set becomes its cell shape; others are contained, never cropped.
  const count = new Map();
  for (const p of list) { const r = (p.width / p.height).toFixed(2); count.set(r, (count.get(r) || 0) + 1); }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '1';
};
const GRID_SIZES = '(min-width: 1600px) 395px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw';

function tile(p, i, eager) {
  const lazy = i >= eager;
  return `<li><a href="${p.url}" data-v><img src="${small(p)}" srcset="${srcset(p)}" sizes="${lazy ? 'auto, ' : ''}${GRID_SIZES}" width="${p.outputs[0].w}" height="${p.outputs[0].h}" alt="${esc(p.alt)}"${lazy ? ' loading="lazy" decoding="async"' : i === 0 ? ' fetchpriority="high"' : ''} style="background-image:url(${p.placeholder})"></a></li>`;
}
const grid = (list, { eager = 2, cls = '', label } = {}) =>
  `<ul class="grid${cls ? ' ' + cls : ''}" style="--ar:${ar(list)}"${label ? ` aria-label="${esc(label)}"` : ''}>${list.map((p, i) => tile(p, i, eager)).join('')}</ul>`;

// Favorites strip: 4 random picks chosen by an inline script while the page parses, so they
// load early and nothing shifts. Without JS the first four show from <noscript>.
async function favStrip() {
  const data = favorites.map((p) => [p.url, p.alt, srcset(p), small(p), p.outputs[0].w, p.outputs[0].h, p.placeholder]);
  const pick = await mini(`(function(){var F=${JSON.stringify(data)},L=document.getElementById('fav').querySelectorAll('img');for(var i=F.length-1;i>0;i--){var j=Math.random()*(i+1)|0,t=F[i];F[i]=F[j];F[j]=t}L.forEach(function(m,i){var f=F[i];if(!f)return;var a=m.parentNode;a.href=f[0];m.alt=f[1];m.sizes='${GRID_SIZES}';m.width=f[4];m.height=f[5];m.style.backgroundImage='url('+f[6]+')';if(i==0)m.fetchPriority='high';m.srcset=f[2];m.src=f[3]})})()`);
  const cells = favorites.slice(0, 4).map((p) => `<li><a href="${p.url}" data-v><img alt=""><noscript><img src="${small(p)}" srcset="${srcset(p)}" sizes="${GRID_SIZES}" width="${p.outputs[0].w}" height="${p.outputs[0].h}" alt="${esc(p.alt)}" style="background-image:url(${p.placeholder})"></noscript></a></li>`).join('');
  return `<ul class="grid four" id="fav" style="--ar:1" aria-label="Favorites">${cells}</ul><script>${pick}</script>`;
}

function header(current, { sizeToggle = false } = {}) {
  const link = (href, label, key) => `<a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a>`;
  const links = [link('/photos/#albums', 'Albums', 'albums'), link('/photos/#collections', 'Collections', 'collections'), link('/places/', 'Places', 'places')];
  const toggle = sizeToggle
    ? `<div class="size" role="group" aria-label="Grid size">${['s', 'm', 'l'].map((s) => `<button type="button" data-size-set="${s}" aria-label="${{ s: 'Small', m: 'Medium', l: 'Large' }[s]} thumbnails" aria-pressed="${s === 'm'}">${ICON[s]}</button>`).join('')}<button type="button" class="cyc" data-size-cycle aria-label="Change thumbnail size">${ICON.m}</button></div>`
    : '';
  return `<header class="top wrap"><a class="me" href="/">${esc(site.name)}</a>${current !== 'home' ? '<span class="crumb">/ <a href="/photos/">Photography</a></span>' : ''}<nav class="nav" aria-label="Main">${current === 'home' ? link('/photos/', 'Photography', 'photos') : links.join('')}${current !== 'home' ? `<details class="menu"><summary>Menu</summary><div>${link('/photos/', 'Photography', 'photos')}${links.join('')}</div></details>` : ''}${toggle}</nav></header>`;
}

const footer = () => `<footer class="foot wrap"><span>© ${new Date().getFullYear()} ${esc(site.name)}</span>${(site.links || []).map((l) => `<a href="${esc(l.url)}" rel="me">${esc(l.label)}</a>`).join('')}</footer>`;

function page({ path, title, description, body, current, sizeToggle, image, solo }) {
  const full = title ? `${title} · ${site.name}` : site.name;
  const canonical = site.url.replace(/\/$/, '') + path;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(full)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${canonical}"><meta name="theme-color" content="#0f0f10"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta property="og:title" content="${esc(title || site.name)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}">${image ? `<meta property="og:image" content="${site.url.replace(/\/$/, '')}/${image.outputs[1]?.src || image.outputs[0].src}"><meta name="twitter:card" content="summary_large_image">` : ''}<script>${headScript}</script><style>${css}</style><script type="module" src="/assets/${jsName}"></script></head><body${solo ? ' class="solo"' : ''}>${solo ? body : `<a class="skip" href="#main">Skip to content</a>${header(current, { sizeToggle })}<main id="main" class="wrap">${body}</main>${footer()}`}</body></html>`;
}

const out = [];
const emit = (path, html) => out.push([path, html]);

// ---------- pages ----------
const totalLine = `${plural(photos.length, 'photo')} · ${plural(albums.length, 'album')}`;

emit('/', page({
  path: '/', current: 'home', image: favorites[0],
  description: `${site.name}: ${site.tagline}`,
  body: `<section class="intro"><h1>${esc(site.name)}</h1><p>${esc(site.tagline)}</p></section>
<section aria-labelledby="ph"><a class="door" href="/photos/"><b id="ph">Photography →</b><span class="muted">${totalLine}</span></a>${await favStrip()}</section>`,
}));

const indexCol = (id, title, items) => `<section><h2 class="lbl" id="${id}">${title}</h2><ul>${items.join('')}</ul></section>`;
const latest = albums[0];
emit('/photos/', page({
  path: '/photos/', current: 'photos', image: favorites[0], sizeToggle: true, title: 'Photography',
  description: `Photography by ${site.name}: ${albums.map((a) => a.title).join(', ')}, and the night sky.`,
  body: `<h1 class="head" style="padding-bottom:0"><span class="lbl">Photography</span></h1>
<div class="sec"><h2 class="lbl">Favorites</h2><a href="/photos/favorites/" class="muted">All ${favorites.length} favorites →</a></div>${await favStrip()}
<div class="index">${indexCol('albums', 'Albums', albums.map((a) => `<li><a href="${a.url}"><span>${esc(a.title)}<small>${esc(fmtRange(a.start, a.end))}</small></span><span class="n">${a.photos.length}</span></a></li>`))}${indexCol('collections', 'Collections', liveCollections.map((c) => `<li><a href="${c.url}"><span>${esc(c.title)}</span><span class="n">${c.photos.length}</span></a></li>`))}${indexCol('years', 'Years', [...years].map(([y, list]) => `<li><a href="/y/${y}/"><span>${y}</span><span class="n">${list.length}</span></a></li>`))}</div>
<div class="sec"><h2 class="lbl">Latest · <a href="${latest.url}">${esc(latest.title)}</a></h2><span class="muted">${esc(fmtRange(latest.start, latest.end))}</span></div>${grid(latest.photos, { eager: 0 })}<a class="more" href="/photos/all/">All ${photos.length} photos →</a>`,
}));

const listPage = ({ path, title, kicker, sub, list, description, image, current, groups }) => emit(path, page({
  path, title, description, image: image || list[0], current, sizeToggle: true,
  body: `<div class="head">${kicker ? `<span class="lbl">${kicker}</span>` : ''}<h1>${esc(title)}</h1>${sub || ''}</div>${groups ? groups.map((g) => `<div class="grp"><h2 class="lbl">${g.label}</h2></div>${grid(g.list, { eager: 0 })}`).join('') : grid(list)}`,
}));

listPage({ path: '/photos/favorites/', title: 'Favorites', kicker: 'Photography', list: favorites, description: `Favorite photographs by ${site.name}.` });
listPage({ path: '/photos/all/', title: 'All photos', kicker: 'Photography', list: byNewest, sub: `<p class="muted">${totalLine}, newest first.</p>`, description: `Every photograph on ${site.name}'s site, newest first.` });

for (const a of albums) {
  const where = a.places.map((pl) => `<a href="/places/${pl.slug}/">${esc(pl.title)}</a>`).join(', ');
  listPage({
    path: a.url, title: a.title, kicker: 'Album', current: 'albums', list: a.photos,
    sub: `<p class="muted">${esc(fmtRange(a.start, a.end))} · ${plural(a.photos.length, 'photo')}${where ? ` · ${where}` : ''}</p>${a.description ? `<p>${esc(a.description)}</p>` : ''}`,
    description: `${a.title}, ${fmtRange(a.start, a.end)}: ${plural(a.photos.length, 'photo')} by ${site.name}.`,
    image: a.photos.find((p) => p.favorite),
  });
}
for (const c of liveCollections) {
  listPage({
    path: c.url, title: c.title, kicker: 'Collection', current: 'collections', list: c.photos,
    sub: c.description ? `<p class="muted">${esc(c.description)}</p>` : '',
    description: `${c.title}: ${c.description || ''} ${plural(c.photos.length, 'photo')} by ${site.name}.`.trim(),
    image: c.photos.find((p) => p.favorite),
  });
}
for (const [y, list] of years) {
  const groups = [];
  for (const p of list) {
    const label = p.album ? `<a href="${p.album.url}">${esc(p.album.title)}</a>` : p.astro ? `<a href="/c/deep-sky/">Deep Sky</a>` : 'Other';
    if (groups.at(-1)?.label !== label) groups.push({ label, list: [] });
    groups.at(-1).list.push(p);
  }
  listPage({ path: `/y/${y}/`, title: y, kicker: 'Year', list, groups, sub: `<p class="muted">${plural(list.length, 'photo')}</p>`, description: `Photographs by ${site.name} from ${y}.` });
}

// Places: text list now; the SVG map is added in a later phase.
const byRegion = new Map();
for (const pl of placeList) {
  const key = pl.region?.title || 'Elsewhere';
  if (!byRegion.has(key)) byRegion.set(key, []);
  byRegion.get(key).push(pl);
}
// Static US map. Places closer than ~10px merge into one dot that links to the
// region's list; a single place links straight to its page.
const usMap = (await readFile(join(ROOT, 'src/us-map.svg'), 'utf8')).trim();
const project = geoAlbersUsa().scale(1300).translate([487.5, 305]);
const dots = [];
for (const pl of placeList) {
  const xy = project([pl.lon, pl.lat]);
  if (!xy) { warnings.push(`${pl.slug}: outside the US map`); continue; }
  const near = dots.find((d) => Math.hypot(d.x - xy[0], d.y - xy[1]) < 10);
  if (near) { near.places.push(pl); near.x = (near.x + xy[0]) / 2; near.y = (near.y + xy[1]) / 2; }
  else dots.push({ x: xy[0], y: xy[1], places: [pl] });
}
const regionId = (r) => `r-${(r || 'elsewhere').toLowerCase().replace(/\W+/g, '-')}`;
const dotSvg = dots.map((d) => {
  const n = d.places.reduce((t, pl) => t + pl.photos.length, 0);
  const one = d.places.length === 1;
  const label = `${d.places.map((pl) => pl.title).join(', ')}: ${plural(n, 'photo')}`;
  const href = one ? d.places[0].url : `#${regionId(d.places[0].region?.title)}`;
  return `<a href="${href}" aria-label="${esc(label)}"><circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${(4 + Math.sqrt(n) * 1.6).toFixed(1)}"><title>${esc(label)}</title></circle></a>`;
}).join('');

emit('/places/', page({
  path: '/places/', title: 'Places', current: 'places',
  description: `Where ${site.name}'s photographs were taken.`,
  body: `<div class="head"><span class="lbl">Photography</span><h1>Places</h1><p class="muted">${plural(placeList.length, 'place')} in ${plural(byRegion.size, 'region')}.</p></div><figure class="map"><svg viewBox="0 0 975 610" role="group" aria-label="Map of the United States with a dot for each place">${usMap}<g class="dots">${dotSvg}</g></svg></figure><div class="index" id="place-list">${[...byRegion].map(([r, list]) => indexCol(regionId(r), `${esc(r)}${list[0].region ? `, ${list[0].region.state}` : ''}`, list.map((pl) => `<li><a href="${pl.url}" data-place="${pl.slug}"><span>${esc(pl.title)}${pl.city && pl.city !== pl.title ? `<small>${esc(pl.city)}</small>` : ''}</span><span class="n">${pl.photos.length}</span></a></li>`))).join('')}</div>`,
}));
for (const pl of placeList) {
  listPage({
    path: pl.url, title: pl.title, kicker: 'Place', current: 'places', list: pl.photos,
    sub: `<p class="muted">${[pl.city !== pl.title ? pl.city : '', pl.region?.title, pl.region?.state].filter(Boolean).map(esc).join(', ')} · ${plural(pl.photos.length, 'photo')}</p>`,
    description: `Photographs of ${pl.title}${pl.region ? ', ' + pl.region.title : ''} by ${site.name}.`,
  });
}

// Single photo pages
function caption(p) {
  const where = p.place ? `<a href="/places/${p.place.slug}/">${esc(p.place.title)}</a>${p.place.city && p.place.city !== p.place.title ? `, ${esc(p.place.city)}` : ''}` : '';
  const meta = [where, p.date && fmtDate(p.date)].filter(Boolean).join(' · ');
  const spec = p.astro
    ? [p.integrationSec && `${fmtDuration(p.integrationSec)} integration`, fmtCamera(p.camera)].filter(Boolean)
    : [p.exposure && fmtExposure(p.exposure), p.fNumber && `f/${p.fNumber}`, p.iso && `ISO ${p.iso}`, p.focal && `${Math.round(p.focal)}mm`, fmtCamera(p.camera), fmtLens(p.lens)].filter(Boolean);
  const links = [`<a href="${p.home.url}" class="home">← ${esc(p.home.title)}</a>`, ...p.collections.filter((c) => c.url !== p.home.url).map((c) => `<a href="${c.url}">${esc(c.title)}</a>`)];
  return `<figcaption class="cap"><div class="l1">${p.title ? `<span class="t">${esc(p.title)}</span>` : ''}${meta ? `<span class="muted">${meta}</span>` : ''}</div>${spec.length ? `<div class="mono muted spec">${spec.map((x) => `<span>${esc(x)}</span>`).join(' · ')}</div>` : ''}<div class="ln">${links.join('')}</div></figcaption>`;
}
for (const p of photos) {
  const big = p.outputs.at(-1);
  const r = p.width / p.height;
  const sizes = `(min-aspect-ratio: ${p.width}/${p.height}) calc(100dvh * ${r.toFixed(4)}), 100vw`;
  emit(p.url, page({
    path: p.url, solo: true, image: p,
    title: p.title || p.alt.replace(/\.$/, ''),
    description: p.alt,
    body: `<main><figure class="shot" data-id="${p.id}"><img src="/${big.src}" srcset="${srcset(p)}" sizes="${sizes}" width="${big.w}" height="${big.h}" alt="${esc(p.alt)}" fetchpriority="high" style="background-image:url(${p.placeholder});background-size:contain;background-position:center;background-repeat:no-repeat">${caption(p)}</figure><nav class="pn" aria-label="Photos">${p.prev ? `<a rel="prev" href="${p.prev.url}" aria-label="Previous photo">←</a>` : ''}${p.next ? `<a rel="next" href="${p.next.url}" aria-label="Next photo">→</a>` : ''}</nav></main>`,
  }));
}

emit('/404.html', page({
  path: '/404.html', title: 'Not found', description: 'Page not found.',
  body: `<div class="head"><h1>Nothing here</h1><p class="muted">That page doesn't exist. Try <a href="/photos/">Photography</a> or <a href="/">the home page</a>.</p></div>`,
}));

// ---------- write ----------
// Remove pages from earlier builds (everything generated except photos/ and _headers).
const KEEP = new Set(['photos', '_headers']);
for (const entry of await readdir(SITE)) if (!KEEP.has(entry)) await rm(join(SITE, entry), { recursive: true, force: true });

for (const [path, html] of out) {
  const file = path.endsWith('.html') ? join(SITE, path) : join(SITE, path, 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}
await mkdir(join(SITE, 'assets'), { recursive: true });
await writeFile(join(SITE, 'assets', jsName), js);
await writeFile(join(SITE, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0f0f10"/><circle cx="16" cy="16" r="7" fill="none" stroke="#e8e6e3" stroke-width="2.5"/><circle cx="23.5" cy="8.5" r="1.6" fill="#f2b24c"/></svg>`);
await writeFile(join(SITE, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site.url.replace(/\/$/, '')}/sitemap.xml\n`);
await writeFile(join(SITE, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${out.filter(([p]) => !p.endsWith('.html')).map(([p]) => `<url><loc>${site.url.replace(/\/$/, '')}${p}</loc></url>`).join('')}</urlset>\n`);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`${out.length} pages · CSS ${kb(css.length)} inline · JS ${kb(js.length)} (${jsName})`);
if (warnings.length) console.log(`\n${warnings.length} warnings:\n  ${warnings.join('\n  ')}`);
