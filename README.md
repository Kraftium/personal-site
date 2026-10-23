# personal-site

Aidan Kelley's personal site and photography gallery. Plain HTML/CSS and a little vanilla JS, generated locally and served from `site/` by Cloudflare Pages. No build step runs on Cloudflare.

- Look and feel: [DESIGN.md](DESIGN.md)
- Build plan: [BUILD-PLAN.md](BUILD-PLAN.md)

## Setup (once)

1. Install Node 20 or newer, then run `npm install` in this folder.
2. Point `originals/` at your edited exports. On Windows, from this folder in Command Prompt:

   ```
   mklink /J originals "C:\Users\socce\OneDrive\Desktop\Export"
   ```

   `originals/` is gitignored, so full-size photos are never committed.

## Adding photos

1. Export from Lightroom into the Export folder:
   - **One folder per trip or outing**, named after the place: `Park City`, `San Diego & Big Bear`. A second trip to the same place gets its own folder (`Park City 2027`).
   - **Loose photos** that don't belong to a trip go directly in the top level of Export.
   - **Astrophotography** goes in `Astrophotography/`, named `<catalog id> <night>.jpg`, e.g. `M31 2026-10-19.jpg`. The date matters: Seestar exports don't carry a capture date.
   - Make sure Lightroom export includes metadata (at least "Copyright & Camera Info"), so capture time and camera settings come through.
2. Run `npm run photos`. It makes the web sizes for new or changed photos only, and adds an entry for each new photo to `content/photos.json`.
3. Fill in the new entries in `content/photos.json`: `alt` (required), and optionally `title`, `collections`, `favorite`, `place`. The command prints what's missing.
4. Run `npm run build`, then `npm run serve` to preview at http://localhost:8080.
5. Commit and push. Cloudflare deploys `site/`.

## Commands

| Command | What it does |
|---|---|
| `npm run photos` | Reads `originals/`, writes WebP sizes to `site/photos/` and `content/manifest.json` |
| `npm run build` | Generates every HTML page into `site/` |
| `npm run serve` | Local preview of `site/` |
| `npm run check` | Lighthouse, screenshots, and size budgets |

## Cloudflare Pages settings

- Build command: *(empty)*
- Build output directory: `site`
