/**
 * SVG path-data parsing and affine transforms.
 *
 * The importer uses Paper.js for the document tree, but Paper only stores
 * cubic segments: an `A` command becomes one or more `C` commands.  This
 * module keeps the source path data long enough to preserve elliptical arcs.
 * It is dependency-free so it can be unit-tested outside the browser.
 *
 * Matrices use the SVG six-value form:
 *
 *     | a c e |
 *     | b d f |
 *     | 0 0 1 |
 */

const EPSILON = 1e-9;

export const IDENTITY = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function multiplyMatrices(left, right) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f
  };
}

export function mapPoint(matrix, x, y) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f
  };
}

/**
 * Invert an affine matrix.  Returns null for a degenerate matrix.  Export uses
 * this to put a generated element back into the coordinate space of the source
 * group it replaces, so ancestor transforms stay untouched.
 */
export function invertMatrix(matrix) {
  const a = Number(matrix?.a) || 0;
  const b = Number(matrix?.b) || 0;
  const c = Number(matrix?.c) || 0;
  const d = Number(matrix?.d) || 0;
  const e = Number(matrix?.e) || 0;
  const f = Number(matrix?.f) || 0;
  const det = a * d - b * c;
  if (!(Math.abs(det) > EPSILON)) return null;
  return {
    a: d / det,
    b: -b / det,
    c: -c / det,
    d: a / det,
    e: (c * f - d * e) / det,
    f: (b * e - a * f) / det
  };
}

/**
 * Parse an SVG `transform` attribute into one matrix.  Transforms are applied
 * left to right, exactly as the attribute specifies.  Returns null when the
 * value contains anything the editor cannot reproduce.
 */
export function parseTransform(value) {
  const text = String(value || '').trim();
  if (!text) return { ...IDENTITY };

  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let matrix = { ...IDENTITY };
  let consumed = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (!/^[\s,]*$/.test(text.slice(consumed, match.index))) return null;
    consumed = pattern.lastIndex;

    const name = match[1];
    const numbers = match[2].trim()
      ? match[2].trim().split(/[\s,]+/).map(Number)
      : [];
    if (!numbers.every(Number.isFinite)) return null;

    let transform = null;
    if (name === 'matrix' && numbers.length === 6) {
      transform = {
        a: numbers[0], b: numbers[1], c: numbers[2],
        d: numbers[3], e: numbers[4], f: numbers[5]
      };
    } else if (name === 'translate' && (numbers.length === 1 || numbers.length === 2)) {
      transform = { a: 1, b: 0, c: 0, d: 1, e: numbers[0], f: numbers[1] || 0 };
    } else if (name === 'scale' && (numbers.length === 1 || numbers.length === 2)) {
      transform = {
        a: numbers[0], b: 0, c: 0,
        d: numbers.length === 1 ? numbers[0] : numbers[1], e: 0, f: 0
      };
    } else if (name === 'rotate' && (numbers.length === 1 || numbers.length === 3)) {
      const angle = numbers[0] * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      transform = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      if (numbers.length === 3) {
        transform = multiplyMatrices(
          multiplyMatrices(
            { a: 1, b: 0, c: 0, d: 1, e: numbers[1], f: numbers[2] },
            transform
          ),
          { a: 1, b: 0, c: 0, d: 1, e: -numbers[1], f: -numbers[2] }
        );
      }
    } else if (name === 'skewX' && numbers.length === 1) {
      transform = { a: 1, b: 0, c: Math.tan(numbers[0] * Math.PI / 180), d: 1, e: 0, f: 0 };
    } else if (name === 'skewY' && numbers.length === 1) {
      transform = { a: 1, b: Math.tan(numbers[0] * Math.PI / 180), c: 0, d: 1, e: 0, f: 0 };
    }
    if (!transform) return null;
    matrix = multiplyMatrices(matrix, transform);
  }

  if (consumed === 0 || !/^[\s,]*$/.test(text.slice(consumed))) return null;
  return matrix;
}

/**
 * Matrix that maps a viewBox into a viewport, including preserveAspectRatio.
 * width/height are the viewport size, as Paper sees it.
 */
export function viewBoxMatrix(viewBox, width, height, preserveAspectRatio) {
  if (!Array.isArray(viewBox) || viewBox.length !== 4) return { ...IDENTITY };
  const [vx, vy, vw, vh] = viewBox;
  if (![vx, vy, vw, vh].every(Number.isFinite) || !(vw > 0) || !(vh > 0)) {
    return { ...IDENTITY };
  }
  const w = Number.isFinite(width) && width > 0 ? width : vw;
  const h = Number.isFinite(height) && height > 0 ? height : vh;

  const tokens = String(preserveAspectRatio || '').trim().split(/\s+/).filter(Boolean);
  let align = tokens[0] || 'xMidYMid';
  if (align === 'defer') align = tokens[1] || 'xMidYMid';
  const slice = tokens.includes('slice');

  if (align === 'none') {
    const e = -vx * (w / vw);
    const f = -vy * (h / vh);
    return {
      a: w / vw, b: 0, c: 0, d: h / vh,
      e: e === 0 ? 0 : e,
      f: f === 0 ? 0 : f
    };
  }

  const scale = slice ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh);
  const alignX = align.startsWith('xMax') ? 1 : align.startsWith('xMid') ? 0.5 : 0;
  const alignY = align.includes('YMax') ? 1 : align.includes('YMid') ? 0.5 : 0;
  const e = (w - vw * scale) * alignX - vx * scale;
  const f = (h - vh * scale) * alignY - vy * scale;
  return {
    a: scale, b: 0, c: 0, d: scale,
    e: e === 0 ? 0 : e,
    f: f === 0 ? 0 : f
  };
}

function normalizeRotation(degrees) {
  let value = degrees % 180;
  if (value < 0) value += 180;
  if (value > 90) value -= 180;
  return Math.abs(value) < 1e-9 ? 0 : value;
}

function transformArc(command, matrix) {
  const rx = Math.abs(Number(command.rx) || 0);
  const ry = Math.abs(Number(command.ry) || 0);
  if (!(rx > EPSILON) || !(ry > EPSILON)) return null;

  const { a, b, c, d } = matrix;
  const det = a * d - b * c;
  if (!(Math.abs(det) > EPSILON)) return null;

  const phi = (Number(command.rotation) || 0) * Math.PI / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const sweep = command.sweep ? 1 : 0;
  const largeArc = command.largeArc ? 1 : 0;

  // Similarity transforms are exact and common: uniform scale, rotation and
  // reflection keep the ellipse's two radii equal to each other's image.
  const columnX = Math.hypot(a, b);
  const columnY = Math.hypot(c, d);
  const dot = a * c + b * d;
  const tolerance = 1e-9 * Math.max(1, columnX * columnY);
  if (Math.abs(columnX - columnY) <= tolerance && Math.abs(dot) <= tolerance) {
    const scale = (columnX + columnY) / 2;
    const angle = Math.atan2(b, a) * 180 / Math.PI;
    const base = Number(command.rotation) || 0;
    // A similarity with a negative determinant is R(angle)·diag(1, -1), so
    // the ellipse's axis angle reflects instead of simply rotating.
    const rotation = det < 0 ? angle - base : angle + base;
    return {
      rx: rx * scale,
      ry: ry * scale,
      rotation: normalizeRotation(rotation),
      largeArc,
      sweep: det < 0 ? 1 - sweep : sweep
    };
  }

  // General affine: the image of the ellipse is still an ellipse.  Its
  // semi-axes are the singular values of L·R(φ)·diag(rx, ry), and the major
  // axis direction is the corresponding eigenvector of that matrix times its
  // transpose.
  const m00 = (a * cos + c * sin) * rx;
  const m01 = (-a * sin + c * cos) * ry;
  const m10 = (b * cos + d * sin) * rx;
  const m11 = (-b * sin + d * cos) * ry;

  const xx = m00 * m00 + m01 * m01;
  const xy = m00 * m10 + m01 * m11;
  const yy = m10 * m10 + m11 * m11;
  const trace = xx + yy;
  const diff = xx - yy;
  const disc = Math.hypot(diff, 2 * xy);
  const major = (trace + disc) / 2;
  const minor = (trace - disc) / 2;
  if (!(major > EPSILON) || !(minor > EPSILON)) return null;

  const rotation = (major - minor) < 1e-9 * major
    ? 0
    : normalizeRotation(0.5 * Math.atan2(2 * xy, diff) * 180 / Math.PI);

  return {
    rx: Math.sqrt(major),
    ry: Math.sqrt(minor),
    rotation,
    largeArc,
    sweep: det < 0 ? 1 - sweep : sweep
  };
}

/**
 * Parse path data into absolute M/L/Q/C/A/Z commands.  H/V become L, S/T
 * reflect their controls.  Returns null for malformed data.
 */
export function parseSvgPath(data) {
  const text = String(data || '');
  const length = text.length;
  let index = 0;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let previousType = null;
  let lastCubicControl = null;
  let lastQuadControl = null;

  const skip = () => {
    while (index < length && /[\s,]/.test(text[index])) index += 1;
  };
  const more = () => {
    skip();
    return index < length && /[0-9+\-.]/.test(text[index]);
  };
  const number = () => {
    skip();
    const match = /^[+-]?(?:(?:\d+\.\d*)|(?:\.\d+)|(?:\d+))(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if (!match) throw new Error('Expected a number');
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new Error('Invalid number');
    return value;
  };
  const flag = () => {
    skip();
    const value = text[index];
    if (value !== '0' && value !== '1') throw new Error('Expected an arc flag');
    index += 1;
    return value === '1' ? 1 : 0;
  };
  const point = (relative) => {
    const x = number();
    const y = number();
    return relative
      ? { x: currentX + x, y: currentY + y }
      : { x, y };
  };
  const resetControls = () => {
    lastCubicControl = null;
    lastQuadControl = null;
  };

  try {
    const out = [];
    while (index < length) {
      skip();
      if (index >= length) break;
      const code = text[index];
      if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(code)) return null;
      index += 1;
      const lower = code.toLowerCase();
      const relative = code === lower;

      if (lower === 'z') {
        out.push({ type: 'Z' });
        currentX = startX;
        currentY = startY;
        previousType = 'Z';
        resetControls();
        continue;
      }

      if (!more()) return null;

      if (lower === 'm') {
        let first = true;
        do {
          const next = point(relative);
          currentX = next.x;
          currentY = next.y;
          if (first) {
            startX = next.x;
            startY = next.y;
            out.push({ type: 'M', x: next.x, y: next.y });
            first = false;
          } else {
            out.push({ type: 'L', x: next.x, y: next.y });
          }
        } while (more());
        previousType = 'M';
        resetControls();
      } else if (lower === 'l') {
        do {
          const next = point(relative);
          currentX = next.x;
          currentY = next.y;
          out.push({ type: 'L', x: next.x, y: next.y });
        } while (more());
        previousType = 'L';
        resetControls();
      } else if (lower === 'h' || lower === 'v') {
        do {
          const value = number();
          if (lower === 'h') {
            currentX = relative ? currentX + value : value;
          } else {
            currentY = relative ? currentY + value : value;
          }
          out.push({ type: 'L', x: currentX, y: currentY });
        } while (more());
        previousType = 'L';
        resetControls();
      } else if (lower === 'c') {
        do {
          const control1 = point(relative);
          const control2 = point(relative);
          const end = point(relative);
          out.push({
            type: 'C',
            x1: control1.x, y1: control1.y,
            x2: control2.x, y2: control2.y,
            x: end.x, y: end.y
          });
          currentX = end.x;
          currentY = end.y;
          lastCubicControl = control2;
          lastQuadControl = null;
          previousType = 'C';
        } while (more());
      } else if (lower === 's') {
        do {
          const control1 = (previousType === 'C' || previousType === 'S') && lastCubicControl
            ? { x: 2 * currentX - lastCubicControl.x, y: 2 * currentY - lastCubicControl.y }
            : { x: currentX, y: currentY };
          const control2 = point(relative);
          const end = point(relative);
          out.push({
            type: 'C',
            x1: control1.x, y1: control1.y,
            x2: control2.x, y2: control2.y,
            x: end.x, y: end.y
          });
          currentX = end.x;
          currentY = end.y;
          lastCubicControl = control2;
          lastQuadControl = null;
          previousType = 'S';
        } while (more());
      } else if (lower === 'q') {
        do {
          const control = point(relative);
          const end = point(relative);
          out.push({
            type: 'Q',
            x1: control.x, y1: control.y,
            x: end.x, y: end.y
          });
          currentX = end.x;
          currentY = end.y;
          lastQuadControl = control;
          lastCubicControl = null;
          previousType = 'Q';
        } while (more());
      } else if (lower === 't') {
        do {
          const control = (previousType === 'Q' || previousType === 'T') && lastQuadControl
            ? { x: 2 * currentX - lastQuadControl.x, y: 2 * currentY - lastQuadControl.y }
            : { x: currentX, y: currentY };
          const end = point(relative);
          out.push({
            type: 'Q',
            x1: control.x, y1: control.y,
            x: end.x, y: end.y
          });
          currentX = end.x;
          currentY = end.y;
          lastQuadControl = control;
          lastCubicControl = null;
          previousType = 'T';
        } while (more());
      } else if (lower === 'a') {
        do {
          const rx = Math.abs(number());
          const ry = Math.abs(number());
          const rotation = number();
          const largeArc = flag();
          const sweep = flag();
          const end = point(relative);
          out.push({
            type: 'A',
            rx, ry, rotation, largeArc, sweep,
            x: end.x, y: end.y
          });
          currentX = end.x;
          currentY = end.y;
        } while (more());
        previousType = 'A';
        resetControls();
      }
    }
    return out;
  } catch (error) {
    return null;
  }
}

/**
 * Apply an affine matrix to absolute path commands.  Arc commands stay arcs:
 * the ellipse is transformed and its sweep flag is inverted when the matrix
 * mirrors the plane.  Degenerate arcs fall back to a straight line.
 */
export function transformCommands(commands, matrix) {
  const m = matrix || { ...IDENTITY };
  const out = [];
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  (Array.isArray(commands) ? commands : []).forEach((command) => {
    if (!command || !command.type) return;
    if (command.type === 'Z') {
      out.push({ type: 'Z' });
      currentX = startX;
      currentY = startY;
      return;
    }

    if (command.type === 'A') {
      const end = mapPoint(m, Number(command.x) || 0, Number(command.y) || 0);
      if (Math.hypot(end.x - currentX, end.y - currentY) < EPSILON) return;
      const arc = transformArc(command, m);
      if (arc) {
        out.push({ type: 'A', ...arc, x: end.x, y: end.y });
      } else {
        out.push({ type: 'L', x: end.x, y: end.y });
      }
      currentX = end.x;
      currentY = end.y;
      return;
    }

    if (command.type === 'M' || command.type === 'L') {
      const point = mapPoint(m, Number(command.x) || 0, Number(command.y) || 0);
      out.push({ type: command.type, x: point.x, y: point.y });
      currentX = point.x;
      currentY = point.y;
      if (command.type === 'M') {
        startX = point.x;
        startY = point.y;
      }
      return;
    }

    if (command.type === 'Q') {
      const control = mapPoint(m, Number(command.x1) || 0, Number(command.y1) || 0);
      const end = mapPoint(m, Number(command.x) || 0, Number(command.y) || 0);
      out.push({ type: 'Q', x1: control.x, y1: control.y, x: end.x, y: end.y });
      currentX = end.x;
      currentY = end.y;
      return;
    }

    if (command.type === 'C') {
      const control1 = mapPoint(m, Number(command.x1) || 0, Number(command.y1) || 0);
      const control2 = mapPoint(m, Number(command.x2) || 0, Number(command.y2) || 0);
      const end = mapPoint(m, Number(command.x) || 0, Number(command.y) || 0);
      out.push({
        type: 'C',
        x1: control1.x, y1: control1.y,
        x2: control2.x, y2: control2.y,
        x: end.x, y: end.y
      });
      currentX = end.x;
      currentY = end.y;
    }
  });

  return out;
}
/**
 * Convert an SVG `rect` / `circle` / `ellipse` through an affine matrix while
 * keeping the editor's primitive types. Returns null when the map cannot be
 * expressed on that type (a tilted rect, elliptical corners from a
 * non-uniform scale, a rotated non-circular ellipse) — the caller then falls
 * back to the path representation.
 */
const PRIMITIVE_TOLERANCE = 1e-6;

export function primitiveShapeGeometry(tag, attrs, matrix) {
  const m = matrix;
  const sx = Math.hypot(m.a, m.b);
  const sy = Math.hypot(m.c, m.d);
  if (!(sx > 0) || !(sy > 0)) return null;
  const scaleRef = Math.max(sx, sy, 1);
  const nearZero = (value) => Math.abs(value) <= PRIMITIVE_TOLERANCE * scaleRef;
  const axisAligned = nearZero(m.b) && nearZero(m.c);
  const swapped = nearZero(m.a) && nearZero(m.d) && !nearZero(m.b) && !nearZero(m.c);
  const conformal = Math.abs(sx - sy) <= PRIMITIVE_TOLERANCE * Math.max(sx, sy) &&
    Math.abs(m.a * m.c + m.b * m.d) <= PRIMITIVE_TOLERANCE * sx * sy;

  if (tag === 'rect') {
    const x = attrs.x, y = attrs.y, width = attrs.width, height = attrs.height;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    if (!axisAligned && !swapped) return null;
    let rx = attrs.rx, ry = attrs.ry;
    const hasRx = Number.isFinite(rx), hasRy = Number.isFinite(ry);
    if (!hasRx && !hasRy) { rx = 0; ry = 0; }
    else if (!hasRy) { ry = rx; }
    else if (!hasRx) { rx = ry; }
    rx = Math.max(0, Math.min(rx, width / 2));
    ry = Math.max(0, Math.min(ry, height / 2));
    const rxDest = swapped ? ry * sy : rx * sx;
    const ryDest = swapped ? rx * sx : ry * sy;
    if (Math.abs(rxDest - ryDest) > PRIMITIVE_TOLERANCE * Math.max(rxDest, ryDest, 1)) return null;
    const p0 = mapPoint(m, x, y);
    const p1 = mapPoint(m, x + width, y + height);
    return {
      type: 'rect',
      x: Math.min(p0.x, p1.x),
      y: Math.min(p0.y, p1.y),
      w: Math.abs(p1.x - p0.x),
      h: Math.abs(p1.y - p0.y),
      rx: rxDest
    };
  }

  if (tag === 'circle' || tag === 'ellipse') {
    const cx = attrs.cx, cy = attrs.cy;
    const rx = tag === 'circle' ? attrs.r : attrs.rx;
    const ry = tag === 'circle' ? attrs.r : attrs.ry;
    if (![cx, cy, rx, ry].every(Number.isFinite) || rx <= 0 || ry <= 0) return null;
    const circular = Math.abs(rx - ry) <= PRIMITIVE_TOLERANCE * Math.max(rx, ry);
    const center = mapPoint(m, cx, cy);
    if (circular) {
      if (conformal) return { type: 'circle', cx: center.x, cy: center.y, r: rx * sx };
      if (axisAligned) return { type: 'ellipse', cx: center.x, cy: center.y, rx: rx * sx, ry: rx * sy };
      if (swapped) return { type: 'ellipse', cx: center.x, cy: center.y, rx: rx * sy, ry: rx * sx };
      return null;
    }
    if (axisAligned) return { type: 'ellipse', cx: center.x, cy: center.y, rx: rx * sx, ry: ry * sy };
    if (swapped) return { type: 'ellipse', cx: center.x, cy: center.y, rx: ry * sy, ry: rx * sx };
    return null;
  }

  return null;
}
