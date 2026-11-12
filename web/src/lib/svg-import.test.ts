import { describe, expect, it } from 'vitest';
import { boundsOf, parsePath } from '@/domain/path-edit';
import type { ArtworkLayer } from '@/domain/schema';
import { cssColor, ellipsePath, mergePieces, piecesToLayers, pointsPath, rectPath, SvgImportError, type SvgPiece } from './svg-import';

const image = (t: Partial<ArtworkLayer['transform']> = {}): ArtworkLayer => ({
  id: 'img',
  name: 'logo.svg',
  visible: true,
  locked: false,
  transform: { centerXmm: 150, centerYmm: 100, widthMm: 100, heightMm: 50, rotationDeg: 0, flipX: false, flipY: false, ...t },
  style: { opacity: 0.8, blendMode: 'normal', finish: 'flat_ink' },
  content: { kind: 'image', assetId: 'a1', naturalWidthPx: 200, naturalHeightPx: 100, mime: 'image/svg+xml' },
});

/** A square piece `size` mm wide at (x, y) in the image's box. */
const square = (x: number, y: number, size: number, fill = '#FF0000', extra: Partial<SvgPiece> = {}): SvgPiece => ({
  subpaths: parsePath(`M${x} ${y}H${x + size}V${y + size}H${x}Z`),
  fill,
  opacity: 1,
  name: '',
  ...extra,
});

describe('reading SVG colours', () => {
  it('reads the colours a browser computes, and none', () => {
    expect(cssColor('rgb(227, 6, 19)')).toEqual({ hex: '#E30613', alpha: 1 });
    expect(cssColor('rgba(0, 0, 0, 0.5)')).toEqual({ hex: '#000000', alpha: 0.5 });
    expect(cssColor('rgb(255 128 0 / 25%)')).toEqual({ hex: '#FF8000', alpha: 0.25 });
    expect(cssColor('#abc')).toEqual({ hex: '#AABBCC', alpha: 1 });
    expect(cssColor('none')).toBeNull();
    expect(cssColor('rgba(10, 10, 10, 0)')).toBeNull();
    expect(cssColor('url("#grad")')).toBeNull();
  });
});

describe('SVG shapes as paths', () => {
  it('draws rectangles with corners rounded as SVG does', () => {
    expect(rectPath(10, 20, 30, 40)).toBe('M10 20H40V60H10Z');
    const rounded = parsePath(rectPath(0, 0, 40, 20, 50));
    // Corners clamp to half the shorter side; the box stays the rectangle's.
    const b = boundsOf(rounded);
    expect([b.x, b.y, Math.round(b.w), Math.round(b.h)]).toEqual([0, 0, 40, 20]);
    expect(rectPath(0, 0, 0, 10)).toBe('');
  });

  it('draws circles and ellipses as closed curves round their centre', () => {
    const b = boundsOf(parsePath(ellipsePath(50, 40, 20, 10)));
    expect([Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)]).toEqual([30, 30, 40, 20]);
    expect(parsePath(ellipsePath(0, 0, 5, 5))[0].closed).toBe(true);
  });

  it('reads polyline and polygon points, however they are spaced', () => {
    expect(pointsPath('0,0 10,0 10 10', false)).toBe('M0 0L10 0L10 10');
    expect(pointsPath('0 0,10 0,5 8', true)).toBe('M0 0L10 0L5 8Z');
    expect(pointsPath('1', true)).toBe('');
  });
});

describe('SVG shapes as layers', () => {
  it('lays each shape exactly where the image shows it, grouped, at the image’s opacity', () => {
    const { layers } = piecesToLayers([square(0, 0, 10), square(80, 30, 20, '#0000FF')], image(), 200);
    expect(layers).toHaveLength(2);
    expect(layers[0].groupId).toBeDefined();
    expect(layers[0].groupId).toBe(layers[1].groupId);
    // The image's box runs 100–200 × 75–125 mm: the first square's middle is 5 mm into it.
    expect(layers[0].transform).toMatchObject({ centerXmm: 105, centerYmm: 80, widthMm: 10, heightMm: 10 });
    expect(layers[1].transform).toMatchObject({ centerXmm: 190, centerYmm: 115 });
    expect(layers[1].content).toMatchObject({ kind: 'shape', shape: 'path', fill: '#0000FF' });
    expect(layers[0].style.opacity).toBeCloseTo(0.8);
  });

  it('turns and mirrors with the image', () => {
    const { layers } = piecesToLayers([square(0, 0, 10)], image({ rotationDeg: 90, flipX: true }), 200);
    // 45 mm left and 20 mm up of the middle, mirrored then turned a quarter.
    expect(layers[0].transform.centerXmm).toBeCloseTo(150 + 20);
    expect(layers[0].transform.centerYmm).toBeCloseTo(100 + 45);
    expect(layers[0].transform).toMatchObject({ rotationDeg: 90, flipX: true });
    expect(layers[0].groupId).toBeUndefined();
  });

  it('keeps strokes as outline-only lines, and gives a straight line a box', () => {
    const line: SvgPiece = { subpaths: parsePath('M0 10L50 10'), fill: '#111111', opacity: 0.5, lineMm: 1.2, roundCaps: true, name: 'rule line' };
    const { layers } = piecesToLayers([line], image(), 200);
    expect(layers[0].content).toMatchObject({ hollow: true, strokeWidthMm: 1.2, roundCaps: true });
    expect(layers[0].transform.heightMm).toBe(0.5);
    expect(layers[0].name).toBe('rule line');
    expect(layers[0].style.opacity).toBeCloseTo(0.4);
  });

  it('shares a layer between neighbours that look alike, and across the stack only when it must', () => {
    const pieces = [square(0, 0, 5), square(10, 0, 5), square(20, 0, 5, '#00FF00'), square(30, 0, 5)];
    expect(mergePieces(pieces, false).map((p) => [p.fill, p.subpaths.length])).toEqual([['#FF0000', 2], ['#00FF00', 1], ['#FF0000', 1]]);
    expect(mergePieces(pieces, true).map((p) => [p.fill, p.subpaths.length])).toEqual([['#FF0000', 3], ['#00FF00', 1]]);
    const fitted = piecesToLayers(pieces, image(), 2);
    expect(fitted.mergedAcross).toBe(true);
    expect(fitted.layers).toHaveLength(2);
    expect(() => piecesToLayers(pieces, image(), 1)).toThrow(SvgImportError);
  });
});
