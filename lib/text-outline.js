/**
 * Text layers: metrics and outlines.
 *
 * A text shape stores its top-left corner, content, font (by PostScript
 * name) and size.  While editing, the shape is painted with the real font
 * (registered from the local font file) and measured through opentype.js
 * metrics; before that happens a coarse per-character fallback keeps the
 * selection frame sane.
 *
 * On export the text is converted to the editor's own M/L/Q/C/Z command
 * stack so the saved SVG carries geometry, never `<text>` — which is the
 * one thing the logo pipeline refuses to bake.
 */

import opentype from 'opentype.js';
import { prepareSfntForParsing } from './sfnt.js';

/**
 * Parse a local font file (sfnt or ttcf collection) and pick the face whose
 * PostScript name matches, falling back to the first face that parses.
 */
export function parseLocalFont(buffer, postscriptName) {
  const faces = prepareSfntForParsing(buffer);
  let fallback = null;
  for (const face of faces) {
    let font = null;
    try {
      font = opentype.parse(face);
    } catch (error) {
      continue;
    }
    if (postscriptName && font.postscriptName === postscriptName) return { font, faceBuffer: face };
    if (!fallback) fallback = { font, faceBuffer: face };
  }
  if (!fallback) throw new Error('Unparseable font file');
  return fallback;
}

/**
 * Text metrics in user units. `ascent` is the distance from the baseline to
 * the top of the layout box; `height` spans ascent plus (the absolute) descent.
 */
export function measureText(text, fontSize, font) {
  const value = String(text ?? '');
  if (font) {
    const scale = fontSize / (font.unitsPerEm || 1000);
    const ascent = (font.ascender || 0) * scale;
    const descent = (font.descender || 0) * scale;
    const width = font.getAdvanceWidth ? font.getAdvanceWidth(value, fontSize) : 0;
    return {
      width: Math.max(1, width),
      height: Math.max(1, ascent - descent),
      ascent
    };
  }
  let width = 0;
  for (const character of value) {
    width += character.codePointAt(0) > 0x2e7f ? fontSize : fontSize * 0.55;
  }
  return { width: Math.max(1, width), height: fontSize * 1.2, ascent: fontSize * 0.9 };
}

export function textBaselineY(shape, font) {
  return shape.y + measureText(shape.text, shape.fontSize, font).ascent;
}

/**
 * Convert opentype.js path commands into the editor command stack.  The
 * command vocabulary matches one-to-one (M/L/Q/C/Z).
 */
export function outlineCommands(font, text, x, baselineY, fontSize) {
  const path = font.getPath(String(text ?? ''), x, baselineY, fontSize);
  return (Array.isArray(path.commands) ? path.commands : [])
    .map((cmd) => {
      if (cmd.type === 'M' || cmd.type === 'L') return { type: cmd.type, x: cmd.x, y: cmd.y };
      if (cmd.type === 'Q') return { type: 'Q', x1: cmd.x1, y1: cmd.y1, x: cmd.x, y: cmd.y };
      if (cmd.type === 'C') return { type: 'C', x1: cmd.x1, y1: cmd.y1, x2: cmd.x2, y2: cmd.y2, x: cmd.x, y: cmd.y };
      if (cmd.type === 'Z') return { type: 'Z' };
      return null;
    })
    .filter(Boolean);
}
