import { describe, expect, it } from 'vitest';
import { alphaBounds } from '@/lib/image-ops';
import { croppedTransform, fitCrop, FULL_CROP, isFullCrop, recroppedTransform } from './geometry';
import { effectiveDpi } from './preflight';
import type { ArtworkLayer } from './schema';

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

describe('free crop', () => {
  it('keeps the photo in place when cropped, re-cropped and uncropped', () => {
    const right = { x: 0.5, y: 0, w: 0.5, h: 1 };
    const once = { ...t, ...recroppedTransform(t, FULL_CROP, right) };
    expect(once).toMatchObject({ centerXmm: 150, widthMm: 100, heightMm: 100 });
    // Cropping again, from the crop, to the top half of what's left.
    const twice = { ...once, ...recroppedTransform(once, right, { x: 0.5, y: 0, w: 0.5, h: 0.5 }) };
    expect(twice).toMatchObject({ centerXmm: 150, centerYmm: 75, widthMm: 100, heightMm: 50 });
    // And back to the whole image: the original box.
    expect(recroppedTransform(twice, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, FULL_CROP)).toEqual({ centerXmm: 100, centerYmm: 100, widthMm: 200, heightMm: 100 });
  });

  it('fits the largest crop of a shape, centred where asked, zoomed in, inside the image', () => {
    // A square from a 400 × 200 image: as tall as the image, half its width.
    expect(fitCrop(1, 400, 200)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    // Centred far right, it stops at the edge; zoomed 2×, it is half the size.
    expect(fitCrop(1, 400, 200, 1, 0.5)).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(fitCrop(1, 400, 200, 0.5, 0.5, 2)).toEqual({ x: 0.375, y: 0.25, w: 0.25, h: 0.5 });
    expect(isFullCrop({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isFullCrop({ x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(false);
  });

  it('prints a crop at the resolution of the pixels it keeps', () => {
    const layer = {
      transform: { centerXmm: 100, centerYmm: 100, widthMm: 101.6, heightMm: 101.6, rotationDeg: 0, flipX: false, flipY: false },
      content: { kind: 'image', assetId: 'a', naturalWidthPx: 2400, naturalHeightPx: 1200, mime: 'image/jpeg', crop: { x: 0.25, y: 0, w: 0.5, h: 1 } },
    } as unknown as ArtworkLayer;
    // 1200 kept pixels across 4 inches: 300 dpi.
    expect(effectiveDpi(layer)?.min).toBeCloseTo(300);
  });
});
