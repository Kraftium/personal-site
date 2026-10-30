// The private /edit page: change photo titles, alt text, places, collections and
// favorites from a browser. Saving commits content/photos.json to GitHub, and the
// rebuild workflow (.github/workflows/rebuild.yml) regenerates site/ from it.
//
// Secrets (set with `npx wrangler secret put <NAME>`, never committed):
//   EDIT_PASSWORD  the password for the page; also keys the session cookie, so
//                  changing it signs every browser out
//   GITHUB_TOKEN   fine-grained token for this repo only, Contents: read and write
//
// Every API route checks the session itself; the page's HTML holds no data.

import PAGE from './edit.html';

const REPO = 'Kraftium/personal-site';
const BRANCH = 'main';
const PHOTOS = 'content/photos.json';
const COOKIE = 'edit_session';
const SESSION_HOURS = 8;
const LIMITS = { title: 120, alt: 500 };

const enc = new TextEncoder();
const b64 = (buf) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
};
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(msg));
}

// Compares two strings in time that doesn't depend on where they differ.
async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))).map((p) => p.then((d) => new Uint8Array(d))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const sign = async (env, exp) => `${exp}.${b64url(await hmac(env.EDIT_PASSWORD, `edit-session:${exp}`))}`;

async function signedIn(request, env) {
  const raw = (request.headers.get('Cookie') || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return false;
  const value = raw.slice(COOKIE.length + 1);
  const exp = Number(value.split('.')[0]);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  return same(value, await sign(env, exp));
}

const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/edit; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

// The page's one inline script is allowed by its hash; nothing else may run.
let csp;
async function page() {
  if (!csp) {
    const script = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
    const hash = b64(await crypto.subtle.digest('SHA-256', enc.encode(script)));
    csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`;
  }
  return new Response(PAGE, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': csp,
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

async function github(env, path, init = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'personal-site-edit',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  });
  return res;
}

async function readFile(env, path) {
  const res = await github(env, `contents/${path}?ref=${BRANCH}`);
  if (!res.ok) throw new Error(`GitHub read ${path}: ${res.status}`);
  const { content, sha } = await res.json();
  const bytes = Uint8Array.from(atob(content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
  return { data: JSON.parse(new TextDecoder().decode(bytes)), sha };
}

async function data(env) {
  const [photos, manifest, places, collections] = await Promise.all([PHOTOS, 'content/manifest.json', 'content/places.json', 'content/collections.json'].map((p) => readFile(env, p)));
  const albums = Object.fromEntries(manifest.data.albums.flatMap((a) => a.photos.map((id) => [id, a.title])));
  return {
    photos: photos.data,
    images: Object.fromEntries(Object.values(manifest.data.photos).map((m) => [m.id, { src: `/${m.outputs[0].src}`, w: m.outputs[0].w, h: m.outputs[0].h, date: m.date, album: albums[m.id] || (m.astro ? 'Astrophotography' : '') }])),
    places: Object.fromEntries(Object.entries(places.data.places).map(([k, v]) => [k, v.title])),
    collections: Object.fromEntries(Object.entries(collections.data).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, v.title])),
  };
}

// Checks one photo's changes against what the site allows. Returns an error message or null.
function apply(entry, change, known) {
  for (const [field, value] of Object.entries(change)) {
    if (field === 'title' || field === 'alt') {
      if (typeof value !== 'string') return `${field} must be text`;
      const v = value.trim();
      if (v.length > LIMITS[field]) return `${field} is over ${LIMITS[field]} characters`;
      if (field === 'alt' && !v) return 'alt text is required';
      if (v) entry[field] = v;
      else delete entry[field];
    } else if (field === 'place') {
      if (value !== '' && !known.places.has(value)) return `unknown place ${value}`;
      if (value) entry.place = value;
      else delete entry.place;
    } else if (field === 'collections') {
      if (!Array.isArray(value) || value.some((c) => !known.collections.has(c))) return 'unknown collection';
      entry.collections = [...new Set(value)];
    } else if (field === 'favorite') {
      if (typeof value !== 'boolean') return 'favorite must be true or false';
      entry.favorite = value;
    } else return `${field} can't be edited here`;
  }
  return null;
}

async function save(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request' }, 400);
  }
  const changes = body?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) return json({ error: 'Nothing to save' }, 400);
  if (Object.keys(changes).length > 500) return json({ error: 'Too many changes at once' }, 400);

  const [places, collections] = await Promise.all(['content/places.json', 'content/collections.json'].map((p) => readFile(env, p)));
  const known = { places: new Set(Object.keys(places.data.places)), collections: new Set(Object.keys(collections.data).filter((k) => !k.startsWith('_'))) };

  // Changes are applied to the newest photos.json, so edits made elsewhere in
  // the meantime are kept. If someone commits between the read and the write,
  // GitHub refuses the stale sha and we try again.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: photos, sha } = await readFile(env, PHOTOS);
    for (const [id, change] of Object.entries(changes)) {
      if (!Object.hasOwn(photos, id)) return json({ error: `Unknown photo ${id}` }, 400);
      if (!change || typeof change !== 'object' || Array.isArray(change)) return json({ error: `Bad change for ${id}` }, 400);
      const error = apply(photos[id], change, known);
      if (error) return json({ error: `${id}: ${error}` }, 400);
    }
    const ids = Object.keys(changes);
    const message = `Edit ${ids.length === 1 ? ids[0] : `${ids.length} photos`} from /edit\n\n${ids.map((id) => `- ${id}: ${Object.keys(changes[id]).join(', ')}`).join('\n')}`;
    const content = b64(enc.encode(`${JSON.stringify(photos, null, 2)}\n`));
    const res = await github(env, `contents/${PHOTOS}`, { method: 'PUT', body: JSON.stringify({ message, content, sha, branch: BRANCH }) });
    if (res.ok) {
      const out = await res.json();
      return json({ ok: true, commit: out.commit.html_url, photos });
    }
    if (res.status !== 409 && res.status !== 422) return json({ error: `GitHub refused the save (${res.status})` }, 502);
  }
  return json({ error: 'photos.json kept changing; try again' }, 409);
}

export async function edit(request, env) {
  const url = new URL(request.url);
  if (!env.EDIT_PASSWORD || !env.GITHUB_TOKEN) return new Response('The edit page is not set up yet.', { status: 503 });
  if (url.pathname === '/edit' || url.pathname === '/edit/') return page();

  if (request.method === 'POST') {
    // Same-origin JSON only. Together with SameSite=Strict this blocks other sites from posting here.
    if (request.headers.get('Origin') !== url.origin || !(request.headers.get('Content-Type') || '').startsWith('application/json')) return json({ error: 'Forbidden' }, 403);
  }

  if (url.pathname === '/edit/api/login' && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.LOGIN_LIMIT && !(await env.LOGIN_LIMIT.limit({ key: ip })).success) return json({ error: 'Too many tries. Wait a minute.' }, 429);
    let password = '';
    try {
      password = String((await request.json()).password || '');
    } catch {}
    if (!(await same(password, env.EDIT_PASSWORD))) return json({ error: 'Wrong password' }, 401);
    const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(await sign(env, exp), SESSION_HOURS * 3600) });
  }
  if (url.pathname === '/edit/api/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });

  if (!(await signedIn(request, env))) return json({ error: 'Signed out' }, 401);
  try {
    if (url.pathname === '/edit/api/data' && request.method === 'GET') return json(await data(env));
    if (url.pathname === '/edit/api/save' && request.method === 'POST') return await save(request, env);
  } catch (e) {
    return json({ error: e.message }, 502);
  }
  return json({ error: 'Not found' }, 404);
}
