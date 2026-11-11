/**
 * Which characters a font has, read from the font itself rather than by drawing (spec AST-07):
 * - Catalogue fonts come from Google Fonts in subsets, and each subset declares the characters it
 *   covers (its unicode-range). A character outside every subset of a family isn't in the font.
 * - Uploaded fonts are read directly: the character map (cmap) inside a TTF, OTF or WOFF file
 *   lists every character the font draws. WOFF2 is packed in a way the browser can't unpack for
 *   us, so callers fall back to measuring for those.
 * Everything here is pure apart from inflating WOFF tables, and every reader treats a damaged
 * file as unreadable (null) instead of throwing.
 */

/** Inclusive code point ranges, sorted and merged. */
export type Ranges = readonly (readonly [number, number])[];

const MAX_CODE_POINT = 0x10ffff;
const CMAP = 0x636d6170; // 'cmap'
/** A cmap bigger than this is not a real one (the largest real fonts are well under 1 MB). */
const MAX_CMAP_BYTES = 8 * 1024 * 1024;

/** Sort and merge overlapping or touching ranges, so lookups can binary search. */
export function mergeRanges(ranges: Iterable<readonly [number, number]>): Ranges {
  const sorted = [...ranges].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a && a >= 0).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], Math.min(b, MAX_CODE_POINT));
    else out.push([a, Math.min(b, MAX_CODE_POINT)]);
  }
  return out;
}

export function inRanges(ranges: Ranges, codePoint: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid];
    if (codePoint < a) hi = mid - 1;
    else if (codePoint > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** A CSS unicode-range ("U+0-FF, U+131, U+4??") as ranges. Parts that don't parse are skipped. */
export function parseUnicodeRange(css: string): Ranges {
  const out: [number, number][] = [];
  for (const part of css.split(',')) {
    const m = /^\s*U\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?\s*$/i.exec(part);
    if (!m) continue;
    if (m[1].includes('?')) {
      if (m[2]) continue; // a wildcard can't also have an end
      out.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'f'), 16)]);
    } else {
      const start = parseInt(m[1], 16);
      out.push([start, m[2] ? parseInt(m[2], 16) : start]);
    }
  }
  return mergeRanges(out);
}

async function inflate(bytes: Uint8Array<ArrayBuffer>, expected: number): Promise<DataView | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  return out.byteLength >= expected ? new DataView(out.buffer, 0, expected) : null;
}

/** The cmap table of a TTF or OTF (sfnt) or WOFF file; null when it can't be read here (WOFF2, damaged files). */
export async function cmapTable(buffer: ArrayBuffer): Promise<DataView | null> {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 12) return null;
    const signature = view.getUint32(0);
    if (signature === 0x774f4646 /* wOFF */) {
      if (view.byteLength < 44) return null;
      const numTables = view.getUint16(12);
      for (let i = 0; i < numTables; i++) {
        const rec = 44 + i * 20;
        if (rec + 20 > view.byteLength) return null;
        if (view.getUint32(rec) !== CMAP) continue;
        const offset = view.getUint32(rec + 4);
        const compLength = view.getUint32(rec + 8);
        const origLength = view.getUint32(rec + 12);
        if (offset + compLength > view.byteLength || origLength > MAX_CMAP_BYTES) return null;
        // A table stored as is has the same length packed and unpacked.
        if (compLength >= origLength) return new DataView(buffer, offset, origLength);
        return await inflate(new Uint8Array(buffer, offset, compLength), origLength);
      }
      return null;
    }
    if (signature === 0x00010000 || signature === 0x4f54544f /* OTTO */ || signature === 0x74727565 /* true */) {
      const numTables = view.getUint16(4);
      for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16;
        if (rec + 16 > view.byteLength) return null;
        if (view.getUint32(rec) !== CMAP) continue;
        const offset = view.getUint32(rec + 8);
        const length = view.getUint32(rec + 12);
        if (offset + length > view.byteLength || length > MAX_CMAP_BYTES) return null;
        return new DataView(buffer, offset, length);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Code points with a real glyph (not glyph 0, the "missing" box) in one cmap subtable. */
function readSubtable(t: DataView, o: number, format: number): [number, number][] {
  const out: [number, number][] = [];
  let runStart = -1;
  const mark = (cp: number, has: boolean) => {
    if (has && runStart < 0) runStart = cp;
    else if (!has && runStart >= 0) {
      out.push([runStart, cp - 1]);
      runStart = -1;
    }
  };
  const close = (end: number) => {
    if (runStart >= 0) out.push([runStart, end]);
    runStart = -1;
  };
  if (format === 0) {
    for (let cp = 0; cp < 256; cp++) mark(cp, t.getUint8(o + 6 + cp) !== 0);
    close(255);
  } else if (format === 4) {
    const segX2 = t.getUint16(o + 6);
    const ends = o + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const rangeOffsets = deltas + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      const end = t.getUint16(ends + i * 2);
      const start = t.getUint16(starts + i * 2);
      const delta = t.getUint16(deltas + i * 2);
      const rangeOffset = t.getUint16(rangeOffsets + i * 2);
      if (start > end) continue;
      for (let cp = start; cp <= end; cp++) {
        let glyph: number;
        if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
        else {
          glyph = t.getUint16(rangeOffsets + i * 2 + rangeOffset + (cp - start) * 2);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        mark(cp, glyph !== 0);
      }
      close(end);
    }
  } else if (format === 6) {
    const first = t.getUint16(o + 6);
    const count = t.getUint16(o + 8);
    for (let i = 0; i < count; i++) mark(first + i, t.getUint16(o + 10 + i * 2) !== 0);
    close(first + count - 1);
  } else if (format === 12 || format === 13) {
    const groups = Math.min(t.getUint32(o + 12), 1_000_000);
    for (let i = 0; i < groups; i++) {
      const g = o + 16 + i * 12;
      const start = t.getUint32(g);
      const end = Math.min(t.getUint32(g + 4), MAX_CODE_POINT);
      const glyph = t.getUint32(g + 8);
      if (start > end) continue;
      // Format 12 counts up from the first glyph (only the first can be glyph 0); format 13 maps the whole group to one glyph.
      if (format === 13) {
        if (glyph !== 0) out.push([start, end]);
      } else if (glyph !== 0) out.push([start, end]);
      else if (end > start) out.push([start + 1, end]);
    }
  }
  return out;
}

/** The characters a cmap table maps to real glyphs, from its fullest Unicode subtable; null when it has none readable. */
export function parseCmap(cmap: DataView): Ranges | null {
  try {
    if (cmap.byteLength < 4) return null;
    const count = cmap.getUint16(2);
    const subtables: { platform: number; encoding: number; offset: number; format: number }[] = [];
    for (let i = 0; i < count; i++) {
      const rec = 4 + i * 8;
      if (rec + 8 > cmap.byteLength) break;
      const offset = cmap.getUint32(rec + 4);
      if (offset + 2 > cmap.byteLength) continue;
      subtables.push({ platform: cmap.getUint16(rec), encoding: cmap.getUint16(rec + 2), offset, format: cmap.getUint16(offset) });
    }
    // Unicode maps only (symbol fonts' private maps say nothing about letters), the fullest first.
    const unicode = subtables.filter((s) => s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10)));
    const pick = unicode.find((s) => s.format === 12 || s.format === 13) ?? unicode.find((s) => s.format === 4) ?? unicode.find((s) => s.format === 6 || s.format === 0);
    if (!pick) return null;
    const ranges = mergeRanges(readSubtable(cmap, pick.offset, pick.format));
    return ranges.length ? ranges : null;
  } catch {
    return null;
  }
}

/** The characters a font file draws; null when the file can't be read here (WOFF2 or damaged). */
export async function fontFileCoverage(buffer: ArrayBuffer): Promise<Ranges | null> {
  const table = await cmapTable(buffer);
  return table ? parseCmap(table) : null;
}
