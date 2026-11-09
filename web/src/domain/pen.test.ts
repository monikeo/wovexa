import { describe, expect, it } from 'vitest';
import { penBounds, penPathData, penShape } from './pen';
import { shapeContentSchema } from './schema';

describe('the pen', () => {
  it('draws corners as lines and smooth points as curves, closed when asked', () => {
    expect(penPathData([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], true)).toBe('M0 0 L10 0 L10 10 L0 0 Z');
    expect(penPathData([{ x: 0, y: 0 }, { x: 10, y: 0, hx: 2, hy: 3 }], false)).toBe('M0 0 C0 0 8 -3 10 0');
  });

  it('bounds the curve itself, not its handles', () => {
    // A smooth top point whose handles reach from −30 to 130 mm: the curve stays well inside them.
    const b = penBounds([{ x: 0, y: 50 }, { x: 50, y: 0, hx: 80, hy: 0 }, { x: 100, y: 50 }]);
    expect(b.x).toBeLessThan(0);
    expect(b.x).toBeGreaterThan(-30);
    expect(b.x + b.w).toBeLessThan(130);
    expect(b.y).toBeCloseTo(0, 0);
  });

  it('makes a shape in a 0–100 box that a layer accepts', () => {
    const shape = penShape([{ x: 20, y: 30 }, { x: 80, y: 30 }, { x: 80, y: 90, hx: -10, hy: 10 }, { x: 20, y: 90 }]);
    expect(shape).not.toBeNull();
    expect(shape!.box.x).toBeCloseTo(20);
    expect(shape!.box.y).toBeCloseTo(30);
    // The curves bulge past the corners, so the box is wider and taller than they are.
    expect(shape!.box.w).toBeGreaterThan(60);
    expect(shape!.box.h).toBeGreaterThan(60);
    expect(shape!.path.startsWith('M0 0 L')).toBe(true);
    expect(shapeContentSchema.safeParse({ kind: 'shape', shape: 'path', fill: '#111111', cornerRadiusMm: 0, path: shape!.path }).success).toBe(true);
    expect(penShape([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBeNull();
    expect(penShape([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toBeNull();
  });
});
