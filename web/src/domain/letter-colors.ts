/**
 * Each letter in its own colour (spec TYP-03): the colours run across the letters in turn, line after
 * line, repeating. Spaces take no colour, so "GO TEAM" in red and white reads G O, T E A M in
 * red, white, red, white, red, white.
 */

/** Grapheme clusters: letters as a reader counts them (an accent or a Khmer vowel sign stays with its letter). */
export function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** The colour of each letter of each line (null for spaces) when text has letter colours. */
export function letterInks(lines: string[], colors: string[]): (string | null)[][] {
  let k = 0;
  return lines.map((line) => graphemes(line).map((g) => (g.trim() === '' || !colors.length ? null : colors[k++ % colors.length])));
}

/** Ready-made letter colour runs; each colour stays editable. */
export const LETTER_PALETTES: { name: string; colors: string[] }[] = [
  { name: 'Rainbow', colors: ['#E63946', '#F4A261', '#E9C46A', '#2A9D8F', '#457B9D', '#7B2CBF'] },
  { name: 'Primary', colors: ['#E10600', '#FFD100', '#0047AB'] },
  { name: 'Pastel', colors: ['#FFADAD', '#FFD6A5', '#FDFFB6', '#CAFFBF', '#9BF6FF', '#BDB2FF'] },
  { name: 'Neon', colors: ['#F72585', '#4CC9F0', '#B5FF00', '#FF9E00'] },
  { name: 'Varsity', colors: ['#8C1D40', '#FFC627'] },
  { name: 'Mono', colors: ['#111111', '#6B6B6B'] },
];
