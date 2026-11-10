import { describe, expect, it } from 'vitest';
import { DOBOK, findSize, JERSEY, TEE_CLASSIC, TEE_LONG, type GarmentModel } from '@/domain/garments';
import { compareRollWidths, DEFAULT_MARKER, markerNestOptions, markerPieces, orderSets, type MarkerPiece } from './marker-layout';
import { bounds, nest, placeOutline, polygonArea, simplifyOutline, type NestOptions, type NestResult, type Point } from './nesting';
import { parseRoster } from './roster';

// ---- Exact vector geometry, independent of the nesting's column spans ----

function pointSegment(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function cross(o: Point, a: Point, b: Point) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}

function inside(p: Point, poly: Point[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Least distance between two outlines (0 when they cross or one holds the other), checked only where it can be under `near`. */
function outlineDistance(a: Point[], b: Point[], near: number) {
  const ba = bounds(a);
  const bb = bounds(b);
  if (ba.minX > bb.maxX + near || bb.minX > ba.maxX + near || ba.minY > bb.maxY + near || bb.minY > ba.maxY + near) return Infinity;
  if (inside(a[0], b) || inside(b[0], a)) return 0;
  const edges = (p: Point[], box: ReturnType<typeof bounds>) =>
    p
      .map((q, i) => [q, p[(i + 1) % p.length]] as [Point, Point])
      .filter(([q, r]) => Math.max(q[0], r[0]) >= box.minX - near && Math.min(q[0], r[0]) <= box.maxX + near && Math.max(q[1], r[1]) >= box.minY - near && Math.min(q[1], r[1]) <= box.maxY + near);
  const ea = edges(a, bb);
  const eb = edges(b, ba);
  let best = Infinity;
  for (const [p, q] of ea) for (const [r, s] of eb) best = Math.min(best, segmentDistance(p, q, r, s));
  return best;
}

const OPTIONS: NestOptions = { rollWidthMm: 1500, gapMm: 5, marginMm: 10, bleedMm: 10, allowTurn: true, maxLengthMm: 3000 };

function order(model: GarmentModel, roster: string) {
  const { sets } = orderSets(model, model.defaultSize, parseRoster(roster));
  return markerPieces(model, sets, 'low').pieces;
}

/** Everything the factory relies on: all pieces placed once, inside the roll and the section, never closer than both bleeds and the gap. */
function expectSound(pieces: MarkerPiece[], result: NestResult, opts: NestOptions) {
  const placed = result.sections.flatMap((s) => s.placements);
  expect(placed.map((p) => p.id).sort()).toEqual(pieces.map((p) => p.id).filter((id) => !result.unplaced.includes(id)).sort());
  expect(new Set(placed.map((p) => p.id)).size).toBe(placed.length);
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const clear = 2 * opts.bleedMm + opts.gapMm;
  let area = 0;
  for (const section of result.sections) {
    expect(section.lengthMm).toBeLessThanOrEqual(result.maxLengthMm + 1e-6);
    const outlines = section.placements.map((p) => {
      expect(p.section).toBe(section.index);
      const piece = byId.get(p.id)!;
      area += polygonArea(piece.outline);
      return { id: p.id, outline: placeOutline(piece.outline, p) };
    });
    for (const { id, outline } of outlines) {
      const b = bounds(outline);
      // Bleed stays inside the margins: across the roll and along the section.
      expect(b.minX - opts.bleedMm, id).toBeGreaterThanOrEqual(opts.marginMm - 1e-6);
      expect(b.maxX + opts.bleedMm, id).toBeLessThanOrEqual(opts.rollWidthMm - opts.marginMm + 1e-6);
      expect(b.minY - opts.bleedMm, id).toBeGreaterThanOrEqual(opts.marginMm - 1e-6);
      expect(b.maxY + opts.bleedMm, id).toBeLessThanOrEqual(section.lengthMm - opts.marginMm + 1e-6);
    }
    for (let i = 0; i < outlines.length; i++) {
      for (let j = i + 1; j < outlines.length; j++) {
        const d = outlineDistance(outlines[i].outline, outlines[j].outline, clear);
        expect(d, `${outlines[i].id} and ${outlines[j].id}`).toBeGreaterThanOrEqual(clear - 1e-6);
      }
    }
  }
  expect(result.pieceAreaMm2).toBeCloseTo(area, 3);
  expect(result.lengthMm).toBeCloseTo(result.sections.reduce((n, s) => n + s.lengthMm, 0), 6);
  expect(result.utilisation).toBeCloseTo(area / (opts.rollWidthMm * result.lengthMm), 9);
  expect(result.utilisation).toBeGreaterThan(0);
  expect(result.utilisation).toBeLessThanOrEqual(1);
}

describe('fabric marker nesting', () => {
  it('nests a mixed-size team order with no overlaps and nothing past the roll edges', () => {
    const pieces = order(TEE_CLASSIC, 'name,number,size\nSokha,7,K8\nDara,10,S\nVanna,4,M\nPisey,9,M\nRith,11,L\nBora,5,XL\nNary,8,2XL\n');
    expect(pieces).toHaveLength(7 * 4);
    const result = nest(pieces, OPTIONS);
    expect(result.unplaced).toEqual([]);
    expectSound(pieces, result, OPTIONS);
    // Tees nest tightly: front, back and two sleeves of seven sizes on 1.5 m wide fabric.
    expect(result.utilisation).toBeGreaterThan(0.6);
    expect(result.strategy).toMatch(/order/);
  });

  it('places every dobok piece, legs included, on a 110 cm roll up to size 170', () => {
    const opts = { ...OPTIONS, rollWidthMm: 1100 };
    const pieces = order(DOBOK, 'name,size\nA,100\nB,140\nC,160\nD,170\n');
    expect(pieces).toHaveLength(4 * 6);
    const result = nest(pieces, opts);
    expect(result.unplaced).toEqual([]);
    expectSound(pieces, result, opts);
    // A 210 cm student's pant leg is wider than 110 cm fabric: it needs a wider roll.
    const tall = order(DOBOK, 'name,size\nE,210\n');
    expect(nest(tall, opts).unplaced.sort()).toEqual(['1/left-leg', '1/right-leg']);
    const wide = { ...opts, rollWidthMm: 1500 };
    const result2 = nest(tall, wide);
    expect(result2.unplaced).toEqual([]);
    expectSound(tall, result2, wide);
  });

  it('nests a large team order quickly', () => {
    const opts = { ...OPTIONS, rollWidthMm: 1600 };
    const sizes = ['S', 'M', 'M', 'L', 'L', 'XL', '2XL', 'K10'];
    const pieces = order(JERSEY, `size\n${Array.from({ length: 40 }, (_, i) => sizes[i % sizes.length]).join('\n')}\n`);
    const t0 = performance.now();
    const result = nest(pieces, opts);
    const ms = performance.now() - t0;
    console.log(`40 jerseys, ${pieces.length} pieces: ${(result.lengthMm / 1000).toFixed(2)} m in ${result.sections.length} lengths, ${(result.utilisation * 100).toFixed(1)}% used, ${ms.toFixed(0)} ms (${result.strategy})`);
    expect(result.unplaced).toEqual([]);
    expectSound(pieces, result, opts);
    expect(ms).toBeLessThan(10000);
    // The 10 s budget above is the check; the runner's 5 s default would cut it short on a busy machine.
  }, 20_000);

  it('keeps every piece upright when turning is off', () => {
    const opts = { ...OPTIONS, allowTurn: false };
    const pieces = order(TEE_LONG, 'size\nS\nM\nL\n');
    const result = nest(pieces, opts);
    expect(result.sections.flatMap((s) => s.placements).every((p) => !p.turned)).toBe(true);
    expectSound(pieces, result, opts);
  });

  it('turns pieces 180° when that packs tighter, never any other way', () => {
    const pieces = order(JERSEY, 'size\nM\nM\nM\nM\nM\nM\n');
    const turned = nest(pieces, OPTIONS);
    const upright = nest(pieces, { ...OPTIONS, allowTurn: false });
    expect(turned.lengthMm).toBeLessThanOrEqual(upright.lengthMm + 1e-6);
    expectSound(pieces, turned, OPTIONS);
  });

  it('splits a long order into roll lengths that no piece crosses', () => {
    const opts = { ...OPTIONS, rollWidthMm: 1600, maxLengthMm: 2000 };
    const pieces = order(JERSEY, `size\n${Array.from({ length: 12 }, (_, i) => ['S', 'M', 'L', 'XL'][i % 4]).join('\n')}\n`);
    const result = nest(pieces, opts);
    expect(result.sections.length).toBeGreaterThan(1);
    expect(result.unplaced).toEqual([]);
    expectSound(pieces, result, opts);
  });

  it('raises the length per file to fit the longest piece', () => {
    const opts = { ...OPTIONS, maxLengthMm: 500 };
    const pieces = order(DOBOK, 'size\n170\n');
    const result = nest(pieces, opts);
    // A 105 cm pant leg plus bleed and margins needs about 1.1 m.
    expect(result.maxLengthMm).toBeGreaterThan(1050);
    expect(result.unplaced).toEqual([]);
    expectSound(pieces, result, opts);
  });

  it('leaves out pieces wider than the roll and places the rest', () => {
    const pieces = order(TEE_CLASSIC, 'size\nM\n');
    const width = (id: string) => {
      const b = bounds(pieces.find((p) => p.id === id)!.outline);
      return b.maxX - b.minX;
    };
    // A roll that takes the sleeves but not the body panels.
    expect(width('1/left-sleeve')).toBeLessThan(width('1/front-body') - 20);
    const opts = { ...OPTIONS, rollWidthMm: (width('1/left-sleeve') + width('1/front-body')) / 2 + 2 * (OPTIONS.marginMm + OPTIONS.bleedMm) };
    const result = nest(pieces, opts);
    expect(result.unplaced.sort()).toEqual(['1/back-body', '1/front-body']);
    expectSound(pieces, result, opts);
  });

  it('reports utilisation as cut area over the fabric used', () => {
    const pieces = order(TEE_CLASSIC, 'size\nM\n');
    const result = nest(pieces, OPTIONS);
    const area = pieces.reduce((n, p) => n + polygonArea(p.outline), 0);
    expect(result.utilisation).toBeCloseTo(area / (OPTIONS.rollWidthMm * result.lengthMm), 9);
    expect(result.sections).toHaveLength(1);
  });
});

describe('marker orders', () => {
  it('reads sizes as people write them', () => {
    expect(findSize(TEE_CLASSIC, 'xxl')?.code).toBe('2XL');
    expect(findSize(TEE_CLASSIC, 'Kids 8')?.code).toBe('K8');
    expect(findSize(TEE_CLASSIC, ' m ')?.code).toBe('M');
    expect(findSize(DOBOK, 'L')?.code).toBe('170');
    expect(findSize(DOBOK, '170 cm')?.code).toBe('170');
    expect(findSize(DOBOK, '2XS')?.code).toBe('130');
    expect(findSize(TEE_CLASSIC, '9XL')).toBeUndefined();
  });

  it('makes one garment per roster row in its size, falling back to the sample size', () => {
    const { sets, unknownSizes } = orderSets(TEE_CLASSIC, 'M', parseRoster('name,number,size\nSokha,7,L\nDara,10,\nVanna,4,Huge\nBora,5,XXXXXXL\n'));
    expect(sets.map((s) => s.size.code)).toEqual(['L', 'M', 'M', '6XL']);
    expect(sets[0].label).toBe('#1 Sokha 7');
    expect(unknownSizes).toEqual(['Huge']);
    expect(orderSets(TEE_CLASSIC, 'XL', null).sets.map((s) => s.size.code)).toEqual(['XL']);
  });

  it('turns marker settings into nesting options, keeping PDF pages within 200 inches', () => {
    const o = markerNestOptions({ ...DEFAULT_MARKER, rollWidthCm: 150, gapMm: -3, lengthPerFileM: 8, format: 'pdf' });
    expect(o.rollWidthMm).toBe(1500);
    expect(o.gapMm).toBe(0);
    expect(o.bleedMm).toBe(10);
    expect(o.maxLengthMm).toBe(5080);
    expect(markerNestOptions({ ...DEFAULT_MARKER, lengthPerFileM: 8 }).maxLengthMm).toBe(8000);
  });

  it('compares roll widths for the same order', () => {
    const estimates = compareRollWidths(TEE_CLASSIC, 'M', parseRoster('size\nS\nM\nL\n'), DEFAULT_MARKER, [110, 150]);
    expect(estimates.map((e) => e.rollWidthCm)).toEqual([110, 150]);
    for (const e of estimates) {
      expect(e.unplaced).toBe(0);
      expect(e.utilisation).toBeGreaterThan(0.3);
    }
    // Wider fabric never needs more length for the same pieces.
    expect(estimates[1].lengthMm).toBeLessThan(estimates[0].lengthMm);
  });

  it('simplifies outlines within tolerance', () => {
    const circle: Point[] = Array.from({ length: 400 }, (_, i) => [Math.cos((i / 400) * Math.PI * 2) * 100, Math.sin((i / 400) * Math.PI * 2) * 100]);
    const simple = simplifyOutline(circle, 0.5);
    expect(simple.length).toBeLessThan(80);
    for (const p of circle) {
      const d = Math.min(...simple.map((q, i) => pointSegment(p, q, simple[(i + 1) % simple.length])));
      expect(d).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});
