import { describe, expect, it } from 'vitest';
import { alignDelta, distributeDeltas, unionBounds } from '../lib/align.js';

describe('unionBounds', () => {
  it('returns null for an empty list', () => {
    expect(unionBounds([])).toBeNull();
  });

  it('unions overlapping and disjoint bounds', () => {
    expect(unionBounds([
      { x: 10, y: 10, w: 20, h: 20 },
      { x: 40, y: 5, w: 10, h: 40 }
    ])).toEqual({ x: 10, y: 5, w: 40, h: 40 });
  });

  it('ignores null entries', () => {
    expect(unionBounds([null, { x: 2, y: 3, w: 4, h: 5 }])).toEqual({ x: 2, y: 3, w: 4, h: 5 });
  });
});

describe('alignDelta', () => {
  const frame = { x: 0, y: 0, w: 100, h: 100 };
  const bounds = { x: 10, y: 20, w: 30, h: 40 };

  it.each([
    ['left', -10, 0],
    ['center', 25, 0],
    ['right', 60, 0],
    ['top', 0, -20],
    ['middle', 0, 10],
    ['bottom', 0, 40]
  ])('aligns %s', (mode, dx, dy) => {
    expect(alignDelta(bounds, frame, mode)).toEqual({ dx, dy });
  });

  it('returns zero for an unknown mode', () => {
    expect(alignDelta(bounds, frame, 'diagonal')).toEqual({ dx: 0, dy: 0 });
  });
});

describe('distributeDeltas', () => {
  it('equalizes horizontal gaps and keeps the outer shapes fixed', () => {
    const entries = [
      { id: 'a', bounds: { x: 0, y: 0, w: 10, h: 10 } },
      { id: 'b', bounds: { x: 30, y: 0, w: 10, h: 10 } },
      { id: 'c', bounds: { x: 100, y: 0, w: 10, h: 10 } }
    ];
    const deltas = distributeDeltas(entries, 'x');
    const byId = Object.fromEntries(deltas.map((delta) => [delta.id, delta]));
    expect(byId.a.dx).toBe(0);
    expect(byId.b.dx).toBe(20);
    expect(byId.c.dx).toBe(0);
  });

  it('equalizes vertical gaps for uneven heights', () => {
    const entries = [
      { id: 'a', bounds: { x: 0, y: 0, w: 10, h: 10 } },
      { id: 'b', bounds: { x: 0, y: 20, w: 10, h: 30 } },
      { id: 'c', bounds: { x: 0, y: 100, w: 10, h: 10 } }
    ];
    const deltas = distributeDeltas(entries, 'y');
    const byId = Object.fromEntries(deltas.map((delta) => [delta.id, delta]));
    expect(byId.a.dy).toBe(0);
    expect(byId.b.dy).toBe(20);
    expect(byId.c.dy).toBe(0);
  });

  it('does nothing with fewer than three entries', () => {
    const entries = [
      { id: 'a', bounds: { x: 0, y: 0, w: 10, h: 10 } },
      { id: 'b', bounds: { x: 30, y: 0, w: 10, h: 10 } }
    ];
    expect(distributeDeltas(entries, 'x')).toEqual([
      { id: 'a', dx: 0, dy: 0 },
      { id: 'b', dx: 0, dy: 0 }
    ]);
  });

  it('is stable when gaps are already equal', () => {
    const entries = [
      { id: 'a', bounds: { x: 0, y: 0, w: 10, h: 10 } },
      { id: 'b', bounds: { x: 20, y: 0, w: 10, h: 10 } },
      { id: 'c', bounds: { x: 40, y: 0, w: 10, h: 10 } }
    ];
    for (const delta of distributeDeltas(entries, 'x')) {
      expect(delta.dx).toBe(0);
      expect(delta.dy).toBe(0);
    }
  });
});
