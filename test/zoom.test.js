import { describe, expect, it } from 'vitest';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_LADDER,
  clampZoom,
  nextZoom,
  wheelZoomFactor,
  zoomPercent
} from '../lib/zoom.js';

describe('clampZoom', () => {
  it('keeps values inside the range untouched', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(1.37)).toBe(1.37);
  });

  it('clamps to the bounds on either side', () => {
    expect(clampZoom(ZOOM_MIN)).toBe(ZOOM_MIN);
    expect(clampZoom(ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(-4)).toBe(ZOOM_MIN);
  });

  it('falls back to fit (1) for non-finite input', () => {
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(ZOOM_MAX);
    expect(clampZoom(-Infinity)).toBe(ZOOM_MIN);
    expect(clampZoom('abc')).toBe(1);
  });

  it('accepts numeric strings within range', () => {
    expect(clampZoom('1.5')).toBe(1.5);
  });
});

describe('ZOOM_LADDER', () => {
  it('contains the fit level and stays within bounds', () => {
    expect(ZOOM_LADDER).toContain(1);
    expect(ZOOM_LADDER[0]).toBe(ZOOM_MIN);
    expect(ZOOM_LADDER[ZOOM_LADDER.length - 1]).toBe(ZOOM_MAX);
  });

  it('is strictly increasing', () => {
    for (let i = 1; i < ZOOM_LADDER.length; i++) {
      expect(ZOOM_LADDER[i]).toBeGreaterThan(ZOOM_LADDER[i - 1]);
    }
  });
});

describe('nextZoom', () => {
  it('walks one ladder step per direction', () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(2, 1)).toBe(2.5);
    expect(nextZoom(2.5, -1)).toBe(2);
  });

  it('jumps to the nearest ladder value above/below an off-ladder zoom', () => {
    expect(nextZoom(1.1, 1)).toBe(1.25);
    expect(nextZoom(1.1, -1)).toBe(1);
    expect(nextZoom(2.2, 1)).toBe(2.5);
    expect(nextZoom(2.2, -1)).toBe(2);
  });

  it('does not stall: stepping up then down across an off-ladder value changes the zoom', () => {
    expect(nextZoom(nextZoom(2.2, 1), -1)).toBe(2);
  });

  it('sticks at the bounds', () => {
    expect(nextZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(nextZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(nextZoom(50, 1)).toBe(ZOOM_MAX);
    expect(nextZoom(0.1, -1)).toBe(ZOOM_MIN);
  });

  it('is a no-op for direction 0', () => {
    expect(nextZoom(1.5, 0)).toBe(1.5);
  });

  it('can walk the whole ladder without skipping or repeating a step', () => {
    const walked = [];
    let zoom = ZOOM_MIN;
    for (let i = 0; i < ZOOM_LADDER.length; i++) {
      walked.push(zoom);
      zoom = nextZoom(zoom, 1);
    }
    expect(walked).toEqual(ZOOM_LADDER);
  });
});

describe('wheelZoomFactor', () => {
  it('shrinks with positive deltaY and grows with negative deltaY', () => {
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
  });

  it('is neutral for zero or invalid delta', () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(NaN)).toBe(1);
  });

  it('is monotonic: a stronger scroll is a stronger zoom-out', () => {
    expect(wheelZoomFactor(50)).toBeGreaterThan(wheelZoomFactor(200));
    expect(wheelZoomFactor(-50)).toBeLessThan(wheelZoomFactor(-200));
  });

  it('bounds one wheel notch so giant deltas cannot jump past the ladder', () => {
    expect(wheelZoomFactor(100000)).toBe(0.5);
    expect(wheelZoomFactor(-100000)).toBe(2);
  });
});

describe('zoomPercent', () => {
  it('renders ladder values as round percentages', () => {
    expect(zoomPercent(1)).toBe('100%');
    expect(zoomPercent(1.25)).toBe('125%');
    expect(zoomPercent(0.6)).toBe('60%');
    expect(zoomPercent(8)).toBe('800%');
  });

  it('rounds continuous wheel zooms to whole percent', () => {
    expect(zoomPercent(1.5624831)).toBe('156%');
    expect(zoomPercent(2.005)).toBe('201%');
  });

  it('labels clamped input at the bounds', () => {
    expect(zoomPercent(20)).toBe('800%');
    expect(zoomPercent(0.1)).toBe('50%');
  });
});
