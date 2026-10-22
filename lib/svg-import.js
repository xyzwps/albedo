/**
 * SVG import.
 *
 * Browser SVG is parsed by Paper.js (already bundled for boolean operations),
 * which resolves `viewBox`, nested `<g>` transforms and inherited presentation
 * styles for us. The editor never renders the imported tree directly: each
 * painted element becomes a regular, editable shape. `rect` / `circle` /
 * `ellipse` keep their primitive type when the transform chain maps them to a
 * shape the editor can hold (axis-aligned or right-angle rotated rect, circle
 * under any conformal map, circular corners only); everything else — and every
 * painted path — is converted into the editor's own M/L/Q/C/A/Z command stack.
 *
 * Paths that use `A` keep their elliptical arcs when the transform chain is a
 * plain viewBox/transform stack.  Anything the source parser cannot follow
 * falls back to Paper's cubic approximation.
 *
 * Fills/strokes are reduced to solid colors. Gradients keep their first
 * visible stop so a monochrome approximation survives; the caller can warn
 * the user that the original paint was flattened.
 */

import paper from 'paper/dist/paper-core.js';
import {
  multiplyMatrices,
  parseSvgPath,
  parseTransform,
  primitiveShapeGeometry,
  transformCommands,
  viewBoxMatrix
} from './svg-path.js';

const UNITS = { in: 96, pt: 96 / 72, pc: 96 / 6, cm: 96 / 2.54, mm: 96 / 25.4 };
const EPSILON = 1e-7;

let ready = false;

function ensurePaper() {
  if (ready && paper.project && paper.view) return;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    paper.setup(canvas);
  } else {
    paper.setup(new paper.Size(1, 1));
  }
  paper.view.matrix = new paper.Matrix();
  ready = true;
}

const round = (value) => {
  const n = Math.round(Number(value) * 1000) / 1000;
  return Object.is(n, -0) ? 0 : n;
};

function parseLength(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const match = String(value).trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|in|pt|pc|cm|mm)?$/);
  if (!match) return fallback;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return fallback;
  return number * (UNITS[match[2]] || 1);
}

function readSvgDocument(svgText) {
  const parsed = new DOMParser().parseFromString(String(svgText), 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) {
    throw new Error('Invalid SVG');
  }
  const viewBox = String(root.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const hasViewBox = viewBox.length === 4 && viewBox.every((value) => Number.isFinite(value)) && viewBox[2] > 0 && viewBox[3] > 0;
  const viewWidth = hasViewBox ? viewBox[2] : null;
  const viewHeight = hasViewBox ? viewBox[3] : null;
  return {
    parsed,
    root,
    viewBox: hasViewBox ? viewBox : null,
    width: parseLength(root.getAttribute('width'), viewWidth),
    height: parseLength(root.getAttribute('height'), viewHeight)
  };
}

/**
 * Stamp source elements with ids Paper will copy onto the imported items, so
 * the importer can look the source element back up after Paper has resolved
 * styles and transforms. Returns a Map from id to `{ element, ...extra }`.
 */
function tagElements(parsed, selector, prefix, accept) {
  const tagged = new Map();
  const usedIds = new Set();
  parsed.querySelectorAll('[id]').forEach((element) => {
    usedIds.add(element.getAttribute('id'));
  });
  const usedByUse = new Set();
  parsed.querySelectorAll('use').forEach((element) => {
    const href = element.getAttribute('href') || element.getAttribute('xlink:href');
    if (href && href.startsWith('#')) usedByUse.add(href.slice(1));
  });
  let sequence = 0;
  parsed.querySelectorAll(selector).forEach((element) => {
    const extra = accept(element);
    if (!extra) return;
    let id = element.getAttribute('id');
    // A <use> clone inherits the name but not necessarily the same transform
    // chain, so let Paper keep its approximation for those elements.
    const numericId = Boolean(id) && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(id) &&
      String(Number(id)) === id;
    if (!id || numericId || usedByUse.has(id) || tagged.has(id)) {
      id = null;
    }
    if (!id) {
      do {
        sequence += 1;
        id = prefix + sequence;
      } while (usedIds.has(id));
      usedIds.add(id);
      element.setAttribute('id', id);
    }
    tagged.set(id, { element, ...extra });
  });
  return tagged;
}

function tagArcPaths(parsed) {
  return tagElements(parsed, 'path', 'albedo-arc-', (element) => {
    const d = element.getAttribute('d');
    return d && /[Aa]/.test(d) ? { d } : null;
  });
}

const NON_DRAWABLE = new Set(['defs', 'symbol', 'clippath', 'mask', 'pattern']);

function isNonDrawable(element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (NON_DRAWABLE.has(node.nodeName.toLowerCase())) return true;
  }
  return false;
}

function tagShapeElements(parsed) {
  return tagElements(parsed, 'rect, circle, ellipse', 'albedo-shape-', (element) => {
    if (isNonDrawable(element)) return null;
    const tag = element.nodeName.toLowerCase();
    const number = (name, fallback) => {
      const raw = element.getAttribute(name);
      if (raw === null || String(raw).trim() === '') return fallback;
      return parseLength(raw, NaN);
    };
    const attrs = tag === 'rect'
      ? {
        x: number('x', 0), y: number('y', 0),
        width: number('width', NaN), height: number('height', NaN),
        rx: number('rx', NaN), ry: number('ry', NaN)
      }
      : tag === 'circle'
        ? { cx: number('cx', 0), cy: number('cy', 0), r: number('r', NaN) }
        : { cx: number('cx', 0), cy: number('cy', 0), rx: number('rx', NaN), ry: number('ry', NaN) };
    return { tag, attrs };
  });
}

function hasStyleTransform(element) {
  return /(?:^|;)\s*transform\s*:/i.test(element.getAttribute('style') || '');
}

/**
 * Rebuild the matrix Paper baked into the item's geometry.  Paper applies
 * transforms and the viewBox while parsing and leaves every item with an
 * identity matrix, so the source DOM is the only place the chain still
 * exists.  Anything outside the common case (nested <svg>, CSS transform)
 * falls back to Paper's cubic approximation.
 */
function resolveElementMatrix(element, prepared) {
  if (!element || !prepared.root) return null;
  const chain = [];
  const unsupported = new Set(['svg', 'defs', 'symbol', 'use', 'marker', 'pattern', 'clippath', 'mask']);
  for (let node = element; node && node !== prepared.root; node = node.parentElement) {
    if (unsupported.has(node.nodeName.toLowerCase())) return null;
    chain.push(node);
  }
  chain.reverse();

  if (String(prepared.root.getAttribute('transform') || '').trim()) return null;
  let matrix = viewBoxMatrix(
    prepared.viewBox,
    prepared.viewport.width,
    prepared.viewport.height,
    prepared.root.getAttribute('preserveAspectRatio')
  );
  const nodes = [prepared.root, ...chain];
  for (const node of nodes) {
    if (hasStyleTransform(node)) return null;
    const value = node.getAttribute('transform');
    if (value === null) continue;
    const transform = parseTransform(value);
    if (!transform) return null;
    matrix = multiplyMatrices(matrix, transform);
  }
  return matrix;
}

/**
 * Read the SVG's nominal size from the source markup. This is only used to
 * decide whether an imported file already matches the current artboard; the
 * geometry itself comes from Paper.
 */
export function readSvgSize(svgText) {
  const { width, height } = readSvgDocument(svgText);
  return { width, height };
}

/**
 * Paper maps a viewBox straight onto width/height, which stretches a logo when
 * those two aspect ratios differ. Normalize the common `meet` case by making
 * the nominal size equal to the viewBox; the editor then fits the result to the
 * canvas with a uniform scale. `preserveAspectRatio="none"` keeps the stretch
 * it asks for.
 */
function prepareSvg(svgText) {
  const source = readSvgDocument(svgText);
  const ratio = String(source.root.getAttribute('preserveAspectRatio') || '').trim().toLowerCase();
  if (source.viewBox && !ratio.startsWith('none')) {
    source.root.setAttribute('width', String(source.viewBox[2]));
    source.root.setAttribute('height', String(source.viewBox[3]));
  }
  const arcPaths = tagArcPaths(source.parsed);
  const shapeElements = tagShapeElements(source.parsed);
  return {
    text: new XMLSerializer().serializeToString(source.parsed),
    source: { width: source.width, height: source.height },
    root: source.root,
    viewBox: source.viewBox,
    viewport: {
      width: parseLength(source.root.getAttribute('width'), source.viewBox ? source.viewBox[2] : null),
      height: parseLength(source.root.getAttribute('height'), source.viewBox ? source.viewBox[3] : null)
    },
    arcPaths,
    shapeElements
  };
}

function colorInfo(color) {
  if (!color) return null;
  if (color.gradient) {
    const stops = color.getGradient().getStops();
    const stop = stops.find((item) => item.color && item.color.alpha > 0) || stops[0];
    if (!stop || !stop.color) return null;
    return {
      hex: stop.color.toCSS(true),
      alpha: Number.isFinite(stop.color.alpha) ? stop.color.alpha : 1,
      gradient: true
    };
  }
  return {
    hex: color.toCSS(true),
    alpha: Number.isFinite(color.alpha) ? color.alpha : 1,
    gradient: false
  };
}

function appendSegment(from, to, out) {
  const outHandle = from.handleOut || { x: 0, y: 0 };
  const inHandle = to.handleIn || { x: 0, y: 0 };
  if (Math.abs(outHandle.x) < EPSILON && Math.abs(outHandle.y) < EPSILON &&
      Math.abs(inHandle.x) < EPSILON && Math.abs(inHandle.y) < EPSILON) {
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

function flushedPath(path) {
  const clone = path.clone({ insert: false });
  const matrix = path.getGlobalMatrix();
  clone.matrix = new paper.Matrix();
  if (matrix && !matrix.isIdentity()) clone.transform(matrix);
  return clone;
}

function appendPath(path, out) {
  const segments = path.segments;
  if (!segments || !segments.length) return;
  const firstPoint = segments[0].point;
  out.push({ type: 'M', x: round(firstPoint.x), y: round(firstPoint.y) });
  for (let index = 0; index < segments.length - 1; index += 1) {
    appendSegment(segments[index], segments[index + 1], out);
  }
  if (path.closed) {
    const last = segments[segments.length - 1];
    const samePoint = Math.abs(firstPoint.x - last.point.x) < EPSILON &&
      Math.abs(firstPoint.y - last.point.y) < EPSILON;
    if (segments.length > 1 && !samePoint) appendSegment(last, segments[0], out);
    out.push({ type: 'Z' });
  }
}

function pathCommands(path) {
  const commands = [];
  appendPath(flushedPath(path), commands);
  return commands;
}

function compoundCommands(compound) {
  const commands = [];
  compound.children.forEach((child) => {
    if (child && child.className === 'Path' && child.segments && child.segments.length) {
      appendPath(flushedPath(child), commands);
    }
  });
  return commands;
}

function roundCommands(commands) {
  return commands.map((command) => {
    const rounded = { ...command };
    ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'rx', 'ry', 'rotation'].forEach((key) => {
      if (Number.isFinite(rounded[key])) rounded[key] = round(rounded[key]);
    });
    return rounded;
  });
}

/**
 * Prefer the source path data when it contains elliptical arcs: Paper's
 * geometry has already replaced them with cubics by the time it returns.
 */
function arcCommandsFor(item, prepared, consumed) {
  if (!item.name || !prepared.arcPaths || consumed.has(item.name)) return null;
  const source = prepared.arcPaths.get(item.name);
  if (!source) return null;
  const matrix = resolveElementMatrix(source.element, prepared);
  if (!matrix) return null;
  const parsed = parseSvgPath(source.d);
  if (!parsed) return null;
  const commands = transformCommands(parsed, matrix);
  if (!commands.some((command) => command.type === 'A')) return null;
  consumed.add(item.name);
  return roundCommands(commands);
}

function paintFromStyle(style) {
  const fill = style.fill ? style.fill.hex : 'none';
  const stroke = style.stroke ? style.stroke.hex : 'none';
  let opacity = style.opacity;
  if (style.fill) opacity *= style.fill.alpha;
  else if (style.stroke) opacity *= style.stroke.alpha;
  return {
    fill,
    stroke,
    strokeWidth: Math.max(0, Number(style.strokeWidth) || 0),
    opacity: Math.min(1, Math.max(0, opacity))
  };
}

function shapeFromItem(item, style, commands) {
  return {
    type: 'path',
    ...paintFromStyle(style),
    fillRule: item.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
    commands
  };
}

function styleOf(item, opacity) {
  const fill = colorInfo(item.fillColor);
  const stroke = colorInfo(item.strokeColor);
  return {
    fill,
    stroke,
    strokeWidth: Number(item.strokeWidth) || 0,
    opacity: Math.min(1, Math.max(0, opacity * (Number.isFinite(item.opacity) ? item.opacity : 1)))
  };
}

/**
 * @param {string} svgText
 * @returns {{shapes: Array, source: {width: number|null, height: number|null}, warnings: {gradients: number, skipped: number}}}
 */
export function parseSvg(svgText) {
  const text = String(svgText || '').trim();
  if (!text) throw new Error('Empty SVG');
  const prepared = prepareSvg(text);

  ensurePaper();
  const previousScaleStrokes = paper.settings.scaleStrokes;
  paper.settings.scaleStrokes = true;
  let root = null;
  let parsed = null;
  try {
    root = paper.project.importSVG(prepared.text, { insert: false, expandShapes: true });
    const shapes = [];
    const warnings = { gradients: 0, skipped: 0 };
    const consumedArcNames = new Set();
    const consumedShapeNames = new Set();

    // A source rect/circle/ellipse whose transform chain lands on a shape the
    // editor can hold as a primitive: Paper's flattened path is discarded and
    // the native type survives so the shape stays convenient to iterate on.
    const primitiveFor = (item, style) => {
      if (!item.name || !prepared.shapeElements || consumedShapeNames.has(item.name)) return null;
      const entry = prepared.shapeElements.get(item.name);
      if (!entry) return null;
      const matrix = resolveElementMatrix(entry.element, prepared);
      if (!matrix) return null;
      const geometry = primitiveShapeGeometry(entry.tag, entry.attrs, matrix);
      if (!geometry) return null;
      consumedShapeNames.add(item.name);
      const rounded = { type: geometry.type };
      Object.entries(geometry).forEach(([key, value]) => {
        if (key !== 'type') rounded[key] = round(value);
      });
      return { ...rounded, ...paintFromStyle(style) };
    };

    const visit = (item, opacity) => {
      if (!item || item.visible === false) return;
      if (item.isClipMask && item.isClipMask()) return;
      const className = item.className;
      if (className === 'Group' || className === 'Layer') {
        const nextOpacity = opacity * (Number.isFinite(item.opacity) ? item.opacity : 1);
        item.children.forEach((child) => visit(child, nextOpacity));
        return;
      }
      const style = styleOf(item, opacity);
      if (style.fill?.gradient) warnings.gradients += 1;
      if (className === 'CompoundPath') {
        const commands = arcCommandsFor(item, prepared, consumedArcNames) || compoundCommands(item);
        if (commands.length) shapes.push(shapeFromItem(item, style, commands));
        else warnings.skipped += 1;
        return;
      }
      if (className === 'Path') {
        const primitive = primitiveFor(item, style);
        if (primitive) {
          shapes.push(primitive);
          return;
        }
        const commands = arcCommandsFor(item, prepared, consumedArcNames) || pathCommands(item);
        if (commands.length) shapes.push(shapeFromItem(item, style, commands));
        else warnings.skipped += 1;
        return;
      }
      if (className === 'Shape') {
        const path = item.toPath(false);
        const commands = path ? pathCommands(path) : [];
        if (commands.length) shapes.push(shapeFromItem(item, style, commands));
        else warnings.skipped += 1;
        return;
      }
      if (className === 'Raster' || className === 'PointText' || className === 'SymbolItem') {
        warnings.skipped += 1;
      }
    };

    if (root) visit(root, 1);
    parsed = { shapes, source: prepared.source, warnings };
  } finally {
    paper.settings.scaleStrokes = previousScaleStrokes;
    if (root && root.isInserted && root.isInserted()) root.remove();
  }
  return parsed;
}