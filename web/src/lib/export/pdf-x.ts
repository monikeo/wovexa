/**
 * CMYK print files as PDF/X-1a:2003 (spec EXP-05): one page per print area at true size, the
 * artwork as an 8-bit DeviceCMYK image, ready for a print shop's RIP.
 *
 * - Colour: a plain conversion from the artwork's RGB, not a colour-managed one (no ICC profile
 *   on this device). Black is generated in full, so greys and thin text print in black ink alone
 *   and stay sharp, and no colour uses more than 300% total ink. For colour-critical work a
 *   printer converts the PNG with their own profile.
 * - Transparency: PDF/X-1a allows none, so where nothing prints is cut away by a 1-bit mask, and
 *   soft edges and fades print with their ink thinned to match (as a halftone would).
 * - Output intent: Coated FOGRA39 by its registered name; TrimBox is the print area, BleedBox and
 *   MediaBox add a 3 mm bleed round it.
 * Works in a worker and on the page (it only needs a 2D context and CompressionStream).
 */
import { pdfText } from './pdf';

/** One sRGB colour as CMYK ink, each 0–255 (255 = solid ink). */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const c0 = 255 - r;
  const m0 = 255 - g;
  const y0 = 255 - b;
  const k = Math.min(c0, m0, y0);
  if (k >= 255) return [0, 0, 0, 255];
  // Full black generation: what the three inks share prints as black, the rest spreads back out.
  const s = 255 / (255 - k);
  return [Math.round((c0 - k) * s), Math.round((m0 - k) * s), Math.round((y0 - k) * s), k];
}

/** Below this alpha (of 255) nothing prints there: the mask cuts it away. */
const MASK_ALPHA = 3;

/** A page's artwork as deflated CMYK rows and a deflated 1-bit mask (null when every pixel prints). */
export interface CmykRaster {
  widthPx: number;
  heightPx: number;
  cmyk: Uint8Array[];
  mask: Uint8Array[] | null;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

/**
 * The artwork on a 2D context as CMYK and a mask, a strip of rows at a time so memory holds one
 * strip of pixels, not the whole page.
 */
export async function cmykRaster(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, widthPx: number, heightPx: number, stripRows = 256): Promise<CmykRaster> {
  const cmykStream = new CompressionStream('deflate');
  const maskStream = new CompressionStream('deflate');
  const cmykOut = drain(cmykStream.readable);
  const maskOut = drain(maskStream.readable);
  const cmykWriter = cmykStream.writable.getWriter();
  const maskWriter = maskStream.writable.getWriter();
  const maskRow = Math.ceil(widthPx / 8);
  let masked = false;
  for (let y0 = 0; y0 < heightPx; y0 += stripRows) {
    const rows = Math.min(stripRows, heightPx - y0);
    const rgba = ctx.getImageData(0, y0, widthPx, rows).data;
    const cmyk = new Uint8Array(widthPx * rows * 4);
    // Mask bits: 1 masks a pixel out (nothing prints), 0 lets the image through.
    const mask = new Uint8Array(maskRow * rows);
    for (let r = 0; r < rows; r++) {
      for (let x = 0; x < widthPx; x++) {
        const s = (r * widthPx + x) * 4;
        const a = rgba[s + 3];
        if (a < MASK_ALPHA) {
          mask[r * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
          masked = true;
          continue;
        }
        // Canvas pixels are not premultiplied when read; a soft edge thins its ink by its alpha.
        const [c, m, yy, k] = rgbToCmyk(rgba[s], rgba[s + 1], rgba[s + 2]);
        const f = a / 255;
        cmyk[s] = Math.round(c * f);
        cmyk[s + 1] = Math.round(m * f);
        cmyk[s + 2] = Math.round(yy * f);
        cmyk[s + 3] = Math.round(k * f);
      }
    }
    await cmykWriter.write(cmyk);
    await maskWriter.write(mask);
  }
  await cmykWriter.close();
  await maskWriter.close();
  const [cmyk, mask] = await Promise.all([cmykOut, maskOut]);
  return { widthPx, heightPx, cmyk, mask: masked ? mask : null };
}

export interface PdfXPage extends CmykRaster {
  /** The print area, mm: the page's TrimBox. */
  widthMm: number;
  heightMm: number;
  /** Its name, for the reader's page labels. */
  label: string;
}

export const PDFX_BLEED_MM = 3;

function pdfDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

/** A PDF/X-1a:2003 file with one page per print area. */
export function buildPdfX(pages: PdfXPage[], info: { title: string; created?: Date }): Blob {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const enc = new TextEncoder();
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  const stream = (n: number, dict: string, data: Uint8Array[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n<< ${dict} /Length ${data.reduce((s, d) => s + d.length, 0)} >>\nstream\n`);
    for (const d of data) push(d);
    push('\nendstream\nendobj\n');
  };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  // 1 catalog, 2 pages, 3 info, 4 output intent, then four objects a page: page, image, mask, contents.
  const first = 5;
  const pageIds = pages.map((_, k) => first + k * 4);
  object(1, '<< /Type /Catalog /Pages 2 0 R /OutputIntents [4 0 R] >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const date = pdfDate(info.created ?? new Date());
  object(3, `<< /Title ${pdfText(info.title)} /Creator (WOVEXA web) /Producer (WOVEXA) /CreationDate (${date}) /ModDate (${date}) /Trapped /False /GTS_PDFXVersion (PDF/X-1a:2003) >>`);
  object(4, '<< /Type /OutputIntent /S /GTS_PDFX /OutputCondition (Coated FOGRA39) /OutputConditionIdentifier (FOGRA39) /RegistryName (http://www.color.org) /Info (Coated FOGRA39 \\(ISO 12647-2:2004\\)) >>');
  const pt = 72 / 25.4;
  const bleed = PDFX_BLEED_MM * pt;
  pages.forEach((page, k) => {
    const id = pageIds[k];
    const w = page.widthMm * pt;
    const h = page.heightMm * pt;
    const box = (x0: number, y0: number, x1: number, y1: number) => `[${x0.toFixed(3)} ${y0.toFixed(3)} ${x1.toFixed(3)} ${y1.toFixed(3)}]`;
    const media = box(0, 0, w + 2 * bleed, h + 2 * bleed);
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox ${media} /BleedBox ${media} /TrimBox ${box(bleed, bleed, bleed + w, bleed + h)} /Resources << /XObject << /Art${k} ${id + 1} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${id + 3} 0 R >>`);
    stream(id + 1, `/Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode${page.mask ? ` /Mask ${id + 2} 0 R` : ''}`, page.cmyk);
    // Every page keeps the same four object numbers; a page that needs no mask has an empty one.
    if (page.mask) stream(id + 2, `/Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ImageMask true /BitsPerComponent 1 /Filter /FlateDecode`, page.mask);
    else object(id + 2, 'null');
    stream(id + 3, '', [enc.encode(`q ${w.toFixed(3)} 0 0 ${h.toFixed(3)} ${bleed.toFixed(3)} ${bleed.toFixed(3)} cm /Art${k} Do Q`)]);
  });
  const count = first + pages.length * 4;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  const fileId = hex(crypto.getRandomValues(new Uint8Array(16)));
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R /ID [<${fileId}> <${fileId}>] >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as Uint8Array<ArrayBuffer>[], { type: 'application/pdf' });
}
