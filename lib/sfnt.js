/**
 * sfnt / TTC byte surgery for local font files.
 *
 * macOS ships most of its system fonts as TrueType Collections (`ttcf`),
 * and opentype.js only parses standalone sfnt buffers.  A collection face
 * cannot simply be sliced out: its table offsets are absolute from the start
 * of the file, so the table directory has to be rebuilt around copied tables.
 *
 * Some fonts also carry cmap subtables (e.g. format 6 under legacy platform 0)
 * that opentype.js refuses outright even though a usable subtable sits next to
 * them.  Dropping unsupported records from the record array is safe — subtable
 * offsets are measured from the table start and the subtables themselves stay
 * in place.
 */

const TABLE_RECORD_SIZE = 16;

function ascii(view, offset, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

export function isSfntCollection(buffer) {
  return ascii(new DataView(buffer), 0, 4) === 'ttcf';
}

/**
 * Rebuild every face of a `ttcf` collection as a standalone sfnt buffer.
 * A non-collection buffer is returned unchanged in a one-element array.
 */
export function extractSfntFaces(buffer) {
  const view = new DataView(buffer);
  if (!isSfntCollection(buffer)) return [buffer];
  const count = view.getUint32(8);
  const faces = [];
  for (let i = 0; i < count; i += 1) {
    const faceStart = view.getUint32(12 + i * 4);
    const numTables = view.getUint16(faceStart + 4);
    const records = [];
    let cursor = 12 + numTables * TABLE_RECORD_SIZE;
    for (let t = 0; t < numTables; t += 1) {
      const rec = faceStart + 12 + t * TABLE_RECORD_SIZE;
      records.push({
        tag: buffer.slice(rec, rec + 4),
        checksum: view.getUint32(rec + 4),
        data: buffer.slice(view.getUint32(rec + 8), view.getUint32(rec + 8) + view.getUint32(rec + 12)),
        at: cursor
      });
      cursor += records[records.length - 1].data.byteLength + ((4 - (records[records.length - 1].data.byteLength % 4)) % 4);
    }
    const out = new ArrayBuffer(cursor);
    const outView = new DataView(out);
    new Uint8Array(out).set(new Uint8Array(buffer, faceStart, 12), 0);
    outView.setUint16(4, numTables);
    records.forEach((record, t) => {
      const rec = 12 + t * TABLE_RECORD_SIZE;
      new Uint8Array(out).set(new Uint8Array(record.tag), rec);
      outView.setUint32(rec + 4, record.checksum);
      outView.setUint32(rec + 8, record.at);
      outView.setUint32(rec + 12, record.data.byteLength);
      new Uint8Array(out).set(new Uint8Array(record.data), record.at);
    });
    faces.push(out);
  }
  return faces;
}

const isSupportedCmapSubtable = (view, cmapStart, offset, platformId, encodingId) => {
  const format = view.getUint16(cmapStart + offset);
  if (format === 4 || format === 12 || format === 14) return true;
  return format === 0 && platformId === 1 && encodingId === 0;
};

/**
 * Remove cmap subtable records the parser cannot read.  Mutates and returns
 * the buffer; buffers without a cmap table pass through.
 */
export function sanitizeCmap(buffer) {
  const view = new DataView(buffer);
  if (isSfntCollection(buffer)) return buffer;
  const numTables = view.getUint16(4);
  let cmapStart = -1;
  for (let t = 0; t < numTables; t += 1) {
    const rec = 12 + t * TABLE_RECORD_SIZE;
    if (ascii(view, rec, 4) === 'cmap') {
      cmapStart = view.getUint32(rec + 8);
      break;
    }
  }
  if (cmapStart < 0) return buffer;
  const count = view.getUint16(cmapStart + 2);
  const kept = [];
  for (let i = 0; i < count; i += 1) {
    const rec = cmapStart + 4 + i * 8;
    const platformId = view.getUint16(rec);
    const encodingId = view.getUint16(rec + 2);
    const offset = view.getUint32(rec + 4);
    if (isSupportedCmapSubtable(view, cmapStart, offset, platformId, encodingId)) {
      kept.push({ platformId, encodingId, offset });
    }
  }
  if (!kept.length || kept.length === count) return buffer;
  kept.forEach((entry, i) => {
    const rec = cmapStart + 4 + i * 8;
    view.setUint16(rec, entry.platformId);
    view.setUint16(rec + 2, entry.encodingId);
    view.setUint32(rec + 4, entry.offset);
  });
  view.setUint16(cmapStart + 2, kept.length);
  return buffer;
}

/**
 * Prepare a (possibly collected) font file for parsing: standalone sfnt
 * buffers with readable cmap records only.
 */
export function prepareSfntForParsing(buffer) {
  return extractSfntFaces(buffer).map(sanitizeCmap);
}
