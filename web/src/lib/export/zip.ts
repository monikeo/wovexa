/**
 * A small ZIP writer for export packages, with no dependency: UTF-8 file names, DOS timestamps,
 * CRC-32, and deflate through the browser's CompressionStream where it helps. Images that are
 * already compressed (PNG, JPEG, WebP, video) are stored as they are.
 */
import { crc32 } from './crc32';

const ALREADY_COMPRESSED = /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|zip|gz|woff2?|pdf)$/i;

export interface ZipEntry {
  path: string;
  /** Uncompressed size in bytes. */
  bytes: number;
  crc32: number;
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/** Forward slashes, no leading slash, no empty or parent segments, nothing a file system rejects. */
export function safeZipPath(path: string) {
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.replace(/[<>:"|?*\u0000-\u001f]/g, '').trim())
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/') || 'file';
}

export class ZipWriter {
  private readonly parts: BlobPart[] = [];
  private readonly central: Uint8Array[] = [];
  private offset = 0;
  private readonly used = new Set<string>();
  readonly entries: ZipEntry[] = [];

  /** Adds a file and returns the path it was stored under (made unique if needed). */
  async add(path: string, data: Blob | Uint8Array | string, opts: { compress?: boolean; modified?: Date } = {}): Promise<string> {
    let name = safeZipPath(path);
    if (this.used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const stem = dot > name.lastIndexOf('/') ? name.slice(0, dot) : name;
      const ext = dot > name.lastIndexOf('/') ? name.slice(dot) : '';
      let n = 2;
      while (this.used.has(`${stem}-${n}${ext}`.toLowerCase())) n++;
      name = `${stem}-${n}${ext}`;
    }
    this.used.add(name.toLowerCase());

    const raw = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    const crc = crc32(raw);
    let stored = raw;
    let method = 0;
    if ((opts.compress ?? !ALREADY_COMPRESSED.test(name)) && raw.length > 128) {
      const deflated = await deflateRaw(raw);
      if (deflated && deflated.length < raw.length) {
        stored = deflated;
        method = 8;
      }
    }
    const nameBytes = new TextEncoder().encode(name);
    const { time, date } = dosDateTime(opts.modified ?? new Date());

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, stored.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const header = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, stored.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, this.offset, true);
    header.set(nameBytes, 46);

    if (this.offset + local.length + stored.length > 0xffffffff || this.entries.length >= 0xffff) {
      throw new Error('This package is too large for one ZIP file. Export fewer colourways or a lower resolution.');
    }
    this.parts.push(local as Uint8Array<ArrayBuffer>, stored as Uint8Array<ArrayBuffer>);
    this.central.push(header);
    this.offset += local.length + stored.length;
    this.entries.push({ path: name, bytes: raw.length, crc32: crc });
    return name;
  }

  finish(): Blob {
    const size = this.central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, this.entries.length, true);
    v.setUint16(10, this.entries.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...(this.central as Uint8Array<ArrayBuffer>[]), end], { type: 'application/zip' });
  }
}

/** Reads a ZIP's central directory (stored and deflated entries), for tests and import checks. */
export function listZip(bytes: Uint8Array): { path: string; method: number; compressedSize: number; size: number; crc32: number; offset: number }[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a ZIP file');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged ZIP directory');
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    out.push({
      path: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      method: v.getUint16(p + 10, true),
      crc32: v.getUint32(p + 16, true),
      compressedSize: v.getUint32(p + 20, true),
      size: v.getUint32(p + 24, true),
      offset: v.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
