// Runs only for /og/photo.jpg and /edit (see run_worker_first in wrangler.jsonc);
// every other request is served straight from site/ without touching this code.
// /og/photo.jpg serves one favorite's link-preview card per UTC day, picked from
// /og/favorites.json. /edit is the private photo editor in edit.js.

import { edit } from './edit.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/edit' || url.pathname.startsWith('/edit/')) return edit(request, env);
    const list = await (await env.ASSETS.fetch(new URL('/og/favorites.json', url))).json();
    const day = Math.floor(Date.now() / 86400000);
    // Stepping by a large prime walks the list in a scrambled order, one per day.
    const card = list[(day * 7919) % list.length];
    const res = await env.ASSETS.fetch(new URL(card, url));
    const out = new Response(res.body, res);
    const untilMidnight = 86400 - Math.floor(Date.now() / 1000) % 86400;
    out.headers.set('Cache-Control', `public, max-age=${Math.min(untilMidnight, 3600)}`);
    return out;
  },
};
