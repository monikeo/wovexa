/**
 * A minimal PDF writer for proof sheets. Each page is one full-page JPEG (DCTDecode), drawn on a
 * canvas first, so Khmer, Korean, Chinese and every artwork font appear exactly as designed,
 * with no fonts to embed.
 */
export interface PdfPage {
  jpeg: Uint8Array;
  widthPx: number;
  heightPx: number;
  /** Page size in points (1/72 inch). */
  widthPt: number;
  heightPt: number;
}

export const A4_LANDSCAPE = { widthPt: 841.89, heightPt: 595.28 };

function pdfText(text: string) {
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
    object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${k} ${imageId} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contentId} 0 R >>`);
    offsets[imageId] = length;
    push(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
    push(page.jpeg);
    push('\nendstream\nendobj\n');
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${k} Do Q`;
    object(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const count = 4 + pages.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as Uint8Array<ArrayBuffer>[], { type: 'application/pdf' });
}
