import { describe, expect, it } from 'vitest';
import type { ShapeContent } from '@/domain/schema';
import { Defs, shapePathData, shapeSvg, transformPathData } from './svg-artwork';

const shape = (s: Partial<ShapeContent>): ShapeContent => ({ kind: 'shape', shape: 'rect', fill: '#000000', cornerRadiusMm: 0, ...s }) as ShapeContent;

/** Every number in path data, in order. */
const nums = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

describe('SVG print files: paths', () => {
  it('scales and moves absolute and relative commands, implicit lines included', () => {
    expect(transformPathData('M10 20 L30 40 Z', 2, 3, 5, 7)).toBe('M25 67 L65 127 Z');
    // Relative moves scale but do not move; pairs after a move are lines.
    expect(transformPathData('m10 20 5 5 h10 v-4 z', 2, 2, 100, 100)).toBe('m20 40 l10 10 h20 v-8 z');
    expect(transformPathData('M0 0 C10 0 20 10 20 20 S40 40 50 50 Q60 60 70 70 T80 80', 0.5, 0.5, 0, 0)).toBe('M0 0 C5 0 10 5 10 10 S20 20 25 25 Q30 30 35 35 T40 40');
    expect(transformPathData('M0,0 L1e1,-5.5', 1, 1, 0, 0)).toBe('M0 0 L10 -5.5');
  });

  it('keeps arcs round and turns their sweep when mirrored', () => {
    expect(transformPathData('M0 0 A10 10 0 0 1 20 0', 2, 2, 0, 0)).toBe('M0 0 A20 20 0 0 1 40 0');
    expect(transformPathData('M0 0 A10 10 0 0 1 20 0', -1, 1, 0, 0)).toBe('M0 0 A10 10 0 0 0 -20 0');
  });

  it('draws shapes in their box, centred, at true size', () => {
    expect(shapePathData(shape({ shape: 'rect' }), 100, 50)).toBe('M-50 -25H50V25H-50Z');
    // Rounded corners stop at the box.
    const rounded = nums(shapePathData(shape({ shape: 'rect', cornerRadiusMm: 200 }), 40, 20));
    expect(Math.max(...rounded.map(Math.abs))).toBeLessThanOrEqual(20);
    const star = shapePathData(shape({ shape: 'star', points: 5 }), 100, 100);
    expect(star.match(/[ML]/g)).toHaveLength(10);
    expect(nums(star).slice(0, 2)).toEqual([0, -50]);
    expect(shapePathData(shape({ shape: 'polygon', points: 6 }), 60, 60).match(/[ML]/g)).toHaveLength(6);
    expect(shapePathData(shape({ shape: 'triangle' }), 10, 10)).toBe('M0 -5L5 5L-5 5Z');
    // A library graphic's 0–100 box is mapped onto the layer box.
    expect(shapePathData(shape({ shape: 'path', path: 'M0 0 L100 100' }), 40, 20)).toBe('M-20 -10 L20 10');
    for (const d of [shapePathData(shape({ shape: 'ellipse' }), 30, 20), shapePathData(shape({ shape: 'heart' }), 30, 20)]) {
      expect(nums(d).every((v) => Math.abs(v) <= 30)).toBe(true);
      expect(d.endsWith('Z')).toBe(true);
    }
  });

  it('draws outline-only shapes as lines in their fill, at the outline width or 1.5 mm', () => {
    const ring = shapeSvg(shape({ shape: 'ellipse', fill: '#E63973', hollow: true }), 40, 40, new Defs(10));
    expect(ring).toContain('fill="none"');
    expect(ring).toContain('stroke="#E63973"');
    expect(ring).toContain('stroke-width="1.5"');
    expect(shapeSvg(shape({ shape: 'rect', hollow: true, strokeWidthMm: 3, strokeColor: '#000000' }), 40, 40, new Defs(10))).toContain('stroke-width="3"');
  });

  it('writes gradients with a middle colour, across or from the centre', () => {
    const defs = new Defs(10);
    const across = defs.paint('#FF0000', { kind: 'gradient', to: '#0000FF', angleDeg: 0, via: '#FFFF00' }, 100, 50);
    const round = defs.paint('#FF0000', { kind: 'gradient', to: '#0000FF', angleDeg: 0, radial: true }, 30, 40);
    expect(across).toBe('url(#p1)');
    expect(round).toBe('url(#p2)');
    expect(defs.svg).toContain('<linearGradient id="p1"');
    expect(defs.svg).toContain('<stop offset="0.5" stop-color="#FFFF00"/>');
    // From the centre to the corners: half the diagonal.
    expect(defs.svg).toContain('<radialGradient id="p2" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="25">');
  });
});
