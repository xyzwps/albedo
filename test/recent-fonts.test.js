import { describe, expect, it } from 'vitest';
import {
  RECENT_FONTS_KEY,
  orderFonts,
  pushRecentFont,
  readRecentFonts
} from '../lib/recent-fonts.js';

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; }
  };
};

const throwingStorage = () => ({
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); }
});

const font = (postscriptName, family = postscriptName, style = 'Regular') => ({
  postscriptName, family, style
});

const names = (fonts) => fonts.map((item) => item.postscriptName);

describe('readRecentFonts', () => {
  it('returns nothing when the store is empty, absent or unreadable', () => {
    expect(readRecentFonts(memoryStorage())).toEqual([]);
    expect(readRecentFonts(null)).toEqual([]);
    expect(readRecentFonts(throwingStorage())).toEqual([]);
    expect(readRecentFonts(memoryStorage({ [RECENT_FONTS_KEY]: 'not json' }))).toEqual([]);
    expect(readRecentFonts(memoryStorage({ [RECENT_FONTS_KEY]: '{"a":1}' }))).toEqual([]);
  });

  it('drops non-strings, blanks and duplicates', () => {
    const storage = memoryStorage({ [RECENT_FONTS_KEY]: JSON.stringify(['A', '  ', 7, 'A', null, ' B ']) });
    expect(readRecentFonts(storage)).toEqual(['A', 'B']);
  });

  it('caps the list at the limit', () => {
    const storage = memoryStorage({ [RECENT_FONTS_KEY]: JSON.stringify(['a', 'b', 'c', 'd']) });
    expect(readRecentFonts(storage, 2)).toEqual(['a', 'b']);
  });
});

describe('pushRecentFont', () => {
  it('moves the picked font to the front instead of appending it', () => {
    const storage = memoryStorage({ [RECENT_FONTS_KEY]: JSON.stringify(['a', 'b', 'c']) });
    expect(pushRecentFont(storage, 'b')).toEqual(['b', 'a', 'c']);
    expect(JSON.parse(storage.data[RECENT_FONTS_KEY])).toEqual(['b', 'a', 'c']);
  });

  it('keeps the list inside the limit', () => {
    const storage = memoryStorage({ [RECENT_FONTS_KEY]: JSON.stringify(['a', 'b']) });
    expect(pushRecentFont(storage, 'c', 2)).toEqual(['c', 'a']);
  });

  it('ignores a blank pick and survives a blocked store', () => {
    expect(pushRecentFont(memoryStorage(), '   ')).toEqual([]);
    expect(pushRecentFont(throwingStorage(), 'a')).toEqual(['a']);
  });
});

describe('orderFonts', () => {
  const shelves = [font('Zeta', 'Zeta'), font('Alpha', 'Alpha'), font('Mezzo', 'Mezzo')];

  it('sorts alphabetically when nothing is recent', () => {
    expect(names(orderFonts(shelves, []))).toEqual(['Alpha', 'Mezzo', 'Zeta']);
    expect(names(orderFonts(shelves, null))).toEqual(['Alpha', 'Mezzo', 'Zeta']);
  });

  it('lifts recent faces to the top in most-recent order', () => {
    expect(names(orderFonts(shelves, ['Zeta', 'Mezzo']))).toEqual(['Zeta', 'Mezzo', 'Alpha']);
  });

  it('ignores recent names the machine no longer has', () => {
    expect(names(orderFonts(shelves, ['Ghost', 'Alpha']))).toEqual(['Alpha', 'Mezzo', 'Zeta']);
  });

  it('orders faces of one family by style and leaves the input array alone', () => {
    const input = [font('F-Bold', 'F', 'Bold'), font('F-Light', 'F', 'Light'), font('A', 'A')];
    expect(names(orderFonts(input, ['F-Light']))).toEqual(['F-Light', 'A', 'F-Bold']);
    expect(names(input)).toEqual(['F-Bold', 'F-Light', 'A']);
  });
});
