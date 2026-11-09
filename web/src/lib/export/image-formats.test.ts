import { describe, expect, it } from 'vitest';
import { encodeTiff } from './image-formats';

/** A stand-in canvas: encodeTiff only reads its size and pixels. */
function fakeCanvas(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + (i >> 5)) & 255;
  const canvas = { width, height, getContext: () => ({ getImageData: () => ({ data }) }) } as unknown as HTMLCanvasElement;
  return { canvas, data };
}

async function inflate(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('TIFF files', () => {
  it('reads back pixel for pixel, with its size, alpha and resolution', async () => {
    const { canvas, data } = fakeCanvas(37, 150);
    const file = new Uint8Array(await (await encodeTiff(canvas, 300)).arrayBuffer());
    const view = new DataView(file.buffer);
    expect([file[0], file[1], view.getUint16(2, true)]).toEqual([0x49, 0x49, 42]);
    const ifd = view.getUint32(4, true);
    const count = view.getUint16(ifd, true);
    const tags = new Map<number, { type: number; count: number; at: number }>();
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      tags.set(view.getUint16(e, true), { type: view.getUint16(e + 2, true), count: view.getUint32(e + 4, true), at: e + 8 });
    }
    const one = (tag: number) => {
      const t = tags.get(tag)!;
      return t.type === 3 ? view.getUint16(t.at, true) : view.getUint32(t.at, true);
    };
    // Tags in ascending order, as readers expect.
    const order = [...tags.keys()];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(one(256)).toBe(37);
    expect(one(257)).toBe(150);
    expect(one(277)).toBe(4);
    expect(one(338)).toBe(2);
    const resolution = view.getUint32(tags.get(282)!.at, true);
    expect([view.getUint32(resolution, true), view.getUint32(resolution + 4, true)]).toEqual([300, 1]);
    const strips = tags.get(273)!;
    const counts = tags.get(279)!;
    const offsets = strips.count === 1 ? [view.getUint32(strips.at, true)] : Array.from({ length: strips.count }, (_, i) => view.getUint32(view.getUint32(strips.at, true) + i * 4, true));
    const sizes = counts.count === 1 ? [view.getUint32(counts.at, true)] : Array.from({ length: counts.count }, (_, i) => view.getUint32(view.getUint32(counts.at, true) + i * 4, true));
    const compressed = one(259) === 8;
    const parts = await Promise.all(offsets.map((o, i) => (compressed ? inflate(file.subarray(o, o + sizes[i])) : Promise.resolve(file.subarray(o, o + sizes[i])))));
    const pixels = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      pixels.set(p, at);
      at += p.length;
    }
    expect(pixels.length).toBe(data.length);
    expect(Buffer.from(pixels).equals(Buffer.from(data))).toBe(true);
  });
});
