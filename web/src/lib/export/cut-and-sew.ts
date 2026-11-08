/**
 * Cut-and-sew panels for all-over printing (sublimation): every pattern piece of the garment
 * with its fabric print and artwork at true size, 10 mm of bleed and a cut line. The pieces are
 * cut from the 3D garment's own fabric layout, so the printed fabric matches the 3D preview.
 */
import { buildGarment } from '@/components/studio/viewer3d/garment-geometry';
import { drawPart, partSizeMm } from '@/components/studio/viewer3d/garment-textures';
import { getGarment, getSize, partColor, type PartId } from '@/domain/garments';
import type { Colorway, DesignDocument } from '@/domain/schema';

export interface CutPiece {
  id: string;
  label: string;
  canvas: HTMLCanvasElement;
  dpi: number;
  widthMm: number;
  heightMm: number;
}

const BLEED_MM = 10;
const MARGIN_MM = 14;

export function renderCutAndSew(doc: DesignDocument, colorway: Colorway, caption: string): CutPiece[] {
  const model = getGarment(doc.garment.modelId);
  const size = getSize(model, doc.garment.sizeCode);
  // Flat pattern pieces only: no need to build the 3D folds.
  const geo = buildGarment(model, size, 'high', 0);
  const textures = new Map<PartId, HTMLCanvasElement>();
  const pieces: CutPiece[] = [];
  try {
    for (const island of geo.islands) {
      let tex = textures.get(island.part);
      if (!tex) {
        tex = document.createElement('canvas');
        drawPart(tex, island.part, { doc, model, geo, colorway, quality: 'print', production: true });
        textures.set(island.part, tex);
      }
      const ppm = tex.width / partSizeMm(geo, island.part).w;
      const pts = island.uv.map(([u, v]) => [u * tex!.width, (1 - v) * tex!.height] as const);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const bleed = BLEED_MM * ppm;
      const pad = MARGIN_MM * ppm;
      const x0 = Math.min(...xs) - bleed - pad;
      const y0 = Math.min(...ys) - bleed - pad;
      const W = Math.ceil(Math.max(...xs) - x0 + bleed + pad);
      const H = Math.ceil(Math.max(...ys) - y0 + bleed + pad);
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;
      const trace = () => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - x0, y - y0) : ctx.moveTo(x - x0, y - y0)));
        ctx.closePath();
      };
      // The fabric for this window: the base colour, then the print. The fabric wraps around the
      // body, so the bleed past a seam continues the print from the neighbouring panel.
      const fabric = document.createElement('canvas');
      fabric.width = W;
      fabric.height = H;
      const f = fabric.getContext('2d')!;
      f.fillStyle = partColor(colorway, island.part === 'torso' ? 'body' : island.part.startsWith('leg') ? 'pants' : 'sleeves');
      f.fillRect(0, 0, W, H);
      for (const shift of [-tex.width, 0, tex.width]) f.drawImage(tex, shift - x0, -y0);
      // The piece plus bleed as a mask, then the fabric through it in one step.
      trace();
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineWidth = bleed * 2;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-in';
      ctx.drawImage(fabric, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      fabric.width = fabric.height = 0;
      // Cut line: a hairline on the finished edge, for the cutter to follow.
      trace();
      ctx.setLineDash([3 * ppm, 2 * ppm]);
      ctx.lineWidth = Math.max(1, 0.25 * ppm);
      ctx.strokeStyle = '#3A3A3A';
      ctx.stroke();
      ctx.setLineDash([]);
      // Label in the margin, outside the bleed.
      ctx.fillStyle = '#3A3A3A';
      ctx.font = `${Math.round(3.6 * ppm)}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(`${island.label}  ·  ${caption}  ·  ${Math.round(ppm * 25.4)} dpi  ·  bleed ${BLEED_MM} mm`, pad * 0.5, pad * 0.5);
      pieces.push({ id: island.id, label: island.label, canvas, dpi: Math.round(ppm * 25.4), widthMm: W / ppm, heightMm: H / ppm });
    }
  } finally {
    for (const t of textures.values()) t.width = t.height = 0;
    for (const p of geo.parts) p.geometry.dispose();
    for (const t of geo.trims) t.geometry.dispose();
  }
  return pieces;
}
