/**
 * Composes garment textures from the canonical document: fabric colour, stitching, and each
 * zone's artwork placed at its true physical position (spec §27.1 "mark zone dirty → redraw").
 */
import type { GarmentModel } from '@/domain/garments';
import type { Colorway, DesignDocument, LayerTransform, ZoneId } from '@/domain/schema';
import { drawZone } from '@/lib/render/zone-renderer';
import type { TeeLayout } from './tee-geometry';

export type Quality = 'low' | 'medium' | 'high';

/** Texture density per quality profile (spec §24.2–24.3). */
export const PX_PER_MM: Record<Quality, number> = { low: 0.8, medium: 1.25, high: 1.7 };
const MAX_TEXTURE = 2048;

type Overrides = Record<string, Partial<LayerTransform>> | undefined;

function sized(canvas: HTMLCanvasElement, wMm: number, hMm: number, quality: Quality) {
  const ppm = Math.min(PX_PER_MM[quality], MAX_TEXTURE / Math.max(wMm, hMm));
  const w = Math.round(wMm * ppm);
  const h = Math.round(hMm * ppm);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return ppm;
}

function stitchLine(ctx: CanvasRenderingContext2D, y: number, width: number, color: string, ppm: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, 0.7 * ppm);
  ctx.setLineDash([3 * ppm, 1.6 * ppm]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
  ctx.restore();
}

/** Torso texture: front and back print zones on the body colour. Returns false while images load. */
export function drawTorso(
  canvas: HTMLCanvasElement,
  doc: DesignDocument,
  model: GarmentModel,
  layout: TeeLayout,
  colorway: Colorway,
  quality: Quality,
  live?: { zoneId: ZoneId | null; overrides: Overrides },
): boolean {
  const C = layout.torsoCircumferenceMm;
  const H = layout.torsoHeightMm;
  const ppm = sized(canvas, C, H, quality);
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = colorway.parts.body;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Double-needle hem, 20 mm above the bottom edge.
  stitchLine(ctx, canvas.height - 20 * ppm, canvas.width, colorway.parts.stitching, ppm);
  stitchLine(ctx, canvas.height - 26 * ppm, canvas.width, colorway.parts.stitching, ppm);

  let complete = true;
  for (const zoneId of ['front', 'back'] as const) {
    const spec = model.zones[zoneId];
    const centerU = zoneId === 'front' ? layout.frontCenterU : layout.backCenterU;
    const originX = (centerU * C - spec.printableWidthMm / 2) * ppm;
    const originY = (spec.topFromHpsMm ?? 0) * ppm;
    complete =
      drawZone(ctx, doc.zones[zoneId], {
        pxPerMm: ppm,
        originX,
        originY,
        overrides: live?.zoneId === zoneId ? live.overrides : undefined,
      }) && complete;
  }
  return complete;
}

export function drawSleeve(
  canvas: HTMLCanvasElement,
  doc: DesignDocument,
  model: GarmentModel,
  layout: TeeLayout,
  colorway: Colorway,
  quality: Quality,
  zoneId: 'left_sleeve' | 'right_sleeve',
  live?: { zoneId: ZoneId | null; overrides: Overrides },
): boolean {
  const C = layout.sleeveCircumferenceMm;
  const L = layout.sleeveLengthMm;
  const ppm = sized(canvas, C, L, quality);
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = colorway.parts.sleeves;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Cuff hem stitching near the open end (bottom of the texture is the cuff).
  stitchLine(ctx, canvas.height - 18 * ppm, canvas.width, colorway.parts.stitching, ppm);

  const spec = model.zones[zoneId];
  const centerAlong = layout.sleeveSeamOffsetMm + (spec.centerFromShoulderMm ?? 90);
  return drawZone(ctx, doc.zones[zoneId], {
    pxPerMm: ppm,
    originX: (C / 2 - spec.printableWidthMm / 2) * ppm,
    originY: (centerAlong - spec.printableHeightMm / 2) * ppm,
    overrides: live?.zoneId === zoneId ? live.overrides : undefined,
  });
}
