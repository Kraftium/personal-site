// Runs Lighthouse (mobile) on a sample of pages, checks size budgets, and saves
// screenshots at phone and desktop widths into .lighthouse/. Needs Chrome or
// Chromium installed; set CHROME_PATH if it isn't found automatically.
//
//   npm run check            all checks
//   npm run check -- /p/m31/ only these paths

import { spawn } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE = join(ROOT, 'site');
const OUT = join(ROOT, '.lighthouse');
const PORT = 8090;
const BASE = `http://localhost:${PORT}`;

const manifest = JSON.parse(await readFile(join(ROOT, 'content/manifest.json'), 'utf8'));
const firstAlbum = manifest.albums[0]?.slug;
const somePhoto = manifest.photos.find((p) => !p.astro)?.id;
const paths = process.argv.slice(2).length ? process.argv.slice(2) : [
  '/', '/photos/', `/a/${firstAlbum}/`, '/c/deep-sky/', `/p/${somePhoto}/`, '/p/m31/', '/places/', '/photos/all/',
];

const BUDGET = { css: 8 * 1024, js: 6 * 1024, photosHtmlGzip: 30 * 1024 };
let failed = false;
const fail = (msg) => { failed = true; console.log(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ---------- budgets ----------
console.log('Budgets');
const photosHtml = await readFile(join(SITE, 'photos/index.html'), 'utf8');
const css = photosHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
(css.length <= BUDGET.css ? ok : fail)(`inline CSS ${(css.length / 1024).toFixed(1)} KB (≤ ${BUDGET.css / 1024} KB)`);
const jsFile = (await readdir(join(SITE, 'assets'))).find((f) => /^main\..*\.js$/.test(f));
const js = await readFile(join(SITE, 'assets', jsFile));
(js.length <= BUDGET.js ? ok : fail)(`main JS ${(js.length / 1024).toFixed(1)} KB (≤ ${BUDGET.js / 1024} KB)`);
const gz = gzipSync(photosHtml).length;
(gz <= BUDGET.photosHtmlGzip ? ok : fail)(`/photos/ HTML ${(gz / 1024).toFixed(1)} KB gzipped (≤ ${BUDGET.photosHtmlGzip / 1024} KB)`);
const thirdParty = photosHtml.match(/(src|href)="https?:\/\/(?!localhost)[^"]+"/g)?.filter((m) => !/rel="canonical"/.test(m)) || [];
const external = (photosHtml.match(/<(script|link|img)[^>]+(src|href)="https?:\/\//g) || []).filter((t) => !/canonical/.test(t));
(external.length === 0 ? ok : fail)(`no third-party requests${external.length ? ': ' + external.join(', ') : ''}`);

// ---------- Lighthouse ----------
const server = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs')], { env: { ...process.env, PORT }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
await mkdir(OUT, { recursive: true });
const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
console.log('\nLighthouse (mobile, simulated throttling)');
const rows = [];
try {
  for (const path of paths) {
    const { lhr } = await lighthouse(BASE + path, { port: chrome.port, output: 'json', logLevel: 'error' });
    const s = Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, Math.round(v.score * 100)]));
    const lcp = lhr.audits['largest-contentful-paint'].numericValue;
    const cls = lhr.audits['cumulative-layout-shift'].numericValue;
    rows.push({ path, ...s, lcp, cls });
    const all100 = Object.values(s).every((v) => v === 100);
    (all100 && cls === 0 ? ok : fail)(`${path.padEnd(32)} perf ${s.performance} · a11y ${s.accessibility} · bp ${s['best-practices']} · seo ${s.seo} · LCP ${(lcp / 1000).toFixed(2)}s · CLS ${cls.toFixed(3)}`);
    if (!all100) {
      for (const a of Object.values(lhr.audits)) {
        if (a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'manual') {
          console.log(`      - ${a.id}: ${a.title}${a.displayValue ? ` (${a.displayValue})` : ''}`);
        }
      }
    }
  }
} finally {
  await chrome.kill();
}
await writeFile(join(OUT, 'summary.json'), JSON.stringify(rows, null, 2));

// ---------- screenshots ----------
try {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || chromeLauncher.Launcher.getInstallations()[0] });
  for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
    const page = await browser.newPage({ viewport });
    for (const path of paths) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await page.screenshot({ path: join(OUT, `${name}${path.replace(/\//g, '_') || '_'}.png`), fullPage: !path.startsWith('/p/') });
    }
    await page.close();
  }
  await browser.close();
  console.log(`\nScreenshots saved in .lighthouse/`);
} catch (e) {
  console.log(`\nScreenshots skipped (${e.message.split('\n')[0]})`);
}

server.kill();
console.log(failed ? '\nSome checks failed.' : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
