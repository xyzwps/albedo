import { describe, expect, it } from 'vitest';
import {
  invertMatrix,
  multiplyMatrices,
  parseSvgPath,
  parseTransform,
  primitiveShapeGeometry,
  transformCommands,
  viewBoxMatrix
} from '../lib/svg-path.js';

const apply = (matrix, point) => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.e,
  y: matrix.b * point.x + matrix.d * point.y + matrix.f
});

/** SVG 1.1 F.6.5 endpoint -> centre parameterization, for verification. */
function arcCentre(start, command) {
  const phi = command.rotation * Math.PI / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (start.x - command.x) / 2;
  const dy = (start.y - command.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let rx = Math.abs(command.rx);
  let ry = Math.abs(command.ry);
  const lambda = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const denominator = rx2 * y1 * y1 + ry2 * x1 * x1;
  const sign = (command.largeArc ? 1 : 0) !== (command.sweep ? 1 : 0) ? 1 : -1;
  const radicand = rx2 * ry2 - rx2 * y1 * y1 - ry2 * x1 * x1;
  const coefficient = sign * Math.sqrt(Math.max(0, radicand / denominator));
  const cxp = coefficient * (rx * y1 / ry);
  const cyp = -coefficient * (ry * x1 / rx);
  const cx = cos * cxp - sin * cyp + (start.x + command.x) / 2;
  const cy = sin * cxp + cos * cyp + (start.y + command.y) / 2;
  const ux = (x1 - cxp) / rx;
  const uy = (y1 - cyp) / ry;
  const vx = (-x1 - cxp) / rx;
  const vy = (-y1 - cyp) / ry;
  let delta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!command.sweep && delta > 0) delta -= Math.PI * 2;
  if (command.sweep && delta < 0) delta += Math.PI * 2;
  return { cx, cy, rx, ry, phi, theta1: Math.atan2(uy, ux), delta };
}

function arcPoint(arc, fraction) {
  const theta = arc.theta1 + arc.delta * fraction;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: arc.cx + arc.rx * cos * Math.cos(arc.phi) - arc.ry * sin * Math.sin(arc.phi),
    y: arc.cy + arc.rx * cos * Math.sin(arc.phi) + arc.ry * sin * Math.cos(arc.phi)
  };
}

describe('parseSvgPath', () => {
  it('normalizes relative commands, H/V, implicit repeats and Z', () => {
    expect(parseSvgPath('M10 10 h20 v20 h-20 z')).toEqual([
      { type: 'M', x: 10, y: 10 },
      { type: 'L', x: 30, y: 10 },
      { type: 'L', x: 30, y: 30 },
      { type: 'L', x: 10, y: 30 },
      { type: 'Z' }
    ]);
  });

  it('reflects S and T control points', () => {
    expect(parseSvgPath('M0 0 C 10 0 20 0 30 0 S 50 0 60 0')).toEqual([
      { type: 'M', x: 0, y: 0 },
      { type: 'C', x1: 10, y1: 0, x2: 20, y2: 0, x: 30, y: 0 },
      { type: 'C', x1: 40, y1: 0, x2: 50, y2: 0, x: 60, y: 0 }
    ]);
    expect(parseSvgPath('M0 0 Q 10 10 20 0 T 40 0')).toEqual([
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 10, y1: 10, x: 20, y: 0 },
      { type: 'Q', x1: 30, y1: -10, x: 40, y: 0 }
    ]);
  });

  it('continues after Z into the next subpath', () => {
    expect(parseSvgPath('M 0 0 L 1 1 Z M 2 2 L 3 3 Z').map((command) => command.type))
      .toEqual(['M', 'L', 'Z', 'M', 'L', 'Z']);
  });

  it('reflects controls across implicit S and T repeats', () => {
    expect(parseSvgPath('M0 0 S 10 10 20 0 30 10 40 0')).toEqual([
      { type: 'M', x: 0, y: 0 },
      { type: 'C', x1: 0, y1: 0, x2: 10, y2: 10, x: 20, y: 0 },
      { type: 'C', x1: 30, y1: -10, x2: 30, y2: 10, x: 40, y: 0 }
    ]);
    expect(parseSvgPath('M0 0 Q 10 10 20 0 T 30 10 T 40 0')).toEqual([
      { type: 'M', x: 0, y: 0 },
      { type: 'Q', x1: 10, y1: 10, x: 20, y: 0 },
      { type: 'Q', x1: 30, y1: -10, x: 30, y: 10 },
      { type: 'Q', x1: 30, y1: 30, x: 40, y: 0 }
    ]);
  });

  it('reads compact arc flags', () => {
    expect(parseSvgPath('M 0 0 A 30 50 0 01162.55 162.45')).toEqual([
      { type: 'M', x: 0, y: 0 },
      {
        type: 'A', rx: 30, ry: 50, rotation: 0,
        largeArc: 0, sweep: 1, x: 162.55, y: 162.45
      }
    ]);
  });

  it('returns null for malformed data', () => {
    expect(parseSvgPath('M 0 0 A 10 10 0 2 0 20 20')).toBeNull();
    expect(parseSvgPath('M 0 0 L 10')).toBeNull();
    expect(parseSvgPath('hello')).toBeNull();
  });
});

describe('parseTransform', () => {
  it('multiplies transforms left to right', () => {
    const matrix = parseTransform('translate(10 20) rotate(90) scale(2)');
    expect(matrix).not.toBeNull();
    expect(apply(matrix, { x: 0, y: 0 }).x).toBeCloseTo(10, 10);
    expect(apply(matrix, { x: 0, y: 0 }).y).toBeCloseTo(20, 10);
    expect(apply(matrix, { x: 1, y: 0 }).x).toBeCloseTo(10, 10);
    expect(apply(matrix, { x: 1, y: 0 }).y).toBeCloseTo(22, 10);
  });

  it('supports matrix, rotate about a point and skew', () => {
    expect(parseTransform('matrix(1 2 3 4 5 6)')).toEqual({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 });
    const rotated = parseTransform('rotate(90 10 10)');
    expect(apply(rotated, { x: 10, y: 10 }).x).toBeCloseTo(10, 10);
    expect(apply(rotated, { x: 20, y: 10 }).x).toBeCloseTo(10, 10);
    expect(apply(rotated, { x: 20, y: 10 }).y).toBeCloseTo(20, 10);
    const skewed = parseTransform('skewX(45)');
    expect(apply(skewed, { x: 0, y: 10 }).x).toBeCloseTo(10, 10);
  });

  it('rejects unknown or malformed transforms', () => {
    expect(parseTransform('translate(1 2) bogus(3)')).toBeNull();
    expect(parseTransform('scale(1 2 3)')).toBeNull();
    expect(parseTransform('translate(1 2) junk')).toBeNull();
  });
});

describe('viewBoxMatrix', () => {
  it('translates a viewBox with a non-zero origin', () => {
    expect(viewBoxMatrix([10, 20, 100, 100], 100, 100, '')).toEqual({
      a: 1, b: 0, c: 0, d: 1, e: -10, f: -20
    });
  });

  it('stretches with preserveAspectRatio="none"', () => {
    expect(viewBoxMatrix([0, 0, 100, 100], 200, 50, 'none')).toEqual({
      a: 2, b: 0, c: 0, d: 0.5, e: 0, f: 0
    });
  });

  it('centres a meet fit', () => {
    const matrix = viewBoxMatrix([0, 0, 100, 50], 100, 100, 'xMidYMid meet');
    expect(matrix.a).toBeCloseTo(1, 10);
    expect(matrix.d).toBeCloseTo(1, 10);
    expect(matrix.e).toBeCloseTo(0, 10);
    expect(matrix.f).toBeCloseTo(25, 10);
  });
});

describe('transformCommands', () => {
  const source = parseSvgPath('M 10 20 A 40 20 35 1 0 100 80');

  it('keeps arc parameters under translation', () => {
    const commands = transformCommands(source, { a: 1, b: 0, c: 0, d: 1, e: 7, f: -3 });
    expect(commands[1]).toMatchObject({
      type: 'A', rx: 40, ry: 20, rotation: 35,
      largeArc: 1, sweep: 0, x: 107, y: 77
    });
  });

  it('scales both radii under a uniform scale', () => {
    const commands = transformCommands(source, { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
    expect(commands[1]).toMatchObject({ type: 'A', rx: 80, ry: 40, rotation: 35, x: 200, y: 160 });
  });

  it('mirrors the ellipse and flips the sweep flag', () => {
    const commands = transformCommands(source, { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(commands[1].type).toBe('A');
    expect(commands[1].sweep).toBe(1);
    expect(commands[1].rotation).toBeCloseTo(-35, 10);
  });

  it('keeps the transformed geometry under a general affine map', () => {
    const matrix = { a: 1.5, b: 0.4, c: -0.3, d: 0.8, e: 10, f: -5 };
    const commands = transformCommands(source, matrix);
    expect(commands[1].type).toBe('A');

    const original = arcCentre({ x: source[0].x, y: source[0].y }, source[1]);
    const transformed = arcCentre({ x: commands[0].x, y: commands[0].y }, commands[1]);
    for (let index = 0; index <= 100; index += 1) {
      const expected = apply(matrix, arcPoint(original, index / 100));
      const actual = arcPoint(transformed, index / 100);
      expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(1e-9);
    }
  });

  it('falls back to a line when the matrix collapses the ellipse', () => {
    const commands = transformCommands(source, { a: 0, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(commands[1]).toMatchObject({ type: 'L', x: 0, y: 80 });
  });

  it('omits zero-length arcs the way SVG does', () => {
    const commands = transformCommands(parseSvgPath('M 10 10 A 5 5 0 0 1 10 10'), { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(commands).toEqual([{ type: 'M', x: 10, y: 10 }]);
  });
});
describe('primitiveShapeGeometry', () => {
  const T = (e, f) => ({ a: 1, b: 0, c: 0, d: 1, e, f });
  const S = (sx, sy = sx) => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
  const ROT90 = (cx, cy) => ({ a: 0, b: 1, c: -1, d: 0, e: cx + cy, f: cy - cx });
  const ROT45 = { a: Math.SQRT1_2, b: Math.SQRT1_2, c: -Math.SQRT1_2, d: Math.SQRT1_2, e: 0, f: 0 };

  it('maps an axis-aligned rect through a translation', () => {
    expect(primitiveShapeGeometry('rect', { x: 10, y: 20, width: 30, height: 40 }, T(5, -5)))
      .toEqual({ type: 'rect', x: 15, y: 15, w: 30, h: 40, rx: 0 });
  });

  it('scales rect geometry and radius uniformly', () => {
    expect(primitiveShapeGeometry('rect', { x: 0, y: 0, width: 32, height: 64, rx: 4 }, S(2)))
      .toEqual({ type: 'rect', x: 0, y: 0, w: 64, h: 128, rx: 8 });
  });

  it('keeps a square-cornered rect under non-uniform scale', () => {
    expect(primitiveShapeGeometry('rect', { x: 10, y: 10, width: 20, height: 30 }, S(2, 3)))
      .toEqual({ type: 'rect', x: 20, y: 30, w: 40, h: 90, rx: 0 });
  });

  it('drops to null when a rounded rect gets elliptical corners', () => {
    expect(primitiveShapeGeometry('rect', { x: 0, y: 0, width: 20, height: 20, rx: 5 }, S(2, 1))).toBeNull();
    expect(primitiveShapeGeometry('rect', { x: 0, y: 0, width: 20, height: 20, rx: 4, ry: 2 }, S(2, 2))).toBeNull();
  });

  it('applies SVG radius inheritance and clamping before the map', () => {
    // rx alone means ry = rx, so a square-ish radius survives a mirror.
    const flipped = { a: -1, b: 0, c: 0, d: 1, e: 100, f: 0 };
    expect(primitiveShapeGeometry('rect', { x: 0, y: 0, width: 20, height: 40, rx: 6 }, flipped))
      .toEqual({ type: 'rect', x: 80, y: 0, w: 20, h: 40, rx: 6 });
    // Clamping to the half-side happens per axis, so rx=30 on a 10x40 rect
    // really draws elliptical corners (5 vs 20) the rect type cannot hold.
    expect(primitiveShapeGeometry('rect', { x: 0, y: 0, width: 10, height: 40, rx: 30 }, flipped)).toBeNull();
  });

  it('keeps a rect rotated by a right angle, swapping its sides', () => {
    expect(primitiveShapeGeometry('rect', { x: 20, y: 30, width: 40, height: 20 }, ROT90(64, 64)))
      .toEqual({ type: 'rect', x: 78, y: 20, w: 20, h: 40, rx: 0 });
  });

  it('drops a rotated or sheared rect to null', () => {
    expect(primitiveShapeGeometry('rect', { x: 0, y: 0, width: 10, height: 10 }, ROT45)).toBeNull();
    expect(primitiveShapeGeometry('rect', { x: 0, y: 0, width: 10, height: 10 },
      { a: 1, b: 0, c: 0.5, d: 1, e: 0, f: 0 })).toBeNull();
  });

  it('rejects degenerate rects and non-finite attributes', () => {
    expect(primitiveShapeGeometry('rect', { x: 0, y: 0, width: 0, height: 10 }, T(0, 0))).toBeNull();
    expect(primitiveShapeGeometry('rect', { x: 0, y: 0, width: NaN, height: 10 }, T(0, 0))).toBeNull();
  });

  it('keeps a circle conformal, including rotation', () => {
    const rotated = primitiveShapeGeometry('circle', { cx: 10, cy: 20, r: 5 }, ROT45);
    expect(rotated.type).toBe('circle');
    expect(rotated.r).toBeCloseTo(5, 9);
    expect(primitiveShapeGeometry('circle', { cx: 0, cy: 0, r: 10 }, S(2.5)))
      .toEqual({ type: 'circle', cx: 0, cy: 0, r: 25 });
  });

  it('turns a stretched circle into an ellipse', () => {
    expect(primitiveShapeGeometry('circle', { cx: 10, cy: 10, r: 5 }, S(2, 4)))
      .toEqual({ type: 'ellipse', cx: 20, cy: 40, rx: 10, ry: 20 });
  });

  it('swaps an ellipse rotated by a right angle', () => {
    expect(primitiveShapeGeometry('ellipse', { cx: 40, cy: 64, rx: 20, ry: 10 }, ROT90(64, 64)))
      .toEqual({ type: 'ellipse', cx: 64, cy: 40, rx: 10, ry: 20 });
  });

  it('drops a tilted ellipse to null but keeps its circular form', () => {
    expect(primitiveShapeGeometry('ellipse', { cx: 0, cy: 0, rx: 20, ry: 10 }, ROT45)).toBeNull();
    const circleForm = primitiveShapeGeometry('ellipse', { cx: 0, cy: 0, rx: 20, ry: 20 }, ROT45);
    expect(circleForm.type).toBe('circle');
    expect(circleForm.r).toBeCloseTo(20, 9);
  });

  it('drops to null on a singular matrix or unknown tag', () => {
    expect(primitiveShapeGeometry('circle', { cx: 0, cy: 0, r: 5 }, { a: 0, b: 0, c: 0, d: 0, e: 1, f: 1 })).toBeNull();
    expect(primitiveShapeGeometry('polygon', { cx: 0, cy: 0 }, T(0, 0))).toBeNull();
  });
});


describe('affine inverses', () => {
  it('inverts a matrix and composes back to identity', () => {
    const matrix = { a: 2, b: 0.5, c: -1, d: 3, e: 10, f: -4 };
    const inverse = invertMatrix(matrix);
    expect(inverse).not.toBeNull();
    const product = multiplyMatrices(matrix, inverse);
    expect(product.a).toBeCloseTo(1, 9);
    expect(product.b).toBeCloseTo(0, 9);
    expect(product.c).toBeCloseTo(0, 9);
    expect(product.d).toBeCloseTo(1, 9);
    expect(product.e).toBeCloseTo(0, 9);
    expect(product.f).toBeCloseTo(0, 9);
  });

  it('returns null for a singular matrix', () => {
    expect(invertMatrix({ a: 0, b: 0, c: 0, d: 0, e: 4, f: 4 })).toBeNull();
  });
});
