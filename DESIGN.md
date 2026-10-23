# DESIGN.md

Source of truth for the look and feel of Aidan Kelley's personal site and photography gallery. If code and this file disagree, this file wins (or gets updated first).

## 1. Vibe

**Sleek, minimal, dark, instant.** The photos are the only color on the page. The chrome is thin, quiet, and gets out of the way. The speed should feel like mcmaster.com: every click lands before you finish expecting it.

- Modern minimal, not a "theme." No shadows, no rounded cards, no gradients, no decorative motion.
- Organized like a catalog: clear indexes, counts, precise small type for metadata.
- One hidden personality layer: the **observatory mode** easter egg (section 9).

## 2. Palette

Always dark. There is no light mode at launch; light can come later as an optional theme (section 10). The site sets `color-scheme: dark` so form controls and scrollbars match.

All colors are CSS custom properties on `:root` so themes can swap them.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0f0f10` | Page background. Near-black, not pure black, so dark photo edges stay visible. |
| `--bg-deep` | `#000000` | Viewer backdrop and full-screen photo page. |
| `--surface` | `#18181a` | Header bar on scroll, index panels, placeholder fallback. |
| `--line` | `#26262a` | Hairline dividers (1px). |
| `--text` | `#e8e6e3` | Primary text. Slightly warm white. |
| `--muted` | `#8b8a88` | Secondary text, counts, spec lines. Meets 4.5:1 on `--bg`. |
| `--accent` | `#f2b24c` | Focus rings, current-page marker, active size toggle. Warm amber, used sparingly. |

Rules: no colored backgrounds behind photos. No accent on large areas. Links are `--text` with an underline on hover/focus, not colored.

## 3. Typography

System fonts only: zero font bytes, no flash, native feel on every OS.

- **Sans:** `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Mono:** `ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", Consolas, monospace`

| Role | Size / weight | Notes |
|---|---|---|
| Body | 15px / 400, line-height 1.5 | 16px on phones. |
| Page title | 22px / 600 | Album and collection names. Tight letter-spacing (-0.01em). |
| Section label | 12px / 600, uppercase, +0.08em tracking, `--muted` | "FAVORITES", "ALBUMS", "LATEST". |
| Index item | 15px / 400 + count in `--muted` | `San Francisco  7` |
| Spec line | 12px mono, `--muted`, tabular numerals | `1/400 · f/5.6 · ISO 800 · 140mm` |

Dates are written `Jul 4–9, 2026`. Numbers in spec lines use `font-variant-numeric: tabular-nums`.

## 4. Layout and grid

### Page frame
- Max content width 1600px, centered. Side padding 24px desktop, 12px phone.
- **Header** (single line, 48px): left = "Aidan Kelley" (links to `/`) and `/ Photography` breadcrumb; right = `Albums · Collections · Places` and the **size toggle**. On phones the nav collapses to a single "Menu" disclosure (native `<details>`, no JS).
- **Footer**: one muted line (© year, Instagram link). Reserved spot for a future settings link.

### Grid
- CSS grid, `grid-template-columns: repeat(var(--cols), 1fr)`, gap 4px (S), 6px (M), 10px (L).
- **Cells are square by default**, because most photos are cropped square. Images use `object-fit: contain`, so **nothing is ever cropped**. Odd shapes sit centered in their cell on `--bg`, which is nearly invisible against dark edges.
- **Per-set cell shape:** each album or collection uses the most common aspect ratio of its photos as its cell shape. Deep Sky gets 9:16 cells; Park City (all 2:3 portrait) gets 2:3 cells. Outliers are contained, never cropped.
- Every `<img>` has `width`/`height` attributes and the cell has a fixed `aspect-ratio`, so **CLS is 0**.

### Size toggle (S / M / L)
Three small grid icons in the header. Keyboard: `-` smaller, `=` larger. The choice is stored in `localStorage` and applied by a tiny inline script before first paint (no flash).

| Mode | Phone | Tablet (≥640px) | Desktop (≥1024px) |
|---|---|---|---|
| S | 3 | 5 | 7 |
| **M (default)** | 2 | 3 | **4** |
| L | 1 | 2 | 3 |

`sizes` on each image is updated with the mode, so the browser picks the 400px thumb in S and the 900px one in L automatically.

## 5. Pages and navigation

```
/                      Personal home
/photos/               Gallery main page
/photos/favorites/     All favorites
/photos/all/           Every photo, newest first
/a/<album>/            Album
/c/<collection>/       Collection
/y/<year>/             Year
/places/               Map + list of places
/places/<place>/       Photos at one place
/p/<photo-id>/         Single photo, full screen
```

### `/` Personal home
Name, one line about Aidan, then the main element: a **"Photography →" doorway** made of a row of 4 random favorites. Room below for future sections (projects, writing) as plain links.

### `/photos/` Gallery main page
1. **Favorites:** one row of 4 photos picked at random from everything marked `favorite`. "All favorites →" links to `/photos/favorites/`.
2. **Index:** three compact text columns, **Albums · Collections · Years**, each entry with a count. Albums are newest first and show their date range. On phones the columns stack.
3. **Latest:** the newest album's grid, ending with "All photos →".

**Random favorites without layout shift:** the HTML ships the 4 cells with fixed square shapes and no `src`. A tiny inline script (~400 bytes) placed right before them picks 4 at random from an inline ID list and sets `src`/`srcset` during parsing, so they still load early and nothing moves. `<noscript>` falls back to the first 4.

### Album page
Title, date range, locations (linked to place pages), optional description, then the grid in capture order.

### Collection page
Title, a one-line description, then the grid. **Capture dates are hidden in the UI** (they stay in the manifest). Default order is curated (manifest order), falling back to newest first.

### Year page
Grid of that year's photos, grouped by album with small labels.

### Prefetch
Every grid thumbnail is a real link to `/p/<id>/`. On `pointerenter` (desktop) or `pointerdown`/`touchstart` (phones), the target page and its 1600px image are prefetched with `<link rel="prefetch">`. Index links prefetch their page on hover too. No library.

## 6. Photo viewer

Two views of the same photo, and the browser decides which one opens.

| Action | Result |
|---|---|
| Left click / tap | **Overlay** opens over the grid (JS) |
| Middle click, Ctrl/Cmd click, "Open in new tab", or no JS | **Full-screen page** `/p/<id>/` |
| Overlay fullscreen button or `F` key | Goes to the full-screen page |

### Overlay
- Built on the native `<dialog>` element: focus trapping, `Esc` to close, and the backdrop come free.
- Backdrop `--bg-deep`. The photo is shown up to ~82vh tall so there is room for the info strip.
- **Info strip** under the photo, quiet and small:
  - Line 1: title or location (left) · `12 / 57` counter (right, muted)
  - Line 2 (mono, muted): `Jul 5, 2026 · 1/640 · f/6.3 · ISO 800 · 70mm · D3500 + 18–140mm`
  - Line 3: album link and collection links as plain muted text links
- **Fullscreen button**: transparent icon in the photo's top-right corner. It appears on hover on desktop and stays faintly visible on touch.
- Close button top-right of the viewport. Prev/next as large invisible hit areas on the left/right thirds plus `←`/`→`; swipe left/right on touch; swipe down to close.
- The URL updates to `/p/<id>/` (`history.pushState`) so the address bar is always shareable; Back closes the overlay.
- Next and previous images are preloaded once the overlay opens.

### Full-screen page `/p/<id>/`
- Black page, photo `object-fit: contain` at `100dvh`, nothing else visible.
- Hover (desktop) or tap (phone) fades in one line at the bottom: title · place · date · "← Album". It fades out after 2.5s idle.
- `←`/`→` move within the album (also real `rel=prev/next` links, so it works without JS). `Esc` goes to the album.
- This is the landing page for shared links, so it must always offer a way into the rest of the site.

## 7. Motion

Almost none.
- Images fade from their placeholder in 150ms (`opacity`).
- Overlay opens with a 120ms fade; no scale, no slide.
- Hover states change instantly or in 100ms.
- No parallax, no scroll-triggered animation, no bounce.
- `prefers-reduced-motion: reduce` makes everything instant and disables the night sky and the hold-to-adapt fade (the unlock still works).

## 8. Locations and the Places map

GPS is not in the photos, so locations are **named once and referenced** by photos.

- Hierarchy: **Place → City → Region → State/Country**, e.g. `Balboa Park → San Diego → SoCal → CA`.
- Shown as text in the viewer info strip and on album pages, each part linking to its place page.
- `/places/` shows a **static SVG map** of the US (simplified state outlines, ~15–25 KB, loaded only on that page) with one dot per place, sized by photo count. Dots are positioned at build time from a hand-entered lat/long per place (no map service, no API). Below the map, the same places as a text list grouped by region; the list is the accessible version of the map.
- Hovering or focusing a dot highlights its list entry and vice versa.

## 9. Easter egg: observatory mode (built later, space reserved now)

### The unlocked look
Applies to the **Deep Sky** collection (`/c/deep-sky/`) and the photo viewer for those photos.
- **Red night-vision palette**: pure black background, red text (around `#ff5a4a`, which keeps body text above 4.5:1 contrast on black) with dimmer red (`#5a1410`) hairlines, the light astronomers use to keep dark-adapted eyes.
- A faint **real star field** behind the grid (a small precomputed list of bright stars, drawn once to a canvas).
- **Telescope-console readouts** per photo, in mono: catalog + common name, total integration, frame count (when known), sub-exposure, gear, site and Bortle, date.
  `NGC 7000 · North America Nebula`
  `INT 47m 40s · SEESTAR S50 · BORTLE 4 · 2026-10-12`
- Thumbnails get a thin reticle (crosshair corners) on hover.

### Trigger: "let your eyes adjust"
- On the Deep Sky page, **press and hold on the dark background for ~3 seconds**. Stars fade in as you hold; letting go early fades them out. At 3s the page switches to observatory mode.
- Keyboard: focus the collection title and **hold Space for 3 seconds**.
- Reduced motion: same hold, no fade; it just switches.
- The unlock lasts for the session (`sessionStorage`). A small "exit observatory" control appears in the header while active.

### Night sky hint (site-wide)
- Between **20:00 and 05:00 visitor local time** (clock only, no location permission), a rare twinkle appears in the page background every 20–40s, and occasionally a slow comet crosses.
- It lives on a fixed, `pointer-events: none` layer behind content, so it only shows in gaps and margins.
- Skipped entirely with `prefers-reduced-motion` or when the tab is hidden.

### Cost rules (non-negotiable)
- **Zero bytes on the main path** except: the night check (~150 bytes inline, everywhere) and the hold listener (~300 bytes inline, Deep Sky page only).
- `night.js` (~1 KB) loads only at night, after `load` + `requestIdleCallback`.
- `observatory.css` + `observatory.js` (budget ≤ 12 KB total, star data included) load only after the hold completes.
- Reserved hooks: `html[data-theme]` for the theme switch and `data-collection="deep-sky"` on the Deep Sky page. The star canvas is created by the script, not shipped in the HTML.

### Future egg: birthday (not built yet)
On **October 7** (Aidan's birthday, visitor local date), a small one-time confetti burst on `/`. Same rules as above: an inline date check of a few bytes, and the confetti script loads only on that day, after `load`, and never with reduced motion.

## 10. Themes (future)

All visual values are tokens (section 2 plus spacing and font tokens). A future settings page can offer themes (light, pixel/retro, etc.):
- Each theme is a small CSS file overriding tokens, loaded only when chosen.
- The saved theme is applied before first paint by the same inline script that applies the grid size.
- Observatory mode is implemented as a hidden theme through the same mechanism.

## 11. Mobile

- Default 2 per row (S = 3, L = 1). Size toggle stays in the header as a single cycling button.
- Prefetch on touch start instead of hover.
- Overlay: swipe left/right to move, swipe down to close; the info strip is always visible below the photo; the fullscreen button is faintly visible at all times.
- Full-screen page: tap toggles the info line.
- Tap targets are at least 44×44px. No hover-only functionality.
- Hold-to-adapt works with touch; the page suppresses the long-press context menu only on the Deep Sky background, never on photos.

## 12. Accessibility

- Semantic HTML: `<header>`, `<nav>`, `<main>`, `<figure>`/`<figcaption>`, real links and buttons.
- Skip link to main content.
- Visible focus everywhere: 2px `--accent` outline with 2px offset.
- Full keyboard navigation: grid in tab order, `Enter` opens the overlay, arrows navigate, `Esc` closes, `F` fullscreen, `-`/`=` grid size.
- **Alt text is required**: the build warns for any photo without `alt` in the content file and uses a plain generated fallback (`"Photo: Golden Gate Bridge, San Francisco"`) meanwhile.
- Text contrast ≥ 4.5:1 (`--muted` on `--bg` is checked).
- The Places map has a full text list equivalent.

## 13. Images

- Per photo: inline blur placeholder (tiny WebP, ~16px wide), 400w, 900w, 1600w WebP.
- Quality 80 for normal photos, 88 for Deep Sky (avoids banding in dark gradients). sRGB, EXIF-oriented, metadata stripped after reading.
- To keep long pages light, inline blur placeholders are used for the first ~12 images per page; later images use a single dominant-color background (a few bytes each).
- First image on each page: `fetchpriority="high"`, not lazy. Everything below the fold: `loading="lazy" decoding="async"`.

## 14. Performance budget

| Item | Budget |
|---|---|
| Lighthouse (mobile) | 100 / 100 / 100 / 100 |
| LCP | < 1s |
| CLS | 0 |
| CSS | Inlined in each page, ≤ 8 KB uncompressed |
| JS on the main path | ≤ 6 KB (viewer, prefetch, size toggle), plus small inline snippets |
| Fonts | 0 bytes |
| Third-party requests | 0 |
| HTML for `/photos/` | ≤ 30 KB compressed |

Caching via `_headers`: generated images and versioned JS/CSS get `Cache-Control: public, max-age=31536000, immutable`; HTML gets a short cache with revalidation.

## 15. Content structure

### Albums (dated trips)
One folder per outing in the source photo folder, named after the place (`Park City`). A `YYYY-MM ` prefix is optional and stripped from the title; album dates always come from the photos' EXIF. If the same place gets a second trip, give it its own folder (`Park City 2027`). An optional `album.json` in the folder overrides title, dates, locations, and description.

Current set (57 photos):

| Album | Dates | Photos | Region |
|---|---|---|---|
| Park City | Mar 27–29, 2026 | 9 | Utah |
| San Pablo Reservoir | May 3, 2026 | 2 | Bay Area |
| San Francisco | Jun 25, 2026 | 7 | Bay Area |
| San Diego & Big Bear | Jul 4–9, 2026 | 13 | SoCal |
| Salt Lake City | Sep 7, 2026 | 4 | Utah |
| Little Cottonwood | Oct 4, 2026 | 6 | Utah |
| Angels Camp | Oct 10–11, 2026 | 4 | Gold Country |

Loose photos with no album (2021 peaks, 2025 stained glass) sit directly in the top of the source folder, outside any album folder. They appear in collections, years, and all photos.

### Collections (timeless, by subject)
Tags in the content file; a photo can be in any number. Capture date hidden in the UI.

| Collection | Seed photos |
|---|---|
| **Deep Sky** | All 10 Seestar targets (anything in `Astrophotography` joins automatically) |
| **Landscapes** | Park City, San Pablo, Little Cottonwood, Big Bear meadow |
| **Wildlife** | Squirrels, raven, crab, duck and duckling, geese, sea lion |
| **Architecture** | California Tower, Botanical Building, Casa de Balboa, Ferry Building, Golden Gate, stained glass, USS Midway |
| **Golden & Blue Hour** | Sunsets, Golden Gate blue hour |
| **Night** | City lights, Big Bear stars, Golden Gate at night |
| **Small Things** | Wildflowers and sprouts, tide-pool crab |
| **Fall** | Little Cottonwood aspens |

Candidates later: Water & Coast, Street, Trails, Pets, Black & White.

### Regions
Utah (Park City, Salt Lake City, Little Cottonwood) · Bay Area (San Francisco, San Pablo) · SoCal (San Diego, Big Bear) · Gold Country (Angels Camp).

### Astro metadata
- **Target:** from the filename (`M31 2026-10-19.jpg`), looked up in an offline table for the common name.
- **Date:** from the filename, because Seestar exports have no capture date. The build flags astro files without one.
- **Integration:** from the EXIF exposure field (Seestar writes total seconds).
- **Gear:** from EXIF (`Seestar S50`).
- **Site and Bortle:** entered once per observing site.

### Photo IDs and URLs
`<yyyymmdd>-<file stem>`, lowercased: `/p/20260705-dsc3447/`, `/p/20261019-m31/`. Stable when photos are added or re-exported.
