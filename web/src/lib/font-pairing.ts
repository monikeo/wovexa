/**
 * Font pairing suggestions (spec TYP-03): for the font of a headline, catalogue fonts that work as
 * its second voice (a subline, a date, a tagline), each with the reason in plain words. Specific
 * fonts have their own known pairs; any other font gets the pairs of its category.
 */
import { ARTWORK_FONTS, type FontCategory } from './fonts';

export interface Pairing {
  family: string;
  why: string;
}

const CLEAN_SANS = 'a clean sans for the smaller words';
const SCRIPT_ACCENT = 'a script accent: bold and loose together';
const SERIF_CONTRAST = 'an elegant serif for contrast';
const MONO_DETAIL = 'a typewriter mono for dates and details';
const CONDENSED_HEAD = 'tall condensed capitals for a bold second line';

const BY_FAMILY: Record<string, [string, string][]> = {
  'Bebas Neue': [['Montserrat', CLEAN_SANS], ['Yellowtail', SCRIPT_ACCENT], ['Playfair Display', SERIF_CONTRAST]],
  Anton: [['Archivo', CLEAN_SANS], ['Kaushan Script', SCRIPT_ACCENT], ['Space Mono', MONO_DETAIL]],
  Oswald: [['Montserrat', CLEAN_SANS], ['Pacifico', SCRIPT_ACCENT], ['Playfair Display', SERIF_CONTRAST]],
  Teko: [['Archivo', CLEAN_SANS], ['Permanent Marker', 'a marker scrawl beside sharp capitals'], ['Space Mono', MONO_DETAIL]],
  Staatliches: [['Poppins', CLEAN_SANS], ['Yellowtail', SCRIPT_ACCENT], ['Space Mono', MONO_DETAIL]],
  'Barlow Condensed': [['Archivo', CLEAN_SANS], ['Satisfy', SCRIPT_ACCENT], ['DM Serif Display', SERIF_CONTRAST]],
  Graduate: [['Archivo', CLEAN_SANS], ['Yellowtail', 'the college script under varsity letters'], ['Oswald', CONDENSED_HEAD]],
  'Russo One': [['Montserrat', CLEAN_SANS], ['Kaushan Script', SCRIPT_ACCENT], ['Space Mono', MONO_DETAIL]],
  'Black Ops One': [['Space Mono', MONO_DETAIL], ['Archivo', CLEAN_SANS], ['Permanent Marker', 'a marker scrawl over the stencil']],
  'Playfair Display': [['Montserrat', CLEAN_SANS], ['Archivo', CLEAN_SANS], ['Great Vibes', 'a fine script for a signature line']],
  'DM Serif Display': [['Poppins', CLEAN_SANS], ['Archivo', CLEAN_SANS], ['Dancing Script', SCRIPT_ACCENT]],
  'Abril Fatface': [['Poppins', CLEAN_SANS], ['Montserrat', CLEAN_SANS], ['Satisfy', SCRIPT_ACCENT]],
  'Cormorant Garamond': [['Montserrat', CLEAN_SANS], ['Great Vibes', 'a fine script for a signature line'], ['Archivo', CLEAN_SANS]],
  'Alfa Slab One': [['Montserrat', CLEAN_SANS], ['Archivo', CLEAN_SANS], ['Pacifico', SCRIPT_ACCENT]],
  Pacifico: [['Bebas Neue', `${CONDENSED_HEAD} under a script, the classic streetwear pair`], ['Oswald', CONDENSED_HEAD], ['Montserrat', CLEAN_SANS]],
  Lobster: [['Oswald', CONDENSED_HEAD], ['Montserrat', CLEAN_SANS], ['Bebas Neue', CONDENSED_HEAD]],
  Yellowtail: [['Graduate', 'varsity letters under the college script'], ['Bebas Neue', CONDENSED_HEAD], ['Archivo', CLEAN_SANS]],
  'Great Vibes': [['Cormorant Garamond', 'a refined serif to match its flourish'], ['Playfair Display', SERIF_CONTRAST], ['Montserrat', CLEAN_SANS]],
  'Permanent Marker': [['Anton', CONDENSED_HEAD], ['Space Mono', MONO_DETAIL], ['Archivo', CLEAN_SANS]],
  UnifrakturMaguntia: [['Archivo', CLEAN_SANS], ['Space Mono', MONO_DETAIL], ['Bebas Neue', CONDENSED_HEAD]],
  'Pirata One': [['Archivo', CLEAN_SANS], ['Bebas Neue', CONDENSED_HEAD], ['Space Mono', MONO_DETAIL]],
  'Grenze Gotisch': [['Archivo', CLEAN_SANS], ['Space Mono', MONO_DETAIL], ['Oswald', CONDENSED_HEAD]],
  Moul: [['Kantumruy Pro', 'a clean Khmer sans for the smaller words'], ['Battambang', 'a classic Khmer text face'], ['Montserrat', 'a Latin sans for English words']],
  Koulen: [['Battambang', 'a classic Khmer text face'], ['Kantumruy Pro', 'a clean Khmer sans for the smaller words'], ['Bebas Neue', 'Latin capitals that match its height']],
  'Black Han Sans': [['Noto Sans KR', 'a clean Korean sans for the smaller words'], ['Nanum Myeongjo', 'a Korean serif for contrast'], ['Bebas Neue', 'Latin capitals that match its weight']],
  'ZCOOL KuaiLe': [['Noto Sans SC', 'a clean Chinese sans for the smaller words'], ['Poppins', 'a rounded Latin sans to match']],
  'Ma Shan Zheng': [['Noto Serif SC', 'a Chinese serif for the smaller words'], ['Noto Sans SC', 'a clean Chinese sans for the smaller words']],
};

const BY_CATEGORY: Record<FontCategory, [string, string][]> = {
  sans: [['Playfair Display', SERIF_CONTRAST], ['Bebas Neue', CONDENSED_HEAD], ['Yellowtail', SCRIPT_ACCENT]],
  serif: [['Montserrat', CLEAN_SANS], ['Archivo', CLEAN_SANS], ['Great Vibes', 'a fine script for a signature line']],
  display: [['Montserrat', CLEAN_SANS], ['Archivo', CLEAN_SANS], ['Space Mono', MONO_DETAIL]],
  sports: [['Montserrat', CLEAN_SANS], ['Yellowtail', SCRIPT_ACCENT], ['Archivo', CLEAN_SANS]],
  script: [['Bebas Neue', `${CONDENSED_HEAD} under a script, the classic streetwear pair`], ['Oswald', CONDENSED_HEAD], ['Montserrat', CLEAN_SANS]],
  blackletter: [['Archivo', CLEAN_SANS], ['Bebas Neue', CONDENSED_HEAD], ['Space Mono', MONO_DETAIL]],
  pixel: [['Space Mono', MONO_DETAIL], ['Archivo', CLEAN_SANS], ['VT323', 'a terminal face for the small print']],
  grunge: [['Archivo', CLEAN_SANS], ['Bebas Neue', CONDENSED_HEAD], ['Space Mono', MONO_DETAIL]],
  khmer: [['Moul', 'a bold Khmer display face for contrast'], ['Kantumruy Pro', 'a clean Khmer sans for the smaller words'], ['Montserrat', 'a Latin sans for English words']],
  korean: [['Black Han Sans', 'a bold Korean display face for contrast'], ['Noto Sans KR', 'a clean Korean sans for the smaller words'], ['Montserrat', 'a Latin sans for English words']],
  chinese: [['ZCOOL KuaiLe', 'a playful Chinese display face for contrast'], ['Noto Sans SC', 'a clean Chinese sans for the smaller words'], ['Montserrat', 'a Latin sans for English words']],
};

/**
 * Up to three catalogue fonts that pair with `family`, best first. A font uploaded to the device
 * (not in the catalogue) gets the pairs of a sans.
 */
export function pairingsFor(family: string): Pairing[] {
  const font = ARTWORK_FONTS.find((f) => f.family === family);
  const list = BY_FAMILY[family] ?? BY_CATEGORY[font?.category ?? 'sans'];
  return list
    .filter(([f]) => f !== family && ARTWORK_FONTS.some((a) => a.family === f))
    .slice(0, 3)
    .map(([f, why]) => ({ family: f, why }));
}
