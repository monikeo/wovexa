/**
 * Artwork font catalogue. Every family is SIL Open Font License from Google Fonts, so it can be
 * embedded in print files (spec AST-07). Khmer and Simplified Chinese families cover
 * mixed-language designs (spec §34).
 *
 * The core families load with the studio. The rest load on demand, one stylesheet per family,
 * and each face downloads only the glyph subsets its text uses.
 */
export type FontCategory = 'sans' | 'serif' | 'display' | 'sports' | 'script' | 'blackletter' | 'pixel' | 'grunge' | 'khmer' | 'korean' | 'chinese';

export const FONT_CATEGORIES: { id: FontCategory; label: string; sample?: string }[] = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'display', label: 'Display' },
  { id: 'sports', label: 'Sports' },
  { id: 'script', label: 'Script' },
  { id: 'blackletter', label: 'Gothic' },
  { id: 'pixel', label: 'Pixel and mono' },
  { id: 'grunge', label: 'Grunge' },
  { id: 'khmer', label: 'Khmer', sample: 'អក្សរខ្មែរ' },
  { id: 'korean', label: 'Korean', sample: '태권도' },
  { id: 'chinese', label: 'Chinese', sample: '中文设计' },
];

export interface ArtworkFont {
  family: string;
  weights: number[];
  italic?: boolean;
  category: FontCategory;
  note?: string;
}

const ALL_WEIGHTS = [400, 500, 600, 700, 800, 900];

export const ARTWORK_FONTS: ArtworkFont[] = [
  // Sans
  { family: 'Archivo', weights: ALL_WEIGHTS, italic: true, category: 'sans' },
  { family: 'Montserrat', weights: ALL_WEIGHTS, italic: true, category: 'sans' },
  { family: 'Poppins', weights: ALL_WEIGHTS, italic: true, category: 'sans' },
  { family: 'Oswald', weights: [400, 500, 600, 700], category: 'sans' },
  { family: 'Barlow Condensed', weights: ALL_WEIGHTS, italic: true, category: 'sans' },
  { family: 'League Spartan', weights: ALL_WEIGHTS, category: 'sans' },
  // Serif
  { family: 'Playfair Display', weights: ALL_WEIGHTS, italic: true, category: 'serif' },
  { family: 'DM Serif Display', weights: [400], italic: true, category: 'serif' },
  { family: 'Abril Fatface', weights: [400], category: 'serif' },
  { family: 'Cormorant Garamond', weights: [400, 500, 600, 700], italic: true, category: 'serif' },
  { family: 'Alfa Slab One', weights: [400], category: 'serif' },
  // Display
  { family: 'Bungee', weights: [400], category: 'display' },
  { family: 'Bungee Shade', weights: [400], category: 'display' },
  { family: 'Monoton', weights: [400], category: 'display' },
  { family: 'Righteous', weights: [400], category: 'display' },
  { family: 'Shrikhand', weights: [400], category: 'display' },
  { family: 'Rubik Mono One', weights: [400], category: 'display' },
  { family: 'Bowlby One SC', weights: [400], category: 'display' },
  { family: 'Racing Sans One', weights: [400], category: 'display' },
  // Sports and varsity
  { family: 'Graduate', weights: [400], category: 'sports', note: 'Varsity' },
  { family: 'Staatliches', weights: [400], category: 'sports' },
  { family: 'Teko', weights: [400, 500, 600, 700], category: 'sports' },
  { family: 'Russo One', weights: [400], category: 'sports' },
  { family: 'Black Ops One', weights: [400], category: 'sports', note: 'Stencil' },
  { family: 'Anton', weights: [400], category: 'sports' },
  { family: 'Bebas Neue', weights: [400], category: 'sports' },
  // Script and hand-drawn
  { family: 'Pacifico', weights: [400], category: 'script' },
  { family: 'Lobster', weights: [400], category: 'script' },
  { family: 'Dancing Script', weights: [400, 500, 600, 700], category: 'script' },
  { family: 'Great Vibes', weights: [400], category: 'script' },
  { family: 'Yellowtail', weights: [400], category: 'script' },
  { family: 'Kaushan Script', weights: [400], category: 'script' },
  { family: 'Satisfy', weights: [400], category: 'script' },
  { family: 'Caveat', weights: [400, 500, 600, 700], category: 'script' },
  { family: 'Permanent Marker', weights: [400], category: 'script' },
  // Blackletter
  { family: 'UnifrakturMaguntia', weights: [400], category: 'blackletter' },
  { family: 'Pirata One', weights: [400], category: 'blackletter' },
  { family: 'Grenze Gotisch', weights: ALL_WEIGHTS, category: 'blackletter' },
  // Pixel and mono
  { family: 'Press Start 2P', weights: [400], category: 'pixel' },
  { family: 'Silkscreen', weights: [400, 700], category: 'pixel' },
  { family: 'VT323', weights: [400], category: 'pixel' },
  { family: 'Space Mono', weights: [400, 700], italic: true, category: 'pixel' },
  // Grunge
  { family: 'Rubik Glitch', weights: [400], category: 'grunge' },
  { family: 'Rubik Wet Paint', weights: [400], category: 'grunge' },
  { family: 'Rubik Dirt', weights: [400], category: 'grunge' },
  // Khmer
  { family: 'Noto Sans Khmer', weights: [400, 700], category: 'khmer', note: 'Khmer' },
  { family: 'Noto Serif Khmer', weights: [400, 700], category: 'khmer', note: 'Khmer' },
  { family: 'Kantumruy Pro', weights: [400, 700], category: 'khmer', note: 'Khmer' },
  { family: 'Koulen', weights: [400], category: 'khmer', note: 'Khmer' },
  { family: 'Moul', weights: [400], category: 'khmer', note: 'Khmer' },
  { family: 'Battambang', weights: [400, 700], category: 'khmer', note: 'Khmer' },
  { family: 'Hanuman', weights: [400, 700], category: 'khmer', note: 'Khmer' },
  { family: 'Bokor', weights: [400], category: 'khmer', note: 'Khmer' },
  // Korean
  { family: 'Noto Sans KR', weights: [400, 700, 900], category: 'korean', note: 'Korean' },
  { family: 'Black Han Sans', weights: [400], category: 'korean', note: 'Korean' },
  { family: 'Do Hyeon', weights: [400], category: 'korean', note: 'Korean' },
  { family: 'Jua', weights: [400], category: 'korean', note: 'Korean' },
  { family: 'Nanum Brush Script', weights: [400], category: 'korean', note: 'Korean' },
  { family: 'Nanum Myeongjo', weights: [400, 700, 800], category: 'korean', note: 'Korean' },
  // Chinese
  { family: 'Noto Sans SC', weights: [400, 700], category: 'chinese', note: 'Chinese' },
  { family: 'Noto Serif SC', weights: [400, 700], category: 'chinese', note: 'Chinese' },
  { family: 'ZCOOL KuaiLe', weights: [400], category: 'chinese', note: 'Chinese' },
  { family: 'ZCOOL QingKe HuangYou', weights: [400], category: 'chinese', note: 'Chinese' },
  { family: 'Ma Shan Zheng', weights: [400], category: 'chinese', note: 'Chinese' },
  { family: 'Long Cang', weights: [400], category: 'chinese', note: 'Chinese' },
];

/** Families preloaded with the studio, so existing designs render their first frame correctly. */
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

const CORE = new Set(['Archivo', 'Anton', 'Bebas Neue', 'Oswald', 'Playfair Display', 'DM Serif Display', 'Permanent Marker', 'Rubik Mono One', 'Space Mono', 'Noto Sans Khmer', 'Noto Sans SC']);

/** Fallback families for scripts a chosen font may not cover, so Khmer, Korean and Chinese always render. */
export function scriptFallbacks(text: string): string[] {
  const out: string[] = [];
  if (/[ក-៿᧠-᧿]/.test(text)) out.push('Noto Sans Khmer');
  if (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(text)) out.push('Noto Sans KR');
  if (/[㐀-䶿一-鿿]/.test(text)) out.push('Noto Sans SC');
  return out;
}

export function findFont(family: string) {
  return ARTWORK_FONTS.find((f) => f.family === family);
}

export function fontWeights(family: string): number[] {
  return findFont(family)?.weights ?? [400, 700];
}

export function nearestWeight(family: string, weight: number) {
  const weights = fontWeights(family);
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0]);
}

/** Google Fonts stylesheet for one family, asking only for styles it really has (others fail the request). */
export function fontCssHref(font: ArtworkFont) {
  const name = font.family.replace(/ /g, '+');
  let axis = '';
  if (font.italic) axis = `:ital,wght@${[...font.weights.map((w) => `0,${w}`), ...font.weights.map((w) => `1,${w}`)].join(';')}`;
  else if (font.weights.length > 1 || font.weights[0] !== 400) axis = `:wght@${font.weights.join(';')}`;
  return `https://fonts.googleapis.com/css2?family=${name}${axis}&display=swap`;
}

const sheets = new Map<string, Promise<void>>();

function waitForSheet(link: HTMLLinkElement) {
  if (link.sheet) return Promise.resolve();
  return new Promise<void>((resolve) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => resolve(), { once: true });
  });
}

/** Make sure each catalogue family's @font-face rules are on the page. Unknown families are ignored. */
export function loadFontStylesheets(families: string[]): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const waits = families.map((family) => {
    const font = findFont(family);
    if (!font) return undefined;
    let pending = sheets.get(family);
    if (!pending) {
      const core = CORE.has(family) ? document.querySelector<HTMLLinkElement>(`link[rel="stylesheet"][href="${ARTWORK_FONTS_HREF}"]`) : null;
      if (core) {
        pending = waitForSheet(core);
      } else {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = fontCssHref(font);
        link.dataset.wovexaFont = family;
        pending = waitForSheet(link);
        document.head.appendChild(link);
      }
      sheets.set(family, pending);
    }
    return pending;
  });
  return Promise.all(waits).then(() => undefined);
}
