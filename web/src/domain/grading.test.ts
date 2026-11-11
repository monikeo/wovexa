import { describe, expect, it } from 'vitest';
import * as cmd from './commands';
import { createDocument, createShapeLayer } from './factory';
import { getGarment, getSize, zoneSpecOrFirst } from './garments';
import { gradeFactor, gradedBounds, gradedOverflowMm, gradingBase, gradingTable, matchSize, zoneGrade } from './grading';
import { applyCommand, emptyHistory } from './history';
import { runPreflight } from './preflight';
import { parseDesignDocument, type DesignDocument } from './schema';

const tee = getGarment('tee-classic');
const front = zoneSpecOrFirst(tee, 'front');

/** A tee with a 200 × 100 mm block at the top centre of the front. */
function design(base?: string) {
  let d: DesignDocument = createDocument({ projectId: 'p1', title: 'Graded', colorwayIndex: 0 });
  const block = createShapeLayer(front, 'rect');
  Object.assign(block.transform, { centerXmm: front.printableWidthMm / 2, centerYmm: 60, widthMm: 200, heightMm: 100 });
  const run = (c: cmd.Command) => (d = applyCommand(d, emptyHistory(), c).document);
  run(cmd.addLayer('front', block));
  if (base) run(cmd.setGrading(base));
  return { get d() { return d; }, run, block };
}

describe('artwork graded by size', () => {
  it('scales a front or back by the chest, a sleeve by the overall grade, in whole percent', () => {
    const m = getSize(tee, 'M');
    const xl = getSize(tee, 'XL');
    expect(gradeFactor('torso', xl, m)).toBeCloseTo(Math.round((xl.chestFlatMm / m.chestFlatMm) * 100) / 100, 9);
    expect(gradeFactor('sleeveLeft', xl, m)).toBeCloseTo(Math.round((xl.scale / m.scale) * 100) / 100, 9);
    expect(gradeFactor('torso', m, m)).toBe(1);
    expect(gradeFactor('torso', getSize(tee, 'S'), m)).toBeLessThan(1);
  });

  it('applies only when graded, on sizes the style has', () => {
    expect(zoneGrade(design().d, 'front', 'XL')).toBe(1);
    const t = design('M');
    expect(gradingBase(t.d)?.code).toBe('M');
    expect(zoneGrade(t.d, 'front', 'M')).toBe(1);
    expect(zoneGrade(t.d, 'front', 'XL')).toBeGreaterThan(1);
    expect(zoneGrade(t.d, 'front', 'NOPE')).toBe(1);
    expect(parseDesignDocument(JSON.parse(JSON.stringify(t.d))).ok).toBe(true);
    t.run(cmd.setGrading(null));
    expect(t.d.garment.grading).toBeUndefined();
  });

  it('grows artwork from the top centre of the print area', () => {
    const t = design('M');
    const b = gradedBounds(t.d.zones.front, front, 1.1)!;
    // Centred on the centre line, its top (10 mm down) 10% further down, 10% bigger.
    expect(b.x + b.w / 2).toBeCloseTo(front.printableWidthMm / 2, 9);
    expect(b.y).toBeCloseTo(10 * 1.1, 9);
    expect(b.w).toBeCloseTo(220, 9);
    expect(b.h).toBeCloseTo(110, 9);
  });

  it('tells how far graded artwork runs past the print area, and warns once per zone', () => {
    const t = design('M');
    // Nearly as wide as the print area: fine on M, cut off on the biggest sizes.
    t.run(cmd.updateTransforms('front', { [t.block.id]: { widthMm: front.printableWidthMm - 4 } }));
    expect(gradedOverflowMm(t.d.zones.front, front, 1)).toBe(0);
    expect(gradedOverflowMm(t.d.zones.front, front, 1.1)).toBeCloseTo(((front.printableWidthMm - 4) * 1.1 - front.printableWidthMm) / 2, 6);
    const table = gradingTable(t.d);
    expect(table.map((s) => s.code)).toEqual(tee.sizes.map((s) => s.code));
    expect(table.find((s) => s.code === 'M')!.base).toBe(true);
    const issues = runPreflight(t.d).filter((i) => i.code === 'graded_overflow');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/^On .*XL.* the artwork grows past the front print area/);
  });

  it('keeps a graded design graded when the style changes, from a size the new style has', () => {
    const t = design('M');
    const dobok = getGarment('taekwondo-dobok');
    // Dobok sizes are heights in cm: there is no M.
    expect(dobok.id).toBe('taekwondo-dobok');
    expect(dobok.sizes.some((s) => s.code === 'M')).toBe(false);
    t.run(cmd.setGarmentModel(dobok));
    expect(t.d.garment.modelId).toBe('taekwondo-dobok');
    expect(dobok.sizes.some((s) => s.code === t.d.garment.grading!.baseSize)).toBe(true);
    expect(t.d.garment.grading!.baseSize).toBe(t.d.garment.sizeCode);
  });

  it('matches roster sizes in any case, by alias, and 2XL to XXL', () => {
    expect(matchSize(tee, 'xl')?.code).toBe('XL');
    expect(matchSize(tee, ' m ')?.code).toBe('M');
    expect(matchSize(tee, 'giant')).toBeUndefined();
    const xxl = tee.sizes.find((s) => s.code === 'XXL' || s.code === '2XL');
    if (xxl) expect(matchSize(tee, xxl.code === 'XXL' ? '2XL' : 'XXL')?.code).toBe(xxl.code);
  });
});
