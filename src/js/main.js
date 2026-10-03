import '../styles/app.css';
import { MODES, DEVICES, GEOMETRY, modeById, visualHeight } from './modes.js';
import { DeviceStage, ROTATE_SPRING } from './devices.js';
import { LayoutPicker } from './layouts.js';
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
// The device's own rotation spring, so the page (panel width, mobile slot) moves in step with it.
const deviceSpring = spring(ROTATE_SPRING);
html.style.setProperty('--device-spring', deviceSpring.easing);
html.style.setProperty('--device-ms', `${deviceSpring.duration}ms`);

// A stable "large viewport" unit for the fixed mobile background (no jump when
// the browser bars collapse).
const setLvh = () => html.style.setProperty('--lvh', CSS.supports('height', '1lvh') ? '1lvh' : `${window.innerHeight / 100}px`);
setLvh();

/** Re-run the soft "value-in" animation on an element whose content just changed. */
function swapIn(el) {
  el.classList.remove('is-swapping');
  void el.offsetWidth;
  el.classList.add('is-swapping');
}

function setText(el, value) {
  if (el.textContent === value) return;
  el.textContent = value;
  swapIn(el);
}

/* ------------------------------------------------------------ status */

function setStatus(tone, title, detail) {
  $$('[data-status]').forEach((el) => { el.dataset.tone = tone; });
  $$('[data-status-title]').forEach((el) => setText(el, title));
  $$('[data-status-detail]').forEach((el) => { setText(el, detail); el.title = detail; });
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
   windows): a real-pixel column. The devices sit in one layer that follows
   whichever is active, so the live site never reloads. */

let pageLayout = null;
const mRoot = $('m-root');
const mSlot = $('m-slot');
const mTest = $('m-test');
const mMore = $('m-test-more');

function mobileGeometry(mode) {
  const g = GEOMETRY.mobile;
  // Columns narrower than the design's 388 px shrink the device to fit.
  const fit = Math.min(1, (mRoot.clientWidth - 32) / g.column);
  const scale = g.scale[mode.id] * fit;
  return { scale, height: visualHeight(mode, scale, DEVICES[mode.device]) };
}

/** How much taller the test card currently is than when closed (its drawer). */
function drawerExtra() {
  const margin = parseFloat(getComputedStyle(mMore).marginTop) || 0;
  return mMore.getBoundingClientRect().height + margin + 12;
}

function placement(mode) {
  if (pageLayout === 'desktop') {
    const g = GEOMETRY.desktop;
    const c = g[mode.orient];
    return { cx: c.x, cy: c.y, scale: g.scale[mode.id] };
  }
  const { scale, height } = mobileGeometry(mode);
  // Position against the *closed* card; --m-shift adds the drawer on top.
  const top = mSlot.getBoundingClientRect().top + window.scrollY - drawerExtra();
  return { cx: html.clientWidth / 2, cy: top + height / 2, scale };
}

/** The empty slot under the test card takes the device's height (animated in CSS). */
function sizeSlot(mode) {
  mSlot.style.setProperty('--slot-h', `${mobileGeometry(mode).height}px`);
}

/** Open / close the mobile popular-sites drawer; the device rides along. */
function setDrawer(open) {
  mTest.classList.toggle('is-open', open);
  const toggle = $('m-test-toggle');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Hide popular sites' : 'Show popular sites');
  const full = mMore.firstElementChild.scrollHeight + 24;
  html.style.setProperty('--m-shift', open ? `${full}px` : '0px');
}

function fitPage() {
  const w = Math.min(window.innerWidth, html.clientWidth || Infinity);
  const h = window.innerHeight;
  const next = w < 700 || w / h < 0.9 ? 'mobile' : 'desktop';
  if (next === 'desktop') {
    const s = Math.min(w / 1920, h / 1000);
    html.style.setProperty('--stage-scale', String(s));
    html.style.setProperty('--stage-top', `${(h - 1000 * s) / 2}px`);
  }
  const changed = next !== pageLayout;
  pageLayout = next;
  html.dataset.layout = next;
  if (devices.mode && (changed || next === 'mobile')) {
    sizeSlot(devices.mode);
    if (next === 'mobile' && mTest.classList.contains('is-open')) setDrawer(true);
    devices.place(devices.mode);
  }
}

const devices = new DeviceStage($('device-layer'), {
  layoutWidthFor: (deviceWidth) => (site.info?.isHtml === false ? deviceWidth : layoutWidth(site.info ? site.info.viewport : '', deviceWidth)),
  placement,
});
fitPage();
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fitPage, 60);
});
window.addEventListener('orientationchange', () => setTimeout(() => { setLvh(); fitPage(); }, 250));

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
  $$('[data-stat="viewport"]').forEach((el) => setText(el, `${mode.viewport.width} × ${mode.viewport.height}`));
  $$('[data-stat="ratio"]').forEach((el) => setText(el, mode.ratio));
}

async function selectMode(id) {
  const mode = modeById(id);
  try {
    localStorage.setItem(MODE_KEY, id);
  } catch { /* ignore */ }
  layoutList.set(id);
  mobileLayouts.set(id, { reveal: true });
  // Portrait devices give the right panel 447 px, landscape ones 364 px; it
  // animates on the device's spring, starting with the device.
  html.dataset.orient = mode.orient;
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
  { el: document.querySelector('[data-recents="mobile"]'), limit: 4, arrow: '/assets/icon-arrow-up-right.svg' },
], {
  onPick: (url) => {
    if (pageLayout === 'mobile') setDrawer(false);
    loadSite(url);
  },
});

const layoutList = new LayoutPicker($('layouts'), { variant: 'desktop', onSelect: selectMode });
const mobileLayouts = new LayoutPicker($('m-layouts'), { variant: 'mobile', onSelect: selectMode });

$('m-test-toggle').addEventListener('click', () => setDrawer(!mTest.classList.contains('is-open')));

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
      btn.classList.add('is-copied');
    } catch (err) {
      if (err?.name === 'AbortError') return;
      label.textContent = 'Copy failed';
    }
    swapIn(label);
    clearTimeout(timer);
    timer = setTimeout(() => {
      label.textContent = 'Share';
      btn.classList.remove('is-copied');
      swapIn(label);
    }, 1800);
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
mobileLayouts.set(initialMode.id);
// A shared link may open on a card that's off-screen in the mobile row.
requestAnimationFrame(() => mobileLayouts.reveal(initialMode.id, { instant: true }));
html.dataset.orient = initialMode.orient;
showModeStats(initialMode);
sizeSlot(initialMode);
devices.place(initialMode);
setStatus('idle', 'Ready', 'Paste a URL to test');

if (params.get('site')) loadSite(params.get('site'));

// Entrance: the panels rise in, one after another. With the splash they arrive
// as the background pulls into focus, so the page assembles around the phone.
html.style.setProperty('--enter-base', withSplash ? '1100ms' : '60ms');
html.classList.add('is-entering');
setTimeout(() => html.classList.remove('is-entering'), withSplash ? 3600 : 1400);

if (withSplash) {
  // Start unfolded, big and centred on the visible screen (device-layer coordinates).
  const mobile = pageLayout === 'mobile';
  playSplash({
    layer: $('device-layer'),
    target: devices.at(initialMode),
    real: devices.deviceFor(initialMode).el,
    center: mobile ? { x: html.clientWidth / 2, y: window.scrollY + window.innerHeight / 2 } : { x: 960, y: 500 },
    // Mobile: the whole open phone fits the screen width with a small margin.
    startWidth: mobile ? html.clientWidth * 0.94 : 1500,
    startHeight: mobile ? window.innerHeight * 0.66 : 960,
    // Narrow screens: start the open phone upright so it begins bigger than it lands.
    startRotate: mobile ? -90 : 0,
  });
}
