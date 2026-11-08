import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32';
import { DEFAULT_PRINT_NAME, fileSafe, formatName, revisionLabel, unknownTokens } from './naming';
import { buildPdf } from './pdf';
import { readPngDpi, setPngDpi } from './png-dpi';
import { designPlaceholders, fillPlaceholders, parseRoster, personalise, sizeBreakdown, toCsv } from './roster';
import { assignInks, colorDistance, findInks, plateData } from './separations';
import { listZip, safeZipPath, ZipWriter } from './zip';
import { createDocument, createTextLayer } from '@/domain/factory';
import { TEE_CLASSIC } from '@/domain/garments';

describe('crc32', () => {
  it('matches the reference value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('continues across pieces', () => {
    const all = new TextEncoder().encode('hello, world');
    expect(crc32(all.subarray(5), crc32(all.subarray(0, 5)))).toBe(crc32(all));
  });
});

describe('ZIP writer', () => {
  it('writes stored and deflated entries that read back intact', async () => {
    const zip = new ZipWriter();
    const text = 'WOVEXA '.repeat(400);
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    await zip.add('manifest.json', text);
    await zip.add('print/front.png', png);
    await zip.add('print/front.png', png);
    await zip.add('team/001_សុខា_7/front.png', png);
    const bytes = new Uint8Array(await zip.finish().arrayBuffer());
    const entries = listZip(bytes);
    expect(entries.map((e) => e.path)).toEqual(['manifest.json', 'print/front.png', 'print/front-2.png', 'team/001_សុខា_7/front.png']);
    const json = entries[0];
    expect(json.method).toBe(8);
    expect(json.size).toBe(text.length);
    // Local header: 30 bytes plus the name, then the deflated data.
    const v = new DataView(bytes.buffer);
    const nameLen = v.getUint16(json.offset + 26, true);
    const data = bytes.subarray(json.offset + 30 + nameLen, json.offset + 30 + nameLen + json.compressedSize);
    const inflated = inflateRawSync(data);
    expect(new TextDecoder().decode(inflated)).toBe(text);
    expect(crc32(new Uint8Array(inflated))).toBe(json.crc32);
    // PNGs are stored, not deflated again.
    expect(entries[1].method).toBe(0);
    expect(entries[1].size).toBe(png.length);
  });

  it('keeps paths inside the archive', () => {
    expect(safeZipPath('../../etc/passwd')).toBe('etc/passwd');
    expect(safeZipPath('/print\\front:1.png')).toBe('print/front1.png');
    expect(safeZipPath('')).toBe('file');
  });
});

/** A 1 × 1 PNG with IHDR, IDAT and IEND, as a browser would encode it. */
function tinyPng() {
  const hex =
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a3b4c9a40000000049454e44ae426082';
  return new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

describe('PNG resolution', () => {
  it('writes pHYs after IHDR and reads it back', () => {
    const png = tinyPng();
    expect(readPngDpi(png)).toBeNull();
    const out = setPngDpi(png, 300);
    expect(readPngDpi(out)).toBe(300);
    expect(out.length).toBe(png.length + 21);
    // Chunk order: IHDR, pHYs, IDAT.
    expect(new TextDecoder().decode(out.subarray(37, 41))).toBe('pHYs');
  });
  it('replaces an existing pHYs instead of adding a second', () => {
    const twice = setPngDpi(setPngDpi(tinyPng(), 150), 600);
    expect(readPngDpi(twice)).toBe(600);
    expect(twice.length).toBe(tinyPng().length + 21);
  });
  it('writes a valid chunk CRC', () => {
    const out = setPngDpi(tinyPng(), 300);
    const v = new DataView(out.buffer);
    expect(v.getUint32(37 + 4 + 9)).toBe(crc32(out.subarray(37, 37 + 4 + 9)));
  });
});

describe('file naming', () => {
  it('labels the design a file came from', () => {
    expect(revisionLabel(0, 'a1b2c3d4e5', 3)).toBe('v3');
    expect(revisionLabel(12, 'a1b2c3d4e5', null)).toBe('r12');
    expect(revisionLabel(0, 'A1B2C3D4E5', null)).toBe('a1b2c3');
  });
  it('fills tokens and keeps Unicode titles', () => {
    expect(formatName(DEFAULT_PRINT_NAME, { project: 'Dojang 2026', zone: 'front', w: 300, h: 400, dpi: 300, rev: 'r12' })).toBe('Dojang-2026_front_300x400mm_300dpi_r12');
    expect(formatName('{project}_{zone}', { project: 'អាវយឺត ក្លឹប', zone: 'back' })).toBe('អាវយឺត-ក្លឹប_back');
  });
  it('drops empty and unknown tokens and never returns nothing', () => {
    expect(formatName('{name}_{zone}_{oops}', { zone: 'front' })).toBe('front');
    expect(formatName('{name}', {})).toBe('wovexa');
    expect(unknownTokens('{project}_{oops}_{Zone}')).toEqual(['oops']);
  });
  it('strips characters file systems reject', () => {
    expect(fileSafe('a/b\\c:d*e?"f"<g>|h')).toBe('abcdefgh');
  });
});

describe('roster', () => {
  it('reads a header row, quotes and tabs', () => {
    const r = parseRoster('Name\tNo\tSize\nSokha\t7\tM\n"Dara, Jr."\t10\tL\n');
    expect(r.fields).toEqual(['name', 'number', 'size']);
    expect(r.rows).toEqual([
      { name: 'Sokha', number: '7', size: 'M' },
      { name: 'Dara, Jr.', number: '10', size: 'L' },
    ]);
  });
  it('recognises columns without a header', () => {
    const r = parseRoster('7, Sokha, M\n10, Dara, XL\n');
    expect(r.fields).toEqual(['number', 'name', 'size']);
    expect(r.rows[1]).toEqual({ number: '10', name: 'Dara', size: 'XL' });
  });
  it('counts sizes in size order', () => {
    const r = parseRoster('name,size\nA,L\nB,S\nC,L\nD,M\n');
    expect(sizeBreakdown(r)).toEqual([
      { size: 'S', count: 1 },
      { size: 'M', count: 1 },
      { size: 'L', count: 2 },
    ]);
  });
  it('personalises text layers without touching the original', () => {
    const doc = createDocument({ projectId: 'p1', title: 'Team' });
    const layer = createTextLayer(TEE_CLASSIC.zones.back!, '{NAME} #{number}');
    doc.zones.back.layers[layer.id] = layer;
    doc.zones.back.orderedLayerIds.push(layer.id);
    expect(designPlaceholders(doc)).toEqual(['name', 'number']);
    const person = personalise(doc, { name: 'SOKHA', number: '7' });
    const c = person.zones.back.layers[layer.id].content;
    expect(c.kind === 'text' && c.value).toBe('SOKHA #7');
    const original = doc.zones.back.layers[layer.id].content;
    expect(original.kind === 'text' && original.value).toBe('{NAME} #{number}');
    expect(fillPlaceholders('{club} {name}', { name: 'Dara' })).toBe('{club} Dara');
  });
  it('quotes CSV fields that need it', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"']])).toBe('a,"b,c","say ""hi"""\r\n');
  });
});

describe('screen-print separations', () => {
  /** 10 × 10 pixels: 60 red, 30 navy, 4 anti-aliased edge pixels, the rest transparent. */
  function art() {
    const data = new Uint8ClampedArray(100 * 4);
    const put = (i: number, rgb: number[], a = 255) => data.set([...rgb, a], i * 4);
    for (let i = 0; i < 60; i++) put(i, [220, 30, 40]);
    for (let i = 60; i < 90; i++) put(i, [20, 30, 90]);
    for (let i = 90; i < 94; i++) put(i, [210, 40, 45]);
    return data;
  }
  it('finds the inks and folds near shades into them', () => {
    const inks = findInks(art());
    expect(inks).toHaveLength(2);
    expect(inks[0].rgb).toEqual([220, 30, 40]);
    expect(inks[0].share).toBeCloseTo(64 / 94, 3);
    expect(inks[1].hex).toBe('#141E5A');
  });
  it('makes one plate per ink, black where it prints', () => {
    const data = art();
    const inks = findInks(data);
    const index = assignInks(data, inks);
    const red = plateData(data, index, 0);
    const navy = plateData(data, index, 1);
    const any = plateData(data, index, 'any');
    const inked = (p: Uint8ClampedArray) => Array.from({ length: 100 }, (_, i) => p[i * 4 + 3]).filter((a) => a > 0).length;
    expect(inked(red)).toBe(64);
    expect(inked(navy)).toBe(30);
    expect(inked(any)).toBe(94);
    expect(red[0] + red[1] + red[2]).toBe(0);
  });
  it('measures colour distance symmetrically', () => {
    expect(colorDistance([0, 0, 0], [0, 0, 0])).toBe(0);
    expect(colorDistance([10, 200, 30], [200, 10, 30])).toBeCloseTo(colorDistance([200, 10, 30], [10, 200, 30]));
  });
});

describe('PDF writer', () => {
  it('writes a valid structure with a correct cross-reference table', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const blob = buildPdf([{ jpeg, widthPx: 10, heightPx: 7, widthPt: 841.89, heightPt: 595.28 }], { title: 'Proof សាកល្បង' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    // Every object offset in the table points at "n 0 obj".
    const rows = text.slice(startxref).split('\n').slice(3, 9);
    rows.forEach((row, i) => {
      const offset = Number(row.slice(0, 10));
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(text).toContain('/Title <FEFF');
    expect(text).toContain('/Filter /DCTDecode');
  });
});
