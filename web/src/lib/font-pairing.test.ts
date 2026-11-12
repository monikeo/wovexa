import { describe, expect, it } from 'vitest';
import { pairingsFor } from './font-pairing';
import { ARTWORK_FONTS } from './fonts';

describe('font pairing', () => {
  it('gives known pairs for a font, best first, each with a reason', () => {
    const pairs = pairingsFor('Bebas Neue');
    expect(pairs.map((p) => p.family)).toEqual(['Montserrat', 'Yellowtail', 'Playfair Display']);
    expect(pairs.every((p) => p.why.length > 10)).toBe(true);
  });

  it('falls back to the pairs of the font’s category, and of a sans for an uploaded font', () => {
    expect(pairingsFor('Monoton').map((p) => p.family)).toEqual(['Montserrat', 'Archivo', 'Space Mono']);
    expect(pairingsFor('My Uploaded Font').map((p) => p.family)).toEqual(['Playfair Display', 'Bebas Neue', 'Yellowtail']);
  });

  it('never suggests the font itself, and only fonts in the catalogue', () => {
    for (const font of ARTWORK_FONTS) {
      const pairs = pairingsFor(font.family);
      expect(pairs.length).toBeGreaterThan(0);
      expect(pairs.length).toBeLessThanOrEqual(3);
      for (const p of pairs) {
        expect(p.family).not.toBe(font.family);
        expect(ARTWORK_FONTS.some((a) => a.family === p.family)).toBe(true);
      }
    }
  });

  it('pairs script and non-Latin fonts within their own writing systems first', () => {
    expect(pairingsFor('Moul')[0].family).toBe('Kantumruy Pro');
    expect(pairingsFor('Black Han Sans')[0].family).toBe('Noto Sans KR');
    expect(pairingsFor('Noto Sans SC')[0].family).toBe('ZCOOL KuaiLe');
  });
});
