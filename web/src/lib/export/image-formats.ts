/**
 * Still image files beyond what the browser's own encoders write: TIFF (RGB with alpha, for print
 * and retouching) and PDF (the image on a page of its own size), plus a check for AVIF.
 */
import { canvasToBlob } from '@/lib/download';
import { buildPdf } from './pdf';

/** Rows per TIFF strip: small enough for any reader, large enough to compress well. */
const ROWS_PER_STRIP = 64;

/** Whether this browser writes AVIF from a canvas (otherwise it would quietly write PNG). */
export function canEncodeAvif(): boolean {
  if (typeof document === 'undefined') return false;
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  try {
    return c.toDataURL('image/avif').startsWith('data:image/avif');
  } catch {
    return false;
  }
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A canvas as a baseline TIFF: 8-bit RGB with unassociated alpha, in strips, Deflate-compressed
 * where the browser can (every current one), with its resolution in dots per inch.
 */
export async function encodeTiff(canvas: HTMLCanvasElement, dpi = 300): Promise<Blob> {
  const W = canvas.width;
  const H = canvas.height;
  const rgba = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const compress = typeof CompressionStream !== 'undefined';
  const strips: Uint8Array[] = [];
  for (let y = 0; y < H; y += ROWS_PER_STRIP) {
    const raw = rgba.subarray(y * W * 4, Math.min(H, y + ROWS_PER_STRIP) * W * 4);
    strips.push(compress ? await deflate(new Uint8Array(raw)) : new Uint8Array(raw));
  }
  const software = 'WOVEXA\0';
  // Header, then the strips, then the directory and the values too long to sit in it.
  const tags: [number, number, number, number[] | number][] = [];
  const SHORT = 3;
  const LONG = 4;
  const RATIONAL = 5;
  const ASCII = 2;
  let offset = 8;
  const stripOffsets = strips.map((s) => {
    const at = offset;
    offset += s.byteLength;
    return at;
  });
  offset += offset % 2;
  const entries = 15;
  const ifdAt = offset;
  const ifdSize = 2 + entries * 12 + 4;
  let extraAt = ifdAt + ifdSize;
  const extra: { at: number; bytes: Uint8Array }[] = [];
  const out = (bytes: Uint8Array) => {
    const at = extraAt;
    extra.push({ at, bytes });
    extraAt += bytes.byteLength + (bytes.byteLength % 2);
    return at;
  };
  const u16s = (values: number[]) => {
    const b = new Uint8Array(values.length * 2);
    const v = new DataView(b.buffer);
    values.forEach((x, i) => v.setUint16(i * 2, x, true));
    return b;
  };
  const u32s = (values: number[]) => {
    const b = new Uint8Array(values.length * 4);
    const v = new DataView(b.buffer);
    values.forEach((x, i) => v.setUint32(i * 4, x, true));
    return b;
  };
  const many = (values: number[], size: 2 | 4) => (values.length * size <= 4 ? values : out(size === 2 ? u16s(values) : u32s(values)));
  tags.push([256, LONG, 1, W]);
  tags.push([257, LONG, 1, H]);
  tags.push([258, SHORT, 4, many([8, 8, 8, 8], 2)]);
  tags.push([259, SHORT, 1, compress ? 8 : 1]);
  tags.push([262, SHORT, 1, 2]);
  tags.push([273, LONG, strips.length, many(stripOffsets, 4)]);
  tags.push([277, SHORT, 1, 4]);
  tags.push([278, LONG, 1, ROWS_PER_STRIP]);
  tags.push([279, LONG, strips.length, many(strips.map((s) => s.byteLength), 4)]);
  tags.push([282, RATIONAL, 1, out(u32s([Math.round(dpi), 1]))]);
  tags.push([283, RATIONAL, 1, out(u32s([Math.round(dpi), 1]))]);
  tags.push([284, SHORT, 1, 1]);
  tags.push([296, SHORT, 1, 2]);
  tags.push([305, ASCII, software.length, out(new TextEncoder().encode(software))]);
  tags.push([338, SHORT, 1, 2]);

  const total = extraAt;
  const file = new Uint8Array(total);
  const view = new DataView(file.buffer);
  file.set([0x49, 0x49], 0); // little-endian
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdAt, true);
  strips.forEach((s, i) => file.set(s, stripOffsets[i]));
  view.setUint16(ifdAt, entries, true);
  tags.forEach(([tag, type, count, value], i) => {
    const e = ifdAt + 2 + i * 12;
    view.setUint16(e, tag, true);
    view.setUint16(e + 2, type, true);
    view.setUint32(e + 4, count, true);
    if (Array.isArray(value)) {
      // Values that fit in the entry itself, left-aligned.
      value.forEach((x, k) => (type === SHORT ? view.setUint16(e + 8 + k * 2, x, true) : view.setUint32(e + 8 + k * 4, x, true)));
    } else if (type === SHORT && count === 1) view.setUint16(e + 8, value, true);
    else view.setUint32(e + 8, value, true);
  });
  view.setUint32(ifdAt + 2 + entries * 12, 0, true);
  for (const { at, bytes } of extra) file.set(bytes, at);
  return new Blob([file], { type: 'image/tiff' });
}

/** A canvas as a one-page PDF the size of the image at `dpi` (its picture JPEG-compressed at `quality`). */
export async function encodePdf(canvas: HTMLCanvasElement, opts: { quality: number; title: string; dpi?: number }): Promise<Blob> {
  const dpi = opts.dpi ?? 300;
  const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', opts.quality)).arrayBuffer());
  return buildPdf([{ jpeg, widthPx: canvas.width, heightPx: canvas.height, widthPt: (canvas.width / dpi) * 72, heightPt: (canvas.height / dpi) * 72 }], { title: opts.title });
}
