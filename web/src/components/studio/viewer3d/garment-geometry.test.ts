import { describe, expect, it } from 'vitest';
import { DOBOK, GARMENT_LIST, getSize, TANK, TEE_CLASSIC } from '@/domain/garments';
import { designDocumentSchema } from '@/domain/schema';
import { createDocument } from '@/domain/factory';
import { buildGarment } from './garment-geometry';

describe('size charts', () => {
  it('builds every dobok size to its chart: jacket, chest, sleeve and pants', () => {
    for (const code of ['100', '140', '170', '210']) {
      const size = getSize(DOBOK, code);
      const geo = buildGarment(DOBOK, size, 'low', 0);
      expect(geo.layout.torsoHeightMm).toBe(size.bodyLengthMm);
      // Sleeve from the shoulder seam, plus the part tucked into the armhole.
      expect(geo.layout.sleeveLengthMm - geo.layout.sleeveSeamOffsetMm).toBeCloseTo(size.sleeveLengthMm!, 0);
      expect(geo.layout.legLengthMm).toBeCloseTo(size.pantsLengthMm!, 0);
    }
    expect(DOBOK.sizes.map((s) => s.code)).toEqual(['100', '110', '120', '130', '140', '150', '160', '170', '180', '190', '200', '210']);
  });

  it('grades shirts by real steps, kids to 8XL, each style keeping its own cut', () => {
    const m = getSize(TEE_CLASSIC, 'M');
    const xl = getSize(TEE_CLASSIC, 'XL');
    // Chest grows 3 cm a size, length only 2 cm: not one percentage.
    expect(xl.chestFlatMm - m.chestFlatMm).toBe(60);
    expect(xl.bodyLengthMm - m.bodyLengthMm).toBe(40);
    expect(TEE_CLASSIC.sizes.map((s) => s.code)).toEqual(['K2', 'K4', 'K6', 'K8', 'K10', 'K12', 'K14', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL', '8XL']);
    for (const model of GARMENT_LIST) {
      const chests = model.sizes.map((s) => s.chestFlatMm);
      const lengths = model.sizes.map((s) => s.bodyLengthMm);
      expect(chests).toEqual([...chests].sort((a, b) => a - b));
      expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
      // The base size is the style's own pattern.
      const base = getSize(model, model.defaultSize);
      expect(base.chestFlatMm).toBeCloseTo(model.chestHalfWidthMm * 2, -1);
      expect(base.bodyLengthMm).toBe(model.bodyLengthMm);
    }
  });
});

describe('drape', () => {
  for (const model of GARMENT_LIST) {
    it(`folds the ${model.shortName} without opening a seam`, () => {
      const size = getSize(model, model.defaultSize);
      const flat = buildGarment(model, size, 'low', 0);
      const draped = buildGarment(model, size, 'low', 1.8);
      let deepest = 0;
      for (const part of draped.parts) {
        const a = flat.parts.find((p) => p.id === part.id)!.geometry.getAttribute('position');
        const b = part.geometry.getAttribute('position');
        expect(b.count).toBe(a.count);
        // Vertices that meet when pressed flat (seams) must still meet when draped.
        const seams = new Map<string, number[]>();
        for (let i = 0; i < a.count; i++) {
          const k = `${Math.round(a.getX(i) * 20)},${Math.round(a.getY(i) * 20)},${Math.round(a.getZ(i) * 20)}`;
          seams.set(k, [...(seams.get(k) ?? []), i]);
          deepest = Math.max(deepest, Math.hypot(b.getX(i) - a.getX(i), b.getY(i) - a.getY(i), b.getZ(i) - a.getZ(i)));
        }
        for (const ids of seams.values()) {
          for (const i of ids.slice(1)) expect(Math.hypot(b.getX(i) - b.getX(ids[0]), b.getY(i) - b.getY(ids[0]), b.getZ(i) - b.getZ(ids[0]))).toBeLessThan(0.05);
        }
      }
      // The cloth really does fold, but within a believable depth.
      expect(deepest).toBeGreaterThan(2);
      expect(deepest).toBeLessThan(20);
    });
  }
});

describe('procedural garments', () => {
  for (const model of GARMENT_LIST) {
    it(`builds the ${model.shortName} with pattern pieces and motion weights`, () => {
      const geo = buildGarment(model, getSize(model, model.defaultSize), 'low');
      // One piece per panel: front and back body, each sleeve, each leg.
      const expected = 2 + (model.sleeve ? 2 : 0) + (model.pants ? 2 : 0);
      expect(geo.islands).toHaveLength(expected);
      for (const island of geo.islands) {
        expect(island.uv.length).toBeGreaterThan(20);
        for (const [u, v] of island.uv) {
          expect(u).toBeGreaterThanOrEqual(-0.001);
          expect(u).toBeLessThanOrEqual(1.001);
          expect(v).toBeGreaterThanOrEqual(-0.001);
          expect(v).toBeLessThanOrEqual(1.001);
        }
      }
      // Every mesh carries a motion weight between 0 (held) and 1 (free edge).
      for (const g of [...geo.parts.map((p) => p.geometry), ...geo.trims.map((t) => t.geometry)]) {
        const free = g.getAttribute('aFree');
        expect(free).toBeDefined();
        expect(free.count).toBe(g.getAttribute('position').count);
        for (let i = 0; i < free.count; i += 7) {
          expect(free.getX(i)).toBeGreaterThanOrEqual(0);
          expect(free.getX(i)).toBeLessThanOrEqual(1);
        }
      }
      expect(geo.layout.widthMm).toBeGreaterThan(300);
      expect(geo.layout.heightMm).toBeGreaterThan(500);
    });
  }

  it('holds the shoulders still and frees the hem', () => {
    const geo = buildGarment(TEE_CLASSIC, getSize(TEE_CLASSIC, 'M'), 'low');
    const torso = geo.parts.find((p) => p.id === 'torso')!.geometry;
    const pos = torso.getAttribute('position');
    const free = torso.getAttribute('aFree');
    let hem = 0;
    let shoulder = 1;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 5) hem = Math.max(hem, free.getX(i));
      if (pos.getY(i) > geo.layout.torsoHeightMm * 0.7) shoulder = Math.min(shoulder, 1 - free.getX(i));
    }
    expect(hem).toBeGreaterThan(0.9);
    expect(shoulder).toBe(1);
  });

  it('ends the torso mesh exactly on the neckline and armholes', () => {
    for (const model of [TEE_CLASSIC, TANK, DOBOK]) {
      const geo = buildGarment(model, getSize(model, model.defaultSize), 'low');
      // The top edge is one point per column, front then back, in order and with no folded
      // slivers: consecutive edge points move steadily across the texture.
      for (const edge of geo.torsoEdges) {
        const dir = Math.sign(edge[edge.length - 1].u - edge[0].u);
        let back = 0;
        for (let i = 1; i < edge.length; i++) {
          const step = (edge[i].u - edge[i - 1].u) * dir;
          expect(Math.abs(step)).toBeLessThan(0.06);
          back = Math.max(back, -step);
        }
        expect(back, `${model.shortName} edge steps back by ${back}`).toBeLessThan(0.004);
      }
    }
  });

  it('stands the dobok on its pant hems, with a seat above the crotch', () => {
    const geo = buildGarment(DOBOK, getSize(DOBOK, '170'), 'low');
    // Size 170: an 83 cm jacket over 105 cm pants whose waist sits 47 cm below the shoulder.
    expect(geo.layout.torsoHeightMm).toBe(830);
    expect(geo.layout.bottomMm).toBeCloseTo(830 - 470 - 1050, 0);
    expect(geo.islands.map((i) => i.id)).toEqual(['front-body', 'back-body', 'left-sleeve', 'right-sleeve', 'left-leg', 'right-leg']);
  });
});

describe('the garment as it really sits', () => {
  it('sews a folded rib band round a crew neck, about 2 cm, not a round tube', () => {
    const size = getSize(TEE_CLASSIC, 'M');
    const geo = buildGarment(TEE_CLASSIC, size, 'low');
    const collar = geo.trims.find((t) => t.key === 'collar')!.geometry;
    collar.computeBoundingBox();
    // The neckline's highest point is the side of the neck (the torso's top); the band stands a
    // little above it, leaning in, where the old tube stood a full 17 mm diameter proud everywhere.
    const rise = collar.boundingBox!.max.y - geo.layout.torsoHeightMm;
    expect(rise).toBeGreaterThan(8);
    expect(rise).toBeLessThan(20);
    // At the back of the neck it stands nearly upright and is only a few millimetres through, where
    // the tube was 17 mm round: front to back it spans under 10 mm, and it stands taller than that.
    const pos = collar.getAttribute('position');
    let zMin = Infinity;
    let zMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i)) > 3 || pos.getZ(i) > 0) continue;
      zMin = Math.min(zMin, pos.getZ(i));
      zMax = Math.max(zMax, pos.getZ(i));
      yMin = Math.min(yMin, pos.getY(i));
      yMax = Math.max(yMax, pos.getY(i));
    }
    expect(zMax - zMin).toBeLessThan(10);
    expect(yMax - yMin).toBeGreaterThan(18);
  });

  it('tucks each sleeve’s end into the body, below the shoulder seam, so it never shows on top', () => {
    for (const model of [TEE_CLASSIC, GARMENT_LIST.find((m) => m.id === 'tee-long')!, GARMENT_LIST.find((m) => m.id === 'tee-oversized')!]) {
      const size = getSize(model, model.defaultSize);
      const geo = buildGarment(model, size, 'low', 0);
      const neckR = model.neckRadiusMm * size.scale;
      for (const id of ['sleeveLeft', 'sleeveRight'] as const) {
        const g = geo.parts.find((p) => p.id === id)!.geometry;
        const pos = g.getAttribute('position');
        const uv = g.getAttribute('uv');
        let checked = 0;
        for (let i = 0; i < pos.count; i++) {
          // v = 1 is the tucked-in end of the sleeve.
          if (uv.getY(i) < 0.999) continue;
          const seam = size.bodyLengthMm - model.shoulderSlope * (Math.abs(pos.getX(i)) - neckR);
          expect(pos.getY(i), `${model.shortName} ${id}`).toBeLessThan(seam);
          checked++;
        }
        expect(checked).toBeGreaterThan(10);
      }
    }
  });

  it('thins the body toward the shoulders instead of keeping the chest’s depth', () => {
    const size = getSize(TEE_CLASSIC, 'M');
    const geo = buildGarment(TEE_CLASSIC, size, 'low', 0);
    const pos = geo.parts.find((p) => p.id === 'torso')!.geometry.getAttribute('position');
    const H = size.bodyLengthMm;
    const depth = (y0: number, y1: number) => {
      let d = 0;
      for (let i = 0; i < pos.count; i++) {
        const x = Math.abs(pos.getX(i));
        const y = pos.getY(i);
        if (x > 100 && x < 200 && y >= y0 * H && y <= y1 * H) d = Math.max(d, Math.abs(pos.getZ(i)));
      }
      return d;
    };
    expect(depth(0.9, 0.95)).toBeLessThan(depth(0.5, 0.55) * 0.72);
  });
});

describe('scene and fabric additions', () => {
  it('accepts motion, image backdrops and dye effects', () => {
    const doc = createDocument({ projectId: 'p1', title: 'Motion' });
    doc.scene = {
      presetId: 'studio',
      exposure: 1,
      envRotationDeg: 0,
      shadows: true,
      backdrop: { kind: 'image', color: '#FFFFFF', color2: '#E3E5EA', assetId: '0b0e4b6c-3f0e-4c47-9a25-5b8a0e4bd1a2' },
      fovDeg: 28,
      cameras: [],
      motion: { kind: 'knit', speed: 1.5 },
    };
    doc.colorways[0].surfaces = { body: { kind: 'effect', effect: 'spiral', color2: '#E63973', color3: '#2B59FF', scaleMm: 140, intensity: 0.9, seed: 42 } };
    expect(designDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('rejects effects outside their ranges', () => {
    const doc = createDocument({ projectId: 'p1', title: 'Bad' });
    doc.colorways[0].surfaces = { body: { kind: 'effect', effect: 'marble', color2: '#000000', scaleMm: 1, intensity: 2, seed: 1 } };
    expect(designDocumentSchema.safeParse(doc).success).toBe(false);
  });
});
