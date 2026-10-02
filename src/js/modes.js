// Every number here comes from the Figma "Final Design" section (1920 × 1000 frames),
// except `viewport`, which is the device's CSS viewport in points.
//
// Viewports use the reported iPhone Duo / Fold panels at iPhone's @3x scale:
//   outer 5.5" 2088 × 1422 px  ->  474 × 696 pt
//   inner 7.8" 2713 × 1920 px  ->  904 × 640 pt
// Split view is two side-by-side apps with a 13 pt divider: 445 × 640 each.

// Native (unrotated) device builds. Positions are relative to the device box.
export const DEVICES = {
  outer: {
    width: 501.053,
    height: 729,
    bezel: { src: '/assets/bezel-outer.png', width: 563.416, height: 784.912, dx: 0, dy: 0 },
    screen: { x: 0, y: 0, width: 501.053, height: 729, radius: '8.602px 51.611px 51.611px 8.602px' },
    shadow: [
      [-166.556, 88.83, 26.649, 0.01],
      [-106.596, 56.629, 24.428, 0.04],
      [-59.96, 32.201, 20.542, 0.15],
      [-26.649, 14.435, 14.99, 0.26],
      [-6.662, 3.331, 8.328, 0.29],
    ],
  },
  inner: {
    width: 917.958,
    height: 653,
    bezel: { src: '/assets/bezel-inner.png', width: 950.51, height: 690.526, dx: -0.87, dy: -0.26 },
    screen: { x: 19.73, y: 17.85, width: 876.756, height: 616.772, radius: '44.253px' },
    // Split view: two 432 × 617 panes, 24px corners, on a black container.
    split: { paneWidth: 432, paneHeight: 617, radius: 24 },
    shadow: [
      [-154.904, 82.615, 24.785, 0.01],
      [-99.138, 52.667, 22.719, 0.04],
      [-55.765, 29.948, 19.105, 0.15],
      [-24.785, 13.425, 13.941, 0.26],
      [-6.196, 3.098, 7.745, 0.29],
    ],
  },
};

// Sprite crops for the dropdown icons (mode-icons.png), straight from Figma.
const ICON_BOX = { padX: 11.475, padY: 3.672 };

export const MODES = [
  {
    id: 'outer-portrait',
    label: 'Outer Portrait',
    device: 'outer',
    rotate: 0,
    viewport: { width: 474, height: 696 },
    ratio: '2:3',
    icon: { w: 33.049, h: 48.656, iw: 1226.56, ih: 277.33, il: -67.36, it: -66.82, align: 'start', rotate: 0 },
  },
  {
    id: 'outer-landscape',
    label: 'Outer Landscape',
    device: 'outer',
    rotate: -90,
    viewport: { width: 696, height: 474 },
    ratio: '3:2',
    icon: { w: 45.443, h: 26.623, iw: 731.31, ih: 411.81, il: -136.53, it: -146.84, align: 'center', rotate: 0 },
  },
  {
    id: 'inner-portrait',
    label: 'Inner Portrait',
    device: 'inner',
    rotate: 90,
    viewport: { width: 640, height: 904 },
    ratio: '5:7',
    icon: { w: 45.443, h: 44.984, iw: 762.21, ih: 253.1, il: -281.95, it: -55.44, align: 'center', rotate: 90 },
  },
  {
    id: 'inner-landscape',
    label: 'Inner Landscape',
    device: 'inner',
    rotate: 0,
    viewport: { width: 904, height: 640 },
    ratio: '7:5',
    icon: { w: 48.656, h: 29.836, iw: 577.64, ih: 310.93, il: -320.89, it: -86.92, align: 'center', rotate: 0 },
  },
  {
    id: 'inner-split',
    label: 'Inner Split',
    device: 'inner',
    split: true,
    rotate: 0,
    viewport: { width: 445, height: 640 },
    ratio: '7:10',
    icon: { w: 48.656, h: 29.836, iw: 577.64, ih: 310.93, il: -450.76, it: -85.38, align: 'center', rotate: 0 },
  },
];

export const modeById = (id) => MODES.find((m) => m.id === id);

// Where the device sits for each page layout (desktop 1920 × 1000 canvas,
// mobile 420 px-wide canvas). Desktop Outer modes are straight from the new
// Figma frames; Inner modes are sized to sit between the two side panels.
// Mobile Outer modes come from the mobile frames; Inner modes fit the same slot.
export const GEOMETRY = {
  desktop: {
    center: { x: 1041.5, y: 476.47 },
    scale: {
      'outer-portrait': 1,
      'outer-landscape': 1,
      'inner-portrait': 729 / 917.958,
      'inner-landscape': 0.9,
      'inner-split': 0.9,
    },
  },
  mobile: {
    centerX: 210,
    scale: {
      'outer-portrait': 277.782 / 501.053,
      'outer-landscape': 340.395 / 729,
      'inner-portrait': 0.44,
      'inner-landscape': 0.4,
      'inner-split': 0.4,
    },
    // Gap between the title and the device: 44 in the portrait frame, 37 in landscape.
    gapAbove: { portrait: 44, landscape: 37 },
  },
};

export const isSideways = (mode) => Math.abs(mode.rotate) === 90;

/** On-screen height of the device for `mode` at `scale` (after rotation). */
export function visualHeight(mode, scale, spec) {
  return (isSideways(mode) ? spec.width : spec.height) * scale;
}

/** A device that reads as portrait (taller than wide) once rotated. */
export const looksPortrait = (mode) => (mode.device === 'outer' ? mode.rotate === 0 : mode.rotate !== 0);

export function iconMarkup(icon) {
  const crop = `<span class="mode-icon__crop" style="width:${icon.w}px;height:${icon.h}px"><img src="/assets/mode-icons.png" alt="" style="width:${icon.iw}%;height:${icon.ih}%;left:${icon.il}%;top:${icon.it}%"></span>`;
  const boxEl = `<span class="mode-icon__box mode-icon__box--${icon.align}" style="padding:${ICON_BOX.padY}px ${ICON_BOX.padX}px">${crop}</span>`;
  const inner = icon.rotate ? `<span class="mode-icon__rot" style="transform:rotate(${icon.rotate}deg)">${boxEl}</span>` : boxEl;
  return `<span class="mode-icon" aria-hidden="true"><span class="mode-icon__scale">${inner}</span></span>`;
}
