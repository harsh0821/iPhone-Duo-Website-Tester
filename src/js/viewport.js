// How wide Mobile Safari lays a page out, given its <meta name="viewport">.
// No tag means the classic 980px desktop layout, zoomed out to fit.
export const DESKTOP_LAYOUT_WIDTH = 980;

export function parseViewport(content) {
  if (content == null) return null;
  const out = {};
  for (const part of content.split(/[,;]/)) {
    const [k, v] = part.split('=').map((s) => s && s.trim().toLowerCase());
    if (k) out[k] = v ?? '';
  }
  return out;
}

export function layoutWidth(viewportContent, deviceWidth) {
  const vp = parseViewport(viewportContent);
  if (!vp) return DESKTOP_LAYOUT_WIDTH;
  if (vp.width === 'device-width') return deviceWidth;
  const fixed = parseFloat(vp.width);
  if (Number.isFinite(fixed) && fixed > 0) return Math.min(Math.max(Math.round(fixed), 200), 10000);
  const scale = parseFloat(vp['initial-scale']);
  if (Number.isFinite(scale) && scale > 0) return Math.round(deviceWidth / scale);
  return DESKTOP_LAYOUT_WIDTH;
}

export function isMobileReady(viewportContent) {
  const vp = parseViewport(viewportContent);
  if (!vp) return false;
  return vp.width === 'device-width' || (!vp.width && parseFloat(vp['initial-scale']) === 1);
}
