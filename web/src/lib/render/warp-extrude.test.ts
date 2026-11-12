import { describe, expect, it } from 'vitest';
import { defaultExtrude, extrudeColorFor } from '@/domain/extrude';
import { designDocumentSchema, layerStyleSchema, textContentSchema, type ArtworkLayer, type TextContent } from '@/domain/schema';
import { hasVectorEffects } from '@/lib/export/svg-artwork';
import { isEnveloped, isWarped, layerBleedMm, needsEffectPass, warpScale } from './zone-renderer';

const text = (c: Partial<TextContent> = {}): TextContent => ({
  kind: 'text',
  value: 'CLUB',
  fontFamily: 'Archivo',
  fontWeight: 800,
  italic: false,
  fill: '#C8102E',
  align: 'center',
  letterSpacingEm: 0,
  lineHeight: 1.1,
  curveDeg: 0,
  ...c,
});

const layer = (style: Partial<ArtworkLayer['style']> = {}, content: ArtworkLayer['content'] = text()): ArtworkLayer => ({
  id: 'l1',
  name: 'CLUB',
  visible: true,
  locked: false,
  transform: { centerXmm: 150, centerYmm: 100, widthMm: 200, heightMm: 60, rotationDeg: 0, flipX: false, flipY: false },
  style: { opacity: 1, blendMode: 'normal', finish: 'flat_ink', ...style },
  content,
});

describe('text envelope warps', () => {
  it('bulges toward the middle, pinches with a negative amount, and leaves the ends as set', () => {
    expect(warpScale({ kind: 'bulge', amount: 50 }, 0.5).s).toBeCloseTo(1.4);
    expect(warpScale({ kind: 'bulge', amount: 50 }, 0).s).toBeCloseTo(1);
    expect(warpScale({ kind: 'bulge', amount: 50 }, 1).s).toBeCloseTo(1);
    expect(warpScale({ kind: 'bulge', amount: -50 }, 0.5).s).toBeCloseTo(0.6);
    expect(warpScale({ kind: 'bulge', amount: 50 }, 0.5).fromBase).toBe(false);
  });

  it('arches from the baseline, and grows across for perspective, never vanishing', () => {
    expect(warpScale({ kind: 'arch', amount: 100 }, 0.5)).toEqual({ s: 1.8, fromBase: true });
    expect(warpScale({ kind: 'perspective', amount: 50 }, 0).s).toBeCloseTo(0.6);
    expect(warpScale({ kind: 'perspective', amount: 50 }, 1).s).toBeCloseTo(1.4);
    expect(warpScale({ kind: 'perspective', amount: -50 }, 0).s).toBeCloseTo(1.4);
    expect(warpScale({ kind: 'perspective', amount: 100 }, 0).s).toBeGreaterThanOrEqual(0.15);
  });

  it('applies to straight single-line text; a path, curve or wave comes first', () => {
    const warp = { kind: 'bulge' as const, amount: 40 };
    expect(isEnveloped(text({ warp }))).toBe(true);
    expect(isWarped(text({ warp }))).toBe(true);
    expect(isEnveloped(text({ warp, curveDeg: 30 }))).toBe(false);
    expect(isEnveloped(text({ warp, wave: 40 }))).toBe(false);
    expect(isEnveloped(text({ warp, value: 'TWO\nLINES' }))).toBe(false);
    expect(isEnveloped(text({ warp, onPath: { d: 'M0 50 L100 50', aspect: 1, start: 0, span: 1, side: 'above' } }))).toBe(false);
    expect(isEnveloped(text({ warp: { kind: 'arch', amount: 0 } }))).toBe(false);
    expect(isWarped(text())).toBe(false);
  });

  it('validates in the document format', () => {
    expect(textContentSchema.safeParse(text({ warp: { kind: 'perspective', amount: -60 } })).success).toBe(true);
    expect(textContentSchema.safeParse({ ...text(), warp: { kind: 'twist', amount: 10 } }).success).toBe(false);
    expect(textContentSchema.safeParse(text({ warp: { kind: 'bulge', amount: 150 } })).success).toBe(false);
  });
});

describe('3D extrusion', () => {
  const extrude = { color: '#3A0A0A', depthMm: 4, angleDeg: 45, shade: true };

  it('runs the effect pass and reaches its depth past the layer box', () => {
    expect(needsEffectPass(layer())).toBe(false);
    expect(needsEffectPass(layer({ extrude }))).toBe(true);
    expect(layerBleedMm(layer({ extrude })) - layerBleedMm(layer())).toBeCloseTo(4.5);
  });

  it('is printed as pixels in SVG files, even beside vector effects', () => {
    expect(hasVectorEffects(layer({ outline: { color: '#FFFFFF', widthMm: 2 } }))).toBe(true);
    expect(hasVectorEffects(layer({ outline: { color: '#FFFFFF', widthMm: 2 }, extrude }))).toBe(false);
  });

  it('takes a darker side for light artwork and a lighter one for dark artwork', () => {
    expect(extrudeColorFor('#FFFFFF')).toBe('#595959');
    expect(extrudeColorFor('#000000')).toBe('#4B4B4B');
    expect(extrudeColorFor('red')).toBe('#1A1A1A');
    expect(defaultExtrude(layer())).toEqual({ color: extrudeColorFor('#C8102E'), depthMm: 3, angleDeg: 45, shade: true });
  });

  it('validates its limits in the document format', () => {
    const style = { opacity: 1, blendMode: 'normal', finish: 'flat_ink' };
    expect(layerStyleSchema.safeParse({ ...style, extrude }).success).toBe(true);
    expect(layerStyleSchema.safeParse({ ...style, extrude: { ...extrude, depthMm: 80 } }).success).toBe(false);
    expect(layerStyleSchema.safeParse({ ...style, extrude: { ...extrude, color: 'red' } }).success).toBe(false);
  });

  it('keeps documents without it valid', () => {
    expect(designDocumentSchema.shape.garment.shape.finish.safeParse(undefined).success).toBe(true);
    expect(designDocumentSchema.shape.garment.shape.finish.safeParse('vintage').success).toBe(true);
    expect(designDocumentSchema.shape.garment.shape.finish.safeParse('stonewashed').success).toBe(false);
  });
});
