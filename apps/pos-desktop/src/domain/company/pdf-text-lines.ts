/**
 * Pure helper that reconstructs visual text lines from pdf.js text items.
 *
 * The DIAN RUT is a FORM, not flowing text: labels and values live at
 * different positions and the raw content stream order does not follow the
 * visual reading order. Grouping items by their vertical position (Y) and
 * sorting each row by X restores the layout a human sees, which is what
 * the RUT parser expects.
 *
 * Framework-free and pdf.js-free: works with any item shaped like
 * `{ str, transform }` so it runs in the browser bundle and in Node tests.
 */

export interface PdfTextItem {
  str: string;
  /** pdf.js transform matrix — [a, b, c, d, e, f]; e = x, f = y. */
  transform: readonly number[];
}

/** Vertical tolerance (PDF units) for two items to share a line. */
const LINE_TOLERANCE = 3;

/**
 * Build visually ordered lines from raw text items.
 *
 * Items whose Y coordinates fall within `LINE_TOLERANCE` become one line,
 * sorted left-to-right and joined with single spaces.
 */
export function buildTextLines(items: readonly PdfTextItem[]): string[] {
  const positioned = items
    .filter((item) => item.str && item.str.trim().length > 0)
    .map((item) => ({
      str: item.str,
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
    }));

  if (positioned.length === 0) return [];

  // Sort top-to-bottom (PDF Y grows upward, so descending), then left-to-right.
  positioned.sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const lines: string[][] = [];
  let currentLine: typeof positioned = [];
  let currentY = positioned[0].y;

  for (const item of positioned) {
    if (Math.abs(item.y - currentY) > LINE_TOLERANCE) {
      if (currentLine.length > 0) lines.push(currentLine.map((i) => i.str));
      currentLine = [];
      currentY = item.y;
    }
    currentLine.push(item);
  }
  if (currentLine.length > 0) lines.push(currentLine.map((i) => i.str));

  return lines.map((parts) => parts.join(' ').replace(/\s+/g, ' ').trim());
}