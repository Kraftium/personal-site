# Build plan

Short plan for turning DESIGN.md into the site. Each phase is a few small commits, pushed as they land.

Approved by Aidan on 2026-10-23.

## Decisions

1. **Output directory is `site/`**, committed. Cloudflare Pages: build command empty, output dir `site`.
2. **Dependencies** (dev-only, never shipped to visitors): `sharp`, `exif-reader`, and `lighthouse` + `playwright-core` for automated checks.
3. **Name:** "Aidan Kelley". Small commits are pushed as they land.

## How you'll add photos (target workflow)

1. Export from Lightroom into `Desktop\Export\<Place>\` (one folder per trip; astro: `Astrophotography\M31 2026-10-19.jpg`; loose photos at the top level).
2. In the repo: `npm run photos`. This reads the folder, makes the WebP sizes for new or changed photos only, and adds a stub entry for each new photo to `content/photos.json`.
3. Fill in alt text, collections, favorite, and location for the new entries (the command lists what's missing).
4. `npm run build`, then commit and push. Cloudflare deploys.

`/originals` stays gitignored. On Windows it can be a junction to your Export folder (`mklink /J originals "C:\Users\socce\OneDrive\Desktop\Export"`), so nothing is copied.

## Phases

Status (2026-10-23): phases 0–6 are built; Cloudflare connection and phase 7 remain.

**0. Scaffold**
`.gitignore` (originals, node_modules), `package.json` with `photos`/`build`/`check` scripts, `_headers`, README with the workflow above, DESIGN.md.

**1. Image pipeline** (`scripts/build-images.mjs`)
- Walk `originals/`: folder = album, files at the top level = no album, `Astrophotography` = Deep Sky.
- Read EXIF (capture time, camera, lens, exposure, ISO, focal length) before stripping; astro date and target from the filename; flag files with no date.
- Write 400/900/1600w WebP (q80, q88 for astro), tiny blur placeholder, dominant color. sRGB, auto-rotated, metadata stripped.
- Incremental: skip files whose size + mtime + settings hash haven't changed.
- Output `photos/<id>/…` and `photos/manifest.json`.

**2. Content files** (`content/`)
`photos.json` (alt, title, collections, favorite, place, overrides), `albums.json` or per-folder `album.json`, `collections.json`, `places.json` (place → city → region → state, lat/long, Bortle for observing sites), `astro-targets.json` (catalog → common name). The build merges these with the manifest and warns on missing alt text or unknown places.

**3. Site generator** (`scripts/build-site.mjs`)
Plain JS template literals, no framework. Generates every page in DESIGN.md section 5 as static HTML with inlined CSS, `srcset`/`sizes`, width/height, lazy loading, `fetchpriority` on the first image, and the inline snippets (size mode, favorites shuffle, night check).

**4. Interaction JS** (`main.js`, ≤ 6 KB)
`<dialog>` overlay viewer with keyboard, swipe, history, preloading; fullscreen button; hover/touch prefetch; size toggle. Full-screen page keyboard nav.

**5. Places map**
Simplified US SVG generated once into the repo; dots placed by a small built-in Albers projection at build time; text list beside it.

**6. QA and deploy**
`npm run check`: Lighthouse mobile on `/`, `/photos/`, an album, a collection, a photo page, and Places (all must score 100); screenshots at 390px and 1440px; link checker; budget check on JS/CSS/HTML sizes. Then connect the repo in Cloudflare Pages (build command empty, output dir per decision 1).

**7. Later: easter eggs**
Night sky hint, observatory mode, and the Oct 7 birthday confetti, per DESIGN.md section 9, each verified to add nothing to the main-path Lighthouse run.

**8. North America map** (built 2026-10-24 in `scripts/map.mjs`; Hawaii inset appears once a Hawaii place exists)
- Land and borders come from `world-atlas` (countries) plus `us-atlas` (states). Canadian province lines are not drawn yet.
- One continuous conic projection covers the lower 48, Canada and Alaska, so Alaska sits in its true spot next to Canada instead of in an inset. Hawaii gets a small boxed inset, shown only once a Hawaii place exists.
- The map fits itself to the places in `places.json`. It never shows less than the lower 48, and it grows north or west as places are added, so the empty Arctic stays off-screen. Adding a trip needs no map edits.
- The Places list groups by country, then state or province (for example `Banff, AB`). The `/og/places.png` link preview updates on its own.
- **Later, once a second continent has photos:** a world overview on top. Clicking a continent zooms into it by animating the SVG viewBox, in a few lines of JS with no map library. Each continent keeps its own static map, so the page stays fast without JS.

## What I won't do without asking
Change the design direction, merge to `main`, or write to your Export folder (read-only).
