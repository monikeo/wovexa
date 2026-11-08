/**
 * Garment flat with a zone's artwork placed on it, from the canonical renderer.
 * Used for project thumbnails (spec PRJ-02) and tech-pack sketches (spec FAC-02).
 */
import { sketchForZone } from '@/components/studio/editor2d/flat-sketch';
import { getGarment, getSize } from '@/domain/garments';
import type { DesignDocument, ZoneId } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from './assets';
import { canvasToBlob } from './download';
import { drawZone, ensureFonts } from './render/zone-renderer';

export async function renderZoneSketch(doc: DesignDocument, zoneId: ZoneId, size = 360, opts: { printArea?: boolean } = {}) {
  const model = getGarment(doc.garment.modelId);
  const garmentSize = getSize(model, doc.garment.sizeCode);
  const spec = model.zones[zoneId];
  const colorway = doc.colorways.find((c) => c.id === doc.activeColorwayId) ?? doc.colorways[0];
  const zone = doc.zones[zoneId];

  await Promise.all(
    Object.values(zone.layers).map((l) =>
      l.content.kind === 'image' && !getLoadedImage(l.content.assetId) ? loadAssetImage(l.content.assetId).catch(() => null) : null,
    ),
  );
  await ensureFonts([zone]);

  const sketch = sketchForZone(model, spec, garmentSize.scale);
  const xs = sketch.body.map(([x]) => x);
  const ys = sketch.body.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  const scale = (size * 0.88) / Math.max(w, h);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.translate((size - w * scale) / 2 - minX * scale, (size - h * scale) / 2 - minY * scale);
  ctx.scale(scale, scale);
  const outline = () => {
    ctx.beginPath();
    sketch.body.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  outline();
  ctx.fillStyle = spec.part === 'torso' ? colorway.parts.body : colorway.parts.sleeves;
  ctx.fill();
  ctx.lineWidth = 1.5 / scale;
  ctx.strokeStyle = 'rgba(110,114,125,0.7)';
  ctx.stroke();
  if (sketch.collar) {
    ctx.beginPath();
    sketch.collar.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.strokeStyle = colorway.parts.collar;
    ctx.stroke();
  }
  ctx.save();
  outline();
  ctx.clip();
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
