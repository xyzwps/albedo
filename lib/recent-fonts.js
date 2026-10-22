/**
 * Recently used local fonts.
 *
 * The font picker lists the machine's fonts alphabetically, which buries the
 * handful a project actually uses.  This module keeps a small most-recently-
 * used list (PostScript names, persisted through a Web Storage object) and
 * lifts those faces to the top of the list.
 *
 * Storage is injected and every access is guarded: private-mode browsers can
 * throw on `localStorage`, and a corrupt entry must never break the picker.
 */

export const RECENT_FONTS_KEY = 'albedo-svg-studio:recent-fonts:v1';
export const RECENT_FONTS_LIMIT = 8;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

export function compareFontData(a, b) {
  return String(a.family || '').localeCompare(String(b.family || '')) ||
    String(a.style || '').localeCompare(String(b.style || ''));
}

/** Read the persisted list, dropping anything malformed and over the cap. */
export function readRecentFonts(storage, limit = RECENT_FONTS_LIMIT) {
  let raw = null;
  try {
    raw = storage ? storage.getItem(RECENT_FONTS_KEY) : null;
  } catch (error) {
    return [];
  }
  if (!raw) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = [];
  for (const entry of parsed) {
    const name = text(entry);
    if (name && !seen.includes(name)) seen.push(name);
    if (seen.length >= limit) break;
  }
  return seen;
}

/** Move `postscriptName` to the front and persist the result. */
export function pushRecentFont(storage, postscriptName, limit = RECENT_FONTS_LIMIT) {
  const name = text(postscriptName);
  const next = (name ? [name] : []).concat(readRecentFonts(storage, limit).filter((entry) => entry !== name))
    .slice(0, limit);
  try {
    if (storage) storage.setItem(RECENT_FONTS_KEY, JSON.stringify(next));
  } catch (error) {
    // A full or blocked store only costs the ordering, never the picked font.
  }
  return next;
}

/**
 * Order a font list for display: recent faces first in most-recent order,
 * then everything else alphabetically.  Names in the recent list that the
 * machine no longer has are simply ignored.
 */
export function orderFonts(fonts, recentFonts) {
  const list = (Array.isArray(fonts) ? fonts : []).slice();
  const recent = Array.isArray(recentFonts) ? recentFonts : [];
  if (!recent.length) return list.sort(compareFontData);
  const byRecency = [];
  const rest = [];
  for (const name of recent) {
    const found = list.filter((fontData) => fontData.postscriptName === name);
    if (found.length) byRecency.push(...found);
  }
  const taken = new Set(byRecency);
  for (const fontData of list) if (!taken.has(fontData)) rest.push(fontData);
  return byRecency.concat(rest.sort(compareFontData));
}
