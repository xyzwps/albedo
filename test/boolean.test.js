import { describe, expect, it } from 'vitest';
import { booleanOperands } from '../lib/boolean.js';
import { ellipsePathData, rectPathData, shapeToPathData } from '../lib/path.js';

const rect = (x, y, w, h) => ({ d: rectPathData({ x, y, w, h, rx: 0 }) });
const circle = (cx, cy, r) => ({ d: ellipsePathData({ type: 'circle', cx, cy, r }) });
const sortedTypes = (commands) => [...new Set(commands.map((cmd) => cmd.type))].sort();

describe('booleanOperands', () => {
  const a = rect(10, 10, 50, 50);
  const b = rect(40, 40, 50, 50);

  it('unites overlapping rectangles', () => {
    const result = booleanOperands([a, b], 'unite');
    expect(result.area).toBeCloseTo(4600, 3);
    expect(result.commands.filter((cmd) => cmd.type === 'M')).toHaveLength(1);
    expect(result.commands.at(-1).type).toBe('Z');
  });

  it('subtracts the top rectangle from the bottom one', () => {
    const result = booleanOperands([a, b], 'subtract');
    expect(result.area).toBeCloseTo(2100, 3);
    expect(result.commands.filter((cmd) => cmd.type === 'M')).toHaveLength(1);
  });

  it('intersects overlapping rectangles', () => {
    const result = booleanOperands([a, b], 'intersect');
    expect(result.area).toBeCloseTo(400, 3);
  });

  it('excludes the overlap and keeps both outer regions', () => {
    const result = booleanOperands([a, b], 'exclude');
    expect(result.area).toBeCloseTo(4200, 3);
    expect(result.commands.filter((cmd) => cmd.type === 'M')).toHaveLength(2);
  });

  it('returns null for an empty intersection', () => {
    expect(booleanOperands([rect(0, 0, 10, 10), rect(50, 50, 10, 10)], 'intersect')).toBeNull();
  });

  it('supports elliptical arcs and emits cubic curves', () => {
    const result = booleanOperands([circle(40, 40, 30), circle(60, 40, 30)], 'unite');
    expect(result).not.toBeNull();
    expect(result.area).toBeGreaterThan(4000);
    expect(result.commands.some((cmd) => cmd.type === 'C')).toBe(true);
    expect(sortedTypes(result.commands)).toContain('M');
    expect(sortedTypes(result.commands)).toContain('Z');
  });

  it('supports quadratic curves', () => {
    const quad = { d: 'M 0 0 Q 50 -60 100 0 L 100 100 L 0 100 Z' };
    const result = booleanOperands([quad, rect(20, 20, 20, 20)], 'unite');
    expect(result).not.toBeNull();
    expect(result.commands.some((cmd) => cmd.type === 'C' || cmd.type === 'Q')).toBe(true);
    expect(result.area).toBeGreaterThan(5000);
  });

  it('produces a hole as a second contour', () => {
    const result = booleanOperands([rect(0, 0, 100, 100), rect(25, 25, 50, 50)], 'subtract');
    expect(result.commands.filter((cmd) => cmd.type === 'M')).toHaveLength(2);
    expect(result.area).toBeCloseTo(7500, 3);
    expect(['nonzero', 'evenodd']).toContain(result.fillRule);
  });

  it('honours evenodd input paths', () => {
    const outer = 'M 0 0 H 100 V 100 H 0 Z';
    const inner = 'M 25 25 H 75 V 75 H 25 Z';
    const donut = { d: outer + ' ' + inner, fillRule: 'evenodd' };
    const result = booleanOperands([donut, rect(0, 0, 100, 20)], 'subtract');
    expect(result).not.toBeNull();
    expect(result.commands.filter((cmd) => cmd.type === 'M').length).toBeGreaterThanOrEqual(2);
  });

  it('closes open subpaths for area operations', () => {
    const open = { d: 'M 0 0 L 40 0 L 40 40 L 0 40' };
    const result = booleanOperands([open, rect(10, 10, 20, 20)], 'unite');
    expect(result).not.toBeNull();
    expect(result.area).toBeCloseTo(1600, 3);
  });

  it('applies more than two operands in order', () => {
    const result = booleanOperands([rect(0, 0, 20, 20), rect(10, 0, 20, 20), rect(20, 0, 20, 20)], 'unite');
    expect(result.area).toBeCloseTo(800, 3);
  });

  it('accepts editor shapes through shapeToPathData', () => {
    const shape = { type: 'rect', x: 0, y: 0, w: 10, h: 10, rx: 2 };
    const result = booleanOperands([{ d: shapeToPathData(shape) }, rect(5, 5, 10, 10)], 'unite');
    expect(result).not.toBeNull();
    expect(result.area).toBeGreaterThan(100);
  });

  it('rejects invalid input', () => {
    expect(() => booleanOperands([a], 'unite')).toThrow(/two operands/i);
    expect(() => booleanOperands([a, b], 'merge')).toThrow(/unknown boolean/i);
    expect(() => booleanOperands([{ d: '' }, b], 'unite')).toThrow(/empty path/i);
  });

  it('emits finite coordinates only', () => {
    const result = booleanOperands([a, b], 'unite');
    const values = result.commands.flatMap((cmd) => [cmd.x, cmd.y, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.rx, cmd.ry]);
    values.filter((value) => value !== undefined).forEach((value) => expect(Number.isFinite(value)).toBe(true));
  });
});
