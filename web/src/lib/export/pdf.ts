/**
 * A minimal PDF writer for proof sheets and print files. Each page is one full-page image drawn
 * on a canvas first, so Khmer, Korean, Chinese and every artwork font appear exactly as designed,
 * with no fonts to embed: a JPEG for proofs, or lossless zlib-compressed rows for print. Print pages can add
 * vector cut paths in a CutContour spot colour, which print-and-cut RIPs cut instead of printing.
 */
export interface PdfPage {
  /** The page image as a JPEG… */
  jpeg?: Uint8Array;
  /** …or as zlib-compressed plain RGB rows (see raster-stream). */
  flateRgb?: Uint8Array[];
  widthPx: number;
  heightPx: number;
  /** Page size in points (1/72 inch). */
  widthPt: number;
  heightPt: number;
  /** Content drawn over the image, in points from the bottom left. The CutContour colour space is available to it. */
  overlay?: string;
}

export const A4_LANDSCAPE = { widthPt: 841.89, heightPt: 595.28 };

/** The spot colour print-and-cut RIPs read as a cut path, shown as magenta elsewhere. */
const CUT_CONTOUR = '[/Separation /CutContour /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 1 0 0] /N 1 >>]';

/** Closed paths stroked in CutContour, from outlines in millimetres measured from the top left of a page `pageHeightMm` tall. */
export function cutContourPaths(outlines: [number, number][][], pageHeightMm: number): string {
  const k = 72 / 25.4;
  const xy = ([x, y]: [number, number]) => `${(x * k).toFixed(2)} ${((pageHeightMm - y) * k).toFixed(2)}`;
  const paths = outlines.map((o) => `${o.map((p, i) => `${xy(p)} ${i ? 'l' : 'm'}`).join('\n')}\nh S`).join('\n');
  return `q /CutContour CS 1 SCN 0.5 w 1 j\n${paths}\nQ`;
}

/** A PDF text string: plain ASCII as it is, anything else as UTF-16BE. */
export function pdfText(text: string) {
  if (/^[\x20-\x7e]*$/.test(text)) return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  // Anything else as UTF-16BE with a byte-order mark.
  let hex = 'FEFF';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex += ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16)).toUpperCase().padStart(8, '0');
    } else hex += code.toString(16).toUpperCase().padStart(4, '0');
  }
  return `<${hex}>`;
}

function pdfDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function buildPdf(pages: PdfPage[], info: { title: string; subject?: string; created?: Date }): Blob {
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

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const pageIds = pages.map((_, k) => 4 + k * 3);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  const created = pdfDate(info.created ?? new Date());
  object(3, `<< /Title ${pdfText(info.title)} /Subject ${pdfText(info.subject ?? '')} /Producer (WOVEXA) /Creator (WOVEXA web) /CreationDate (${created}) >>`);
  pages.forEach((page, k) => {
    const pageId = 4 + k * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const w = page.widthPt.toFixed(2);
    const h = page.heightPt.toFixed(2);
    const spot = page.overlay ? ` /ColorSpace << /CutContour ${CUT_CONTOUR} >>` : '';
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${k} ${imageId} 0 R >>${spot} /ProcSet [/PDF /ImageC] >> /Contents ${contentId} 0 R >>`);
    const data = page.jpeg ? [page.jpeg] : (page.flateRgb ?? []);
    const filter = page.jpeg ? '/Filter /DCTDecode' : '/Filter /FlateDecode';
    offsets[imageId] = length;
    push(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${filter} /Length ${data.reduce((n, d) => n + d.length, 0)} >>\nstream\n`);
    for (const d of data) push(d);
    push('\nendstream\nendobj\n');
    const content = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im${k} Do Q${page.overlay ? `\n${page.overlay}` : ''}`);
    offsets[contentId] = length;
    push(`${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
    push(content);
    push('\nendstream\nendobj\n');
  });
  const count = 4 + pages.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as Uint8Array<ArrayBuffer>[], { type: 'application/pdf' });
}
