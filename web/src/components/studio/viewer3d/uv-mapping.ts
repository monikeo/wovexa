/**
 * Garment UV ↔ print-zone millimetres (spec §27.2 rule 3: translate the UV hit into the
 * zone's coordinate system through the garment's authoring mapping, not a global constant).
 * Pure functions: the exact inverse of how garment-textures places each zone on its part.
 */
import type { GarmentModel, PartId } from '@/domain/garments';
import type { ZoneId } from '@/domain/schema';
import type { GarmentLayout } from './garment-geometry';

export type GarmentPart = PartId;

export interface ZonePoint {
  zoneId: ZoneId;
  xMm: number;
  yMm: number;
}

function partSpan(layout: GarmentLayout, part: PartId) {
  if (part === 'torso') return { w: layout.torsoCircumferenceMm, h: layout.torsoHeightMm };
  if (part === 'sleeveLeft' || part === 'sleeveRight') return { w: layout.sleeveCircumferenceMm, h: layout.sleeveLengthMm };
  return { w: layout.legCircumferenceMm, h: layout.legLengthMm };
}

/** Top-left of a zone's print area in its part's texture, in millimetres. */
export function zoneOrigin(model: GarmentModel, layout: GarmentLayout, zoneId: ZoneId) {
  const spec = model.zones[zoneId];
  if (!spec) return { x: 0, y: 0 };
  if (spec.part === 'torso') {
    const centerU = zoneId === 'front' ? layout.frontCenterU : layout.backCenterU;
    return { x: centerU * layout.torsoCircumferenceMm - spec.printableWidthMm / 2, y: spec.topFromHpsMm ?? 0 };
  }
  if (spec.part === 'sleeveLeft' || spec.part === 'sleeveRight') {
    const along = layout.sleeveSeamOffsetMm + (spec.centerFromShoulderMm ?? 90);
    return { x: layout.sleeveCircumferenceMm / 2 - spec.printableWidthMm / 2, y: along - spec.printableHeightMm / 2 };
  }
  return { x: layout.legCircumferenceMm / 2 - spec.printableWidthMm / 2, y: spec.topFromWaistMm ?? 0 };
}

const PART_ZONE: Record<Exclude<PartId, 'torso'>, ZoneId> = {
  sleeveLeft: 'left_sleeve',
  sleeveRight: 'right_sleeve',
  legLeft: 'left_leg',
  legRight: 'right_leg',
};

/** UV on a garment part → the zone it belongs to and the point in that zone's millimetres; null if the garment has no zone there. */
export function uvToZone(model: GarmentModel, layout: GarmentLayout, part: PartId, u: number, v: number): ZonePoint | null {
  let zoneId: ZoneId;
  if (part === 'torso') {
    // Front is centred at u = 0.75, back at u = 0.25; whichever is nearer owns the hit.
    zoneId = Math.abs(u - layout.frontCenterU) <= 0.25 ? 'front' : 'back';
  } else {
    zoneId = PART_ZONE[part];
  }
  if (!model.zones[zoneId]) return null;
  const o = zoneOrigin(model, layout, zoneId);
  const { w, h } = partSpan(layout, part);
  return { zoneId, xMm: u * w - o.x, yMm: (1 - v) * h - o.y };
}

export function partForZone(zoneId: ZoneId): PartId {
  if (zoneId === 'left_sleeve') return 'sleeveLeft';
  if (zoneId === 'right_sleeve') return 'sleeveRight';
  if (zoneId === 'left_leg') return 'legLeft';
  if (zoneId === 'right_leg') return 'legRight';
  return 'torso';
}

/**
 * UV → millimetres in one given zone, for dragging artwork across the surface. Unlike
 * uvToZone it never switches zone, and it unwraps the torso seam so a drag stays continuous.
 */
export function uvInZone(model: GarmentModel, layout: GarmentLayout, zoneId: ZoneId, u: number, v: number) {
  const o = zoneOrigin(model, layout, zoneId);
  const part = partForZone(zoneId);
  const { w, h } = partSpan(layout, part);
  if (part === 'torso') {
    const center = zoneId === 'front' ? layout.frontCenterU : layout.backCenterU;
    const uu = u - center > 0.5 ? u - 1 : center - u > 0.5 ? u + 1 : u;
    return { xMm: uu * w - o.x, yMm: (1 - v) * h - o.y };
  }
  return { xMm: u * w - o.x, yMm: (1 - v) * h - o.y };
}

/** Zone millimetres → UV on its garment part (used by tests and guides). */
export function zoneToUv(model: GarmentModel, layout: GarmentLayout, zoneId: ZoneId, xMm: number, yMm: number) {
  const o = zoneOrigin(model, layout, zoneId);
  const { w, h } = partSpan(layout, partForZone(zoneId));
  return { u: (xMm + o.x) / w, v: 1 - (yMm + o.y) / h };
}
