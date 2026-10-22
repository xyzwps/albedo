import { describe, expect, it } from 'vitest';
import {
  measureText,
  outlineCommands,
  parseLocalFont,
  textBaselineY
} from '../lib/text-outline.js';

const stubFont = (commands) => ({
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  getAdvanceWidth: (text, size) => size * text.length * 0.5,
  getPath: () => ({ commands })
});

describe('measureText', () => {
  it('uses the font metrics when a parsed font is available', () => {
    const font = {
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      getAdvanceWidth: (text, size) => size * text.length * 0.5
    };
    expect(measureText('abc', 50, font)).toEqual({ width: 75, height: 50, ascent: 40 });
  });

  it('falls back to per-character estimates without a font', () => {
    expect(measureText('AB', 20, null)).toEqual({ width: 22, height: 24, ascent: 18 });
    expect(measureText('字', 20, null)).toEqual({ width: 20, height: 24, ascent: 18 });
  });

  it('never reports a box narrower than one unit', () => {
    expect(measureText('', 20, null).width).toBe(1);
    expect(measureText('a', 20, stubFont([])).width).toBeGreaterThan(0);
  });
});

describe('textBaselineY', () => {
  it('puts the baseline one ascent below the top-left corner', () => {
    expect(textBaselineY({ y: 100, fontSize: 20, text: 'A' }, null)).toBe(118);
    expect(textBaselineY({ y: 100, fontSize: 20, text: 'A' }, { unitsPerEm: 1000, ascender: 500, descender: 0, getAdvanceWidth: () => 1 })).toBe(110);
  });
});

describe('outlineCommands', () => {
  it('maps the opentype command vocabulary onto the editor command stack', () => {
    const font = stubFont([
      { type: 'M', x: 1, y: 2 },
      { type: 'L', x: 3, y: 4 },
      { type: 'Q', x1: 5, y1: 6, x: 7, y: 8 },
      { type: 'C', x1: 9, y1: 10, x2: 11, y2: 12, x: 13, y: 14 },
      { type: 'Z' }
    ]);
    expect(outlineCommands(font, 'A', 0, 0, 10)).toEqual([
      { type: 'M', x: 1, y: 2 },
      { type: 'L', x: 3, y: 4 },
      { type: 'Q', x1: 5, y1: 6, x: 7, y: 8 },
      { type: 'C', x1: 9, y1: 10, x2: 11, y2: 12, x: 13, y: 14 },
      { type: 'Z' }
    ]);
  });

  it('drops command types the editor cannot store', () => {
    const font = stubFont([{ type: 'M', x: 1, y: 2 }, { type: 'B', x: 3, y: 4 }]);
    expect(outlineCommands(font, 'A', 0, 0, 10)).toEqual([{ type: 'M', x: 1, y: 2 }]);
  });

  it('passes the placement through to the glyph path', () => {
    let seen = null;
    const font = { ...stubFont([]), getPath: (text, x, y, size) => { seen = { text, x, y, size }; return { commands: [] }; } };
    outlineCommands(font, 'Hi', 12, 34, 56);
    expect(seen).toEqual({ text: 'Hi', x: 12, y: 34, size: 56 });
  });
});

describe('parseLocalFont', () => {
  it('rejects a buffer that carries no parsable face', () => {
    expect(() => parseLocalFont(new ArrayBuffer(12), 'Helvetica')).toThrow(/Unparseable font file/);
  });
});
