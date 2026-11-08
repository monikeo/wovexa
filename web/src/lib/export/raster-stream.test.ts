import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32';
import { buildPdf, cutContourPaths } from './pdf';
import { readPngDpi } from './png-dpi';
import { RgbRowDeflater, rgbPng } from './raster-stream';

const pixel = (x: number, y: number) => [(x * 7 + y) & 255, (y * 5) & 255, (x * y) & 255];

function rgba(width: number, rows: number, top: number) {
  const data = new Uint8ClampedArray(width * rows * 4);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) data.set([...pixel(x, y + top), 255], (y * width + x) * 4);
  }
  return data;
}

/** The image a strip-by-strip encoder made, deflated, as a PNG or a PDF stream would carry it. */
async function encode(width: number, height: number, stripRows: number, layout: 'png' | 'plain' = 'png') {
  const d = new RgbRowDeflater(width, layout);
  for (let top = 0; top < height; top += stripRows) {
    const rows = Math.min(stripRows, height - top);
    await d.push(rgba(width, rows, top), rows);
  }
  expect(d.rows).toBe(height);
  return d.finish();
}

/** Undo PNG filter 2 ("up") on every row and compare with the pixels drawn. */
function expectPixels(raw: Uint8Array, width: number, height: number) {
  const stride = width * 3 + 1;
  expect(raw.length).toBe(stride * height);
  const prior = new Uint8Array(width * 3);
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(2);
    for (let i = 0; i < width * 3; i++) prior[i] = (raw[y * stride + 1 + i] + prior[i]) & 255;
    for (let x = 0; x < width; x++) expect([prior[x * 3], prior[x * 3 + 1], prior[x * 3 + 2]]).toEqual(pixel(x, y));
  }
}

describe('print files streamed a strip at a time', () => {
  it('writes a PNG that decodes to every pixel drawn, at its resolution', async () => {
    const [w, h] = [37, 50];
    const png = new Uint8Array(await rgbPng(w, h, await encode(w, h, 16), 120).arrayBuffer());
    expect(readPngDpi(png)).toBe(120);
    const v = new DataView(png.buffer);
    const types: string[] = [];
    const idat: Uint8Array[] = [];
    for (let at = 8; at < png.length; ) {
      const length = v.getUint32(at);
      const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
      expect(v.getUint32(at + 8 + length), `${type} CRC`).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
      types.push(type);
      if (type === 'IHDR') {
        expect(v.getUint32(at + 8)).toBe(w);
        expect(v.getUint32(at + 12)).toBe(h);
        expect([png[at + 16], png[at + 17]]).toEqual([8, 2]);
      }
      if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
      at += 12 + length;
    }
    expect(types[0]).toBe('IHDR');
    expect(types[1]).toBe('pHYs');
    expect(types.at(-1)).toBe('IEND');
    expectPixels(new Uint8Array(inflateSync(Buffer.concat(idat))), w, h);
  });

  it('makes a true-size PDF page from plain rows, with cut paths in CutContour', async () => {
    const [w, h] = [24, 30];
    const data = await encode(w, h, 7, 'plain');
    // 24 × 30 px at 120 dpi is 5.08 × 6.35 mm.
    const overlay = cutContourPaths([[[0, 0], [5, 0], [5, 6]]], 6.35);
    const blob = buildPdf([{ flateRgb: data, widthPx: w, heightPx: h, widthPt: 14.4, heightPt: 18, overlay }], { title: 'Marker' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    // Plain rows: no PNG predictor, which Chrome's PDF viewer drew wrongly on marker-sized images.
    expect(text).toContain(`/Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length`);
    expect(text).not.toContain('/Predictor');
    expect(text).toContain('/ColorSpace << /CutContour [/Separation /CutContour /DeviceCMYK');
    expect(text).toContain('/CutContour CS 1 SCN');
    // (5 mm, 6 mm) from the top left of a 6.35 mm page is (14.17, 0.99) pt from the bottom left.
    expect(text).toContain('0.00 18.00 m\n14.17 18.00 l\n14.17 0.99 l\nh S');
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    const rows = text.slice(startxref).split('\n').slice(3, 9);
    rows.forEach((row, i) => {
      const offset = Number(row.slice(0, 10));
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    // The image stream inflates to exactly the pixels drawn, row after row.
    const head = text.indexOf('/Subtype /Image');
    const length = Number(text.slice(head).match(/\/Length (\d+)/)![1]);
    const start = text.indexOf('stream\n', head) + 'stream\n'.length;
    const raw = new Uint8Array(inflateSync(bytes.subarray(start, start + length)));
    expect(raw.length).toBe(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) expect([...raw.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)]).toEqual(pixel(x, y));
    const contentLength = Number(text.slice(text.indexOf('6 0 obj')).match(/\/Length (\d+)/)![1]);
    const contentStart = text.indexOf('stream\n', text.indexOf('6 0 obj')) + 'stream\n'.length;
    expect(text.slice(contentStart + contentLength, contentStart + contentLength + 10)).toBe('\nendstream');
  });
});
