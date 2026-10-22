/**
 * Path serialization shared by the editor and the geometry engine.
 *
 * The editor stores paths as command stacks (`M`, `L`, `Q`, `C`, `A`, `Z`).
 * Paper.js consumes SVG path data, so this module is the single place where
 * those commands become a `d` string.  Keeping it dependency-free also makes
 * it directly testable under Node.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const fmt = (value, digits = 2) => {
  const factor = 10 ** digits;
  const n = Math.round(Number(value) * factor) / factor;
  return Object.is(n, -0) ? '0' : String(n);
};

export function pathData(commands, digits = 2) {
  const f = (value) => fmt(value, digits);
  return (Array.isArray(commands) ? commands : []).map((cmd) => {
    switch (cmd.type) {
      case 'M': return 'M ' + f(cmd.x) + ' ' + f(cmd.y);
      case 'L': return 'L ' + f(cmd.x) + ' ' + f(cmd.y);
      case 'Q': return 'Q ' + f(cmd.x1) + ' ' + f(cmd.y1) + ' ' + f(cmd.x) + ' ' + f(cmd.y);
      case 'C': return 'C ' + f(cmd.x1) + ' ' + f(cmd.y1) + ' ' + f(cmd.x2) + ' ' + f(cmd.y2) + ' ' + f(cmd.x) + ' ' + f(cmd.y);
      case 'A': return 'A ' + f(cmd.rx) + ' ' + f(cmd.ry) + ' ' + f(cmd.rotation) + ' ' + (cmd.largeArc ? 1 : 0) + ' ' + (cmd.sweep ? 1 : 0) + ' ' + f(cmd.x) + ' ' + f(cmd.y);
      case 'Z': return 'Z';
      default: return '';
    }
  }).filter(Boolean).join(' ');
}

export function rectPathData(shape) {
  const x = Number(shape.x) || 0;
  const y = Number(shape.y) || 0;
  const w = Math.max(0, Number(shape.w) || 0);
  const h = Math.max(0, Number(shape.h) || 0);
  const r = clamp(Number(shape.rx) || 0, 0, Math.min(w, h) / 2);
  if (r <= 0.0001) {
    return 'M ' + fmt(x) + ' ' + fmt(y) + ' H ' + fmt(x + w) + ' V ' + fmt(y + h) + ' H ' + fmt(x) + ' Z';
  }
  return [
    'M ' + fmt(x + r) + ' ' + fmt(y),
    'H ' + fmt(x + w - r),
    'A ' + fmt(r) + ' ' + fmt(r) + ' 0 0 1 ' + fmt(x + w) + ' ' + fmt(y + r),
    'V ' + fmt(y + h - r),
    'A ' + fmt(r) + ' ' + fmt(r) + ' 0 0 1 ' + fmt(x + w - r) + ' ' + fmt(y + h),
    'H ' + fmt(x + r),
    'A ' + fmt(r) + ' ' + fmt(r) + ' 0 0 1 ' + fmt(x) + ' ' + fmt(y + h - r),
    'V ' + fmt(y + r),
    'A ' + fmt(r) + ' ' + fmt(r) + ' 0 0 1 ' + fmt(x + r) + ' ' + fmt(y),
    'Z'
  ].join(' ');
}

export function ellipsePathData(shape) {
  const cx = Number(shape.cx) || 0;
  const cy = Number(shape.cy) || 0;
  if (shape.type === 'circle') {
    const r = Math.max(0, Number(shape.r) || 0);
    return 'M ' + fmt(cx - r) + ' ' + fmt(cy) +
      ' A ' + fmt(r) + ' ' + fmt(r) + ' 0 1 0 ' + fmt(cx + r) + ' ' + fmt(cy) +
      ' A ' + fmt(r) + ' ' + fmt(r) + ' 0 1 0 ' + fmt(cx - r) + ' ' + fmt(cy) + ' Z';
  }
  const rx = Math.max(0, Number(shape.rx) || 0);
  const ry = Math.max(0, Number(shape.ry) || 0);
  return 'M ' + fmt(cx - rx) + ' ' + fmt(cy) +
    ' A ' + fmt(rx) + ' ' + fmt(ry) + ' 0 1 0 ' + fmt(cx + rx) + ' ' + fmt(cy) +
    ' A ' + fmt(rx) + ' ' + fmt(ry) + ' 0 1 0 ' + fmt(cx - rx) + ' ' + fmt(cy) + ' Z';
}

export function polygonPathData(shape) {
  const points = Array.isArray(shape.points) ? shape.points : [];
  if (!points.length) return '';
  return 'M ' + points.map((point) => fmt(point.x) + ' ' + fmt(point.y)).join(' L ') + ' Z';
}

/**
 * Convert any filled editor shape into SVG path data suitable for a boolean
 * operand.  Lines have no area and therefore return null.
 */
export function shapeToPathData(shape) {
  if (!shape) return null;
  switch (shape.type) {
    case 'rect': return rectPathData(shape);
    case 'ellipse':
    case 'circle': return ellipsePathData(shape);
    case 'polygon': return polygonPathData(shape);
    case 'path': return pathData(shape.commands);
    default: return null;
  }
}

export function subpathCount(d) {
  return (String(d).match(/[Mm]/g) || []).length;
}