/**
 * Fonts offered for artwork. All are SIL Open Font License families from Google Fonts,
 * so they can be embedded in print files (spec AST-07). Khmer and Simplified Chinese
 * families cover mixed-language designs (spec §34).
 */
export interface ArtworkFont {
  family: string;
  weights: number[];
  italic?: boolean;
  note?: string;
}

export const ARTWORK_FONTS: ArtworkFont[] = [
  { family: 'Archivo', weights: [400, 500, 600, 700, 800, 900], italic: true },
  { family: 'Anton', weights: [400] },
  { family: 'Bebas Neue', weights: [400] },
  { family: 'Oswald', weights: [400, 500, 600, 700] },
  { family: 'Playfair Display', weights: [400, 600, 700, 900], italic: true },
  { family: 'DM Serif Display', weights: [400], italic: true },
  { family: 'Permanent Marker', weights: [400] },
  { family: 'Rubik Mono One', weights: [400] },
  { family: 'Space Mono', weights: [400, 700], italic: true },
  { family: 'Noto Sans Khmer', weights: [400, 700], note: 'Khmer' },
  { family: 'Noto Sans SC', weights: [400, 700], note: 'Chinese' },
];

export const ARTWORK_FONTS_HREF =
  'https://fonts.googleapis.com/css2?' +
  [
    'family=Archivo:ital,wght@0,400..900;1,400..900',
    'family=Anton',
    'family=Bebas+Neue',
    'family=Oswald:wght@400..700',
    'family=Playfair+Display:ital,wght@0,400..900;1,400..900',
    'family=DM+Serif+Display:ital@0;1',
    'family=Permanent+Marker',
    'family=Rubik+Mono+One',
    'family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700',
    'family=Noto+Sans+Khmer:wght@400;700',
    'family=Noto+Sans+SC:wght@400;700',
  ].join('&') +
  '&display=swap';

export function fontWeights(family: string): number[] {
  return ARTWORK_FONTS.find((f) => f.family === family)?.weights ?? [400, 700];
}

export function nearestWeight(family: string, weight: number) {
  const weights = fontWeights(family);
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0]);
}
