/**
 * Snap math for moving, resizing, and node dragging.
 *
 * All values are artboard user units.  The caller supplies a threshold already
 * converted from screen pixels, so snapping feels the same at every zoom.
 *
 * Context shape:
 *   {
 *     enabled: boolean,
 *     threshold: number,
 *     grid: { enabled: boolean, size: number },
 *     targets: [{ x, y, w, h }],          // other shapes
 *     artboard: { w, h },
 *     points: [{ x, y }]                  // other nodes (node drag only)
 *   }
 */

const EPS = 1e-7;
const PRIORITY = { shape: 3, node: 2, grid: 1 };

function axisLines(context, axis) {
  const lines = [];
  const push = (value, kind) => {
    if (Number.isFinite(value)) lines.push({ value, kind });
  };
  (context.targets || []).forEach((b) => {
    if (!b) return;
    if (axis === 'x') {
      push(b.x, 'shape');
      push(b.x + b.w / 2, 'shape');
      push(b.x + b.w, 'shape');
    } else {
      push(b.y, 'shape');
      push(b.y + b.h / 2, 'shape');
      push(b.y + b.h, 'shape');
    }
  });
  const artboard = context.artboard;
  if (artboard) {
    if (axis === 'x') {
      push(0, 'shape');
      push(artboard.w / 2, 'shape');
      push(artboard.w, 'shape');
    } else {
      push(0, 'shape');
      push(artboard.h / 2, 'shape');
      push(artboard.h, 'shape');
    }
  }
  (context.points || []).forEach((point) => {
    if (point) push(axis === 'x' ? point.x : point.y, 'node');
  });
  return lines;
}

function bestSnap(anchors, lines, grid, threshold) {
  if (!(threshold > 0)) return null;
  let best = null;
  const consider = (delta, value, kind) => {
    const distance = Math.abs(delta);
    if (distance > threshold + EPS) return;
    if (!best ||
        distance < best.distance - EPS ||
        (distance <= best.distance + EPS && PRIORITY[kind] > PRIORITY[best.kind])) {
      best = { delta, value, kind, distance };
    }
  };

  anchors.forEach((anchor) => {
    lines.forEach((line) => consider(line.value - anchor, line.value, line.kind));
    if (grid && grid.enabled && grid.size > 0) {
      const value = Math.round(anchor / grid.size) * grid.size;
      consider(value - anchor, value, 'grid');
    }
  });
  return best;
}

function guide(snap, axis) {
  return snap ? { axis, value: snap.value, kind: snap.kind } : null;
}

function dedupeGuides(guides) {
  const seen = new Set();
  return guides.filter((item) => {
    if (!item) return false;
    const key = item.axis + ':' + Math.round(item.value * 1000);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function snapMove(bounds, dx, dy, context = {}) {
  if (!context.enabled || bounds == null) return { dx, dy, guides: [] };
  const threshold = Number(context.threshold) || 0;
  if (threshold <= 0) return { dx, dy, guides: [] };

  const xLines = axisLines(context, 'x');
  const yLines = axisLines(context, 'y');
  const xSnap = bestSnap(
    [bounds.x + dx, bounds.x + bounds.w / 2 + dx, bounds.x + bounds.w + dx],
    xLines,
    context.grid,
    threshold
  );
  const ySnap = bestSnap(
    [bounds.y + dy, bounds.y + bounds.h / 2 + dy, bounds.y + bounds.h + dy],
    yLines,
    context.grid,
    threshold
  );

  return {
    dx: dx + (xSnap ? xSnap.delta : 0),
    dy: dy + (ySnap ? ySnap.delta : 0),
    guides: dedupeGuides([guide(xSnap, 'x'), guide(ySnap, 'y')])
  };
}

export function snapResize(bounds, handle, context = {}) {
  if (!context.enabled || !bounds || !handle) return { bounds, guides: [] };
  const threshold = Number(context.threshold) || 0;
  if (threshold <= 0) return { bounds, guides: [] };

  const xLines = axisLines(context, 'x');
  const yLines = axisLines(context, 'y');
  const minSize = 1;
  let left = bounds.x;
  let right = bounds.x + bounds.w;
  let top = bounds.y;
  let bottom = bounds.y + bounds.h;
  const guides = [];

  if (handle.includes('w')) {
    const snap = bestSnap([left], xLines, context.grid, threshold);
    if (snap) { left += snap.delta; guides.push(guide(snap, 'x')); }
  }
  if (handle.includes('e')) {
    const snap = bestSnap([right], xLines, context.grid, threshold);
    if (snap) { right += snap.delta; guides.push(guide(snap, 'x')); }
  }
  if (handle.includes('n')) {
    const snap = bestSnap([top], yLines, context.grid, threshold);
    if (snap) { top += snap.delta; guides.push(guide(snap, 'y')); }
  }
  if (handle.includes('s')) {
    const snap = bestSnap([bottom], yLines, context.grid, threshold);
    if (snap) { bottom += snap.delta; guides.push(guide(snap, 'y')); }
  }

  if (right - left < minSize) right = left + minSize;
  if (bottom - top < minSize) bottom = top + minSize;

  return {
    bounds: { x: left, y: top, w: right - left, h: bottom - top },
    guides: dedupeGuides(guides)
  };
}

export function snapPoint(point, context = {}) {
  if (!context.enabled || !point) return { point, guides: [] };
  const threshold = Number(context.threshold) || 0;
  if (threshold <= 0) return { point, guides: [] };

  const xSnap = bestSnap([point.x], axisLines(context, 'x'), context.grid, threshold);
  const ySnap = bestSnap([point.y], axisLines(context, 'y'), context.grid, threshold);

  return {
    point: {
      x: point.x + (xSnap ? xSnap.delta : 0),
      y: point.y + (ySnap ? ySnap.delta : 0)
    },
    guides: dedupeGuides([guide(xSnap, 'x'), guide(ySnap, 'y')])
  };
}