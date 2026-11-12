import { describe, expect, it } from 'vitest';
import { smoothVertexValues } from './ao-bake';

describe('baked shading', () => {
  it('evens out steps between neighbours, keeps an even patch even, and never crosses to another panel', () => {
    // A strip of two triangles with stepped shading, a separate triangle, and a vertex in no triangle.
    const values = Float32Array.from([0, 1, 0, 1, 0.6, 0.6, 0.6, 0.2]);
    const index = [0, 1, 2, 1, 3, 2, 4, 5, 6];
    smoothVertexValues(values, index, 6);
    const strip = Array.from(values.slice(0, 4));
    expect(Math.max(...strip) - Math.min(...strip)).toBeLessThan(0.15);
    // The strip's overall shade is kept, not washed toward white or black.
    expect(strip.reduce((a, b) => a + b, 0) / 4).toBeCloseTo(0.5, 1);
    for (const v of values.slice(4, 7)) expect(v).toBeCloseTo(0.6, 5);
    expect(values[7]).toBeCloseTo(0.2, 5);
  });

  it('leaves the values alone with no passes or no triangles', () => {
    const values = Float32Array.from([0, 1, 0]);
    smoothVertexValues(values, [0, 1, 2], 0);
    expect(Array.from(values)).toEqual([0, 1, 0]);
    smoothVertexValues(values, null, 3);
    expect(Array.from(values)).toEqual([0, 1, 0]);
  });
});
