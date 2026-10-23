// The only script on the main path: grid size toggle, hover/touch prefetch,
// the overlay viewer, and keyboard/touch handling on full-screen photo pages.
// Everything works without it; this only makes it faster and nicer.

const d = document;
const html = d.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- grid size (S / M / L) ----------
const ORDER = ['s', 'm', 'l'];
const GRID_SIZES = {
  s: '(min-width: 1600px) 225px, (min-width: 1024px) 15vw, (min-width: 640px) 20vw, 33vw',
  m: '(min-width: 1600px) 395px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw',
  l: '(min-width: 1600px) 530px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
};
const currentSize = () => html.dataset.size || 'm';

function syncSize() {
  const c = currentSize();
  d.querySelectorAll('[data-size-set]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.sizeSet === c));
  const cyc = d.querySelector('[data-size-cycle]');
  const icon = d.querySelector(`[data-size-set="${c}"] svg`);
  if (cyc && icon) cyc.replaceChildren(icon.cloneNode(true));
  // Lazy images use sizes="auto" and follow layout; eager ones need the hint updated.
  d.querySelectorAll('.grid img[sizes]').forEach((img) => {
    if (!img.getAttribute('sizes').startsWith('auto')) img.sizes = GRID_SIZES[c];
  });
}

function setSize(s) {
  if (s === 'm') delete html.dataset.size;
  else html.dataset.size = s;
  try { s === 'm' ? localStorage.removeItem('size') : localStorage.setItem('size', s); } catch {}
  syncSize();
}
const stepSize = (n) => setSize(ORDER[Math.max(0, Math.min(2, ORDER.indexOf(currentSize()) + n))]);

d.addEventListener('click', (e) => {
  const set = e.target.closest('[data-size-set]');
  if (set) return setSize(set.dataset.sizeSet);
  if (e.target.closest('[data-size-cycle]')) setSize(ORDER[(ORDER.indexOf(currentSize()) + 1) % 3]);
});
syncSize();

// ---------- prefetch ----------
const pages = new Map();
function getPage(url) {
  if (!pages.has(url)) {
    pages.set(url, fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((t) => new DOMParser().parseFromString(t, 'text/html'))
      .catch((err) => { pages.delete(url); throw err; }));
  }
  return pages.get(url);
}

function viewerSizes(img) {
  const r = img.width / img.height;
  return `${Math.round(Math.min(innerWidth - 24, (innerHeight - 170) * r))}px`;
}
function preloadImage(img) {
  if (!img) return;
  const pre = new Image();
  pre.sizes = viewerSizes(img);
  pre.srcset = img.getAttribute('srcset');
}

function warm(a) {
  if (!a || a.dataset.pf || a.origin !== location.origin) return;
  a.dataset.pf = '1';
  if (a.hasAttribute('data-v')) {
    getPage(a.pathname).then((doc) => preloadImage(doc.querySelector('.shot img'))).catch(() => {});
  } else if (a.pathname !== location.pathname) {
    const l = d.createElement('link');
    l.rel = 'prefetch';
    l.href = a.pathname;
    d.head.append(l);
  }
}

let hoverTimer;
const linkOf = (e) => e.target.closest?.('a[href^="/"]');
d.addEventListener('pointerover', (e) => {
  const a = linkOf(e);
  clearTimeout(hoverTimer);
  if (a && e.pointerType === 'mouse') hoverTimer = setTimeout(() => warm(a), 65);
});
d.addEventListener('pointerout', () => clearTimeout(hoverTimer));
d.addEventListener('pointerdown', (e) => warm(linkOf(e)), { passive: true });
d.addEventListener('focusin', (e) => warm(linkOf(e)));

// ---------- overlay viewer ----------
const ICON_X = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 3l12 12M15 3L3 15"/></svg>';
const ICON_FS = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 7V2h5M11 2h5v5M16 11v5h-5M7 16H2v-5"/></svg>';
let dlg, stage, counter, prevBtn, nextBtn, list = [], idx = -1, opener, baseTitle = d.title;

function buildDialog() {
  dlg = d.createElement('dialog');
  dlg.className = 'v';
  dlg.setAttribute('aria-label', 'Photo viewer');
  dlg.innerHTML = `<span class="ct mono" aria-live="polite"></span><button type="button" class="x" aria-label="Close">${ICON_X}</button><button type="button" class="pv" aria-label="Previous photo"></button><button type="button" class="nx" aria-label="Next photo"></button><div class="st"></div>`;
  d.body.append(dlg);
  stage = dlg.querySelector('.st');
  counter = dlg.querySelector('.ct');
  prevBtn = dlg.querySelector('.pv');
  nextBtn = dlg.querySelector('.nx');
  dlg.querySelector('.x').onclick = closeViewer;
  prevBtn.onclick = () => step(-1);
  nextBtn.onclick = () => step(1);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeViewer(); });
  dlg.addEventListener('close', () => {
    stage.replaceChildren();
    d.title = baseTitle;
    opener?.focus({ preventScroll: true });
    opener?.scrollIntoView({ block: 'nearest' });
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) location.href = list[idx].pathname;
  });
  // Swipe left/right to move, down to close.
  let sx, sy;
  dlg.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
  dlg.addEventListener('pointerup', (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = sy = null;
    if (dy > 80 && dy > Math.abs(dx)) closeViewer();
    else if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
  });
}

async function show(i, push) {
  idx = i;
  const a = list[i];
  let doc;
  try { doc = await getPage(a.pathname); } catch { location.href = a.pathname; return; }
  if (idx !== i) return;
  const fig = d.importNode(doc.querySelector('.shot'), true);
  const img = fig.querySelector('img');
  img.removeAttribute('fetchpriority');
  img.sizes = viewerSizes(img);
  const frame = d.createElement('div');
  frame.className = 'fr';
  img.replaceWith(frame);
  const fs = d.createElement('a');
  fs.className = 'fs';
  fs.href = a.pathname;
  fs.setAttribute('aria-label', 'Open full screen');
  fs.innerHTML = ICON_FS;
  frame.append(img, fs);
  stage.replaceChildren(fig);
  counter.textContent = `${i + 1} / ${list.length}`;
  prevBtn.hidden = i === 0;
  nextBtn.hidden = i === list.length - 1;
  d.title = doc.title;
  if (!dlg.open) dlg.showModal();
  const state = { v: a.pathname };
  push ? history.pushState(state, '', a.pathname) : history.replaceState(state, '', a.pathname);
  // Warm the neighbours so stepping is instant.
  for (const n of [list[i + 1], list[i - 1]]) if (n) getPage(n.pathname).then((x) => preloadImage(x.querySelector('.shot img'))).catch(() => {});
}

function step(n) {
  const i = idx + n;
  if (i >= 0 && i < list.length) show(i, false);
}

function closeViewer() {
  if (history.state?.v) history.back();
  else dlg?.close();
}

addEventListener('popstate', (e) => {
  if (!dlg?.open) return;
  const at = e.state?.v && list.findIndex((a) => a.pathname === e.state.v);
  if (at >= 0) show(at, false);
  else dlg.close();
});

d.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[data-v]');
  if (!a) return;
  e.preventDefault();
  if (!dlg) buildDialog();
  opener = a;
  baseTitle = d.title;
  list = [...a.closest('.grid').querySelectorAll('a[data-v]')];
  show(list.indexOf(a), true);
});

// ---------- keyboard shortcuts on grid pages ----------
d.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || dlg?.open || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (d.querySelector('[data-size-set]')) {
    if (e.key === '-') stepSize(-1);
    else if (e.key === '=' || e.key === '+') stepSize(1);
  }
});

// ---------- full-screen photo page ----------
if (d.body.classList.contains('solo')) {
  const body = d.body;
  let idle;
  const wake = () => {
    body.classList.remove('idle');
    clearTimeout(idle);
    if (!reduced) idle = setTimeout(() => body.classList.add('idle'), 2500);
  };
  d.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wake(); });
  d.addEventListener('focusin', () => { body.classList.remove('idle'); clearTimeout(idle); });
  d.addEventListener('click', (e) => {
    if (e.pointerType !== 'mouse' && !e.target.closest('a, button')) body.classList.toggle('idle');
  });
  d.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const go = (sel) => { const a = d.querySelector(sel); if (a) location.href = a.href; };
    if (e.key === 'ArrowLeft') go('[rel=prev]');
    else if (e.key === 'ArrowRight') go('[rel=next]');
    else if (e.key === 'Escape') go('.cap .home');
  });
  for (const a of d.querySelectorAll('.pn a')) warm(a);
}
