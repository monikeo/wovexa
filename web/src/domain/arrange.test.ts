import { describe, expect, it } from 'vitest';
import { arrangeCopies, MAX_COPIES } from './arrange';

const t = { centerXmm: 150, centerYmm: 200, widthMm: 40, heightMm: 20, rotationDeg: 10, flipX: false, flipY: false };
const plan = { gapMm: 10, radiusMm: 100, turn: true };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('step and repeat', () => {
  it('lays a row out at width plus gap, centred where the original was', () => {
    const row = arrangeCopies(t, { ...plan, mode: 'row', count: 3 });
    expect(row.map((p) => p.centerXmm)).toEqual([100, 150, 200]);
    expect(row.every((p) => p.centerYmm === 200 && p.rotationDeg === 10)).toBe(true);
  });

  it('fills a grid row by row and centres a short last row', () => {
    const grid = arrangeCopies(t, { ...plan, mode: 'grid', count: 5 });
    // Three columns: 3 then 2.
    expect(grid.slice(0, 3).map((p) => p.centerXmm)).toEqual([100, 150, 200]);
    expect(grid.slice(3).map((p) => p.centerXmm)).toEqual([125, 175]);
    expect(new Set(grid.map((p) => p.centerYmm))).toEqual(new Set([185, 215]));
    expect(mean(grid.map((p) => p.centerYmm))).toBeCloseTo(197);
  });

  it('goes round a circle from the top, turning each copy to face out', () => {
    const ring = arrangeCopies(t, { ...plan, mode: 'circle', count: 4 });
    expect(ring[0].centerXmm).toBeCloseTo(150);
    expect(ring[0].centerYmm).toBeCloseTo(100);
    expect(ring[1].centerXmm).toBeCloseTo(250);
    expect(ring[1].centerYmm).toBeCloseTo(200);
    expect(ring.map((p) => p.rotationDeg)).toEqual([10, 100, -170, -80]);
    // Centred on the original.
    expect(mean(ring.map((p) => p.centerXmm))).toBeCloseTo(150);
    expect(mean(ring.map((p) => p.centerYmm))).toBeCloseTo(200);
    expect(arrangeCopies(t, { ...plan, mode: 'circle', count: 4, turn: false }).every((p) => p.rotationDeg === 10)).toBe(true);
  });

  it('makes at least two and at most the limit', () => {
    expect(arrangeCopies(t, { ...plan, mode: 'row', count: 1 })).toHaveLength(2);
    expect(arrangeCopies(t, { ...plan, mode: 'circle', count: 500 })).toHaveLength(MAX_COPIES);
  });
});
