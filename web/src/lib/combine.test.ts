import { describe, expect, it } from 'vitest';
import type { ArtworkLayer } from '@/domain/schema';
import { combineRegions, regionArea, regionToPath, shapeRegion } from './combine';

const rect = (id: string, centerXmm: number, centerYmm: number, widthMm: number, heightMm: number, rotationDeg = 0): ArtworkLayer => ({
  id,
  name: id,
  visible: true,
  locked: false,
  transform: { centerXmm, centerYmm, widthMm, heightMm, rotationDeg, flipX: false, flipY: false },
  style: { opacity: 1, blendMode: 'normal', finish: 'flat_ink' },
  content: { kind: 'shape', shape: 'rect', fill: '#000000', cornerRadiusMm: 0 },
});

describe('combining shapes', () => {
  // Two 20 × 20 mm squares overlapping by a 10 × 20 mm strip.
  const a = shapeRegion(rect('a', 10, 10, 20, 20));
  const b = shapeRegion(rect('b', 20, 10, 20, 20));

  it('unites, subtracts, intersects and excludes overlapping areas', () => {
    expect(regionArea(combineRegions('union', [a, b]))).toBeCloseTo(600, 3);
    expect(regionArea(combineRegions('subtract', [a, b]))).toBeCloseTo(200, 3);
    expect(regionArea(combineRegions('intersect', [a, b]))).toBeCloseTo(200, 3);
    expect(regionArea(combineRegions('exclude', [a, b]))).toBeCloseTo(400, 3);
  });

  it('follows curves and turned shapes', () => {
    const circle: ArtworkLayer = { ...rect('c', 0, 0, 20, 20), content: { kind: 'shape', shape: 'ellipse', fill: '#000000', cornerRadiusMm: 0 } };
    expect(regionArea(shapeRegion(circle))).toBeCloseTo(Math.PI * 100, 0);
    // A square turned 45° keeps its area.
    expect(regionArea(shapeRegion(rect('d', 0, 0, 20, 20, 45)))).toBeCloseTo(400, 3);
  });

  it('writes a cut-out as one even-odd path, so the hole stays a hole', () => {
    const frame = combineRegions('subtract', [shapeRegion(rect('outer', 50, 50, 40, 40)), shapeRegion(rect('inner', 50, 50, 20, 20))]);
    expect(regionArea(frame)).toBeCloseTo(1200, 3);
    const out = regionToPath(frame)!;
    expect(out.box).toEqual({ x: 30, y: 30, w: 40, h: 40 });
    // Two rings: the outside and the hole.
    expect(out.path.match(/M/g)).toHaveLength(2);
    expect(regionToPath(combineRegions('intersect', [shapeRegion(rect('x', 0, 0, 10, 10)), shapeRegion(rect('y', 50, 50, 10, 10))]))).toBeNull();
  });
});
