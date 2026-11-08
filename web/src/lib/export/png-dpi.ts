/**
 * PNG resolution metadata. Browsers encode canvases without a pHYs chunk, so print software
 * reads them as 72 dpi and shows the wrong physical size. Writing pHYs makes a 300 dpi print
 * file open at its true size in RIPs, Photoshop and Illustrator.
 */
import { crc32 } from './crc32';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function isPng(bytes: Uint8Array) {
  return bytes.length > 33 && SIGNATURE.every((b, i) => bytes[i] === b);
}

function chunkType(bytes: Uint8Array, at: number) {
  return String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
}

/** Returns a copy of the PNG with a pHYs chunk for `dpi` (replacing any existing one). */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png)) throw new Error('Not a PNG file');
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const v = new DataView(chunk.buffer);
  v.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  v.setUint32(17, crc32(chunk.subarray(4, 17)));

  const pieces: Uint8Array[] = [png.subarray(0, 8)];
  let at = 8;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (at + 12 <= png.length) {
    const length = dv.getUint32(at);
    const type = chunkType(png, at);
    const end = at + 12 + length;
    if (type !== 'pHYs') pieces.push(png.subarray(at, end));
    if (type === 'IHDR') pieces.push(chunk);
    at = end;
    if (type === 'IEND') break;
  }
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of pieces) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The resolution a PNG declares, in dots per inch, or null when it declares none. */
export function readPngDpi(png: Uint8Array): number | null {
  if (!isPng(png)) return null;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  while (at + 12 <= png.length) {
    const length = dv.getUint32(at);
    const type = chunkType(png, at);
    if (type === 'pHYs' && png[at + 16] === 1) return Math.round(dv.getUint32(at + 8) * 0.0254);
    if (type === 'IDAT' || type === 'IEND') return null;
    at += 12 + length;
  }
  return null;
}

export async function pngBlobWithDpi(blob: Blob, dpi: number): Promise<Blob> {
  const bytes = setPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' });
}
