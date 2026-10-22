import { describe, expect, it } from 'vitest';
import {
  ellipsePathData,
  fmt,
  pathData,
  polygonPathData,
  rectPathData,
  shapeToPathData,
  subpathCount
} from '../lib/path.js';

describe('fmt', () => {
  it('rounds to two decimals and normalizes negative zero', () => {
    expect(fmt(1.234)).toBe('1.23');
    expect(fmt(-0.001)).toBe('0');
    expect(fmt(-1.235)).toBe('-1.24');
  });
});

describe('pathData', () => {
  it('serializes every command type', () => {
    const commands = [
      { type: 'M', x: 1, y: 2 },
      { type: 'L', x: 3, y: 4 },
      { type: 'Q', x1: 5, y1: 6, x: 7, y: 8 },
      { type: 'C', x1: 9, y1: 10, x2: 11, y2: 12, x: 13, y: 14 },
      { type: 'A', rx: 15, ry: 16, rotation: 0, largeArc: 1, sweep: 1, x: 17, y: 18 },
      { type: 'Z' }
    ];
    expect(pathData(commands)).toBe(
      'M 1 2 L 3 4 Q 5 6 7 8 C 9 10 11 12 13 14 A 15 16 0 1 1 17 18 Z'
    );
  });

  it('ignores unknown commands and empty input', () => {
    expect(pathData([{ type: 'X' }])).toBe('');
    expect(pathData(null)).toBe('');
  });
});

describe('primitive path data', () => {
  it('serializes an unrounded rectangle', () => {
    expect(rectPathData({ x: 0, y: 0, w: 10, h: 20, rx: 0 })).toBe('M 0 0 H 10 V 20 H 0 Z');
  });

  it('serializes a rounded rectangle with four arcs', () => {
    const d = rectPathData({ x: 0, y: 0, w: 20, h: 10, rx: 3 });
    expect(d.match(/A/g)).toHaveLength(4);
    expect(d).toContain('M 3 0');
    expect(d.endsWith('Z')).toBe(true);
  });

  it('clamps the corner radius', () => {
    const d = rectPathData({ x: 0, y: 0, w: 10, h: 10, rx: 99 });
    expect(d).toContain('A 5 5');
  });

  it('serializes circles and ellipses', () => {
    expect(ellipsePathData({ type: 'circle', cx: 10, cy: 10, r: 5 }))
      .toBe('M 5 10 A 5 5 0 1 0 15 10 A 5 5 0 1 0 5 10 Z');
    expect(ellipsePathData({ type: 'ellipse', cx: 10, cy: 10, rx: 6, ry: 4 }))
      .toBe('M 4 10 A 6 4 0 1 0 16 10 A 6 4 0 1 0 4 10 Z');
  });

  it('serializes polygons and rejects empty ones', () => {
    expect(polygonPathData({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }] }))
      .toBe('M 0 0 L 10 0 L 5 8 Z');
    expect(polygonPathData({ points: [] })).toBe('');
  });
});

describe('shapeToPathData', () => {
  it('routes each filled shape type', () => {
    expect(shapeToPathData({ type: 'rect', x: 0, y: 0, w: 1, h: 1 })).toContain('M 0 0');
    expect(shapeToPathData({ type: 'circle', cx: 0, cy: 0, r: 1 })).toContain('A 1 1');
    expect(shapeToPathData({ type: 'polygon', points: [{ x: 0, y: 0 }] })).toBe('M 0 0 Z');
    expect(shapeToPathData({ type: 'path', commands: [{ type: 'M', x: 0, y: 0 }, { type: 'Z' }] })).toBe('M 0 0 Z');
  });

  it('returns null for lines and unknown shapes', () => {
    expect(shapeToPathData({ type: 'line' })).toBeNull();
    expect(shapeToPathData(null)).toBeNull();
  });

  it('counts subpaths', () => {
    expect(subpathCount('M0 0L1 1ZM2 2L3 3Z')).toBe(2);
  });
});
