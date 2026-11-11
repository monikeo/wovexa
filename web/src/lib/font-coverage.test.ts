import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cmapTable, fontFileCoverage, inRanges, mergeRanges, parseCmap, parseUnicodeRange } from './font-coverage';

/** A byte writer for building tiny fonts by hand. */
class Bytes {
  private out: number[] = [];
  u8(v: number) {
    this.out.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v >> 8).u8(v);
  }
  u32(v: number) {
    return this.u16(v >>> 16).u16(v & 0xffff);
  }
  tag(s: string) {
    for (const ch of s) this.u8(ch.charCodeAt(0));
    return this;
  }
  bytes(b: Uint8Array) {
    for (const v of b) this.u8(v);
    return this;
  }
  get length() {
    return this.out.length;
  }
  done() {
    return new Uint8Array(this.out);
  }
}

/** Format 4: A–C by delta, a–c through the glyph array with "b" missing, and the closing 0xFFFF segment. */
function format4() {
  const segX2 = 6;
  const b = new Bytes().u16(4).u16(0).u16(0).u16(segX2).u16(4).u16(1).u16(2);
  b.u16(0x43).u16(0x63).u16(0xffff); // ends
  b.u16(0); // reserved
  b.u16(0x41).u16(0x61).u16(0xffff); // starts
  b.u16(-0x40 & 0xffff).u16(0).u16(1); // deltas: A -> glyph 1
  b.u16(0).u16(4).u16(0); // range offsets: the second segment reads the glyph array that follows
  b.u16(5).u16(0).u16(6); // glyphs for a, b (none), c
  return b.done();
}

/** Format 12: A–C and two emoji. */
function format12() {
  const groups: [number, number, number][] = [
    [0x41, 0x43, 1],
    [0x1f600, 0x1f601, 10],
  ];
  const b = new Bytes().u16(12).u16(0).u32(16 + groups.length * 12).u32(0).u32(groups.length);
  for (const [s, e, g] of groups) b.u32(s).u32(e).u32(g);
  return b.done();
}

function cmapWith(subtables: { platform: number; encoding: number; data: Uint8Array }[]) {
  const b = new Bytes().u16(0).u16(subtables.length);
  let offset = 4 + subtables.length * 8;
  for (const s of subtables) {
    b.u16(s.platform).u16(s.encoding).u32(offset);
    offset += s.data.length;
  }
  for (const s of subtables) b.bytes(s.data);
  return b.done();
}

function sfnt(cmap: Uint8Array, signature = 0x00010000) {
  return new Bytes().u32(signature).u16(1).u16(16).u16(0).u16(0).tag('cmap').u32(0).u32(28).u32(cmap.length).bytes(cmap).done();
}

function woff(cmap: Uint8Array, compress: boolean) {
  const stored = compress ? new Uint8Array(deflateSync(cmap)) : cmap;
  const b = new Bytes().tag('wOFF').u32(0x00010000).u32(64 + stored.length).u16(1).u16(0).u32(12 + 16 + cmap.length).u16(1).u16(0);
  b.u32(0).u32(0).u32(0).u32(0).u32(0); // metadata and private blocks
  b.tag('cmap').u32(64).u32(stored.length).u32(cmap.length).u32(0);
  return b.bytes(stored).done();
}

const covers = (ranges: ReturnType<typeof parseUnicodeRange> | null, ch: string) => !!ranges && inRanges(ranges, ch.codePointAt(0)!);
const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe('unicode ranges', () => {
  it('reads CSS unicode-range lists, wildcards included', () => {
    const r = parseUnicodeRange('U+0-FF, U+131, U+152-153, U+4??');
    expect(covers(r, 'A')).toBe(true);
    expect(covers(r, 'ı')).toBe(true);
    expect(covers(r, 'Œ')).toBe(true);
    expect(covers(r, 'ѐ')).toBe(true);
    expect(covers(r, 'Ā')).toBe(false);
    expect(covers(r, 'ᚠ')).toBe(false);
  });

  it('skips parts that are not ranges', () => {
    expect(parseUnicodeRange('nonsense, U+41, U+4?-50')).toEqual([[0x41, 0x41]]);
    expect(parseUnicodeRange('')).toEqual([]);
  });

  it('merges overlapping and touching ranges', () => {
    expect(
      mergeRanges([
        [10, 20],
        [5, 9],
        [15, 30],
        [40, 41],
      ]),
    ).toEqual([
      [5, 30],
      [40, 41],
    ]);
  });
});

describe('font character maps', () => {
  it('reads a format 4 map, leaving out letters mapped to the missing glyph', () => {
    const ranges = parseCmap(new DataView(buffer(cmapWith([{ platform: 3, encoding: 1, data: format4() }]))));
    expect(['A', 'B', 'C', 'a', 'c'].every((ch) => covers(ranges, ch))).toBe(true);
    expect(covers(ranges, 'b')).toBe(false);
    expect(covers(ranges, 'D')).toBe(false);
    expect(covers(ranges, '￿')).toBe(false);
  });

  it('prefers the full-repertoire format 12 map, which reaches past the basic plane', () => {
    const ranges = parseCmap(
      new DataView(
        buffer(
          cmapWith([
            { platform: 3, encoding: 1, data: format4() },
            { platform: 3, encoding: 10, data: format12() },
          ]),
        ),
      ),
    );
    expect(covers(ranges, '😀')).toBe(true);
    expect(covers(ranges, 'a')).toBe(false); // only in the format 4 map
  });

  it('ignores symbol maps, which say nothing about letters', () => {
    expect(parseCmap(new DataView(buffer(cmapWith([{ platform: 3, encoding: 0, data: format4() }]))))).toBeNull();
  });

  it('finds the map in TTF, OTF and WOFF files, packed or not', async () => {
    const cmap = cmapWith([{ platform: 0, encoding: 3, data: format4() }]);
    for (const file of [sfnt(cmap), sfnt(cmap, 0x4f54544f), woff(cmap, false), woff(cmap, true)]) {
      const ranges = await fontFileCoverage(buffer(file));
      expect(covers(ranges, 'A')).toBe(true);
      expect(covers(ranges, 'b')).toBe(false);
    }
  });

  it('gives up quietly on WOFF2, damaged and truncated files', async () => {
    expect(await cmapTable(buffer(new Bytes().tag('wOF2').u32(0).u32(0).u32(0).done()))).toBeNull();
    expect(await fontFileCoverage(new ArrayBuffer(3))).toBeNull();
    const good = sfnt(cmapWith([{ platform: 3, encoding: 1, data: format4() }]));
    expect(await fontFileCoverage(buffer(good.slice(0, 40)))).toBeNull();
    const lying = good.slice();
    lying[27] = 0xff; // the cmap claims to run past the end of the file
    expect(await fontFileCoverage(buffer(lying))).toBeNull();
  });
});
