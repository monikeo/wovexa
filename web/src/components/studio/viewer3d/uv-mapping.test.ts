import { describe, expect, it } from 'vitest';
import { DOBOK, GARMENT_LIST, TANK, TEE_CLASSIC } from '@/domain/garments';
import { hitTestLayer } from '@/domain/geometry';
import type { GarmentLayout } from './garment-geometry';
import { partForZone, uvInZone, uvToZone, zoneToUv } from './uv-mapping';

// A layout like the one buildGarment produces for size M (values from the procedural garment).
const layout: GarmentLayout = {
  torsoCircumferenceMm: 1240,
  torsoHeightMm: 720,
  frontCenterU: 0.75,
  backCenterU: 0.25,
  sleeveCircumferenceMm: 560,
  sleeveLengthMm: 245,
  sleeveSeamOffsetMm: 30,
  legCircumferenceMm: 920,
  legLengthMm: 1070,
  heightMm: 1500,
  widthMm: 1240,
  bottomMm: -800,
};

describe('UV ↔ zone mapping', () => {
  for (const model of GARMENT_LIST) {
    it.each(model.zoneOrder)(`round-trips points in the %s zone of the ${model.shortName} within 0.001 mm`, (zoneId) => {
      const spec = model.zones[zoneId]!;
      for (const [x, y] of [[0, 0], [spec.printableWidthMm / 2, spec.printableHeightMm / 2], [spec.printableWidthMm, spec.printableHeightMm], [12.5, 33.3]]) {
        const { u, v } = zoneToUv(model, layout, zoneId, x, y);
        const back = uvToZone(model, layout, partForZone(zoneId), u, v)!;
        expect(back.zoneId).toBe(zoneId);
        expect(back.xMm).toBeCloseTo(x, 3);
        expect(back.yMm).toBeCloseTo(y, 3);
      }
    });
  }

  it('puts the front print centre at the front of the torso', () => {
    const spec = TEE_CLASSIC.zones.front!;
    const { u } = zoneToUv(TEE_CLASSIC, layout, 'front', spec.printableWidthMm / 2, 0);
    expect(u).toBeCloseTo(0.75, 6);
  });

  it('centres sleeve and leg prints on the top of the sleeve and the outside of the leg', () => {
    expect(zoneToUv(TEE_CLASSIC, layout, 'left_sleeve', TEE_CLASSIC.zones.left_sleeve!.printableWidthMm / 2, 0).u).toBeCloseTo(0.5, 6);
    expect(zoneToUv(DOBOK, layout, 'right_leg', DOBOK.zones.right_leg!.printableWidthMm / 2, 0).u).toBeCloseTo(0.5, 6);
  });

  it('reports no zone where a garment has none', () => {
    expect(uvToZone(TANK, layout, 'sleeveLeft', 0.5, 0.5)).toBeNull();
    expect(uvToZone(TEE_CLASSIC, layout, 'legLeft', 0.5, 0.5)).toBeNull();
  });

  it('keeps a drag continuous across the torso seam', () => {
    const o = uvToZone(TEE_CLASSIC, layout, 'torso', 0.98, 0.7)!;
    // Dragging the front artwork past the side seam (u wraps from 0.99 to 0.01).
    const before = uvInZone(TEE_CLASSIC, layout, 'front', 0.99, 0.7);
    const after = uvInZone(TEE_CLASSIC, layout, 'front', 0.01, 0.7);
    expect(o.zoneId).toBe('front');
    expect(after.xMm - before.xMm).toBeCloseTo(0.02 * layout.torsoCircumferenceMm, 6);
    expect(partForZone('left_sleeve')).toBe('sleeveLeft');
    expect(partForZone('right_leg')).toBe('legRight');
    expect(partForZone('back')).toBe('torso');
  });

  it('finds the topmost layer under a point, respecting rotation', () => {
    const zone = {
      orderedLayerIds: ['under', 'over'],
      layers: {
        under: { visible: true, transform: { centerXmm: 100, centerYmm: 100, widthMm: 80, heightMm: 80, rotationDeg: 0, flipX: false, flipY: false } },
        over: { visible: true, transform: { centerXmm: 100, centerYmm: 100, widthMm: 100, heightMm: 10, rotationDeg: 90, flipX: false, flipY: false } },
      },
    };
    expect(hitTestLayer(zone, 100, 140)).toBe('over'); // inside the rotated bar
    expect(hitTestLayer(zone, 130, 100)).toBe('under'); // outside the bar, inside the square
    expect(hitTestLayer(zone, 200, 200)).toBeNull();
  });
});
