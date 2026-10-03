// Builds the two physical devices (outer screen, inner screen) and moves
// between the five modes. Portrait/landscape on the same screen is one
// continuous spring rotation; folding/unfolding morphs one device into the other.
import { DEVICES, MODES } from './modes.js';
import { Pane } from './pane.js';
import { spring, prefersReducedMotion } from './spring.js';

export const ROTATE_SPRING = { response: 0.62, damping: 0.9 };
const MORPH_SPRING = { response: 0.7, damping: 0.92 };
const PANE_SPRING = { response: 0.5, damping: 0.86 };
const FADE_OUT_MS = 140;
const FADE_IN_MS = 320;
// Content starts fading back in once the motion is this far through.
const REVEAL_AT = 0.5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sameFrame = (a, b) => a.rotate === b.rotate && a.scale === b.scale && a.cx === b.cx && a.cy === b.cy;

/** Fade elements between opacities; the end value is committed to inline style. */
function fade(els, from, to, duration) {
  return Promise.all(els.map((el) => {
    el.getAnimations().forEach((a) => a.cancel());
    el.style.opacity = String(to);
    return el.animate([{ opacity: from }, { opacity: to }], {
      duration,
      easing: to > from ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'ease-out',
    }).finished;
  }));
}

function shadowFilter(list) {
  return list.map(([x, y, blur, a]) => `drop-shadow(${x}px ${y}px ${blur}px rgba(0,0,0,${a}))`).join(' ');
}

function buildDevice(key, spec) {
  const el = document.createElement('div');
  el.className = `device device--${key}`;
  el.dataset.active = 'false';
  el.style.width = `${spec.width}px`;
  el.style.height = `${spec.height}px`;

  const { bezel, screen } = spec;
  const bezelBox = `left:${(spec.width - bezel.width) / 2 + bezel.dx}px;top:${(spec.height - bezel.height) / 2 + bezel.dy}px;width:${bezel.width}px;height:${bezel.height}px`;
  const screenBox = `left:${screen.x}px;top:${screen.y}px;width:${screen.width}px;height:${screen.height}px;border-radius:${screen.radius}`;

  // The drop shadow is cast by a solid silhouette (bezel + screen) underneath,
  // so the live iframe never sits inside a CSS filter.
  el.innerHTML = `
    <div class="device__shadow" style="filter:${shadowFilter(spec.shadow)}">
      <div style="${screenBox};background:#000"></div>
      <img src="${bezel.src}" alt="" style="${bezelBox}">
    </div>
    <div class="device__screen" style="${screenBox}"><div class="screen__content"></div></div>
    <img class="device__bezel" src="${bezel.src}" alt="" style="${bezelBox}">`;

  const content = el.querySelector('.screen__content');
  const panes = [new Pane(), ...(spec.split ? [new Pane()] : [])];
  panes.forEach((p) => content.append(p.el));

  return { key, spec, el, content, panes };
}

const visualSize = (mode, spec) => {
  const w = spec.width * mode.scale;
  const h = spec.height * mode.scale;
  return Math.abs(mode.rotate) === 90 ? { w: h, h: w } : { w, h };
};

function transformFor(mode, spec, fx = 1, fy = 1) {
  // fx/fy are *visual* stretch factors; map them into the element's local axes.
  const sideways = Math.abs(mode.rotate) === 90;
  const sx = mode.scale * (sideways ? fy : fx);
  const sy = mode.scale * (sideways ? fx : fy);
  const tx = mode.cx - spec.width / 2;
  const ty = mode.cy - spec.height / 2;
  return `translate(${tx}px, ${ty}px) rotate(${mode.rotate}deg) scale(${sx}, ${sy})`;
}

export class DeviceStage {
  /**
   * @param placement (mode) => { cx, cy, scale } for the current page layout,
   *   so the same devices can sit on the desktop canvas or the mobile one.
   */
  constructor(root, { layoutWidthFor, placement }) {
    this.root = root;
    this.layoutWidthFor = layoutWidthFor;
    this.placement = placement;
    this.devices = {
      outer: buildDevice('outer', DEVICES.outer),
      inner: buildDevice('inner', DEVICES.inner),
    };
    Object.values(this.devices).forEach((d) => root.append(d.el));
    this.mode = null;
    this.busy = null;
    this.pending = null;
  }

  /** The mode plus where it sits right now. */
  at(mode) {
    return { ...mode, ...this.placement(mode) };
  }

  deviceFor(mode) {
    return this.devices[mode.device];
  }

  visiblePanes(mode = this.mode) {
    const dev = this.deviceFor(mode);
    return mode.split ? dev.panes : [dev.panes[0]];
  }

  allPanes() {
    return [...this.devices.outer.panes, ...this.devices.inner.panes];
  }

  /** Lay out the screen content for `mode`: orientation, pane boxes, iframe viewports. */
  layout(mode, { animatePanes = false } = {}) {
    const dev = this.deviceFor(mode);
    const { screen } = dev.spec;
    const sideways = Math.abs(mode.rotate) === 90;
    const cw = sideways ? screen.height : screen.width;
    const ch = sideways ? screen.width : screen.height;

    Object.assign(dev.content.style, {
      width: `${cw}px`,
      height: `${ch}px`,
      transform: `translate(-50%, -50%) rotate(${-mode.rotate}deg)`,
    });
    dev.el.dataset.split = mode.split ? 'true' : 'false';

    const [first, second] = dev.panes;
    const timing = animatePanes && !prefersReducedMotion() ? spring(PANE_SPRING) : null;
    for (const p of dev.panes) {
      p.el.style.transitionDuration = timing ? `${timing.duration}ms` : '0ms';
      p.el.style.transitionTimingFunction = timing ? timing.easing : '';
    }

    if (second) {
      const split = dev.spec.split;
      if (mode.split) {
        first.setBox({ left: 0, width: split.paneWidth, height: split.paneHeight, radius: split.radius });
        second.setBox({ left: cw - split.paneWidth, width: split.paneWidth, height: split.paneHeight, radius: split.radius });
      } else {
        first.setBox({ left: 0, width: cw, height: ch, radius: 0 });
        second.setBox({ left: cw + 12, width: split.paneWidth, height: split.paneHeight, radius: split.radius });
      }
    } else {
      first.setBox({ left: 0, width: cw, height: ch, radius: 0 });
    }

    const vp = mode.viewport;
    const layoutWidth = this.layoutWidthFor(vp.width);
    const layoutHeight = Math.round((layoutWidth * vp.height) / vp.width);
    this.visiblePanes(mode).forEach((p) => p.setViewport(layoutWidth, layoutHeight));
  }

  /** Re-apply layout for the current mode (e.g. the page's viewport meta changed). */
  relayout() {
    if (this.mode) this.layout(this.mode);
  }

  place(mode) {
    this.mode = mode;
    for (const dev of Object.values(this.devices)) {
      const active = dev === this.deviceFor(mode);
      dev.el.dataset.active = String(active);
      dev.el.getAnimations().forEach((a) => a.cancel());
      dev.el.style.opacity = '1';
      dev.content.style.opacity = '1';
    }
    const dev = this.deviceFor(mode);
    dev.el.style.transform = transformFor(this.at(mode), dev.spec);
    // Park the hidden device in this layout too, so it never widens the page.
    for (const other of Object.values(this.devices)) {
      if (other === dev) continue;
      const rest = MODES.find((m) => m.device === other.key);
      other.el.style.transform = transformFor(this.at(rest), other.spec);
    }
    this.layout(mode);
  }

  /**
   * Animate to `mode`. `beforeReveal(mode)` runs while content is hidden, after
   * the new layout is in place (used to load panes that just became visible).
   */
  async go(mode, { beforeReveal } = {}) {
    if (!this.mode) return this.place(mode);
    if (mode === this.mode && !this.busy) return;
    if (this.busy) {
      this.pending = { mode, beforeReveal };
      return this.busy;
    }
    this.busy = this.run(this.mode, mode, beforeReveal);
    try {
      await this.busy;
    } finally {
      this.busy = null;
    }
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      if (next.mode !== this.mode) return this.go(next.mode, { beforeReveal: next.beforeReveal });
    }
  }

  async run(from, to, beforeReveal) {
    const A = this.deviceFor(from);
    const B = this.deviceFor(to);
    const F = this.at(from);
    const T = this.at(to);
    this.mode = to;

    if (prefersReducedMotion()) {
      this.place(to);
      beforeReveal?.(to);
      return;
    }

    if (A === B && sameFrame(F, T)) {
      // Split view on / off: the panes glide apart or together; only their content fades.
      const inners = A.panes.map((p) => p.inner);
      await fade(inners, 1, 0, FADE_OUT_MS);
      this.layout(to, { animatePanes: true });
      beforeReveal?.(to);
      await sleep(spring(PANE_SPRING).duration * REVEAL_AT);
      await fade(inners, 0, 1, FADE_IN_MS);
      return;
    }

    const fadeOut = fade([A.content], 1, 0, FADE_OUT_MS);

    if (A === B) {
      // Same screen: one continuous spring rotation / resize about the device centre.
      const { duration, easing } = spring(ROTATE_SPRING);
      const move = A.el.animate(
        [{ transform: transformFor(F, A.spec) }, { transform: transformFor(T, A.spec) }],
        { duration, easing },
      );
      A.el.style.transform = transformFor(T, A.spec);
      await fadeOut;
      this.layout(to);
      beforeReveal?.(to);
      await sleep(Math.max(0, duration * REVEAL_AT - FADE_OUT_MS));
      await Promise.all([move.finished, fade([A.content], 0, 1, FADE_IN_MS)]);
      return;
    }

    // Fold / unfold: the outgoing device stretches into the incoming device's
    // footprint while fading out; the incoming one grows out of the old footprint.
    const { duration, easing } = spring(MORPH_SPRING);
    const va = visualSize(F, A.spec);
    const vb = visualSize(T, B.spec);

    B.el.getAnimations().forEach((a) => a.cancel());
    B.content.style.opacity = '0';
    B.el.dataset.active = 'true';
    this.layout(to);
    beforeReveal?.(to);

    const grow = B.el.animate(
      [
        { transform: transformFor(T, B.spec, va.w / vb.w, va.h / vb.h), opacity: 0 },
        { opacity: 1, offset: 0.35 },
        { transform: transformFor(T, B.spec), opacity: 1 },
      ],
      { duration, easing },
    );
    const shrink = A.el.animate(
      [
        { transform: transformFor(F, A.spec), opacity: 1 },
        { opacity: 0, offset: 0.35 },
        { transform: transformFor({ ...F, cx: T.cx, cy: T.cy }, A.spec, vb.w / va.w, vb.h / va.h), opacity: 0 },
      ],
      { duration, easing, fill: 'forwards' },
    );
    B.el.style.transform = transformFor(T, B.spec);
    B.el.style.opacity = '1';

    await sleep(duration * REVEAL_AT);
    await Promise.all([grow.finished, shrink.finished, fade([B.content], 0, 1, FADE_IN_MS)]);
    A.el.dataset.active = 'false';
    shrink.cancel();
    A.content.style.opacity = '1';
    A.el.style.transform = transformFor(F, A.spec);
  }
}
