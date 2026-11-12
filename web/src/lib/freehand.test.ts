import { describe, expect, it } from 'vitest';
import { LIMITS } from '@/domain/limits';
import { parsePath } from '@/domain/path-edit';
import { brushRegion, brushStroke, brushWidths, curveThrough, pencilStroke, simplifyStroke, smoothStroke, thinStroke, type StrokePoint } from './freehand';
import { regionArea } from './combine';

/** A straight stroke from (x0, y) to (x1, y), sampled every `step` mm. */
const line = (x0: number, x1: number, y = 50, step = 0.5): StrokePoint[] => {
  const out: StrokePoint[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += step) out.push({ x, y });
  return out;
};

/** A circle of radius `r` round (cx, cy), `n` samples, ending where it began. */
const circle = (cx: number, cy: number, r: number, n = 120): StrokePoint[] =>
  Array.from({ length: n + 1 }, (_, i) => ({ x: cx + Math.cos((i / n) * Math.PI * 2) * r, y: cy + Math.sin((i / n) * Math.PI * 2) * r }));

describe('freehand strokes: cleaning up', () => {
  it('drops samples a hand jitters between, keeping the last', () => {
    const out = thinStroke([{ x: 0, y: 0 }, { x: 0.05, y: 0 }, { x: 1, y: 0 }, { x: 1.04, y: 0 }, { x: 2, y: 0 }, { x: 2.5, y: 0 }], 0.5);
    expect(out.map((p) => p.x)).toEqual([0, 1, 2, 2.5]);
  });

  it('keeps corners and drops points on a straight run', () => {
    const corner = [...line(0, 10, 0, 1), ...line(10, 10, 0, 1).slice(1), { x: 10, y: 5 }, { x: 10, y: 10 }];
    const kept = simplifyStroke(corner, 0.1);
    expect(kept.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it('smooths the middle and keeps an open stroke’s ends', () => {
    const zigzag: StrokePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 0 }, { x: 3, y: 2 }, { x: 4, y: 0 }];
    const smooth = smoothStroke(zigzag, 1);
    expect(smooth[0]).toEqual(zigzag[0]);
    expect(smooth[4]).toEqual(zigzag[4]);
    expect(Math.abs(smooth[2].y - 1)).toBeLessThan(1);
  });

  it('draws a smooth curve through every point', () => {
    const d = curveThrough([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }], false);
    expect(d.startsWith('M0 0 C')).toBe(true);
    expect(d.endsWith('20 0')).toBe(true);
    expect(curveThrough([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], true).endsWith('Z')).toBe(true);
  });
});

describe('the pencil', () => {
  it('turns a straight stroke into an open line with a box that still has height', () => {
    const out = pencilStroke(line(10, 90), { smoothing: 0.5, closeMm: 3 })!;
    expect(out.closed).toBe(false);
    expect(out.box.w).toBeCloseTo(80, 0);
    expect(out.box.h).toBeGreaterThanOrEqual(1);
    expect(parsePath(out.path)[0].closed).toBe(false);
  });

  it('closes a loop that ends where it began', () => {
    const out = pencilStroke(circle(50, 50, 20), { smoothing: 0.3, closeMm: 3 })!;
    expect(out.closed).toBe(true);
    expect(out.box.w).toBeGreaterThan(38);
    expect(out.box.w).toBeLessThan(42);
    expect(out.path.trim().endsWith('Z')).toBe(true);
  });

  it('ignores a tap, and keeps a very long scribble within a layer’s path size', () => {
    expect(pencilStroke([{ x: 1, y: 1 }], { smoothing: 0.5, closeMm: 3 })).toBeNull();
    expect(pencilStroke(line(0, 0.5), { smoothing: 0.5, closeMm: 3 })).toBeNull();
    const scribble: StrokePoint[] = Array.from({ length: 4000 }, (_, i) => ({ x: (i % 200) * 0.9, y: Math.floor(i / 200) * 3 + Math.sin(i) * 2 }));
    const out = pencilStroke(scribble, { smoothing: 0, closeMm: 3 })!;
    expect(out.path.length).toBeLessThanOrEqual(LIMITS.pathChars);
  });
});

describe('the brush', () => {
  it('covers its width along the stroke, with round ends', () => {
    const out = brushStroke(line(10, 90), { brush: 'round', widthMm: 4, smoothing: 0 })!;
    expect(out.box.h).toBeCloseTo(4, 0);
    expect(out.box.w).toBeCloseTo(84, 0);
  });

  it('has flat ends as a marker', () => {
    const out = brushStroke(line(10, 90), { brush: 'marker', widthMm: 4, smoothing: 0 })!;
    expect(out.box.w).toBeCloseTo(80, 0);
  });

  it('tapers at both ends as ink, and thins under light stylus pressure', () => {
    const round = regionArea(brushRegion(line(0, 60, 0, 1), 'round', 4));
    const ink = regionArea(brushRegion(line(0, 60, 0, 1), 'taper', 4));
    expect(ink).toBeLessThan(round * 0.9);
    const widths = brushWidths([{ x: 0, y: 0, p: 0.1 }, { x: 5, y: 0, p: 1 }, { x: 10, y: 0 }], 'round', 4);
    expect(widths[0]).toBeLessThan(widths[1]);
    expect(widths[2]).toBe(4);
  });

  it('draws a calligraphy nib broad across it and a hairline along it, never nothing', () => {
    const across = regionArea(brushRegion([{ x: 0, y: 0 }, { x: 20, y: 20 }], 'calligraphy', 6));
    const along = regionArea(brushRegion([{ x: 0, y: 20 }, { x: 20, y: 0 }], 'calligraphy', 6));
    expect(across).toBeGreaterThan(along * 4);
    expect(along).toBeGreaterThan(0);
  });

  it('stays one clean area where a stroke crosses itself, and a tap leaves a dot', () => {
    const loop = brushStroke(circle(50, 50, 15, 90), { brush: 'round', widthMm: 3, smoothing: 0 })!;
    // The ring round the loop and the hole inside it: two outlines.
    expect(parsePath(loop.path)).toHaveLength(2);
    const dot = brushStroke([{ x: 5, y: 5 }], { brush: 'round', widthMm: 4, smoothing: 0 })!;
    expect(dot.box.w).toBeCloseTo(4, 0);
  });
});
