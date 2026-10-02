// First-visit splash: an unfolded iPhone Duo, large and in focus on black. It
// shrinks, folds shut in 3D and lands exactly where the live device sits, while
// the black, blurred page behind slowly pulls into focus. The real device then
// takes over with identical geometry.
//
// The fold rig is the inner-screen build cut on the hinge. The left half is a
// flap: its front is the inner screen's left half, its back the outer screen.
// Folding swings it 180° onto the right half, leaving the outer phone face-up
// with its spine on the hinge, exactly like the real hardware.
//
// Smoothness: every animated property is transform or opacity, so the whole
// splash runs on the compositor and never waits on the main thread.
//  - Motion is split across nested elements (position / scale / anchor / fold),
//    each on its own curve, so the combined movement never hitches.
//  - Shadows are painted once into canvases (open + folded silhouettes, the
//    device's exact 5-layer drop shadow) and crossfaded. Nothing is clipped.
//  - The focus pull is a stack of fixed-radius blur layers that fade out in
//    turn, instead of animating a blur radius.
//  - Edge-on shading is a bezel-shaped dark layer faded in and out.
import { DEVICES } from './modes.js';

const SEEN_KEY = 'duo.splash.seen';

// Timeline, [delay, duration] in ms. Everything settles together at ~2900.
const T = {
  appear: [0, 700],
  scale: [150, 2700],
  move: [900, 1950],
  fold: [1000, 1700],
  black: [250, 1900],
  blurFar: [500, 1900],
  blurNear: [1000, 1900],
  handoff: [2850, 560],
};

// What the screens show while the splash plays: apple.com captured at each
// screen's exact viewport (2x). The landing crossfades into the empty state.
// Re-capture with scripts/capture-splash-screens.mjs.
const SCREENS = {
  inner: '/assets/splash/apple-inner.jpg', // 904 × 640
  // 640 × 904 portrait capture, pre-rotated: reads upright when the open phone starts upright (mobile).
  innerUpright: '/assets/splash/apple-inner-upright.jpg',
  outer: '/assets/splash/apple-outer.jpg', // 474 × 696
};
const EASE = {
  appear: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  scale: 'cubic-bezier(0.45, 0, 0.2, 1)',
  move: 'cubic-bezier(0.6, 0, 0.25, 1)',
  fold: 'cubic-bezier(0.55, 0, 0.25, 1)',
  black: 'cubic-bezier(0.4, 0, 0.3, 1)',
  blur: 'cubic-bezier(0.35, 0, 0.25, 1)',
  handoff: 'ease-in-out',
};

// Shadow canvases cover the device box plus room for the shadow, which falls
// down and to the left (offsets up to -167, +89 with ~27 px blur).
const SHADOW_PAD = { left: 300, right: 80, top: 80, bottom: 220 };

/** Whether the inline head script queued a splash for this page load. */
export const splashQueued = () => document.documentElement.classList.contains('splash');

function build(spec, { shade = false, image = null } = {}) {
  const { bezel, screen } = spec;
  const box = `left:${(spec.width - bezel.width) / 2 + bezel.dx}px;top:${(spec.height - bezel.height) / 2 + bezel.dy}px;width:${bezel.width}px;height:${bezel.height}px`;
  const content = image ? `;background-image:linear-gradient(125deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 38%), url(${image})` : '';
  return `
    <div class="splash-screen" style="left:${screen.x}px;top:${screen.y}px;width:${screen.width}px;height:${screen.height}px;border-radius:${screen.radius}${content}"></div>
    <img class="splash-bezel" src="${bezel.src}" alt="" style="${box}">
    ${shade ? `<div class="splash-shade" style="${box};-webkit-mask-image:url(${bezel.src});mask-image:url(${bezel.src})"></div>` : ''}`;
}

function geometry() {
  const inner = DEVICES.inner;
  const outer = DEVICES.outer;
  const W = inner.width;
  const H = inner.height;
  // The outer phone on the flap's back: bezel as tall as the inner bezel, spine on the hinge.
  const k = inner.bezel.height / outer.bezel.height;
  const ox = ((outer.bezel.width - outer.width) / 2) * k;
  const oy = (H - outer.height * k) / 2;
  // Folded, the outer phone in rig coordinates (the back face is mirrored
  // twice, so its content x maps to hinge + x).
  const closed = { x: W / 2 + ox, y: oy, width: outer.width * k, height: outer.height * k };
  return { inner, outer, W, H, k, ox, oy, closed };
}

const loadImage = (src) => {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
};

const radii = (css, k = 1) => css.split(/\s+/).map((v) => parseFloat(v) * k);

/**
 * Paint a device's drop shadow: each of its five layers cast from the
 * silhouette (screen + bezel), shadow only. The silhouette is drawn far off
 * the canvas and its shadow offset back in, so the shadow also lies *under*
 * the device, like a real object's, and nothing shows when the phone folds.
 * `place` maps the device's own build into rig coordinates: { x, y, k }.
 */
async function paintShadow(spec, place, shadows) {
  const w = DEVICES.inner.width + SHADOW_PAD.left + SHADOW_PAD.right;
  const h = DEVICES.inner.height + SHADOW_PAD.top + SHADOW_PAD.bottom;
  const canvas = (cw = w, ch = h) => Object.assign(document.createElement('canvas'), { width: cw, height: ch });

  const img = await loadImage(spec.bezel.src);
  const shape = canvas();
  const g = shape.getContext('2d');
  g.translate(SHADOW_PAD.left + place.x, SHADOW_PAD.top + place.y);
  g.scale(place.k, place.k);
  const { screen, bezel } = spec;
  g.fillStyle = '#000';
  g.beginPath();
  if (g.roundRect) g.roundRect(screen.x, screen.y, screen.width, screen.height, radii(screen.radius));
  else g.rect(screen.x, screen.y, screen.width, screen.height);
  g.fill();
  g.drawImage(img, (spec.width - bezel.width) / 2 + bezel.dx, (spec.height - bezel.height) / 2 + bezel.dy, bezel.width, bezel.height);

  const acc = canvas();
  const c = acc.getContext('2d');
  const far = w + 2000;
  for (const [x, y, blur, a] of shadows) {
    c.shadowColor = `rgba(0,0,0,${a})`;
    c.shadowBlur = blur * place.k;
    c.shadowOffsetX = x * place.k + far;
    c.shadowOffsetY = y * place.k;
    c.drawImage(shape, -far, 0);
  }

  acc.className = 'splash-shadow';
  Object.assign(acc.style, { left: `${-SHADOW_PAD.left}px`, top: `${-SHADOW_PAD.top}px`, width: `${w}px`, height: `${h}px` });
  return acc;
}

// The site stills are optional: if they're slow, the screens just stay dark.
const loadScreen = (src) => Promise.race([
  loadImage(src).then(() => src),
  new Promise((r) => setTimeout(() => r(null), 1500)),
]).catch(() => null);

async function buildRig({ upright = false } = {}) {
  const geo = geometry();
  const [innerShot, outerShot] = await Promise.all([
    loadScreen(upright ? SCREENS.innerUpright : SCREENS.inner),
    loadScreen(SCREENS.outer),
  ]);
  const { inner, outer, W, H, k, ox, oy, closed } = geo;
  const half = W / 2;

  const rig = document.createElement('div');
  rig.className = 'splash-rig';
  rig.innerHTML = `
    <div class="splash-scale">
      <div class="splash-anchor" style="width:${W}px;height:${H}px">
        <div class="splash-3d">
          <div class="splash-half splash-half--right" style="left:${half}px;width:${half}px">
            <div class="splash-build" style="left:${-half}px;width:${W}px;height:${H}px">${build(inner, { image: innerShot })}</div>
          </div>
          <div class="splash-flap" style="width:${half}px">
            <div class="splash-face splash-face--front">
              <div class="splash-build" style="width:${W}px;height:${H}px">${build(inner, { shade: true, image: innerShot })}</div>
            </div>
            <div class="splash-face splash-face--back">
              <div class="splash-build" style="left:${ox}px;top:${oy}px;width:${outer.width}px;height:${outer.height}px;transform:scale(${k});transform-origin:0 0">${build(outer, { shade: true, image: outerShot })}</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const [openShadow, closedShadow] = await Promise.all([
    paintShadow(inner, { x: 0, y: 0, k: 1 }, inner.shadow),
    paintShadow(outer, { x: closed.x, y: closed.y, k }, outer.shadow),
  ]);
  const anchor = rig.querySelector('.splash-anchor');
  anchor.prepend(openShadow, closedShadow);
  return { rig, geo, openShadow, closedShadow };
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Paint everything once while still invisible on black: both sides of the flap
 * and the shadow textures. Without this the first frames of motion, and the
 * moment the flap's back first turns into view, would stall on rasterising.
 */
async function warmUp(rig) {
  const flap = rig.querySelector('.splash-flap');
  rig.style.opacity = '0.001';
  flap.style.transform = 'translateZ(2px) rotateY(180deg)';
  await frame();
  await frame();
  flap.style.transform = 'translateZ(2px) rotateY(0deg)';
  await frame();
  await frame();
  rig.style.opacity = '';
  flap.style.transform = '';
}

/**
 * Play the splash in the device layer's coordinate space.
 * target: devices.at(mode) for the mode the page opens in.
 * real: the live device element it hands over to.
 * center: where the unfolded phone starts; startWidth / startHeight: the
 * largest it may appear there; startRotate: its starting orientation (narrow
 * screens start it upright so it can begin larger than it ends).
 */
export async function playSplash({ layer, target, real, center, startWidth, startHeight, startRotate = 0 }) {
  const html = document.documentElement;
  const veil = document.querySelector('.splash-veil');
  const realShadow = real.querySelector('.device__shadow');
  real.style.opacity = '0';

  let parts;
  try {
    parts = await buildRig({ upright: Math.abs(startRotate) === 90 });
  } catch {
    // Images failed to decode: skip straight to the page.
    html.classList.remove('splash');
    real.style.opacity = '';
    return;
  }
  const { rig, geo, openShadow, closedShadow } = parts;
  const { W, H, k, closed } = geo;
  layer.append(rig);
  await warmUp(rig);

  const anims = [];
  const run = (el, frames, [delay, duration], easing, fill = 'both') => {
    const a = el.animate(frames, { delay, duration, easing, fill });
    anims.push(a);
    return a;
  };

  // Background: black lifts first, then a heavy and a light blur fade out in
  // turn, so the page drifts into focus. Opacity only.
  run(veil.querySelector('.splash-veil__black'), [{ opacity: 1 }, { opacity: 0 }], T.black, EASE.black);
  run(veil.querySelector('.splash-veil__far'), [{ opacity: 1 }, { opacity: 0 }], T.blurFar, EASE.blur);
  run(veil.querySelector('.splash-veil__near'), [{ opacity: 1 }, { opacity: 0 }], T.blurNear, EASE.blur);

  const scaleEl = rig.querySelector('.splash-scale');
  const anchorEl = rig.querySelector('.splash-anchor');
  const body = rig.querySelector('.splash-3d');
  const folds = target.device === 'outer';

  // Start: unfolded, centred, as large as the screen allows.
  const upright = Math.abs(startRotate) === 90;
  const s0 = Math.min(startWidth / (upright ? H : W), startHeight / (upright ? W : H));
  // End: identical to the live device. Folded, the outer face is drawn at k.
  const sEnd = folds ? target.scale / k : target.scale;
  const anchorEnd = folds ? { x: closed.x + closed.width / 2, y: closed.y + closed.height / 2 } : { x: W / 2, y: H / 2 };

  run(rig, [{ opacity: 0 }, { opacity: 1 }], T.appear, EASE.appear);
  run(rig, [
    { transform: `translate(${center.x}px, ${center.y}px) rotate(${startRotate}deg)` },
    { transform: `translate(${target.cx}px, ${target.cy}px) rotate(${target.rotate}deg)` },
  ], T.move, EASE.move);
  run(scaleEl, [{ transform: `scale(${s0 * 1.04})` }, { transform: `scale(${sEnd})` }], T.scale, EASE.scale);

  if (folds) {
    run(anchorEl, [
      { transform: `translate(${-W / 2}px, ${-H / 2}px)` },
      { transform: `translate(${-anchorEnd.x}px, ${-anchorEnd.y}px)` },
    ], T.fold, EASE.fold);
    run(rig.querySelector('.splash-flap'), [
      { transform: 'translateZ(2px) rotateY(0deg)' },
      { transform: 'translateZ(2px) rotateY(180deg)' },
    ], T.fold, EASE.fold);
    // Shadow follows the silhouette from open to folded.
    run(openShadow, [{ opacity: 1 }, { opacity: 0 }], T.fold, EASE.fold);
    run(closedShadow, [{ opacity: 0 }, { opacity: 1 }], T.fold, EASE.fold);
    // Light falls off as each face turns edge-on.
    const [frontShade, backShade] = rig.querySelectorAll('.splash-shade');
    run(frontShade, [{ opacity: 0 }, { opacity: 0.55, offset: 0.5 }, { opacity: 0.55 }], T.fold, EASE.fold);
    run(backShade, [{ opacity: 0.55 }, { opacity: 0.55, offset: 0.5 }, { opacity: 0 }], T.fold, EASE.fold);
  } else {
    anchorEl.style.transform = `translate(${-W / 2}px, ${-H / 2}px)`;
    closedShadow.style.opacity = '0';
  }

  // Hand over, on the animation clock: the live device appears underneath, the
  // rig's body fades off it and the two (matching) shadows crossfade.
  real.style.opacity = '';
  run(real, [{ opacity: 0 }, { opacity: 1 }], [T.handoff[0], 1], 'linear');
  run(realShadow, [{ opacity: 0 }, { opacity: 1 }], T.handoff, EASE.handoff);
  run(body, [{ opacity: 1 }, { opacity: 0 }], T.handoff, EASE.handoff);
  // 'forwards' so it doesn't override the shadow's own fold fade before it starts.
  run(folds ? closedShadow : openShadow, [{ opacity: 1 }, { opacity: 0 }], T.handoff, EASE.handoff, 'forwards');

  const finish = () => {
    anims.forEach((a) => a.cancel());
    rig.remove();
    real.style.opacity = '';
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    html.classList.remove('splash');
  };
  const done = Promise.all(anims.map((a) => a.finished)).catch(() => {}).then(finish);

  // Click, tap or any key skips straight to the end.
  const skip = () => anims.forEach((a) => a.finish());
  window.addEventListener('pointerdown', skip, { once: true, capture: true });
  window.addEventListener('keydown', skip, { once: true, capture: true });
  done.then(() => {
    window.removeEventListener('pointerdown', skip, { capture: true });
    window.removeEventListener('keydown', skip, { capture: true });
  });
  return done;
}
