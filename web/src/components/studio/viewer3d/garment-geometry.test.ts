import { describe, expect, it } from 'vitest';
import { DOBOK, GARMENT_LIST, getSize, TANK, TEE_CLASSIC } from '@/domain/garments';
import { designDocumentSchema } from '@/domain/schema';
import { createDocument } from '@/domain/factory';
import { buildGarment } from './garment-geometry';

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
    expect(geo.layout.bottomMm).toBeLessThan(-700);
    expect(geo.islands.map((i) => i.id)).toEqual(['front-body', 'back-body', 'left-sleeve', 'right-sleeve', 'left-leg', 'right-leg']);
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
