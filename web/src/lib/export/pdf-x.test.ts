import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildPdfX, cmykRaster, rgbToCmyk } from './pdf-x';

/** A 2D context stand-in that serves pixels from an RGBA array. */
function fakeContext(width: number, rgba: number[]) {
  return {
    getImageData: (_x: number, y: number, w: number, rows: number) => ({ data: new Uint8ClampedArray(rgba.slice(y * width * 4, (y + rows) * width * 4)) }),
  } as unknown as CanvasRenderingContext2D;
}

const joined = (parts: Uint8Array[]) => Buffer.concat(parts.map((p) => Buffer.from(p)));

describe('CMYK conversion', () => {
  it('prints white as no ink, black and greys in black alone, and pure colours in their inks', () => {
    expect(rgbToCmyk(255, 255, 255)).toEqual([0, 0, 0, 0]);
    expect(rgbToCmyk(0, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(rgbToCmyk(128, 128, 128)).toEqual([0, 0, 0, 127]);
    expect(rgbToCmyk(255, 0, 0)).toEqual([0, 255, 255, 0]);
    expect(rgbToCmyk(0, 0, 128)).toEqual([255, 255, 0, 127]);
  });

  it('never goes over 300% total ink', () => {
    for (let i = 0; i < 2000; i++) {
      const [c, m, y, k] = rgbToCmyk((i * 37) % 256, (i * 91) % 256, (i * 53) % 256);
      expect(c + m + y + k).toBeLessThanOrEqual(3 * 255);
      expect(Math.min(c, m, y)).toBe(0);
    }
  });
});

describe('CMYK raster', () => {
  it('masks out where nothing prints and thins the ink of soft edges', async () => {
    // Row 0: transparent, solid red, half-transparent red. Row 1: solid black, white, transparent.
    const rgba = [0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 128, 0, 0, 0, 255, 255, 255, 255, 255, 9, 9, 9, 0];
    const raster = await cmykRaster(fakeContext(3, rgba), 3, 2, 1);
    const cmyk = inflateSync(joined(raster.cmyk));
    expect([...cmyk.subarray(4, 8)]).toEqual([0, 255, 255, 0]);
    expect([...cmyk.subarray(8, 12)]).toEqual([0, 128, 128, 0]);
    expect([...cmyk.subarray(12, 16)]).toEqual([0, 0, 0, 255]);
    expect([...cmyk.subarray(16, 20)]).toEqual([0, 0, 0, 0]);
    // One byte a row: the first pixel of row 0 and the last of row 1 are masked out.
    const mask = inflateSync(joined(raster.mask!));
    expect([...mask]).toEqual([0b10000000, 0b00100000]);
  });

  it('needs no mask when everything prints', async () => {
    const raster = await cmykRaster(fakeContext(1, [10, 20, 30, 255]), 1, 1);
    expect(raster.mask).toBeNull();
  });
});

describe('PDF/X-1a file', () => {
  it('is a PDF/X-1a:2003 file: CMYK only, an output intent, trim and bleed boxes, an ID and true offsets', async () => {
    const raster = await cmykRaster(fakeContext(2, [0, 0, 0, 0, 255, 0, 0, 255]), 2, 1);
    const blob = buildPdfX([{ ...raster, widthMm: 100, heightMm: 50, label: 'Front' }], { title: 'Crew tee · front', created: new Date(Date.UTC(2026, 10, 10)) });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const text = bytes.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/GTS_PDFXVersion (PDF/X-1a:2003)');
    expect(text).toContain('/Trapped /False');
    expect(text).toContain('/OutputIntents [4 0 R]');
    expect(text).toContain('/OutputConditionIdentifier (FOGRA39)');
    expect(text).toContain('/ColorSpace /DeviceCMYK');
    expect(text).toContain('/ImageMask true');
    expect(text).not.toContain('/DeviceRGB');
    expect(text).not.toContain('/SMask');
    expect(text).toMatch(/\/ID \[<[0-9A-F]{32}> <[0-9A-F]{32}>\]/);
    // 100 × 50 mm trim with a 3 mm bleed all round, in points.
    expect(text).toContain('/TrimBox [8.504 8.504 291.969 150.236]');
    expect(text).toContain('/MediaBox [0.000 0.000 300.472 158.740]');
    // Every xref offset points at its object.
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    const rows = text.slice(start).split('\n').slice(3).filter((r) => / n $/.test(r));
    rows.forEach((row, i) => expect(text.slice(Number(row.slice(0, 10)), Number(row.slice(0, 10)) + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
  });
});
