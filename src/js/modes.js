// Every number here comes from the Figma "Finalised" section (304:8452):
// desktop frames 284:1934 / 285:3623 (1920 × 1000), mobile 285:4126 / 304:6614
// (420 wide). `viewport` is the device's CSS viewport in points.
//
// Viewports use the reported iPhone Duo / Fold panels at iPhone's @3x scale:
//   outer 5.5" 2088 × 1422 px  ->  474 × 696 pt
//   inner 7.8" 2713 × 1920 px  ->  904 × 640 pt
// Split view is two side-by-side apps with a 13 pt divider: 445 × 640 each.

// The design's drop shadow, in device-local units (Figma draws it at 1.0628×).
const SHADOW = [
  [-182.54, 155.26, 33.4, 0.01],
  [-116.68, 99.74, 30.58, 0.06],
  [-65.87, 56.46, 25.88, 0.2],
  [-29.17, 24.46, 19.29, 0.34],
  [-7.53, 6.59, 10.35, 0.39],
];

// Native (unrotated) device builds. Positions are relative to the device box.
export const DEVICES = {
  outer: {
    width: 501.053,
    height: 729,
    bezel: { src: '/assets/bezel-outer.png', width: 563.416, height: 784.912, dx: 0, dy: 0 },
    screen: { x: 0, y: 0, width: 501.053, height: 729, radius: '8.602px 51.611px 51.611px 8.602px' },
    shadow: SHADOW,
  },
  inner: {
    width: 917.958,
    height: 653,
    bezel: { src: '/assets/bezel-inner.png', width: 950.51, height: 690.526, dx: -0.87, dy: -0.26 },
    screen: { x: 19.73, y: 17.85, width: 876.756, height: 616.772, radius: '44.253px' },
    // Split view: two 432 × 617 panes, 24px corners, on a black container.
    split: { paneWidth: 432, paneHeight: 617, radius: 24 },
    shadow: SHADOW,
  },
};

// `orient` decides the page layout around the device: portrait modes give the
// right-hand panel more room (447 px), landscape modes give it to the device (364 px).
export const MODES = [
  {
    id: 'outer-portrait',
    label: 'Outer Portrait',
    lines: ['Outer', 'Portrait'],
    desc: 'Default outer screen view',
    device: 'outer',
    orient: 'portrait',
    rotate: 0,
    viewport: { width: 474, height: 696 },
    ratio: '2:3',
    thumb: { src: '/assets/thumbs/outer-portrait.png', w: 26, h: 41 },
  },
  {
    id: 'outer-landscape',
    label: 'Outer Landscape',
    lines: ['Outer', 'Landscape'],
    desc: 'Wider outer display',
    device: 'outer',
    orient: 'landscape',
    rotate: -90,
    viewport: { width: 696, height: 474 },
    ratio: '3:2',
    thumb: { src: '/assets/thumbs/outer-landscape.png', w: 38, h: 25 },
  },
  {
    id: 'inner-portrait',
    label: 'Inner Portrait',
    lines: ['Inner', 'Portrait'],
    desc: 'Full inner screen (tall)',
    device: 'inner',
    orient: 'portrait',
    rotate: 90,
    viewport: { width: 640, height: 904 },
    ratio: '5:7',
    thumb: { src: '/assets/thumbs/inner-portrait.png', w: 31, h: 38 },
  },
  {
    id: 'inner-landscape',
    label: 'Inner Landscape',
    lines: ['Inner', 'Landscape'],
    desc: 'Full inner screen (wide)',
    device: 'inner',
    orient: 'landscape',
    rotate: 0,
    viewport: { width: 904, height: 640 },
    ratio: '7:5',
    thumb: { src: '/assets/thumbs/inner-landscape.png', w: 37, h: 31 },
  },
  {
    id: 'inner-split',
    label: 'Inner Split',
    lines: ['Inner', 'Split'],
    desc: 'Default app split view',
    device: 'inner',
    split: true,
    orient: 'landscape',
    rotate: 0,
    viewport: { width: 445, height: 640 },
    ratio: '7:10',
    thumb: { src: '/assets/thumbs/inner-split.png', w: 35, h: 37 },
  },
];

export const modeById = (id) => MODES.find((m) => m.id === id);

// Where the device sits for each page layout.
// Desktop (1920 × 1000 canvas): Outer modes straight from the frames; Inner modes
// share the same centre for their orientation, sized to sit between the panels.
// Mobile (CSS px, 388 px content column): Outer modes from the frames; Inner modes
// fit the same column. Mobile scales shrink further on columns narrower than 388.
export const GEOMETRY = {
  desktop: {
    portrait: { x: 1022.25, y: 546.38 },
    landscape: { x: 1048.62, y: 543.95 },
    scale: {
      'outer-portrait': 532.504 / 501.053,
      'outer-landscape': 508.091 / 501.053,
      'inner-portrait': 774.76 / 917.958,
      'inner-landscape': 0.89,
      'inner-split': 0.89,
    },
  },
  mobile: {
    column: 388,
    scale: {
      'outer-portrait': 277.782 / 501.053,
      'outer-landscape': 251.782 / 501.053,
      'inner-portrait': 0.44,
      'inner-landscape': 0.41,
      'inner-split': 0.41,
    },
  },
};

export const isSideways = (mode) => Math.abs(mode.rotate) === 90;

/** On-screen height of the device for `mode` at `scale` (after rotation). */
export function visualHeight(mode, scale, spec) {
  return (isSideways(mode) ? spec.width : spec.height) * scale;
}

/** The thumbnail tile used by the layout cards (56 px box, render centred). */
export function thumbMarkup(mode) {
  const { src, w, h } = mode.thumb;
  return `<span class="thumb" aria-hidden="true"><img src="${src}" alt="" width="${w}" height="${h}"></span>`;
}
