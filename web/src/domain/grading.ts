/**
 * Artwork graded by size, for orders across sizes: the design is made on one size (its base), and
 * every other size prints it scaled by how much bigger or smaller that garment is where the print
 * goes: the chest across a front or back, the overall grade along a sleeve, the length down a leg.
 * The print area's top centre stays put (prints are placed down from the collar, on the centre
 * line), so artwork grows down and out from there. Grades are whole percent, as print shops use.
 * Design areas and artwork across seams keep their size: they are placed on the garment itself.
 * Pure, so it runs the same in the studio, the exports and the tests.
 */
import { getGarment, getSize, sizeLabel, type GarmentModel, type GarmentSize, type PartId, type ZoneSpec } from './garments';
import { rotatedBounds } from './geometry';
import type { DesignDocument, LayerStack, ZoneId } from './schema';

/** Graded artwork stays within these, whatever the size chart says. */
export const MIN_GRADE = 0.6;
export const MAX_GRADE = 1.6;

/** How much a part's artwork scales from `base` to `size`. */
export function gradeFactor(part: PartId, size: GarmentSize, base: GarmentSize): number {
  let ratio: number;
  if (part === 'torso') ratio = size.chestFlatMm / base.chestFlatMm;
  else if ((part === 'legLeft' || part === 'legRight') && size.pantsLengthMm && base.pantsLengthMm) ratio = size.pantsLengthMm / base.pantsLengthMm;
  else ratio = size.scale / base.scale;
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.round(Math.min(MAX_GRADE, Math.max(MIN_GRADE, ratio)) * 100) / 100;
}

/** The base size of a graded design on this model, or null when the design isn't graded. */
export function gradingBase(doc: Pick<DesignDocument, 'garment'>, model: GarmentModel = getGarment(doc.garment.modelId)): GarmentSize | null {
  const code = doc.garment.grading?.baseSize;
  return code && model.sizes.some((s) => s.code === code) ? getSize(model, code) : null;
}

/** Whether `code` is one of the model's sizes (a roster may name sizes the style doesn't come in). */
export function hasSize(model: GarmentModel, code: string | undefined): code is string {
  return !!code && model.sizes.some((s) => s.code === code);
}

/** The model size a roster's size names (any case, or its letter alias), if any. */
export function matchSize(model: GarmentModel, value: string | undefined): GarmentSize | undefined {
  const v = value?.trim().toUpperCase();
  if (!v) return undefined;
  return model.sizes.find((s) => s.code.toUpperCase() === v || s.alias?.toUpperCase() === v || (v === '2XL' && s.code === 'XXL') || (v === 'XXL' && s.code === '2XL'));
}

/** The grade a zone's artwork prints at on `sizeCode`: 1 when the design isn't graded, on its base, or for a size the style lacks. */
export function zoneGrade(doc: Pick<DesignDocument, 'garment'>, zoneId: ZoneId, sizeCode: string | undefined): number {
  const model = getGarment(doc.garment.modelId);
  const base = gradingBase(doc, model);
  const spec = model.zones[zoneId];
  if (!base || !spec || !hasSize(model, sizeCode)) return 1;
  return gradeFactor(spec.part, getSize(model, sizeCode), base);
}

/** Where a zone's artwork grows from (mm in the zone): the top centre of its print area. */
export function gradeAnchor(spec: Pick<ZoneSpec, 'printableWidthMm'>) {
  return { xMm: spec.printableWidthMm / 2, yMm: 0 };
}

/** A grade as a renderer applies it: scale by `factor` about the anchor. */
export interface Grade {
  factor: number;
  anchorXmm: number;
  anchorYmm: number;
}

export function gradeFor(spec: Pick<ZoneSpec, 'printableWidthMm'>, factor: number): Grade | undefined {
  if (Math.abs(factor - 1) < 1e-9) return undefined;
  const a = gradeAnchor(spec);
  return { factor, anchorXmm: a.xMm, anchorYmm: a.yMm };
}

/** The box round a stack's visible artwork, graded by `factor` about the anchor (mm in the zone), or null when empty. */
export function gradedBounds(zone: LayerStack, spec: Pick<ZoneSpec, 'printableWidthMm'>, factor: number): { x: number; y: number; w: number; h: number } | null {
  const shown = zone.orderedLayerIds.map((id) => zone.layers[id]).filter((l) => l?.visible);
  if (!shown.length) return null;
  const boxes = shown.map((l) => rotatedBounds(l.transform));
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  const { xMm: ax, yMm: ay } = gradeAnchor(spec);
  const gx = (x: number) => ax + (x - ax) * factor;
  const gy = (y: number) => ay + (y - ay) * factor;
  return { x: gx(x0), y: gy(y0), w: (x1 - x0) * factor, h: (y1 - y0) * factor };
}

/** How far graded artwork runs past its print area, at most, in mm (0 when it fits). */
export function gradedOverflowMm(zone: LayerStack, spec: Pick<ZoneSpec, 'printableWidthMm' | 'printableHeightMm'>, factor: number): number {
  const b = gradedBounds(zone, spec, factor);
  if (!b) return 0;
  return Math.max(0, -b.x, -b.y, b.x + b.w - spec.printableWidthMm, b.y + b.h - spec.printableHeightMm);
}

export interface GradedZone {
  zoneId: ZoneId;
  label: string;
  factor: number;
  /** The artwork's box at this size, mm. */
  widthMm: number;
  heightMm: number;
  /** How far it runs past the print area at this size, mm. */
  overflowMm: number;
}

export interface GradedSize {
  code: string;
  label: string;
  base: boolean;
  zones: GradedZone[];
}

/** Every size of a graded design with each printed zone's grade and artwork size; empty when not graded. */
export function gradingTable(doc: Pick<DesignDocument, 'garment' | 'zones'>): GradedSize[] {
  const model = getGarment(doc.garment.modelId);
  const base = gradingBase(doc, model);
  if (!base) return [];
  const zones = model.zoneOrder.filter((z) => model.zones[z] && doc.zones[z]?.orderedLayerIds.some((id) => doc.zones[z].layers[id]?.visible));
  return model.sizes.map((size) => ({
    code: size.code,
    label: sizeLabel(model, size),
    base: size.code === base.code,
    zones: zones.map((zoneId) => {
      const spec = model.zones[zoneId]!;
      const factor = gradeFactor(spec.part, size, base);
      const b = gradedBounds(doc.zones[zoneId], spec, factor);
      return { zoneId, label: spec.label, factor, widthMm: b?.w ?? 0, heightMm: b?.h ?? 0, overflowMm: gradedOverflowMm(doc.zones[zoneId], spec, factor) };
    }),
  }));
}
