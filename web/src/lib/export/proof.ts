/**
 * Client proof sheet (spec EXP-05, APP-03): an A4 landscape page set a customer can approve.
 * Page 1 shows the product in every exported colourway with the colour parts; page 2 shows each
 * print placement with its size, method and position. Drawn on canvas, then written as PDF.
 */
import type { GarmentModel, GarmentSize, ZoneSpec } from '@/domain/garments';
import { partColor, PRINT_METHOD_LABELS } from '@/domain/garments';
import type { Colorway, DesignDocument, ZoneId } from '@/domain/schema';
import { A4_LANDSCAPE, buildPdf, type PdfPage } from './pdf';

export interface ProofInput {
  doc: DesignDocument;
  model: GarmentModel;
  size: GarmentSize;
  fabricLabel: string;
  /** Product images per colourway (3D renders), or flats when the 3D view is closed. */
  products: { colorway: Colorway; images: { label: string; canvas: HTMLCanvasElement }[] }[];
  placements: { zoneId: ZoneId; spec: ZoneSpec; sketch: HTMLCanvasElement; art: HTMLCanvasElement }[];
  approval: string;
  /** v3, r12 or a design ID (see revisionLabel). */
  revision: string;
  /** For a team order: how many personalised garments, by size. */
  team?: { people: number; sizes: { size: string; count: number }[] };
}

const PX = 200 / 72; // 200 dpi on an A4 page measured in points
const INK = '#14151A';
const MUTED = '#6B6F7B';
const LINE = '#DADCE2';
const ACCENT = '#2B59FF';

function uiFont() {
  if (typeof document === 'undefined') return 'system-ui, sans-serif';
  const archivo = getComputedStyle(document.documentElement).getPropertyValue('--font-archivo').trim();
  return `${archivo ? `${archivo}, ` : ''}Archivo, "Noto Sans Khmer", "Noto Sans KR", "Noto Sans SC", system-ui, sans-serif`;
}

function page() {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(A4_LANDSCAPE.widthPt * PX);
  canvas.height = Math.round(A4_LANDSCAPE.heightPt * PX);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(PX, PX); // draw in points
  return { canvas, ctx };
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, opts: { weight?: number; color?: string; align?: CanvasTextAlign; max?: number } = {}) {
  ctx.font = `${opts.weight ?? 400} ${size}px ${uiFont()}`;
  ctx.fillStyle = opts.color ?? INK;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  let v = value;
  if (opts.max) while (v.length > 1 && ctx.measureText(v).width > opts.max) v = `${v.slice(0, -2)}…`;
  ctx.fillText(v, x, y);
}

/** Draw `img` contained in a box, centred. */
function contain(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const k = Math.min(w / img.width, h / img.height);
  const dw = img.width * k;
  const dh = img.height * k;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** "Version 3", "Revision 12" or "Design a1b2c3" for a revision label. */
export function revisionText(label: string) {
  if (/^v\d+$/.test(label)) return `Version ${label.slice(1)}`;
  if (/^r\d+$/.test(label)) return `Revision ${label.slice(1)}`;
  return `Design ${label}`;
}

function header(ctx: CanvasRenderingContext2D, input: ProofInput, title: string, pageNo: number, pages: number) {
  const { doc, model, size, fabricLabel } = input;
  const W = A4_LANDSCAPE.widthPt;
  text(ctx, 'WOVEXA', 36, 44, 11, { weight: 800, color: INK });
  text(ctx, title, 36, 74, 22, { weight: 700, max: W * 0.55 });
  text(ctx, doc.title, 36, 94, 11, { color: MUTED, max: W * 0.55 });
  const meta = [revisionText(input.revision), model.name, model.category === 'uniform' ? `${size.code} cm tall` : `Size ${size.code}`, fabricLabel];
  text(ctx, meta.join('   ·   '), 36, 112, 9, { color: MUTED, max: W - 72 });
  // Approval status, top right.
  ctx.font = `700 9px ${uiFont()}`;
  const pill = input.approval;
  const pw = ctx.measureText(pill).width + 20;
  ctx.fillStyle = pill.startsWith('Approved') ? '#E7F6EC' : '#F1F2F5';
  ctx.beginPath();
  ctx.roundRect(W - 36 - pw, 30, pw, 20, 10);
  ctx.fill();
  text(ctx, pill, W - 36 - pw / 2, 44, 9, { weight: 700, align: 'center', color: pill.startsWith('Approved') ? '#1D7A3E' : MUTED });
  text(ctx, `${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}   ·   Page ${pageNo} of ${pages}`, W - 36, 112, 9, { align: 'right', color: MUTED });
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(36, 124);
  ctx.lineTo(W - 36, 124);
  ctx.stroke();
}

function footer(ctx: CanvasRenderingContext2D) {
  const W = A4_LANDSCAPE.widthPt;
  const H = A4_LANDSCAPE.heightPt;
  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(36, H - 54);
  ctx.lineTo(W - 36, H - 54);
  ctx.stroke();
  text(ctx, 'Check spelling, sizes, colours and placement. Screen and paper colours are approximate; a physical sample is the colour reference.', 36, H - 36, 8, { color: MUTED, max: W * 0.58 });
  text(ctx, 'Approved by  ______________________      Date  ____________', W - 36, H - 36, 9, { align: 'right' });
}

/**
 * The garment's own area in a product render, so the proof can show it large. The backdrop is
 * nearly uniform along each row, so content is whatever differs from the row's edge colour.
 */
function trimToContent(src: HTMLCanvasElement, pad = 0.04): HTMLCanvasElement {
  const k = Math.min(1, 320 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * k));
  const h = Math.max(1, Math.round(src.height * k));
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(src, 0, 0, w, h);
  const { data } = pctx.getImageData(0, 0, w, h);
  // Renders on a transparent background crop exactly by alpha; others by difference from the backdrop.
  const transparent = [0, w - 1, (h - 1) * w, h * w - 1].every((p) => data[p * 4 + 3] < 10);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const l = y * w * 4;
    const r = (y * w + w - 1) * 4;
    const bg = [0, 1, 2].map((c) => (data[l + c] + data[r + c]) / 2);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const diff = transparent ? 255 : Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
      if (data[i + 3] > (transparent ? 40 : 24) && diff > 26) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return src;
  const p = Math.round(Math.max(x1 - x0, y1 - y0) * pad);
  const sx = Math.max(0, (x0 - p) / k);
  const sy = Math.max(0, (y0 - p) / k);
  const sw = Math.min(src.width - sx, (x1 - x0 + 2 * p) / k);
  const sh = Math.min(src.height - sy, (y1 - y0 + 2 * p) / k);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw));
  out.height = Math.max(1, Math.round(sh));
  out.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

function overviewPage(input: ProofInput, pages: number) {
  const { canvas, ctx } = page();
  header(ctx, input, 'Design proof', 1, pages);
  const W = A4_LANDSCAPE.widthPt;
  const top = 138;
  const bottom = A4_LANDSCAPE.heightPt - 74;
  const rows = input.products.slice(0, 4);
  // One colourway per row for one or two; a two-by-two grid for three or four.
  const cols = rows.length >= 3 ? 2 : 1;
  const gridRows = Math.ceil(rows.length / cols) || 1;
  const gap = 18;
  const cellW = (W - 72 - gap * (cols - 1)) / cols;
  const cellH = (bottom - top - gap * (gridRows - 1)) / gridRows;
  // Wide cells keep the colour list beside the images; grid cells put it underneath.
  const below = cols === 2;
  const parts = input.model.colorParts;
  const legendW = below ? 0 : 200;
  const titleH = below ? 20 : 0;
  const legendH = below ? Math.ceil(parts.length / 3) * 14 + 8 : 0;
  const swatch = (hex: string, lx: number, yy: number) => {
    ctx.fillStyle = hex;
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.roundRect(lx, yy - 8.5, 11, 11, 2);
    ctx.fill();
    ctx.stroke();
  };
  rows.forEach((row, r) => {
    const x = 36 + (r % cols) * (cellW + gap);
    const y = top + Math.floor(r / cols) * (cellH + gap);
    const n = Math.max(1, row.images.length);
    const imgW = (cellW - legendW - (below ? 0 : 12)) / n;
    const imgTop = y + titleH;
    const imgH = cellH - titleH - legendH - 14;
    row.images.forEach((img, i) => {
      const trimmed = trimToContent(img.canvas);
      ctx.fillStyle = '#F6F7F9';
      ctx.beginPath();
      ctx.roundRect(x + i * imgW + 3, imgTop, imgW - 6, imgH, 6);
      ctx.fill();
      contain(ctx, trimmed, x + i * imgW + 10, imgTop + 8, imgW - 20, imgH - 16);
      text(ctx, img.label, x + i * imgW + imgW / 2, imgTop + imgH + 10, 7.5, { align: 'center', color: MUTED });
    });
    const printed = row.colorway.surfaces && Object.values(row.colorway.surfaces).some(Boolean);
    if (below) {
      text(ctx, row.colorway.name, x + 3, y + 12, 10.5, { weight: 700, max: cellW * 0.6 });
      if (printed) text(ctx, 'All-over fabric print', x + cellW - 3, y + 12, 8, { color: ACCENT, align: 'right' });
      const colW = cellW / 3;
      parts.forEach(({ part, label }, k) => {
        const lx = x + 3 + (k % 3) * colW;
        const yy = imgTop + imgH + 28 + Math.floor(k / 3) * 14;
        const hex = partColor(row.colorway, part);
        swatch(hex, lx, yy);
        text(ctx, label, lx + 15, yy + 1, 7.5, { max: colW - 62 });
        text(ctx, hex.toUpperCase(), lx + colW - 8, yy + 1, 7.5, { align: 'right', color: MUTED });
      });
      return;
    }
    // Colour parts beside the images.
    const lx = x + cellW - legendW;
    text(ctx, row.colorway.name, lx, y + 12, 10.5, { weight: 700, max: legendW });
    const step = Math.min(15, (cellH - 44) / Math.max(1, parts.length));
    parts.forEach(({ part, label }, k) => {
      const yy = y + 30 + k * step;
      const hex = partColor(row.colorway, part);
      swatch(hex, lx, yy);
      text(ctx, label, lx + 17, yy + 1, 8, { max: legendW - 70 });
      text(ctx, hex.toUpperCase(), lx + legendW, yy + 1, 8, { align: 'right', color: MUTED });
    });
    if (printed) text(ctx, 'All-over fabric print', lx, y + cellH - 4, 8, { color: ACCENT });
  });
  if (input.products.length > rows.length) text(ctx, `+ ${input.products.length - rows.length} more colourways in the package`, W - 36, bottom + 14, 8, { color: MUTED, align: 'right' });
  if (input.team) {
    const summary = input.team.sizes.map((s) => `${s.size} × ${s.count}`).join('   ');
    text(ctx, `Team order: ${input.team.people} personalised garments${summary ? `   ·   ${summary}` : ''}`, 36, bottom + 14, 9, { weight: 600, max: W * 0.6 });
  }
  footer(ctx);
  return canvas;
}

function placementsPage(input: ProofInput, pages: number) {
  const { canvas, ctx } = page();
  header(ctx, input, 'Print placement', 2, pages);
  const W = A4_LANDSCAPE.widthPt;
  const top = 140;
  const bottom = A4_LANDSCAPE.heightPt - 70;
  const items = input.placements.slice(0, 6);
  const cols = items.length <= 2 ? items.length || 1 : 3;
  const rowsN = Math.ceil(items.length / cols) || 1;
  const cellW = (W - 72) / cols;
  const cellH = (bottom - top) / rowsN;
  items.forEach((item, k) => {
    const x = 36 + (k % cols) * cellW;
    const y = top + Math.floor(k / cols) * cellH;
    const imgH = cellH - 64;
    const half = (cellW - 16) / 2;
    contain(ctx, item.sketch, x + 4, y + 4, half, imgH);
    // The artwork alone on a light check, with its dimensions.
    const ax = x + 12 + half;
    const k2 = Math.min(half / item.art.width, (imgH - 18) / item.art.height);
    const aw = item.art.width * k2;
    const ah = item.art.height * k2;
    const ox = ax + (half - aw) / 2;
    const oy = y + 4 + (imgH - 18 - ah) / 2;
    ctx.fillStyle = '#F4F5F7';
    ctx.fillRect(ox, oy, aw, ah);
    ctx.drawImage(item.art, ox, oy, aw, ah);
    ctx.strokeStyle = ACCENT;
    ctx.setLineDash([3, 2]);
    ctx.lineWidth = 0.75;
    ctx.strokeRect(ox, oy, aw, ah);
    ctx.setLineDash([]);
    text(ctx, `${item.spec.printableWidthMm} × ${item.spec.printableHeightMm} mm`, ox + aw / 2, oy + ah + 12, 8, { align: 'center', color: ACCENT, weight: 600 });
    const method = PRINT_METHOD_LABELS[input.doc.zones[item.zoneId].printMethod];
    text(ctx, item.spec.label, x + 6, y + cellH - 40, 11, { weight: 700 });
    text(ctx, method, x + 6, y + cellH - 26, 8.5, { color: MUTED, max: cellW - 12 });
    text(ctx, placementText(item.spec), x + 6, y + cellH - 13, 8.5, { color: MUTED, max: cellW - 12 });
  });
  if (!items.length) text(ctx, 'This design has no artwork yet.', W / 2, (top + bottom) / 2, 12, { align: 'center', color: MUTED });
  footer(ctx);
  return canvas;
}

export function placementText(spec: ZoneSpec) {
  if (spec.topFromHpsMm !== undefined) return `Top of print area ${spec.topFromHpsMm} mm below the high point of shoulder, centred`;
  if (spec.centerFromShoulderMm !== undefined) return `Centre ${spec.centerFromShoulderMm} mm down the sleeve from the shoulder seam`;
  if (spec.topFromWaistMm !== undefined) return `Top ${spec.topFromWaistMm} mm below the waistband, on the outer leg`;
  return 'Centred on the panel';
}

async function toJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The proof could not be encoded.'))), 'image/jpeg', 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildProofPdf(input: ProofInput): Promise<Blob> {
  const canvases = [overviewPage(input, 2), placementsPage(input, 2)];
  const pages: PdfPage[] = [];
  for (const c of canvases) {
    pages.push({ jpeg: await toJpeg(c), widthPx: c.width, heightPx: c.height, ...A4_LANDSCAPE });
    c.width = c.height = 0;
  }
  return buildPdf(pages, { title: `${input.doc.title}, design proof ${input.revision}`, subject: input.model.name });
}
