# Build plan

Short plan for turning DESIGN.md into the site. Each phase is a few small commits on a branch, opened as a PR for your review. Nothing gets built until you approve this.

## Decisions I need from you

1. **Cloudflare output directory.** The project rules say output dir `/`, which publishes the whole repo root: `scripts/`, `content/`, `DESIGN.md`, `package.json`. Harmless, but sloppy and it counts toward the file limit. **I recommend a committed `site/` folder as the output dir** (still no build step on Cloudflare). Keep `/` or switch to `site/`?
2. **Dependencies.** `sharp` is already approved. I'd also add, as dev-only tools that never ship to visitors:
   - `exif-reader` (~10 KB, no deps) to parse EXIF from the buffer sharp returns. The alternative is a hand-written parser, which is more code to maintain.
   - `lighthouse` + `playwright` (Chromium) to run Lighthouse and take mobile/desktop screenshots from one command.
3. **Name in the header** and the one line about you for `/`. "Aidan" alone, or first and last name?

## How you'll add photos (target workflow)

1. Export from Lightroom into `Desktop\Export\<YYYY-MM Place>\` (astro: `Astrophotography\M31 2026-10-19.jpg`).
2. In the repo: `npm run photos`. This reads the folder, makes the WebP sizes for new or changed photos only, and adds a stub entry for each new photo to `content/photos.json`.
3. Fill in alt text, collections, favorite, and location for the new entries (the command lists what's missing).
4. `npm run build`, then commit and push. Cloudflare deploys.

`/originals` stays gitignored. On Windows it can be a junction to your Export folder (`mklink /J originals "C:\Users\socce\OneDrive\Desktop\Export"`), so nothing is copied.

## Phases

**0. Scaffold**
`.gitignore` (originals, node_modules), `package.json` with `photos`/`build`/`check` scripts, `_headers`, README with the workflow above, DESIGN.md.

**1. Image pipeline** (`scripts/build-images.mjs`)
- Walk `originals/`: folder = album, `_singles` = no album, `Astrophotography` = Deep Sky.
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

**7. Later: easter egg**
Night sky hint, then observatory mode, per DESIGN.md section 9, each verified to add nothing to the main-path Lighthouse run.

## What I won't do without asking
Add other dependencies, change the design direction, push to `main`, or touch your Export folder (read-only).
