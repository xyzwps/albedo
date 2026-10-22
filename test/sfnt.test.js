import { describe, expect, it } from 'vitest';
import {
  extractSfntFaces,
  isSfntCollection,
  prepareSfntForParsing,
  sanitizeCmap
} from '../lib/sfnt.js';

const pad4 = (n) => n + ((4 - (n % 4)) % 4);

function buildSfnt(tables) {
  const header = 12 + tables.length * 16;
  let cursor = header;
  const placed = tables.map((table) => {
    const at = cursor;
    cursor += pad4(table.data.byteLength);
    return { ...table, at };
  });
  const buffer = new ArrayBuffer(cursor);
  const view = new DataView(buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tables.length);
  placed.forEach((table, i) => {
    const rec = 12 + i * 16;
    for (let j = 0; j < 4; j += 1) view.setUint8(rec + j, table.tag.charCodeAt(j));
    view.setUint32(rec + 8, table.at);
    view.setUint32(rec + 12, table.data.byteLength);
    new Uint8Array(buffer, table.at, table.data.byteLength).set(table.data);
  });
  return buffer;
}

function rebaseSfnt(buffer, delta) {
  const view = new DataView(buffer);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    view.setUint32(rec + 8, view.getUint32(rec + 8) + delta);
  }
  return buffer;
}

function buildTtc(faces) {
  const bodyStart = 12 + faces.length * 4;
  const placed = [];
  let cursor = bodyStart;
  for (const face of faces) {
    placed.push({ buffer: rebaseSfnt(face, cursor), at: cursor });
    cursor += pad4(face.byteLength);
  }
  const out = new ArrayBuffer(cursor);
  const view = new DataView(out);
  for (let i = 0; i < 4; i += 1) view.setUint8(i, 'ttcf'.charCodeAt(i));
  view.setUint32(4, 0x00010000);
  view.setUint32(8, placed.length);
  const bytes = new Uint8Array(out);
  placed.forEach((face, i) => {
    view.setUint32(12 + i * 4, face.at);
    bytes.set(new Uint8Array(face.buffer), face.at);
  });
  return out;
}

/** cmap subtable header: version, numRecords, records, then the subtables. */
function buildCmap(records) {
  const recordBytes = 4 + records.length * 8;
  let cursor = recordBytes;
  const placed = records.map((record) => {
    const offset = cursor;
    cursor += 8;
    return { ...record, offset };
  });
  const data = new Uint8Array(cursor);
  const view = new DataView(data.buffer);
  view.setUint16(2, placed.length);
  placed.forEach((record, i) => {
    const rec = 4 + i * 8;
    view.setUint16(rec, record.platformId);
    view.setUint16(rec + 2, record.encodingId);
    view.setUint32(rec + 4, record.offset);
    view.setUint16(record.offset, record.format);
  });
  return data;
}

function cmapRecords(buffer) {
  const view = new DataView(buffer);
  const numTables = view.getUint16(4);
  let cmapStart = -1;
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    if (view.getUint32(rec + 12) && String.fromCharCode(
      view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3)) === 'cmap') {
      cmapStart = view.getUint32(rec + 8);
    }
  }
  const count = view.getUint16(cmapStart + 2);
  return Array.from({ length: count }, (_, i) => {
    const rec = cmapStart + 4 + i * 8;
    return {
      platformId: view.getUint16(rec),
      encodingId: view.getUint16(rec + 2),
      offset: view.getUint32(rec + 4),
      format: view.getUint16(cmapStart + view.getUint32(rec + 4))
    };
  });
}

describe('isSfntCollection', () => {
  it('recognizes only the ttcf tag', () => {
    expect(isSfntCollection(buildSfnt([{ tag: 'head', data: new Uint8Array(4) }]))).toBe(false);
    expect(isSfntCollection(buildTtc([buildSfnt([{ tag: 'head', data: new Uint8Array(4) }])]))).toBe(true);
  });
});

describe('extractSfntFaces', () => {
  it('passes a standalone sfnt through untouched', () => {
    const buffer = buildSfnt([{ tag: 'head', data: new Uint8Array([1, 2, 3, 4]) }]);
    expect(extractSfntFaces(buffer)).toEqual([buffer]);
  });

  it('rebuilds each collection face with rebased table offsets', () => {
    const first = buildSfnt([
      { tag: 'head', data: new Uint8Array([9, 8, 7, 6]) },
      { tag: 'name', data: new Uint8Array([1, 2, 3, 4, 5]) }
    ]);
    const second = buildSfnt([{ tag: 'head', data: new Uint8Array([17, 18, 19, 20]) }]);
    const faces = extractSfntFaces(buildTtc([first, second]));
    expect(faces).toHaveLength(2);
    faces.forEach((face) => expect(isSfntCollection(face)).toBe(false));

    const tableAt = (buffer, tag) => {
      const view = new DataView(buffer);
      for (let i = 0; i < view.getUint16(4); i += 1) {
        const rec = 12 + i * 16;
        if (String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3)) === tag) {
          return new Uint8Array(buffer, view.getUint32(rec + 8), view.getUint32(rec + 12));
        }
      }
      return null;
    };
    expect(Array.from(tableAt(faces[0], 'head'))).toEqual([9, 8, 7, 6]);
    expect(Array.from(tableAt(faces[0], 'name'))).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(tableAt(faces[1], 'head'))).toEqual([17, 18, 19, 20]);
    expect(new DataView(faces[0]).getUint32(0)).toBe(0x00010000);
  });
});

describe('sanitizeCmap', () => {
  const head = { tag: 'head', data: new Uint8Array(4) };

  it('drops records the parser cannot read and keeps the rest in place', () => {
    const cmap = buildCmap([
      { platformId: 3, encodingId: 1, format: 4 },
      { platformId: 0, encodingId: 3, format: 6 },
      { platformId: 3, encodingId: 10, format: 12 }
    ]);
    const records = cmapRecords(sanitizeCmap(buildSfnt([head, { tag: 'cmap', data: cmap }])));
    expect(records.map((r) => r.format)).toEqual([4, 12]);
    expect(records.map((r) => r.platformId)).toEqual([3, 3]);
  });

  it('keeps a format 0 subtable only under the Mac Roman pairing', () => {
    const kept = buildCmap([{ platformId: 1, encodingId: 0, format: 0 }, { platformId: 3, encodingId: 1, format: 4 }]);
    expect(cmapRecords(sanitizeCmap(buildSfnt([{ tag: 'cmap', data: kept }]))).map((r) => r.format)).toEqual([0, 4]);

    const dropped = buildCmap([{ platformId: 3, encodingId: 1, format: 0 }, { platformId: 3, encodingId: 1, format: 4 }]);
    expect(cmapRecords(sanitizeCmap(buildSfnt([{ tag: 'cmap', data: dropped }]))).map((r) => r.format)).toEqual([4]);
  });

  it('leaves a buffer alone when nothing is unsupported or no cmap exists', () => {
    const all = buildCmap([{ platformId: 0, encodingId: 3, format: 6 }, { platformId: 0, encodingId: 4, format: 2 }]);
    const buffer = buildSfnt([{ tag: 'cmap', data: all }]);
    expect(sanitizeCmap(buffer)).toBe(buffer);
    expect(cmapRecords(buffer)).toHaveLength(2);

    const noCmap = buildSfnt([head]);
    expect(sanitizeCmap(noCmap)).toBe(noCmap);
  });

  it('refuses to rewrite a collection in place', () => {
    const collection = buildTtc([buildSfnt([{ tag: 'cmap', data: buildCmap([{ platformId: 3, encodingId: 1, format: 4 }]) }])]);
    expect(sanitizeCmap(collection)).toBe(collection);
  });
});

describe('prepareSfntForParsing', () => {
  it('unions a collection and sanitizes each face', () => {
    const collection = buildTtc([
      buildSfnt([{ tag: 'cmap', data: buildCmap([{ platformId: 3, encodingId: 1, format: 4 }, { platformId: 0, encodingId: 3, format: 6 }]) }]),
      buildSfnt([{ tag: 'cmap', data: buildCmap([{ platformId: 3, encodingId: 10, format: 12 }]) }])
    ]);
    const faces = prepareSfntForParsing(collection);
    expect(faces).toHaveLength(2);
    expect(cmapRecords(faces[0]).map((r) => r.format)).toEqual([4]);
    expect(cmapRecords(faces[1]).map((r) => r.format)).toEqual([12]);
  });
});
