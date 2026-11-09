import { describe, expect, it } from 'vitest';
import { paletteFromPixels } from '@/lib/image-ops';
import type { ArtworkLayer } from '@/domain/schema';
import { adjustMatrix, applyAdjust, distanceField, distressAt, effectiveDistress, halftoneCover, hashString, isNeutralAdjust, layerBleedMm, layerShadow, needsEffectPass, NEUTRAL_ADJUST, valueNoise } from './zone-renderer';

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);

describe('image adjustments', () => {
  it('leaves pixels untouched at neutral settings', () => {
    expect(isNeutralAdjust(NEUTRAL_ADJUST)).toBe(true);
    const data = px(12, 200, 99, 255);
    applyAdjust(data, NEUTRAL_ADJUST);
    expect([...data]).toEqual([12, 200, 99, 255]);
  });

  it('inverts, greys and keeps alpha', () => {
    const inverted = px(10, 20, 30, 128);
    applyAdjust(inverted, { ...NEUTRAL_ADJUST, invert: true });
    expect([...inverted]).toEqual([245, 235, 225, 128]);
    const grey = px(200, 40, 40, 255);
    applyAdjust(grey, { ...NEUTRAL_ADJUST, grayscale: true });
    expect(grey[0]).toBe(grey[1]);
    expect(grey[1]).toBe(grey[2]);
  });

  it('threshold makes a one-colour separation', () => {
    const data = px(30, 30, 30, 255, 220, 220, 220, 255);
    applyAdjust(data, { ...NEUTRAL_ADJUST, threshold: 128 });
    expect([...data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('a full hue turn is the identity', () => {
    const m = adjustMatrix({ ...NEUTRAL_ADJUST, hue: 180 });
    const back = adjustMatrix({ ...NEUTRAL_ADJUST, hue: -180 });
    for (let i = 0; i < 12; i++) expect(m[i]).toBeCloseTo(back[i], 9);
  });
});

describe('distress', () => {
  const d = { amount: 0.5, scaleMm: 6, seed: 99 };

  it('is deterministic for a seed and stays within 0–1', () => {
    for (const [x, y] of [[0, 0], [12.3, 45.6], [200, 7]]) {
      const a = distressAt(x, y, d);
      expect(a).toBe(distressAt(x, y, d));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
    expect(valueNoise(3.5, 2.25, 1)).toBe(valueNoise(3.5, 2.25, 1));
  });

  it('removes more ink as the amount rises', () => {
    const share = (amount: number) => {
      let removed = 0;
      for (let x = 0; x < 60; x++) for (let y = 0; y < 60; y++) removed += distressAt(x, y, { ...d, amount });
      return removed / 3600;
    };
    expect(share(0)).toBe(0);
    expect(share(0.3)).toBeLessThan(share(0.7));
    expect(share(1)).toBeGreaterThan(0.8);
  });

  it('gives the distressed finish a default wear seeded by the layer', () => {
    const layer = { id: 'layer-a', style: { opacity: 1, blendMode: 'normal' as const, finish: 'distressed' as const } };
    expect(effectiveDistress(layer)).toEqual({ amount: 0.45, scaleMm: 6, seed: hashString('layer-a') % 100000 });
    expect(effectiveDistress({ ...layer, style: { ...layer.style, distress: { amount: 0, scaleMm: 6, seed: 1 } } })).toBeNull();
    expect(effectiveDistress({ ...layer, style: { ...layer.style, finish: 'flat_ink' } })).toBeNull();
  });
});

describe('sticker outline and halftone', () => {
  it('measures the exact distance to the nearest inside pixel', () => {
    // A single inside pixel in the middle of a 7 × 5 grid.
    const field = distanceField((i) => i === 2 * 7 + 3, 7, 5);
    expect(field[2 * 7 + 3]).toBe(0);
    expect(field[2 * 7 + 6]).toBe(9); // three across
    expect(field[0]).toBe(9 + 4); // corner: three across, two up
    // Two inside pixels: each cell measures to the nearer one.
    const two = distanceField((i) => i === 0 || i === 9, 10, 1);
    expect(Array.from(two)).toEqual([0, 1, 4, 9, 16, 16, 9, 4, 1, 0]);
  });

  it('screens by tone (photos) or by opacity (fades)', () => {
    expect(halftoneCover(0, 0, 0, 255, 'tone')).toBeCloseTo(1);
    expect(halftoneCover(255, 255, 255, 255, 'tone')).toBeCloseTo(0);
    expect(halftoneCover(0, 0, 0, 128, 'tone')).toBeCloseTo(128 / 255);
    // A fade screens a light colour as solidly as a dark one; only its opacity counts.
    expect(halftoneCover(255, 230, 0, 255, 'fade')).toBe(1);
    expect(halftoneCover(255, 230, 0, 51, 'fade')).toBeCloseTo(0.2);
  });

  it('gives every layer a shadow, outline and halftone that reach the print and its bleed', () => {
    const shape: ArtworkLayer = {
      id: 's',
      name: 'Star',
      visible: true,
      locked: false,
      transform: { centerXmm: 50, centerYmm: 50, widthMm: 40, heightMm: 40, rotationDeg: 0, flipX: false, flipY: false },
      style: { opacity: 1, blendMode: 'normal', finish: 'flat_ink' },
      content: { kind: 'shape', shape: 'star', fill: '#000000', cornerRadiusMm: 0 },
    };
    expect(needsEffectPass(shape)).toBe(false);
    expect(layerBleedMm(shape)).toBe(0);
    const styled = { ...shape, style: { ...shape.style, outline: { color: '#FFFFFF', widthMm: 3 }, shadow: { color: '#000000', offsetXmm: 2, offsetYmm: 4, blurMm: 2 } } };
    expect(needsEffectPass(styled)).toBe(true);
    // The outline and the shadow beyond it both fit in the bleed.
    expect(layerBleedMm(styled)).toBeCloseTo(3.5 + 4 + 3);
    expect(needsEffectPass({ ...shape, style: { ...shape.style, halftone: { cellMm: 2, angleDeg: 45, shape: 'dot', by: 'tone' } } })).toBe(true);
    // Outline-only shapes reach half their line past the box.
    expect(layerBleedMm({ ...shape, content: { ...shape.content, hollow: true } as ArtworkLayer['content'] })).toBeCloseTo(1.25);
    // Text keeps its own shadow; it wins over a style shadow.
    const textShadow = { color: '#FF0000', offsetXmm: 1, offsetYmm: 1, blurMm: 0 };
    const text = { ...styled, content: { kind: 'text', value: 'A', fontFamily: 'Archivo', fontWeight: 700, italic: false, fill: '#000000', align: 'center', letterSpacingEm: 0, lineHeight: 1.2, curveDeg: 0, shadow: textShadow } } as ArtworkLayer;
    expect(layerShadow(text)).toEqual(textShadow);
    expect(layerShadow(styled)).toEqual(styled.style.shadow);
  });
});

describe('palette extraction', () => {
  it('ranks dominant colours, merges near shades and ignores transparent pixels', () => {
    const pixels: number[] = [];
    const add = (n: number, rgba: number[]) => {
      for (let i = 0; i < n; i++) pixels.push(...rgba);
    };
    add(60, [232, 17, 45, 255]);
    add(10, [236, 20, 48, 255]); // a near shade of the red
    add(25, [43, 89, 255, 255]);
    add(40, [0, 255, 0, 0]); // transparent: ignored
    const palette = paletteFromPixels(new Uint8ClampedArray(pixels), 6);
    expect(palette).toHaveLength(2);
    expect(palette[0].hex.startsWith('#E')).toBe(true);
    expect(palette[0].share).toBeCloseTo(70 / 95, 6);
    expect(palette[1].hex).toBe('#2B59FF');
  });
});
