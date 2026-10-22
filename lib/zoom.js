/**
 * Canvas zoom math: discrete ladder for buttons/shortcuts, clamping, and
 * the per-notch wheel factor. The editor anchors zoom on a document point
 * read through the stage CTM, so no scroll-geometry helper lives here.
 */

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 8;
export const ZOOM_LADDER = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8];

const EPSILON = 1e-9;

export function clampZoom(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

export function nextZoom(current, direction) {
  const zoom = clampZoom(current);
  if (direction > 0) {
    return ZOOM_LADDER.find((step) => step > zoom + EPSILON) ?? ZOOM_MAX;
  }
  if (direction < 0) {
    return [...ZOOM_LADDER].reverse().find((step) => step < zoom - EPSILON) ?? ZOOM_MIN;
  }
  return zoom;
}

export function wheelZoomFactor(deltaY) {
  const delta = Number(deltaY);
  if (!Number.isFinite(delta) || delta === 0) return 1;
  return clampFactor(Math.exp(-delta * 0.002));
}

// Bounds one wheel notch so a huge delta (some mice, some trackpads)
// cannot jump past several ladder steps in a single event.
function clampFactor(factor) {
  return Math.min(2, Math.max(0.5, factor));
}

export function zoomPercent(value) {
  return Math.round(clampZoom(value) * 100) + '%';
}
