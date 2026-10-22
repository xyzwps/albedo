/**
 * Boolean path operations, backed by Paper.js.
 *
 * Paper.js is used as a real geometry engine: it parses SVG path data
 * (including elliptical arcs), performs curve-aware boolean operations, and
 * returns Bézier contours.  The editor never renders through Paper; the
 * result is converted back into the editor's own M/L/C/Z command stack.
 */

import paper from 'paper/dist/paper-core.js';

let ready = false;

function ensurePaper() {
  if (ready) return;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    paper.setup(canvas);
  } else {
    // Node / Vitest: Paper's headless setup.
    paper.setup(new paper.Size(1, 1));
  }
  paper.view.matrix = new paper.Matrix();
  ready = true;
}

function round(value) {
  const n = Math.round(Number(value) * 10000) / 10000;
  return Object.is(n, -0) ? 0 : n;
}

function toPaperItem(operand) {
  const d = String(operand?.d || '').trim();
  if (!d || !/[Mm]/.test(d)) throw new Error('Empty path operand');
  const count = (d.match(/[Mm]/g) || []).length;
  const item = count > 1 ? new paper.CompoundPath(d) : new paper.Path(d);
  item.fillRule = operand.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
  const paths = item.className === 'CompoundPath' ? item.children : [item];
  paths.forEach((path) => {
    if (path && path.className === 'Path') path.closed = true;
  });
  return item;
}

function appendSegment(from, to, out) {
  const outHandle = from.handleOut;
  const inHandle = to.handleIn;
  const straight = outHandle.length < 1e-7 && inHandle.length < 1e-7;
  if (straight) {
    out.push({ type: 'L', x: round(to.point.x), y: round(to.point.y) });
    return;
  }
  out.push({
    type: 'C',
    x1: round(from.point.x + outHandle.x),
    y1: round(from.point.y + outHandle.y),
    x2: round(to.point.x + inHandle.x),
    y2: round(to.point.y + inHandle.y),
    x: round(to.point.x),
    y: round(to.point.y)
  });
}

function appendPath(path, out) {
  const segments = path.segments;
  if (!segments || !segments.length) return;
  out.push({ type: 'M', x: round(segments[0].point.x), y: round(segments[0].point.y) });
  for (let i = 0; i < segments.length - 1; i += 1) {
    appendSegment(segments[i], segments[i + 1], out);
  }
  if (path.closed) {
    const first = segments[0].point;
    const last = segments[segments.length - 1].point;
    const samePoint = Math.abs(first.x - last.x) < 1e-7 && Math.abs(first.y - last.y) < 1e-7;
    if (segments.length > 1 && !samePoint) {
      appendSegment(segments[segments.length - 1], segments[0], out);
    }
    out.push({ type: 'Z' });
  }
}

function appendItem(item, out) {
  if (!item) return;
  if (item.className === 'CompoundPath') {
    item.children.forEach((child) => appendItem(child, out));
    return;
  }
  if (item.className === 'Path') appendPath(item, out);
}

function netArea(item) {
  if (!item) return 0;
  if (item.className === 'CompoundPath') {
    return item.children.reduce((sum, child) => sum + netArea(child), 0);
  }
  if (item.className === 'Path') return item.area || 0;
  return 0;
}

function absoluteArea(item) {
  if (!item) return 0;
  if (item.className === 'CompoundPath') {
    return item.children.reduce((sum, child) => sum + absoluteArea(child), 0);
  }
  if (item.className === 'Path') return Math.abs(item.area || 0);
  return 0;
}

const OPERATIONS = {
  unite: (a, b) => a.unite(b),
  subtract: (a, b) => a.subtract(b),
  intersect: (a, b) => a.intersect(b),
  exclude: (a, b) => a.exclude(b)
};

/**
 * @param {Array<{d: string, fillRule?: string}>} operands bottom-to-top
 * @param {'unite'|'subtract'|'intersect'|'exclude'} operation
 * @returns {{commands: Array, fillRule: string, area: number}|null}
 */
export function booleanOperands(operands, operation) {
  if (!OPERATIONS[operation]) throw new Error('Unknown boolean operation: ' + operation);
  if (!Array.isArray(operands) || operands.length < 2) {
    throw new Error('Boolean operations need at least two operands');
  }

  ensurePaper();
  const layer = paper.project.activeLayer;
  layer.removeChildren();
  try {
    const items = operands.map(toPaperItem);
    let result = items[0];
    for (let i = 1; i < items.length; i += 1) {
      result = OPERATIONS[operation](result, items[i]);
      if (!result) return null;
    }
    const absolute = absoluteArea(result);
    const net = Math.abs(netArea(result));
    const area = net > 1e-6 ? net : absolute;
    const commands = [];
    appendItem(result, commands);
    if (!commands.length || absolute < 1e-6) return null;
    return {
      commands,
      fillRule: result.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
      area
    };
  } finally {
    layer.removeChildren();
  }
}