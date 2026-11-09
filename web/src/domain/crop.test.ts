import { describe, expect, it } from 'vitest';
import { alphaBounds } from '@/lib/image-ops';
import { croppedTransform } from './geometry';

const t = { centerXmm: 100, centerYmm: 100, widthMm: 200, heightMm: 100, rotationDeg: 0, flipX: false, flipY: false };
/** A 400 × 200 px image whose artwork fills x 200–399, y 0–99: the top-right quarter. */
const crop = { x: 200, y: 0, w: 200, h: 100 };

describe('trimming empty edges', () => {
  it('finds the box of the visible pixels, or none', () => {
    const w = 6;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    data[(1 * w + 2) * 4 + 3] = 255;
    data[(2 * w + 4) * 4 + 3] = 200;
    data[(3 * w + 0) * 4 + 3] = 5; // all but invisible: ignored
    expect(alphaBounds(data, w, h)).toEqual({ x: 2, y: 1, w: 3, h: 2 });
    expect(alphaBounds(new Uint8ClampedArray(w * h * 4), w, h)).toBeNull();
  });

  it('keeps the artwork where it was in a tighter box', () => {
    // The top-right quarter of a 200 × 100 mm box centred at (100, 100) sits at (150, 75).
    expect(croppedTransform(t, 400, 200, crop)).toEqual({ centerXmm: 150, centerYmm: 75, widthMm: 100, heightMm: 50 });
  });

  it('follows the layer when it is mirrored or turned', () => {
    // Mirrored left to right, that quarter is drawn on the left.
    expect(croppedTransform({ ...t, flipX: true }, 400, 200, crop).centerXmm).toBeCloseTo(50);
    // Turned 90° clockwise, right of centre becomes below it, and up becomes right.
    const turned = croppedTransform({ ...t, rotationDeg: 90 }, 400, 200, crop);
    expect(turned.centerXmm).toBeCloseTo(125);
    expect(turned.centerYmm).toBeCloseTo(150);
  });
});
