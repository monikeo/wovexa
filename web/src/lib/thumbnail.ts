/**
 * Garment flat with a zone's artwork placed on it, from the canonical renderer.
 * Used for project thumbnails (spec PRJ-02), tech-pack sketches (spec FAC-02) and the
 * production package's placement drawings.
 */
import { drawSketch, sketchBounds, sketchForZone } from '@/components/studio/editor2d/flat-sketch';
import { getGarment, getSize, zoneSpecOrFirst } from '@/domain/garments';
import { gradeAnchor, zoneGrade } from '@/domain/grading';
import { layerAssetIds } from '@/domain/lockups';
import type { DesignDocument, ZoneId } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from './assets';
import { canvasToBlob } from './download';
import { drawZone, ensureFonts } from './render/zone-renderer';

export async function renderZoneSketch(doc: DesignDocument, zoneId: ZoneId, size = 360, opts: { printArea?: boolean; colorwayId?: string; sizeCode?: string } = {}) {
  const model = getGarment(doc.garment.modelId);
  // The garment in the size asked for (the size on show by default), its artwork at that size's scale when graded by size.
  const garmentSize = getSize(model, opts.sizeCode ?? doc.garment.sizeCode);
  const spec = zoneSpecOrFirst(model, zoneId);
  const colorway = doc.colorways.find((c) => c.id === (opts.colorwayId ?? doc.activeColorwayId)) ?? doc.colorways[0];
  const zone = doc.zones[spec.id];

  const assetIds = new Set<string>();
  for (const l of Object.values(zone.layers)) for (const id of layerAssetIds(l)) assetIds.add(id);
  for (const s of Object.values(colorway.surfaces ?? {})) if (s?.kind === 'image') assetIds.add(s.assetId);
  await Promise.all([...assetIds].map((id) => (getLoadedImage(id) ? null : loadAssetImage(id).catch(() => null))));
  await ensureFonts([zone]);

  const sketch = sketchForZone(model, spec, garmentSize.scale);
  const b = sketchBounds(sketch);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const scale = (size * 0.9) / Math.max(w, h);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.translate((size - w * scale) / 2 - b.minX * scale, (size - h * scale) / 2 - b.minY * scale);
  ctx.scale(scale, scale);
  drawSketch(ctx, sketch, colorway, scale);
  // Artwork is clipped to the panel it is printed on.
  ctx.save();
  ctx.beginPath();
  sketch.body.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  const factor = zoneGrade(doc, spec.id, garmentSize.code);
  if (factor !== 1) {
    const a = gradeAnchor(spec);
    ctx.translate(a.xMm, a.yMm);
    ctx.scale(factor, factor);
    ctx.translate(-a.xMm, -a.yMm);
  }
  drawZone(ctx, zone, { pxPerMm: 1 });
  ctx.restore();
  if (opts.printArea) {
    ctx.setLineDash([14 / scale, 9 / scale]);
    ctx.lineWidth = 3 / scale;
    ctx.strokeStyle = '#2b59ff';
    ctx.strokeRect(0, 0, spec.printableWidthMm, spec.printableHeightMm);
  }
  return canvas;
}

export async function renderThumbnail(doc: DesignDocument, size = 360): Promise<Blob> {
  return canvasToBlob(await renderZoneSketch(doc, 'front', size), 'image/webp', 0.86);
}

/**
 * A thumbnail, or none when drawing it fails or takes longer than `ms` (a font or image slow to
 * load), so saving a project or a version never waits on it.
 */
export function thumbnailWithin(doc: DesignDocument, ms = 4000): Promise<Blob | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(resolve, ms, undefined)));
  return Promise.race([renderThumbnail(doc).catch(() => undefined), late]).finally(() => clearTimeout(timer));
}
