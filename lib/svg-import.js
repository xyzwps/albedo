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
  mapPoint,
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

function rootTitle(root) {
  const title = Array.from(root.children || [])
    .find((element) => element.nodeName.toLowerCase() === 'title');
  const text = String(title?.textContent || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAINTABLE_SELECTOR = 'path, rect, circle, ellipse, line, polygon, polyline, use';
const NON_DRAWABLE = new Set(['defs', 'symbol', 'clippath', 'mask', 'pattern']);
const RESOURCE_TAGS = new Set([
  'defs', 'style', 'title', 'desc', 'metadata', 'script',
  'symbol', 'marker', 'pattern', 'clippath', 'mask',
  'lineargradient', 'radialgradient', 'filter'
]);

function isNonDrawable(element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (NON_DRAWABLE.has(node.nodeName.toLowerCase())) return true;
  }
  return false;
}

function hasStyleTransform(element) {
  return /(?:^|;)\s*transform\s*:/i.test(element.getAttribute('style') || '');
}

function isIdentityMatrix(matrix) {
  return Math.abs(matrix.a - 1) < 1e-9 && Math.abs(matrix.b) < 1e-9 &&
    Math.abs(matrix.c) < 1e-9 && Math.abs(matrix.d - 1) < 1e-9 &&
    Math.abs(matrix.e) < 1e-9 && Math.abs(matrix.f) < 1e-9;
}

function matrixText(matrix) {
  const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
    .map((value) => String(Number(value.toFixed(9))));
  return 'matrix(' + values.join(' ') + ')';
}

function parsePoints(value) {
  const numbers = String(value || '').trim().split(/[\s,]+/).map(Number);
  if (numbers.length < 6 || numbers.length % 2) return null;
  if (!numbers.every(Number.isFinite)) return null;
  const points = [];
  for (let index = 0; index < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

function attrsForElement(element, tag) {
  const number = (name, fallback) => {
    const raw = element.getAttribute(name);
    if (raw === null || String(raw).trim() === '') return fallback;
    return parseLength(raw, NaN);
  };
  if (tag === 'rect') {
    return {
      x: number('x', 0), y: number('y', 0),
      width: number('width', NaN), height: number('height', NaN),
      rx: number('rx', NaN), ry: number('ry', NaN)
    };
  }
  if (tag === 'circle') return { cx: number('cx', 0), cy: number('cy', 0), r: number('r', NaN) };
  if (tag === 'ellipse') {
    return { cx: number('cx', 0), cy: number('cy', 0), rx: number('rx', NaN), ry: number('ry', NaN) };
  }
  if (tag === 'line') {
    return { x1: number('x1', 0), y1: number('y1', 0), x2: number('x2', 0), y2: number('y2', 0) };
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const points = parsePoints(element.getAttribute('points'));
    return points ? { points } : null;
  }
  if (tag === 'path') {
    const d = element.getAttribute('d');
    return d ? { d } : null;
  }
  if (tag === 'use') {
    const href = element.getAttribute('href') || element.getAttribute('xlink:href');
    return href ? { href } : null;
  }
  return null;
}

/**
 * Normalize the document to the editor's coordinate space: the root viewBox
 * becomes `0 0 width height` and the original viewBox mapping moves onto one
 * wrapper group.  Both the working document (fed to Paper) and the export
 * document (kept for byte-preserving output) go through the same pass, so a
 * source element and its editable shape share coordinates.
 */
function normalizeRoot(root, viewBox, width, height) {
  let w = width;
  let h = height;
  // A root opacity multiplies every child.  Move it onto a wrapper so new
  // shapes appended at the root are not dimmed by it as well.
  const opacityValue = root.getAttribute('opacity');
  const opacityNumber = Number(opacityValue);
  const carriesOpacity = opacityValue !== null && Number.isFinite(opacityNumber) && opacityNumber !== 1;
  const wrapChildren = (matrix) => {
    const wrapper = root.ownerDocument.createElementNS(SVG_NS, 'g');
    if (matrix && !isIdentityMatrix(matrix)) wrapper.setAttribute('transform', matrixText(matrix));
    if (carriesOpacity) {
      wrapper.setAttribute('opacity', opacityValue);
      root.removeAttribute('opacity');
    }
    Array.from(root.childNodes).forEach((node) => {
      if (node.nodeType === 1 && RESOURCE_TAGS.has(node.nodeName.toLowerCase())) return;
      wrapper.appendChild(node);
    });
    root.appendChild(wrapper);
  };
  if (viewBox) {
    w = Number.isFinite(w) && w > 0 ? w : viewBox[2];
    h = Number.isFinite(h) && h > 0 ? h : viewBox[3];
    const matrix = viewBoxMatrix(viewBox, w, h, root.getAttribute('preserveAspectRatio'));
    root.setAttribute('width', String(w));
    root.setAttribute('height', String(h));
    root.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    if (!isIdentityMatrix(matrix) || carriesOpacity) wrapChildren(matrix);
    return { width: w, height: h, viewBox: [0, 0, w, h] };
  }
  if (Number.isFinite(w) && w > 0) root.setAttribute('width', String(w));
  if (Number.isFinite(h) && h > 0) root.setAttribute('height', String(h));
  if (carriesOpacity) wrapChildren(null);
  return { width: w, height: h, viewBox: null };
}

/**
 * Give every paintable element a stable key.  The working copy gets an `id`
 * because Paper copies ids onto `item.name`; the export copy gets the key in a
 * data attribute so the original ids and markup stay untouched.
 */
function keyElements(sourceRoot, exportRoot) {
  const workingNodes = Array.from(sourceRoot.querySelectorAll(PAINTABLE_SELECTOR));
  const exportNodes = Array.from(exportRoot.querySelectorAll(PAINTABLE_SELECTOR));
  const ids = new Set();
  const counts = new Map();
  sourceRoot.querySelectorAll('[id]').forEach((element) => {
    const id = element.getAttribute('id');
    ids.add(id);
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  const entries = new Map();
  let sequence = 0;
  const length = Math.min(workingNodes.length, exportNodes.length);
  for (let index = 0; index < length; index += 1) {
    const working = workingNodes[index];
    const exported = exportNodes[index];
    const tag = working.nodeName.toLowerCase();
    // Resources and clip/mask contents are not painted shapes.
    if (isNonDrawable(working)) continue;
    const attrs = attrsForElement(working, tag);
    if (!attrs) continue;
    const originalId = working.getAttribute('id');
    const numericId = Boolean(originalId) && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(originalId) &&
      String(Number(originalId)) === originalId;
    let key = originalId;
    if (!key || numericId || counts.get(key) > 1) {
      do {
        sequence += 1;
        key = 'albedo-src-' + sequence;
      } while (ids.has(key));
      ids.add(key);
      working.setAttribute('id', key);
    }
    exported.setAttribute('data-albedo-key', key);
    entries.set(key, { working, exported, tag, attrs });
  }
  return entries;
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
 * Parse the source twice: one document is normalized and handed to Paper, the
 * other is kept (also normalized) as the structural template for export.  The
 * template keeps original ids, comments, defs, styles and path data.
 */
function prepareSvg(svgText) {
  const source = readSvgDocument(svgText);
  const exportDoc = source.parsed.cloneNode(true);
  const normalized = normalizeRoot(source.root, source.viewBox, source.width, source.height);
  const sourceRoot = exportDoc.documentElement;
  normalizeRoot(sourceRoot, source.viewBox, source.width, source.height);
  const elements = keyElements(source.root, sourceRoot);
  return {
    text: new XMLSerializer().serializeToString(source.parsed),
    source: { width: normalized.width, height: normalized.height },
    root: source.root,
    viewBox: normalized.viewBox,
    viewport: { width: normalized.width, height: normalized.height },
    elements,
    sourceDoc: exportDoc,
    sourceRoot,
    title: rootTitle(sourceRoot)
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
 * Prefer the source path data.  Paper stores only cubic segments, so using its
 * geometry turns `A` into `C`, and it also loses `Q` and the source's command
 * structure.  For every path whose transform chain we can rebuild, parse the
 * original `d` and map it as a whole.
 */
function sourceCommandsFor(item, prepared, consumed) {
  if (!item.name || !prepared.elements || consumed.has(item.name)) return null;
  const entry = prepared.elements.get(item.name);
  if (!entry) return null;
  let parsed = null;
  if (entry.tag === 'path') parsed = parseSvgPath(entry.attrs.d);
  else if (entry.tag === 'polyline') {
    parsed = entry.attrs.points.map((point, index) => ({
      type: index === 0 ? 'M' : 'L', x: point.x, y: point.y
    }));
  }
  if (!parsed || !parsed.length) return null;
  const matrix = resolveElementMatrix(entry.working, prepared);
  if (!matrix) return null;
  const commands = transformCommands(parsed, matrix);
  if (!commands.length) return null;
  consumed.add(item.name);
  return roundCommands(commands);
}

function primitiveFromSource(entry, matrix, style) {
  if (!entry || !matrix) return null;
  let geometry = null;
  if (entry.tag === 'rect' || entry.tag === 'circle' || entry.tag === 'ellipse') {
    geometry = primitiveShapeGeometry(entry.tag, entry.attrs, matrix);
  } else if (entry.tag === 'line') {
    const start = mapPoint(matrix, entry.attrs.x1, entry.attrs.y1);
    const end = mapPoint(matrix, entry.attrs.x2, entry.attrs.y2);
    geometry = { type: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
  } else if (entry.tag === 'polygon') {
    geometry = {
      type: 'polygon',
      points: entry.attrs.points.map((point) => mapPoint(matrix, point.x, point.y))
    };
  }
  if (!geometry) return null;
  const rounded = { type: geometry.type };
  Object.entries(geometry).forEach(([key, value]) => {
    if (key === 'type') return;
    if (key === 'points') {
      rounded.points = value.map((point) => ({ x: round(point.x), y: round(point.y) }));
    } else {
      rounded[key] = round(value);
    }
  });
  return { ...rounded, ...paintFromStyle(style) };
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
    sourceKey: item.name || null,
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
    const consumedSourceNames = new Set();

    // A source rect/circle/ellipse/line/polygon whose transform chain lands on
    // a shape the editor can hold as a primitive: Paper's flattened path is
    // discarded and the native type survives so the shape stays convenient to
    // iterate on.
    const primitiveFor = (item, style) => {
      if (!item.name || !prepared.elements || consumedSourceNames.has(item.name)) return null;
      const entry = prepared.elements.get(item.name);
      if (!entry) return null;
      const matrix = resolveElementMatrix(entry.working, prepared);
      const primitive = primitiveFromSource(entry, matrix, style);
      if (!primitive) return null;
      consumedSourceNames.add(item.name);
      return { ...primitive, sourceKey: item.name };
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
        const primitive = primitiveFor(item, style);
        if (primitive) {
          shapes.push(primitive);
          return;
        }
        const commands = sourceCommandsFor(item, prepared, consumedSourceNames) || compoundCommands(item);
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
        const commands = sourceCommandsFor(item, prepared, consumedSourceNames) || pathCommands(item);
        if (commands.length) shapes.push(shapeFromItem(item, style, commands));
        else warnings.skipped += 1;
        return;
      }
      if (className === 'Shape') {
        const primitive = primitiveFor(item, style);
        if (primitive) {
          shapes.push(primitive);
          return;
        }
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
    parsed = {
      shapes,
      source: prepared.source,
      warnings,
      sourceDoc: prepared.sourceDoc,
      sourceRoot: prepared.sourceRoot,
      sourceElements: prepared.elements,
      title: prepared.title || null
    };
  } finally {
    paper.settings.scaleStrokes = previousScaleStrokes;
    if (root && root.isInserted && root.isInserted()) root.remove();
  }
  return parsed;
}