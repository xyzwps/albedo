import { describe, expect, it } from 'vitest';
import { snapMove, snapResize, snapPoint } from '../lib/snap.js';

const base = (overrides = {}) => ({
  enabled: true,
  threshold: 1.1,
  grid: { enabled: true, size: 8 },
  artboard: { w: 128, h: 128 },
  targets: [],
  points: [],
  ...overrides
});

describe('snapMove', () => {
  it('returns the raw delta when snapping is disabled', () => {
    const result = snapMove({ x: 10, y: 10, w: 20, h: 20 }, 5.5, 0, base({ enabled: false }));
    expect(result).toEqual({ dx: 5.5, dy: 0, guides: [] });
  });

  it('snaps the nearest edge to the grid', () => {
    const result = snapMove({ x: 10, y: 10, w: 20, h: 20 }, 5.5, 0, base());
    expect(result.dx).toBe(6);
    expect(result.dy).toBe(0);
    expect(result.guides).toContainEqual({ axis: 'x', value: 16, kind: 'grid' });
  });

  it('prefers a shape edge over the grid when distances tie', () => {
    const result = snapMove(
      { x: 10, y: 10, w: 20, h: 20 },
      5.5,
      0,
      base({ targets: [{ x: 16, y: 0, w: 10, h: 10 }] })
    );
    expect(result.dx).toBe(6);
    expect(result.guides.find((guide) => guide.axis === 'x')).toEqual({
      axis: 'x', value: 16, kind: 'shape'
    });
  });

  it('does not snap beyond the threshold', () => {
    const result = snapMove(
      { x: 10, y: 10, w: 20, h: 20 },
      4,
      0,
      base({ artboard: null, grid: { enabled: true, size: 10 } })
    );
    expect(result.dx).toBe(4);
    expect(result.guides.some((guide) => guide.axis === 'x')).toBe(false);
  });

  it('snaps both axes independently', () => {
    const result = snapMove({ x: 10, y: 10, w: 20, h: 20 }, 5.5, 5.5, base());
    expect(result.dx).toBe(6);
    expect(result.dy).toBe(6);
    expect(result.guides.map((guide) => guide.axis).sort()).toEqual(['x', 'y']);
  });

  it('snaps the center to another shape center', () => {
    const result = snapMove(
      { x: 0, y: 0, w: 20, h: 20 },
      23.5,
      0,
      base({ grid: { enabled: false, size: 8 }, targets: [{ x: 30, y: 0, w: 7, h: 10 }] })
    );
    expect(result.dx).toBe(23.5);
    expect(result.guides).toContainEqual({ axis: 'x', value: 33.5, kind: 'shape' });
  });

  it('keeps coordinates finite when there is no grid or artboard', () => {
    const result = snapMove({ x: 1, y: 2, w: 3, h: 4 }, 0.5, 0.5, base({ artboard: null, grid: { enabled: false, size: 0 } }));
    expect(result.dx).toBe(0.5);
    expect(result.dy).toBe(0.5);
  });
});

describe('snapResize', () => {
  it('snaps the east handle to the grid and preserves the anchor', () => {
    const result = snapResize({ x: 10, y: 10, w: 21.5, h: 20 }, 'e', base());
    expect(result.bounds.x).toBe(10);
    expect(result.bounds.w).toBe(22);
    expect(result.guides).toContainEqual({ axis: 'x', value: 32, kind: 'grid' });
  });

  it('snaps the west handle without moving the east edge', () => {
    const result = snapResize({ x: 7.5, y: 10, w: 22.5, h: 20 }, 'w', base());
    expect(result.bounds.x).toBe(8);
    expect(result.bounds.x + result.bounds.w).toBe(30);
  });

  it('snaps both axes for a corner handle', () => {
    const result = snapResize({ x: 10, y: 10, w: 22.5, h: 22.5 }, 'se', base());
    expect(result.bounds.w).toBe(22);
    expect(result.bounds.h).toBe(22);
    expect(result.guides.map((guide) => guide.axis).sort()).toEqual(['x', 'y']);
  });

  it('enforces a minimum size', () => {
    const result = snapResize({ x: 10, y: 10, w: 10, h: 10 }, 'e', base(), {});
    expect(result.bounds.w).toBeGreaterThanOrEqual(1);
  });
});

describe('snapPoint', () => {
  it('snaps a point to the grid', () => {
    const result = snapPoint({ x: 15.5, y: 20 }, base());
    expect(result.point.x).toBe(16);
    expect(result.point.y).toBe(20);
  });

  it('prefers another node over the grid', () => {
    const result = snapPoint({ x: 15.5, y: 20 }, base({ points: [{ x: 16, y: 20 }] }));
    expect(result.point).toEqual({ x: 16, y: 20 });
    expect(result.guides).toContainEqual({ axis: 'x', value: 16, kind: 'node' });
  });
});
