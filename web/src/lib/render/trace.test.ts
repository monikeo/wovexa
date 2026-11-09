import { describe, expect, it } from 'vitest';
import { ringArea, ringsPath, simplifyRing, traceContours } from './trace';

/** A w × h field from a predicate, +1 inside and -1 outside. */
const grid = (w: number, h: number, inside: (x: number, y: number) => boolean) => {
  const f = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = inside(x, y) ? 1 : -1;
  return f;
};

describe('tracing outlines for vector and cut files', () => {
  it('traces a filled square as one closed ring around it', () => {
    // Pixels 2–5 inside a 10 × 10 grid: the edge falls halfway between inside and outside centres.
    const rings = traceContours(grid(10, 10, (x, y) => x >= 2 && x <= 5 && y >= 2 && y <= 5), 10, 10);
    expect(rings).toHaveLength(1);
    const simple = simplifyRing(rings[0], 0.01);
    // Corners are cut at 45°, so the area sits between the inner (3 × 3) and outer (4 × 4) squares.
    expect(ringArea(simple)).toBeGreaterThan(9);
    expect(ringArea(simple)).toBeLessThan(16);
    for (const [x, y] of simple) {
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThanOrEqual(6);
      expect(y).toBeGreaterThanOrEqual(2);
      expect(y).toBeLessThanOrEqual(6);
    }
  });

  it('keeps a hole as a ring of its own, and closes shapes at the edge of the grid', () => {
    const ringShape = traceContours(grid(12, 12, (x, y) => Math.hypot(x - 5.5, y - 5.5) <= 5 && Math.hypot(x - 5.5, y - 5.5) >= 2.5), 12, 12);
    expect(ringShape).toHaveLength(2);
    const full = traceContours(grid(4, 4, () => true), 4, 4);
    expect(full).toHaveLength(1);
    expect(ringArea(full[0])).toBeGreaterThan(9);
  });

  it('finds the edge between pixel centres by interpolating the field', () => {
    // A field falling from 1 to -1 across x: zero halfway between centres 2 and 3, at x = 3.
    const w = 6;
    const h = 3;
    const f = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = 2.5 - x;
    const rings = traceContours(f, w, h);
    expect(rings).toHaveLength(1);
    const xs = rings[0].map(([x]) => x);
    expect(Math.max(...xs)).toBeCloseTo(3, 5);
  });

  it('drops points along straight runs and writes compact path data', () => {
    const line: [number, number][] = [];
    for (let i = 0; i <= 20; i++) line.push([i, 0]);
    for (let i = 1; i <= 20; i++) line.push([20, i]);
    for (let i = 19; i >= 0; i--) line.push([i, 20]);
    for (let i = 19; i >= 1; i--) line.push([0, i]);
    const simple = simplifyRing(line, 0.05);
    expect(simple).toHaveLength(4);
    expect(ringsPath([simple], ([x, y]) => [x / 10, y / 10])).toBe('M0 0L2 0L2 2L0 2Z');
  });
});
