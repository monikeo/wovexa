/**
 * Cut-and-sew panels for all-over printing (sublimation): every pattern piece of the garment
 * with its fabric print and artwork at true size, 10 mm of bleed and a cut line. The pieces are
 * cut from the 3D garment's own fabric layout, so the printed fabric matches the 3D preview.
 * Artwork projected across seams is split at each seam: every panel carries its own share.
 */
import { buildGarment, type GarmentIsland } from '@/components/studio/viewer3d/garment-geometry';
import { drawPart, partSizeMm } from '@/components/studio/viewer3d/garment-textures';
import { drawPatches, projectionBleed, sceneRest, type ProjectionScene } from '@/components/studio/viewer3d/projected-paint';
import { insideOutline, meshPieces } from '@/components/studio/viewer3d/projection';
import { getGarment, getSize, partColor, type PartId } from '@/domain/garments';
import type { Colorway, DesignDocument } from '@/domain/schema';
import { BLEED_MM } from './marker-layout';

export interface CutPiece {
  id: string;
  label: string;
  canvas: HTMLCanvasElement;
  dpi: number;
  widthMm: number;
  heightMm: number;
}

const MARGIN_MM = 14;

export function renderCutAndSew(doc: DesignDocument, colorway: Colorway, caption: string): CutPiece[] {
  const model = getGarment(doc.garment.modelId);
  const size = getSize(model, doc.garment.sizeCode);
  // Flat pattern pieces only: no need to build the 3D folds.
  const geo = buildGarment(model, size, 'high', 0);
  const textures = new Map<PartId, HTMLCanvasElement>();
  const pieces: CutPiece[] = [];
  // Projected artwork lands on this same pressed-flat garment, so the panels match the 3D view.
  const scene: ProjectionScene = { doc, rest: sceneRest(geo), geo, live: null };
  const piecesOf = new Map<PartId, Int32Array>();
  /** The triangles of one pattern piece: the connected part of its mesh that lies inside its outline. */
  const pieceFilter = (island: GarmentIsland) => {
    const mesh = scene.rest.parts.find((p) => p.id === island.part)?.mesh;
    if (!mesh) return null;
    let ids = piecesOf.get(island.part);
    if (!ids) {
      ids = meshPieces(mesh);
      piecesOf.set(island.part, ids);
    }
    const seen = new Set<number>();
    for (let t = 0; t < ids.length; t++) {
      if (seen.has(ids[t])) continue;
      seen.add(ids[t]);
      const [a, b, c] = [mesh.index[t * 3], mesh.index[t * 3 + 1], mesh.index[t * 3 + 2]];
      const u = (mesh.uv[a * 2] + mesh.uv[b * 2] + mesh.uv[c * 2]) / 3;
      const v = (mesh.uv[a * 2 + 1] + mesh.uv[b * 2 + 1] + mesh.uv[c * 2 + 1]) / 3;
      if (insideOutline(u, v, island.uv)) {
        const piece = ids[t];
        const all = ids;
        return (triangle: number) => all[triangle] === piece;
      }
    }
    return null;
  };
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
      // Artwork across seams carries on past this piece's own edges into its bleed, outside the
      // cut line only, so a slightly wide cut still lands on print, not on bare fabric.
      if (scene.doc.projections.orderedLayerIds.length) {
        const keep = pieceFilter(island);
        const bleedArt = keep ? projectionBleed(scene, island.part, ppm, { width: tex.width, height: tex.height }, keep, Math.ceil(bleed)) : null;
        if (bleedArt?.length) {
          const band = document.createElement('canvas');
          band.width = W;
          band.height = H;
          const b = band.getContext('2d')!;
          for (const l of bleedArt) drawPatches(b, l.patches, x0, y0, l.opacity, l.blend);
          b.globalCompositeOperation = 'destination-out';
          b.beginPath();
          pts.forEach(([x, y], i) => (i ? b.lineTo(x - x0, y - y0) : b.moveTo(x - x0, y - y0)));
          b.closePath();
          b.fill();
          f.drawImage(band, 0, 0);
          band.width = band.height = 0;
        }
      }
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
