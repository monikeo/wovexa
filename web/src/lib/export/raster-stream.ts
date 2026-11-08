/**
 * Print files metres long without a canvas that size: the image is drawn a strip at a time and
 * each strip's rows go straight into zlib, so memory holds one strip, not the whole roll length.
 * PNG rows are led by filter 2 ("up": the difference from the row above), which shrinks printed
 * fabric a lot. PDF images take the rows plain, which every reader and RIP decodes the same way:
 * Chrome's PDF viewer drew marker-sized images with PNG predictors wrongly.
 */
import { crc32 } from './crc32';

/** RGB rows deflated into one zlib stream: PNG image data ('png'), or plain rows for a PDF image ('plain'). */
export class RgbRowDeflater {
  private readonly writer: WritableStreamDefaultWriter<BufferSource>;
  private readonly output: Promise<Uint8Array[]>;
  private readonly prev: Uint8Array;
  rows = 0;

  constructor(
    readonly width: number,
    readonly layout: 'png' | 'plain' = 'png',
  ) {
    const stream = new CompressionStream('deflate');
    this.writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    this.output = (async () => {
      const out: Uint8Array[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return out;
        out.push(value);
      }
    })();
    // Read errors surface through finish(); never leave them unhandled after an abort.
    this.output.catch(() => undefined);
    this.prev = new Uint8Array(width * 3);
  }

  /** Adds `rows` rows of RGBA pixels. Alpha is dropped: print files here are opaque. */
  async push(rgba: Uint8ClampedArray | Uint8Array, rows: number) {
    const w = this.width;
    let out: Uint8Array<ArrayBuffer>;
    if (this.layout === 'plain') {
      out = new Uint8Array(w * 3 * rows);
      for (let s = 0, d = 0; d < out.length; s += 4, d += 3) {
        out[d] = rgba[s];
        out[d + 1] = rgba[s + 1];
        out[d + 2] = rgba[s + 2];
      }
    } else {
      const stride = w * 3 + 1;
      out = new Uint8Array(stride * rows);
      const prev = this.prev;
      for (let r = 0; r < rows; r++) {
        let d = r * stride;
        out[d++] = 2;
        let s = r * w * 4;
        for (let p = 0; p < w * 3; p += 3, s += 4, d += 3) {
          const R = rgba[s];
          const G = rgba[s + 1];
          const B = rgba[s + 2];
          out[d] = (R - prev[p]) & 255;
          out[d + 1] = (G - prev[p + 1]) & 255;
          out[d + 2] = (B - prev[p + 2]) & 255;
          prev[p] = R;
          prev[p + 1] = G;
          prev[p + 2] = B;
        }
      }
    }
    this.rows += rows;
    await this.writer.write(out);
  }

  /** The zlib stream, in the pieces it arrived in. */
  async finish(): Promise<Uint8Array[]> {
    await this.writer.close();
    return this.output;
  }

  abort() {
    void this.writer.abort().catch(() => undefined);
  }
}

/** One PNG chunk as parts, with its CRC carried across the parts so the data is never copied. */
function chunk(type: string, data: Uint8Array[]): Uint8Array[] {
  const length = data.reduce((n, d) => n + d.length, 0);
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, length);
  for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
  let crc = crc32(head.subarray(4));
  for (const d of data) crc = crc32(d, crc);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, crc);
  return [head, ...data, tail];
}

/** An 8-bit RGB PNG from deflated rows, with its resolution written in (pHYs), so it opens at true size. */
export function rgbPng(width: number, height: number, deflated: Uint8Array[], dpi: number): Blob {
  const ihdr = new Uint8Array(13);
  const h = new DataView(ihdr.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 2; // RGB
  const phys = new Uint8Array(9);
  const p = new DataView(phys.buffer);
  const perMetre = Math.round(dpi / 0.0254);
  p.setUint32(0, perMetre);
  p.setUint32(4, perMetre);
  phys[8] = 1; // unit: metre
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...chunk('IHDR', [ihdr]), ...chunk('pHYs', [phys])];
  // Image data in chunks of about 1 MB.
  let batch: Uint8Array[] = [];
  let size = 0;
  for (const d of deflated) {
    batch.push(d);
    size += d.length;
    if (size >= 1 << 20) {
      parts.push(...chunk('IDAT', batch));
      batch = [];
      size = 0;
    }
  }
  if (batch.length) parts.push(...chunk('IDAT', batch));
  parts.push(...chunk('IEND', []));
  return new Blob(parts as Uint8Array<ArrayBuffer>[], { type: 'image/png' });
}
