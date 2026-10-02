import '../styles/app.css';
import { MODES, DEVICES, GEOMETRY, modeById, visualHeight, looksPortrait } from './modes.js';
import { DeviceStage } from './devices.js';
import { LayoutList } from './layouts.js';
import { ModeDropdown } from './dropdown.js';
import { PopularSites, displayUrl } from './popular.js';
import { layoutWidth, isMobileReady, DESKTOP_LAYOUT_WIDTH } from './viewport.js';
import { spring } from './spring.js';
import { playSplash, splashQueued } from './splash.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const MODE_KEY = 'duo.mode';
const html = document.documentElement;
// Apple platforms render the design's SF Pro natively; others use the Inter fallback.
html.classList.toggle('has-sf', /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));

// One spring for UI micro-motion (layout list, mobile device slot).
const uiSpring = spring({ response: 0.5, damping: 0.86 });
html.style.setProperty('--spring', uiSpring.easing);
html.style.setProperty('--spring-ms', `${uiSpring.duration}ms`);

/* ------------------------------------------------------------ status */

function setStatus(tone, title, detail) {
  $$('[data-status]').forEach((el) => { el.dataset.tone = tone; });
  $$('[data-status-title]').forEach((el) => { el.textContent = title; });
  $$('[data-status-detail]').forEach((el) => { el.textContent = detail; el.title = detail; });
}

/* ------------------------------------------------------------ site state */

const site = {
  url: null, // what the user asked for (normalised)
  info: null, // /api/inspect response
  src: null, // what the iframes load
  proxied: false,
  token: 0,
};

/* ------------------------------------------------------------ page layout
   Desktop: the 1920 × 1000 design scaled to fit. Mobile (portrait or narrow
   windows): the 420 px design scaled to the width. The devices sit in one
   layer that follows whichever is active, so the live site never reloads. */

let pageLayout = null;
const mBrand = document.querySelector('.m-brand');
const mSlot = $('m-slot');

function mobileGeometry(mode) {
  const g = GEOMETRY.mobile;
  const scale = g.scale[mode.id];
  return {
    scale,
    height: visualHeight(mode, scale, DEVICES[mode.device]),
    gap: looksPortrait(mode) ? g.gapAbove.portrait : g.gapAbove.landscape,
  };
}

function placement(mode) {
  if (pageLayout === 'desktop') {
    const g = GEOMETRY.desktop;
    return { cx: g.center.x, cy: g.center.y, scale: g.scale[mode.id] };
  }
  const { scale, height, gap } = mobileGeometry(mode);
  const top = mBrand.offsetTop + mBrand.offsetHeight + gap;
  return { cx: GEOMETRY.mobile.centerX, cy: top + height / 2, scale };
}

/** The empty slot under the mobile title takes the device's height (animated in CSS). */
function sizeSlot(mode) {
  const { height, gap } = mobileGeometry(mode);
  mSlot.style.setProperty('--slot-h', `${height}px`);
  mSlot.style.setProperty('--slot-gap', `${gap}px`);
}

function fitPage() {
  const w = Math.min(window.innerWidth, html.clientWidth || Infinity);
  const h = window.innerHeight;
  const next = w < 700 || w / h < 0.9 ? 'mobile' : 'desktop';
  if (next === 'desktop') {
    const s = Math.min(w / 1920, h / 1000);
    html.style.setProperty('--stage-scale', String(s));
    html.style.setProperty('--stage-top', `${(h - 1000 * s) / 2}px`);
  } else {
    html.style.setProperty('--m-scale', String(Math.min(w / 420, 1.6)));
  }
  if (next !== pageLayout) {
    pageLayout = next;
    html.dataset.layout = next;
    if (devices.mode) {
      sizeSlot(devices.mode);
      devices.place(devices.mode);
    }
  }
}

const devices = new DeviceStage($('device-layer'), {
  layoutWidthFor: (deviceWidth) => (site.info?.isHtml === false ? deviceWidth : layoutWidth(site.info ? site.info.viewport : '', deviceWidth)),
  placement,
});
fitPage();
window.addEventListener('resize', fitPage);

function normalise(raw) {
  let value = (raw || '').trim();
  if (!value) throw new Error('Enter a website URL');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'https://' + value;
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) throw new Error('That does not look like a valid URL');
  return url.href;
}

const proxyPath = (href) => {
  const u = new URL(href);
  return `/__proxy/${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}`;
};

/* ------------------------------------------------------------ service worker (proxy helper) */

let swRegistration = null;
const swReady = (async () => {
  if (!('serviceWorker' in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/__proxy/' });
    const worker = swRegistration.installing || swRegistration.waiting || swRegistration.active;
    if (worker && worker.state !== 'activated') {
      await new Promise((resolve) => {
        const done = () => worker.state === 'activated' && resolve();
        worker.addEventListener('statechange', done);
        setTimeout(resolve, 3000);
      });
    }
    return swRegistration;
  } catch {
    return null;
  }
})();

async function tellWorker(origin) {
  const reg = await swReady;
  reg?.active?.postMessage({ type: 'duo-target', origin });
  document.cookie = `duo_target=${encodeURIComponent(origin)}; path=/; SameSite=Lax`;
}

/* ------------------------------------------------------------ loading */

function ensurePanesLoaded(mode) {
  if (!site.src) return;
  for (const pane of devices.visiblePanes(mode)) {
    if (pane.src !== site.src) {
      const src = site.src;
      pane.load(src).then((ok) => {
        if (ok && pane === devices.visiblePanes()[0]) evaluate();
        if (ok && src === site.src) schedulePreload();
      });
    }
  }
}

// Once the visible screen is ready, quietly load the page on the other screen
// too, so folding / unfolding shows the site immediately.
let preloadTimer = null;
function schedulePreload() {
  clearTimeout(preloadTimer);
  preloadTimer = setTimeout(() => {
    const other = devices.mode.device === 'outer' ? modeById('inner-landscape') : modeById('outer-portrait');
    const pane = devices.deviceFor(other).panes[0];
    if (!site.src || pane.src === site.src) return;
    devices.layout(other);
    pane.load(site.src);
  }, 1500);
}

let evaluateTimer = null;
function evaluate() {
  clearTimeout(evaluateTimer);
  evaluateTimer = setTimeout(runEvaluate, 350);
}

function runEvaluate() {
  const { info } = site;
  if (!info) return;
  const mode = devices.mode;
  const panes = devices.visiblePanes(mode);
  if (panes.some((p) => p.el.dataset.state === 'loading')) {
    setStatus('busy', 'Loading', `Rendering at ${mode.viewport.width} px`);
    return;
  }
  if (panes.every((p) => p.el.dataset.state === 'error')) {
    setStatus('error', 'Can’t load site', 'It took too long to respond');
    return;
  }
  if (info.status >= 400) {
    setStatus('warn', `Page returned ${info.status}`, 'Check the address');
    return;
  }
  if (info.isHtml && !isMobileReady(info.viewport)) {
    const w = layoutWidth(info.viewport, mode.viewport.width);
    setStatus('warn', 'Not mobile ready', w === DESKTOP_LAYOUT_WIDTH ? 'No viewport tag, renders at 980 px' : `Fixed ${w} px layout`);
    return;
  }
  const overflow = panes.map((p) => p.measureOverflow()).filter((v) => v !== null);
  const worst = overflow.length ? Math.max(...overflow) : null;
  if (worst > 1) {
    setStatus('warn', 'Needs attention', `Content spills ${worst} px past the edge`);
    return;
  }
  // Directly framed sites are cross-origin: the viewport tag is verified, overflow can't be.
  setStatus('good', 'Looks good', overflow.length ? 'No issues detected' : 'Mobile viewport is set');
}

async function loadSite(raw) {
  let url;
  try {
    url = normalise(raw);
  } catch (err) {
    setStatus('error', 'Invalid URL', err.message);
    return;
  }

  const token = ++site.token;
  inputs.forEach((i) => { i.value = displayUrl(url); });
  forms.forEach((f) => { f.dataset.busy = 'true'; });
  setStatus('busy', 'Checking', new URL(url).host);
  devices.allPanes().forEach((p) => p.clear());
  devices.visiblePanes().forEach((p) => { p.el.dataset.state = 'loading'; });

  let info;
  try {
    const res = await fetch(`/api/inspect?url=${encodeURIComponent(url)}`);
    info = await res.json();
  } catch {
    info = { ok: false, error: 'The tester could not reach its server' };
  }
  if (token !== site.token) return;
  forms.forEach((f) => { f.dataset.busy = 'false'; });

  if (!info.ok) {
    site.url = null;
    site.info = null;
    site.src = null;
    devices.visiblePanes().forEach((p) => p.showError(info.error));
    setStatus('error', 'Can’t load site', info.error);
    return;
  }

  site.url = url;
  site.info = info;
  site.proxied = !info.frameable;
  site.src = site.proxied ? proxyPath(info.finalUrl) : info.finalUrl;
  if (site.proxied) await tellWorker(new URL(info.finalUrl).origin);
  if (token !== site.token) return;

  popular.setCurrent(url);
  syncQuery();

  devices.relayout();
  ensurePanesLoaded(devices.mode);
  setStatus('busy', 'Loading', `Rendering at ${devices.mode.viewport.width} px`);
}

/* ------------------------------------------------------------ layout pickers */

function showModeStats(mode) {
  $$('[data-stat="viewport"]').forEach((el) => { el.textContent = `${mode.viewport.width} × ${mode.viewport.height}`; });
  $$('[data-stat="ratio"]').forEach((el) => { el.textContent = mode.ratio; });
}

async function selectMode(id) {
  const mode = modeById(id);
  try {
    localStorage.setItem(MODE_KEY, id);
  } catch { /* ignore */ }
  layoutList.set(id);
  dropdown.set(id);
  showModeStats(mode);
  sizeSlot(mode);
  syncQuery();
  await devices.go(mode, { beforeReveal: (m) => ensurePanesLoaded(m) });
  evaluate();
}

function syncQuery() {
  const params = new URLSearchParams();
  if (site.url) params.set('site', displayUrl(site.url));
  if (devices.mode) params.set('screen', devices.mode.id);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

/* ------------------------------------------------------------ wiring */

const forms = $$('[data-url-form]');
const inputs = forms.map((f) => f.querySelector('[data-url-input]'));
forms.forEach((form, i) => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    inputs[i].blur();
    loadSite(inputs[i].value);
  });
});
inputs.forEach((input) => {
  input.addEventListener('focus', () => input.select());
  // Keep the desktop and mobile fields in step.
  input.addEventListener('input', () => inputs.forEach((o) => { if (o !== input) o.value = input.value; }));
});

const popular = new PopularSites([
  { el: document.querySelector('[data-recents="desktop"]'), limit: 4, arrow: '/assets/icon-arrow-up-right.svg' },
  { el: document.querySelector('[data-recents="mobile"]'), limit: 2, arrow: '/assets/m/icon-arrow-up-right.svg' },
], { onPick: (url) => loadSite(url) });

const layoutList = new LayoutList($('layouts'), { onSelect: selectMode });

const dropdown = new ModeDropdown({
  trigger: $('m-select-trigger'),
  menu: $('m-select-menu'),
  icon: $('m-select-icon'),
  label: $('m-select-label'),
  onSelect: selectMode,
});

// Share: the current site + screen as a link (native share sheet on touch devices).
$$('[data-share]').forEach((btn) => {
  const label = btn.querySelector('[data-share-label]');
  let timer = null;
  btn.addEventListener('click', async () => {
    const url = location.href;
    const title = site.url ? `${new URL(site.url).host} on iPhone Duo` : 'iPhone Duo Website Tester';
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      label.textContent = 'Link copied';
    } catch (err) {
      if (err?.name === 'AbortError') return;
      label.textContent = 'Copy failed';
    }
    clearTimeout(timer);
    timer = setTimeout(() => { label.textContent = 'Share'; }, 1800);
  });
});

// Initial state: ?screen= / ?site= (shareable links), else last used screen.
const params = new URLSearchParams(location.search);
const withSplash = splashQueued();
let initialMode = modeById(params.get('screen') || '');
// The splash folds the phone shut, so a fresh visit opens folded.
if (!initialMode && withSplash) initialMode = modeById('outer-portrait');
if (!initialMode) {
  try {
    initialMode = modeById(localStorage.getItem(MODE_KEY) || '');
  } catch { /* ignore */ }
}
initialMode ||= MODES[0];

layoutList.set(initialMode.id);
dropdown.set(initialMode.id);
showModeStats(initialMode);
sizeSlot(initialMode);
devices.place(initialMode);
setStatus('idle', 'Ready', 'Paste a URL to test');

if (params.get('site')) loadSite(params.get('site'));

if (withSplash) {
  // Start unfolded, big and centred on the visible screen (device-layer coordinates).
  const mobile = pageLayout === 'mobile';
  const ms = parseFloat(html.style.getPropertyValue('--m-scale')) || 1;
  const viewH = mobile ? window.innerHeight / ms : 1000;
  playSplash({
    layer: $('device-layer'),
    target: devices.at(initialMode),
    real: devices.deviceFor(initialMode).el,
    center: mobile ? { x: 210, y: viewH / 2 } : { x: 960, y: 500 },
    // Mobile: the whole open phone fits the screen width with a small margin.
    startWidth: mobile ? (window.innerWidth * 0.94) / ms : 1500,
    startHeight: mobile ? viewH * 0.66 : 960,
    // Narrow screens: start the open phone upright so it begins bigger than it lands.
    startRotate: mobile ? -90 : 0,
  });
}
