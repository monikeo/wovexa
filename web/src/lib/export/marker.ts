/**
 * Fabric marker for cut-and-sew and sublimation: every pattern piece of the order nested on a
 * roll of the chosen width (see nesting.ts), printed at true size with its own print, bleed, a
 * dashed cut line and a label in the bleed below the hem, split into roll lengths. Each length is
 * one PNG with its resolution written in, or one true-size PDF page whose cut lines are also
 * vector paths in a CutContour spot colour for print-and-cut RIPs. A plan of the whole marker and
 * a piece list come with it.
 *
 * Memory stays bounded however long the order: each printed piece is drawn once and kept as a
 * PNG, and each roll length is assembled a strip at a time straight into its file.
 */
import { drawPart, PX_PER_MM } from '@/components/studio/viewer3d/garment-textures';
import { getGarment, partColor, type GarmentModel, type GarmentSize, type PartId } from '@/domain/garments';
import type { Colorway, DesignDocument, ZoneId } from '@/domain/schema';
import { canvasToBlob } from '@/lib/download';
import { BLEED_MM, markerNestOptions, markerPieces, orderSets, type MarkerPiece, type MarkerSettings, type MarkerShape } from './marker-layout';
import { bounds, nest, placeOutline, simplifyOutline, type Placement, type Point } from './nesting';
import { buildPdf, cutContourPaths } from './pdf';
import { RgbRowDeflater, rgbPng } from './raster-stream';
import { toCsv, type Roster } from './roster';

/** Markers print at the cut-and-sew resolution, the usual one for all-over sublimation. */
const PPM = PX_PER_MM.print;
export const MARKER_DPI = Math.round(PPM * 25.4);
/** Rows per strip while a roll length is assembled. */
const STRIP = 1024;

export interface MarkerSummary {
  rollWidthMm: number;
  gapMm: number;
  marginMm: number;
  bleedMm: number;
  allowTurn: boolean;
  format: 'png' | 'pdf';
  dpi: number;
  garments: number;
  pieces: number;
  sizes: { code: string; garments: number }[];
  /** Fabric used, every roll length added up. */
  lengthMm: number;
  fabricAreaM2: number;
  pieceAreaM2: number;
  /** Cut area over fabric used. */
  utilisation: number;
  /** Fabric length per garment, for costing. */
  perGarmentMm: number;
  lengths: { file: string; lengthMm: number; pieces: number; utilisation: number }[];
  plan: string;
  pieceList: string;
  /** Pieces wider than the roll, left off. */
  unplaced: string[];
  strategy: string;
}

export interface MarkerContext {
  /** "Title · Colourway · v3", printed on the plan. */
  caption: string;
  /** Zones whose artwork changes per person; parts carrying them are printed per garment. */
  personalZones?: ZoneId[];
  /** A personalised copy of the design for one roster row, with fonts loaded and text fitted. */
  personalise?: (row: Record<string, string>) => Promise<DesignDocument>;
  signal?: AbortSignal;
  onProgress?: (label: string, fraction: number) => void;
}

interface Art {
  blob: Blob;
  /** Piece-frame millimetres at the image's top-left corner. */
  bx0: number;
  by0: number;
  w: number;
  h: number;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));
function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}
const release = (c: HTMLCanvasElement) => {
  c.width = 0;
  c.height = 0;
};
const sizeText = (model: GarmentModel, size: GarmentSize) => (model.category === 'uniform' ? `${size.code} cm` : size.code);
const metres = (mm: number) => `${(mm / 1000).toFixed(2)} m`;

/** One printed piece with its bleed, cut out of its part's texture at marker resolution. */
function renderPiece(tex: HTMLCanvasElement, info: MarkerShape, base: string): { canvas: HTMLCanvasElement; bx0: number; by0: number } {
  const b = bounds(info.outline);
  const pad = BLEED_MM + 1;
  const bx0 = b.minX - pad;
  const by0 = b.minY - pad;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((b.maxX - b.minX + 2 * pad) * PPM);
  canvas.height = Math.ceil((b.maxY - b.minY + 2 * pad) * PPM);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(PPM, 0, 0, PPM, -bx0 * PPM, -by0 * PPM);
  ctx.beginPath();
  info.outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  // The piece and its bleed as a mask, filled with the fabric colour and then the print. The print
  // wraps round the body, so bleed past a side seam continues from the neighbouring panel.
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2 * BLEED_MM;
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = base;
  ctx.fillRect(bx0, by0, canvas.width / PPM, canvas.height / PPM);
  ctx.globalCompositeOperation = 'source-atop';
  for (const shift of [-1, 0, 1]) ctx.drawImage(tex, shift * info.partMm.w, 0, info.partMm.w, info.partMm.h);
  ctx.globalCompositeOperation = 'source-over';
  return { canvas, bx0, by0 };
}

/** Where a piece's label sits: centred on its hem, in the outer half of the bleed below it. */
function labelAnchor(outline: Point[]): Point {
  const b = bounds(outline);
  const hem = outline.filter(([, y]) => y >= b.maxY - 0.5);
  const xs = hem.map(([x]) => x);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, b.maxY + BLEED_MM * 0.58];
}

export async function buildMarker(doc: DesignDocument, colorway: Colorway, roster: Roster | null, settings: MarkerSettings, ctx: MarkerContext) {
  const model = getGarment(doc.garment.modelId);
  const progress = (label: string, fraction: number) => ctx.onProgress?.(label, Math.min(1, fraction));
  const { sets, unknownSizes } = orderSets(model, doc.garment.sizeCode, roster);
  progress('Fabric marker: nesting the pieces', 0);
  await yieldToUi();
  const { pieces, geos } = markerPieces(model, sets, 'high');
  const opts = markerNestOptions(settings);
  const result = nest(pieces, opts);
  abortIfNeeded(ctx.signal);
  const warnings: string[] = [];
  if (unknownSizes.length) warnings.push(`The marker uses the sample size where the roster asks for a size this garment does not have: ${unknownSizes.join(', ')}.`);
  if (result.unplaced.length) {
    const names = [...new Set(result.unplaced.map((id) => pieces.find((p) => p.id === id)!).map((p) => `${p.info.island.label.toLowerCase()} (${sizeText(model, p.info.size)})`))];
    warnings.push(`${result.unplaced.length} ${result.unplaced.length === 1 ? 'piece is' : 'pieces are'} wider than the ${opts.rollWidthMm / 10} cm roll and left off the marker: ${names.join(', ')}. Choose a wider roll.`);
  }

  // ---- Every distinct printed piece, once. Parts with personalised zones print per garment;
  // the rest are shared by every garment of the same size. ----
  const personalParts = new Set((ctx.personalZones ?? []).map((z) => model.zones[z]?.part).filter((p): p is PartId => !!p));
  const personal = (p: MarkerPiece) => !!(ctx.personalise && p.set.row && personalParts.has(p.info.island.part));
  const textureKey = (p: MarkerPiece) => `${p.info.size.code}|${p.info.island.part}|${personal(p) ? p.set.index : '*'}`;
  const artKey = (p: MarkerPiece) => `${textureKey(p)}|${p.info.island.id}`;
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const placed = result.sections.flatMap((s) => s.placements.map((pl) => byId.get(pl.id)!));
  const groups = new Map<string, Map<string, MarkerPiece>>();
  for (const p of placed) {
    const g = groups.get(textureKey(p)) ?? new Map<string, MarkerPiece>();
    if (!g.has(artKey(p))) g.set(artKey(p), p);
    groups.set(textureKey(p), g);
  }
  const people = new Map<number, Promise<DesignDocument>>();
  const arts = new Map<string, Art>();
  let g = 0;
  for (const group of groups.values()) {
    abortIfNeeded(ctx.signal);
    const first = group.values().next().value!;
    progress(`Fabric marker: printing pieces, size ${sizeText(model, first.info.size)}`, 0.05 + (0.4 * g++) / groups.size);
    let design = doc;
    if (personal(first)) {
      if (!people.has(first.set.index)) people.set(first.set.index, ctx.personalise!(first.set.row!));
      design = await people.get(first.set.index)!;
    }
    const part = first.info.island.part;
    const tex = document.createElement('canvas');
    drawPart(tex, part, { doc: design, model, geo: geos.get(first.info.size.code)!, colorway, quality: 'print', production: true });
    const base = partColor(colorway, part === 'torso' ? 'body' : part.startsWith('leg') ? 'pants' : 'sleeves');
    for (const [key, piece] of group) {
      const { canvas, bx0, by0 } = renderPiece(tex, piece.info, base);
      arts.set(key, { blob: await canvasToBlob(canvas), bx0, by0, w: canvas.width, h: canvas.height });
      release(canvas);
    }
    release(tex);
    await yieldToUi();
  }

  // ---- The plan: every roll length side by side, small. ----
  const files: { path: string; blob: Blob }[] = [];
  const lengthsOut: MarkerSummary['lengths'] = [];
  const n = result.sections.length;
  const longest = Math.max(1, ...result.sections.map((s) => s.lengthMm));
  let scale = Math.min(480 / opts.rollWidthMm, 1200 / longest);
  const GAP = 28;
  const HEAD = 116;
  const CAPTION = 30;
  const perRow = Math.max(1, Math.min(n, Math.floor((3600 - GAP) / (opts.rollWidthMm * scale + GAP))));
  const rows = Math.ceil(n / perRow);
  // Keep the plan within a canvas every browser can make.
  scale = Math.min(scale, (12000 - HEAD - rows * (CAPTION + GAP)) / (rows * longest));
  const plan = document.createElement('canvas');
  plan.width = Math.ceil(GAP + perRow * (opts.rollWidthMm * scale + GAP));
  plan.height = Math.ceil(HEAD + rows * (longest * scale + CAPTION + GAP));
  const pc = plan.getContext('2d')!;
  pc.fillStyle = '#FFFFFF';
  pc.fillRect(0, 0, plan.width, plan.height);
  const garments = sets.length;
  const fabricAreaM2 = (opts.rollWidthMm * result.lengthMm) / 1e6;
  pc.fillStyle = '#14151A';
  pc.font = '700 26px system-ui, sans-serif';
  pc.fillText(`Fabric marker · ${ctx.caption}`, GAP, 42);
  pc.font = '16px system-ui, sans-serif';
  pc.fillText(
    `${opts.rollWidthMm / 10} cm roll · ${garments} ${garments === 1 ? 'garment' : 'garments'}, ${placed.length} pieces · ${metres(result.lengthMm)} (${fabricAreaM2.toFixed(2)} m²) · ${Math.round(result.utilisation * 100)}% of the fabric used`,
    GAP,
    72,
  );
  pc.fillStyle = '#6B6F7B';
  pc.fillText(
    `Gap ${opts.gapMm} mm, margin ${opts.marginMm} mm, bleed ${BLEED_MM} mm · grain along the roll${opts.allowTurn ? ', pieces turn 180° at most' : ', no pieces turned'} · not mirrored: set mirroring for transfer paper in your RIP`,
    GAP,
    96,
  );
  const slot = (i: number) => ({ x: GAP + (i % perRow) * (opts.rollWidthMm * scale + GAP), y: HEAD + Math.floor(i / perRow) * (longest * scale + CAPTION + GAP) });

  // ---- Each roll length, a strip at a time, straight into its file. ----
  const strip = document.createElement('canvas');
  const sc = strip.getContext('2d', { willReadFrequently: true })!;
  const csv: (string | number)[][] = [['length', 'file', 'garment', 'name', 'number', 'size', 'piece', 'turned', 'x_mm', 'y_mm', 'width_mm', 'length_mm', 'area_cm2']];
  const totalStrips = result.sections.reduce((t, s) => t + Math.ceil(Math.round(s.lengthMm * PPM) / STRIP), 0);
  let stripsDone = 0;
  const ext = settings.format === 'pdf' ? 'pdf' : 'png';
  for (const section of result.sections) {
    abortIfNeeded(ctx.signal);
    const W = Math.round(opts.rollWidthMm * PPM);
    const H = Math.round(section.lengthMm * PPM);
    const file = `marker/marker_${opts.rollWidthMm / 10}cm_${String(section.index + 1).padStart(2, '0')}-of-${String(n).padStart(2, '0')}_${(section.lengthMm / 1000).toFixed(2)}m.${ext}`;
    // Snap each piece to whole pixels; the vector cut paths follow the snapped position.
    const items = section.placements.map((pl) => {
      const piece = byId.get(pl.id)!;
      const art = arts.get(artKey(piece))!;
      if (!pl.turned) {
        const x0 = Math.round((pl.tx + art.bx0) * PPM);
        const y0 = Math.round((pl.ty + art.by0) * PPM);
        return { piece, art, key: artKey(piece), at: { ...pl, tx: x0 / PPM - art.bx0, ty: y0 / PPM - art.by0 } as Placement, x0, y0, x1: x0 + art.w, y1: y0 + art.h };
      }
      const x1 = Math.round((pl.tx - art.bx0) * PPM);
      const y1 = Math.round((pl.ty - art.by0) * PPM);
      return { piece, art, key: artKey(piece), at: { ...pl, tx: x1 / PPM + art.bx0, ty: y1 / PPM + art.by0 } as Placement, x0: x1 - art.w, y0: y1 - art.h, x1, y1 };
    });
    // Decode each printed piece when a strip first needs it; let it go after its last strip.
    const lastStrip = new Map<string, number>();
    for (const it of items) lastStrip.set(it.key, Math.max(lastStrip.get(it.key) ?? 0, Math.floor((Math.min(H, it.y1) - 1) / STRIP)));
    const bitmaps = new Map<string, ImageBitmap>();
    const origin = slot(section.index);
    const drawnOnPlan = new Set<string>();
    const deflater = new RgbRowDeflater(W, settings.format === 'pdf' ? 'plain' : 'png');
    try {
      for (let top = 0, s = 0; top < H; top += STRIP, s++) {
        abortIfNeeded(ctx.signal);
        const h = Math.min(STRIP, H - top);
        if (strip.width !== W || strip.height !== h) {
          strip.width = W;
          strip.height = h;
        }
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.fillStyle = '#FFFFFF';
        sc.fillRect(0, 0, W, h);
        sc.imageSmoothingEnabled = false;
        const here = items.filter((it) => it.y0 < top + h && it.y1 > top);
        for (const it of here) {
          let bmp = bitmaps.get(it.key);
          if (!bmp) {
            bmp = await createImageBitmap(it.art.blob);
            bitmaps.set(it.key, bmp);
          }
          const t = it.at.turned;
          sc.setTransform(t ? -1 : 1, 0, 0, t ? -1 : 1, t ? it.x1 : it.x0, (t ? it.y1 : it.y0) - top);
          sc.drawImage(bmp, 0, 0);
          if (!drawnOnPlan.has(it.piece.id)) {
            drawnOnPlan.add(it.piece.id);
            pc.save();
            pc.imageSmoothingQuality = 'high';
            pc.setTransform(t ? -scale / PPM : scale / PPM, 0, 0, t ? -scale / PPM : scale / PPM, origin.x + ((t ? it.x1 : it.x0) / PPM) * scale, origin.y + ((t ? it.y1 : it.y0) / PPM) * scale);
            pc.drawImage(bmp, 0, 0);
            pc.restore();
          }
        }
        // Cut lines and labels over the print, in millimetres.
        sc.setTransform(PPM, 0, 0, PPM, 0, -top);
        for (const it of here) {
          const o = placeOutline(it.piece.outline, it.at);
          sc.beginPath();
          o.forEach(([x, y], i) => (i ? sc.lineTo(x, y) : sc.moveTo(x, y)));
          sc.closePath();
          sc.setLineDash([3, 2]);
          sc.lineWidth = 0.25;
          sc.strokeStyle = '#3A3A3A';
          sc.stroke();
          sc.setLineDash([]);
          const [ax, ay] = labelAnchor(it.piece.outline);
          const [lx, ly] = placeOutline([[ax, ay]], it.at)[0];
          const b = bounds(it.piece.outline);
          sc.save();
          sc.translate(lx, ly);
          if (it.at.turned) sc.rotate(Math.PI);
          sc.font = '600 3.6px system-ui, sans-serif';
          sc.textAlign = 'center';
          sc.textBaseline = 'middle';
          const text = `${sizeText(model, it.piece.info.size)} · ${it.piece.set.label} · ${it.piece.info.island.label}`;
          const maxWidth = Math.max(20, b.maxX - b.minX - 20);
          sc.lineWidth = 0.9;
          sc.strokeStyle = '#FFFFFF';
          sc.strokeText(text, 0, 0, maxWidth);
          sc.fillStyle = '#1A1A1A';
          sc.fillText(text, 0, 0, maxWidth);
          sc.restore();
        }
        for (const [key, last] of lastStrip) {
          if (last <= s && bitmaps.has(key)) {
            bitmaps.get(key)!.close();
            bitmaps.delete(key);
          }
        }
        await deflater.push(sc.getImageData(0, 0, W, h).data, h);
        stripsDone++;
        progress(`Fabric marker: roll length ${section.index + 1} of ${n}`, 0.45 + (0.53 * stripsDone) / Math.max(1, totalStrips));
      }
      const data = await deflater.finish();
      const blob =
        settings.format === 'pdf'
          ? buildPdf(
              [
                {
                  flateRgb: data,
                  widthPx: W,
                  heightPx: H,
                  widthPt: (W / PPM) * (72 / 25.4),
                  heightPt: (H / PPM) * (72 / 25.4),
                  overlay: cutContourPaths(
                    items.map((it) => simplifyOutline(placeOutline(it.piece.outline, it.at), 0.05)),
                    H / PPM,
                  ),
                },
              ],
              { title: `Fabric marker ${section.index + 1} of ${n}, ${ctx.caption}`, subject: `${opts.rollWidthMm / 10} cm roll, ${metres(section.lengthMm)}` },
            )
          : rgbPng(W, H, data, MARKER_DPI);
      files.push({ path: file, blob });
    } catch (error) {
      deflater.abort();
      throw error;
    } finally {
      for (const b of bitmaps.values()) b.close();
    }

    // Plan: the roll length's outline, cut lines and a small label on each piece.
    pc.save();
    pc.strokeStyle = '#B9BCC5';
    pc.lineWidth = 1;
    pc.strokeRect(origin.x - 0.5, origin.y - 0.5, opts.rollWidthMm * scale + 1, section.lengthMm * scale + 1);
    pc.setTransform(scale, 0, 0, scale, origin.x, origin.y);
    for (const it of items) {
      const o = placeOutline(it.piece.outline, it.at);
      pc.beginPath();
      o.forEach(([x, y], i) => (i ? pc.lineTo(x, y) : pc.moveTo(x, y)));
      pc.closePath();
      pc.lineWidth = 1.2 / scale;
      pc.strokeStyle = '#14151A';
      pc.stroke();
      const b = bounds(o);
      pc.font = `600 ${11 / scale}px system-ui, sans-serif`;
      pc.textAlign = 'center';
      pc.textBaseline = 'middle';
      const label = `${it.piece.info.size.code} ${it.piece.set.label.split(' ')[0]}`;
      pc.lineWidth = 3 / scale;
      pc.strokeStyle = '#FFFFFF';
      pc.strokeText(label, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
      pc.fillStyle = '#14151A';
      pc.fillText(label, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
      csv.push([
        section.index + 1,
        file,
        it.piece.set.index + 1,
        it.piece.set.row?.name ?? '',
        it.piece.set.row?.number ?? '',
        it.piece.info.size.code,
        it.piece.info.island.label,
        it.at.turned ? 180 : 0,
        b.minX.toFixed(1),
        b.minY.toFixed(1),
        (b.maxX - b.minX).toFixed(1),
        (b.maxY - b.minY).toFixed(1),
        (it.piece.info.areaMm2 / 100).toFixed(1),
      ]);
    }
    pc.restore();
    pc.fillStyle = '#14151A';
    pc.font = '600 14px system-ui, sans-serif';
    pc.textAlign = 'left';
    pc.textBaseline = 'alphabetic';
    pc.fillText(`${section.index + 1} of ${n} · ${metres(section.lengthMm)} · ${section.placements.length} pieces`, origin.x, origin.y + section.lengthMm * scale + 20);
    lengthsOut.push({ file, lengthMm: section.lengthMm, pieces: section.placements.length, utilisation: section.pieceAreaMm2 / (opts.rollWidthMm * section.lengthMm) });
    await yieldToUi();
  }
  release(strip);

  const planPath = 'marker/marker-plan.png';
  const listPath = 'marker/marker-pieces.csv';
  files.push({ path: planPath, blob: await canvasToBlob(plan) });
  release(plan);
  files.push({ path: listPath, blob: new Blob([toCsv(csv)], { type: 'text/csv;charset=utf-8' }) });
  progress('Fabric marker: done', 1);

  const sizeCounts = new Map<string, number>();
  for (const set of sets) sizeCounts.set(set.size.code, (sizeCounts.get(set.size.code) ?? 0) + 1);
  const summary: MarkerSummary = {
    rollWidthMm: opts.rollWidthMm,
    gapMm: opts.gapMm,
    marginMm: opts.marginMm,
    bleedMm: BLEED_MM,
    allowTurn: opts.allowTurn,
    format: settings.format,
    dpi: MARKER_DPI,
    garments,
    pieces: placed.length,
    sizes: model.sizes.filter((s) => sizeCounts.has(s.code)).map((s) => ({ code: s.code, garments: sizeCounts.get(s.code)! })),
    lengthMm: result.lengthMm,
    fabricAreaM2,
    pieceAreaM2: result.pieceAreaMm2 / 1e6,
    utilisation: result.utilisation,
    perGarmentMm: result.lengthMm / Math.max(1, garments),
    lengths: lengthsOut,
    plan: planPath,
    pieceList: listPath,
    unplaced: result.unplaced,
    strategy: result.strategy,
  };
  return { files, summary, warnings };
}
