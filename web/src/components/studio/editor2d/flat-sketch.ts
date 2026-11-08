/**
 * Flat technical sketch of the garment around a print zone, in zone millimetres
 * (origin = top-left of the printable area). Drawn behind the artboard so placement is
 * judged against the real garment, the way a tech pack shows it.
 */
import type { GarmentModel, ZoneSpec } from '@/domain/garments';

export interface Sketch {
  body: [number, number][];
  /** Neckline rib, drawn as a thick stroke. */
  collar?: [number, number][];
  /** Seam and hem lines. */
  seams: [number, number][][];
}

export function sketchForZone(model: GarmentModel, zone: ZoneSpec, scale = 1): Sketch {
  if (zone.part !== 'torso') return sleeveSketch(model, zone, scale);
  const s = scale;
  const cx = zone.printableWidthMm / 2;
  const hps = -(zone.topFromHpsMm ?? 0);
  const neck = model.neckRadiusMm * s;
  const drop = (zone.id === 'front' ? model.frontNeckDropMm : model.backNeckDropMm) * s;
  const shoulderX = model.shoulderHalfWidthMm * s;
  const shoulderY = hps + model.shoulderSlope * (shoulderX - neck);
  const a = (model.sleeveAngleDeg * Math.PI) / 180;
  const len = model.sleeveLengthMm * s;
  const cuff = 160 * s;
  const sleeveTop: [number, number] = [shoulderX + Math.cos(a) * len, shoulderY + Math.sin(a) * len];
  const sleeveBottom: [number, number] = [sleeveTop[0] - Math.sin(a) * cuff, sleeveTop[1] + Math.cos(a) * cuff];
  const armpit: [number, number] = [model.chestHalfWidthMm * s, hps + model.bodyLengthMm * s * 0.36];
  const hemY = hps + model.bodyLengthMm * s;
  const hemX = model.chestHalfWidthMm * s * 0.975;

  const neckCurve: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const x = -neck + (2 * neck * i) / 24;
    neckCurve.push([x, hps + drop * (1 - (x / neck) ** 2)]);
  }
  const right: [number, number][] = [[neck, hps], [shoulderX, shoulderY], sleeveTop, sleeveBottom, armpit, [hemX, hemY]];
  const left = right.map(([x, y]) => [-x, y] as [number, number]).reverse();
  const body = [...neckCurve, ...right, ...left].map(([x, y]) => [x + cx, y] as [number, number]);

  return {
    body,
    collar: neckCurve.map(([x, y]) => [x + cx, y]),
    seams: [
      [[cx - hemX, hemY - 22 * s], [cx + hemX, hemY - 22 * s]],
      [[cx + shoulderX, shoulderY], [cx + armpit[0], armpit[1]]],
      [[cx - shoulderX, shoulderY], [cx - armpit[0], armpit[1]]],
    ],
  };
}

function sleeveSketch(model: GarmentModel, zone: ZoneSpec, s: number): Sketch {
  const cx = zone.printableWidthMm / 2;
  const cy = zone.printableHeightMm / 2;
  const seamY = cy - (zone.centerFromShoulderMm ?? 90);
  const cuffY = seamY + model.sleeveLengthMm * s;
  const top = 112 * s;
  const bottom = 86 * s;
  return {
    body: [
      [cx - top, seamY],
      [cx + top, seamY],
      [cx + bottom, cuffY],
      [cx - bottom, cuffY],
    ],
    seams: [
      [[cx - bottom * 1.02, cuffY - 18 * s], [cx + bottom * 1.02, cuffY - 18 * s]],
    ],
  };
}
