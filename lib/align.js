/**
 * Pure alignment / distribution math.  Bounds are `{x, y, w, h}` in artboard
 * user units.  The editor owns translation and history; this module only
 * answers "how far does this box move".
 */

export function unionBounds(boundsList) {
  const list = (Array.isArray(boundsList) ? boundsList : []).filter(Boolean);
  if (!list.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  list.forEach((b) => {
    left = Math.min(left, b.x);
    top = Math.min(top, b.y);
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  });
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function alignDelta(bounds, frame, mode) {
  if (!bounds || !frame) return { dx: 0, dy: 0 };
  switch (mode) {
    case 'left': return { dx: frame.x - bounds.x, dy: 0 };
    case 'center': return { dx: frame.x + frame.w / 2 - (bounds.x + bounds.w / 2), dy: 0 };
    case 'right': return { dx: frame.x + frame.w - (bounds.x + bounds.w), dy: 0 };
    case 'top': return { dx: 0, dy: frame.y - bounds.y };
    case 'middle': return { dx: 0, dy: frame.y + frame.h / 2 - (bounds.y + bounds.h / 2) };
    case 'bottom': return { dx: 0, dy: frame.y + frame.h - (bounds.y + bounds.h) };
    default: return { dx: 0, dy: 0 };
  }
}

/**
 * Equal-gap distribution: the first and last boxes stay put, the boxes between
 * them are spaced so that every gap is identical.  This is the behavior users
 * expect from "distribute spacing", not "distribute centers".
 */
export function distributeDeltas(entries, axis) {
  const list = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && entry.bounds)
    .slice()
    .sort((a, b) => (axis === 'y'
      ? a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x
      : a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y));
  if (list.length < 2) return list.map((entry) => ({ id: entry.id, dx: 0, dy: 0 }));

  const start = axis === 'y' ? list[0].bounds.y : list[0].bounds.x;
  const last = list[list.length - 1].bounds;
  const end = axis === 'y' ? last.y + last.h : last.x + last.w;
  const total = list.reduce((sum, entry) => sum + (axis === 'y' ? entry.bounds.h : entry.bounds.w), 0);
  const gap = (end - start - total) / (list.length - 1);

  let cursor = start;
  return list.map((entry) => {
    const current = axis === 'y' ? entry.bounds.y : entry.bounds.x;
    const delta = cursor - current;
    cursor += (axis === 'y' ? entry.bounds.h : entry.bounds.w) + gap;
    return axis === 'y' ? { id: entry.id, dx: 0, dy: delta } : { id: entry.id, dx: delta, dy: 0 };
  });
}