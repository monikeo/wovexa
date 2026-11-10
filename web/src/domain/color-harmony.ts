/**
 * Colourway ideas (spec AI-04): colourways worked out around the colour wheel from an anchor hue
 * (the garment's own colour, or the artwork's main ink when the garment is white, black or grey),
 * kept to colours fabric is really dyed in, and scored for how well the artwork's inks read on
 * them. Pure and deterministic, so it is tested without the studio; it runs on the device.
 */
import { artboardSpec, designAreas } from './areas';
import { getGarment } from './garments';
import type { ArtworkLayer, Colorway, DesignDocument, LayerContent } from './schema';

export interface Hsl {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  l: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) =>
    Math.round(clamp01(v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio: 1 (none) to 21 (black on white). Print reads well from about 3. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * How colourful a colour is: the spread between its strongest and weakest channel, 0–1. HSL
 * saturation overstates pale and very dark colours (bone reads as 31 % saturated); this doesn't.
 */
export function chroma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (Math.max(...ch) - Math.min(...ch)) / 255;
}

/** White, black, greys and barely tinted colours (near-black navy included): no hue to build a harmony on. */
export function isNeutral(hex: string): boolean {
  const { l } = hexToHsl(hex);
  return chroma(hex) < 0.08 || l < 0.12 || l > 0.95;
}

type Band = 'dark' | 'mid' | 'light';
/** Lightness and saturation of dyed fabric: deep, bright and pale. Neon and muddy colours are left out. */
const BANDS: Record<Band, { s: number; l: number }> = { dark: { s: 0.42, l: 0.21 }, mid: { s: 0.58, l: 0.45 }, light: { s: 0.4, l: 0.84 } };
const bandOf = (hex: string): Band => {
  const { l } = hexToHsl(hex);
  return l < 0.33 ? 'dark' : l > 0.7 ? 'light' : 'mid';
};
const fabric = (h: number, band: Band) => hslToHex({ h, ...BANDS[band] });
/** The same colour, lighter (+) or darker (−). */
const shade = (hex: string, dl: number) => {
  const c = hexToHsl(hex);
  return hslToHex({ ...c, l: clamp01(c.l + dl) });
};
/** Thread a touch off the body colour, as real stitching is. */
const stitchFor = (body: string) => shade(body, bandOf(body) === 'light' ? -0.08 : 0.07);

const HUES: [number, string, string, string][] = [
  // Up to this hue: the dark, mid and light name.
  [12, 'burgundy', 'red', 'blush'],
  [40, 'rust', 'orange', 'peach'],
  [62, 'ochre', 'mustard', 'butter'],
  [95, 'olive', 'lime', 'pistachio'],
  [160, 'forest', 'green', 'mint'],
  [190, 'deep teal', 'teal', 'seafoam'],
  [215, 'petrol', 'turquoise', 'sky'],
  [250, 'navy', 'royal blue', 'powder blue'],
  [280, 'midnight', 'violet', 'lavender'],
  [320, 'plum', 'purple', 'lilac'],
  [345, 'wine', 'magenta', 'pink'],
  [360, 'burgundy', 'red', 'blush'],
];

/** A plain colour name for a fabric colour ("navy", "mint", "bone"), for naming colourways. */
export function colourName(hex: string): string {
  const { h, l } = hexToHsl(hex);
  const c = chroma(hex);
  const warm = h >= 20 && h <= 60;
  if (l < 0.12) return 'black';
  if (l > 0.93 && c < 0.12) return 'white';
  if (c < 0.08) {
    if (l > 0.75) return warm && c > 0.02 ? 'bone' : 'silver';
    return l < 0.3 ? 'charcoal' : 'grey';
  }
  if (l > 0.7 && c < 0.22 && warm) return 'sand';
  const names = HUES.find(([to]) => h < to) ?? HUES[HUES.length - 1];
  const band = l < 0.33 ? 1 : l > 0.7 ? 3 : 2;
  return names[band];
}

/** A layer's inks in the artwork, and the garment part it is printed on. */
export interface Ink {
  /** Its main fill. */
  hex: string;
  /** The layer, to name it. */
  name: string;
  part: 'body' | 'sleeves' | 'pants';
  /** The rest of its fill: a gradient's far end, a pattern's second colour. */
  also?: string[];
  /** An outline bold enough to carry the shape on its own. */
  outline?: string;
}

/** Outlines from this width (mm) hold a shape's edge on fabric by themselves. */
const BOLD_OUTLINE_MM = 0.8;

/**
 * How well a layer reads on a fabric: its fill (by its faintest colour), or its outline when that
 * stands out more. An amber word with a navy outline reads on a pale shirt; without it, it fades.
 */
export function inkContrast(ink: Ink, fabric: string): number {
  const fill = Math.min(...[ink.hex, ...(ink.also ?? [])].map((c) => contrastRatio(c, fabric)));
  return ink.outline ? Math.max(fill, contrastRatio(ink.outline, fabric)) : fill;
}

/**
 * The inks of the design's visible artwork, a layer at a time, biggest first (so the main colour
 * leads), with the part each is printed on. Photos are left out: their colours aren't inks to
 * check one by one.
 */
export function designInks(doc: DesignDocument, limit = 24): Ink[] {
  const model = getGarment(doc.garment.modelId);
  const found: (Ink & { area: number })[] = [];
  const inksOf = (layer: { name: string; visible: boolean; content: LayerContent; transform: { widthMm: number; heightMm: number } }, part: Ink['part']) => {
    const c = layer.content;
    if (!layer.visible || c.kind === 'image') return;
    if (c.kind === 'lockup') {
      // A lockup's inks are its layers', at the size this placement prints them.
      const kx = layer.transform.widthMm / c.widthMm;
      const ky = layer.transform.heightMm / c.heightMm;
      for (const id of c.orderedLayerIds) {
        const inner = c.layers[id];
        if (inner) inksOf({ ...inner, name: `${layer.name}: ${inner.name}`, transform: { widthMm: inner.transform.widthMm * kx, heightMm: inner.transform.heightMm * ky } }, part);
      }
      return;
    }
    // Letter colours take the fill's place: the first is the layer's ink, the rest go with it.
    const letters = c.kind === 'text' && c.letterColors?.length ? [...new Set(c.letterColors.map((x) => x.toUpperCase()))] : null;
    const also = letters ? letters.slice(1) : c.fillStyle?.kind === 'gradient' ? [c.fillStyle.to] : c.fillStyle?.kind === 'pattern' ? [c.fillStyle.color2] : [];
    const ink: Ink & { area: number } = { hex: (letters?.[0] ?? c.fill).toUpperCase(), name: layer.name, part, area: layer.transform.widthMm * layer.transform.heightMm };
    if (also.length) ink.also = also.map((x) => x.toUpperCase());
    if (c.strokeColor && (c.strokeWidthMm ?? 0) >= BOLD_OUTLINE_MM) ink.outline = c.strokeColor.toUpperCase();
    found.push(ink);
  };
  const partOf = (p: string): Ink['part'] => (p === 'torso' ? 'body' : p === 'legLeft' || p === 'legRight' ? 'pants' : 'sleeves');
  for (const z of model.zoneOrder) {
    const zone = doc.zones[z];
    const part = partOf(artboardSpec(model, doc, z).part);
    for (const id of zone.orderedLayerIds) if (zone.layers[id]) inksOf(zone.layers[id] as ArtworkLayer, part);
  }
  for (const area of designAreas(doc)) for (const id of area.orderedLayerIds) if (area.layers[id]) inksOf(area.layers[id], 'body');
  for (const id of doc.projections.orderedLayerIds) if (doc.projections.layers[id]) inksOf(doc.projections.layers[id], 'body');
  return found
    .sort((a, b) => b.area - a.area)
    .slice(0, limit)
    .map((ink) => {
      const { hex, name, part, also, outline } = ink;
      return { hex, name, part, ...(also ? { also } : {}), ...(outline ? { outline } : {}) };
    });
}

export type HarmonyKind = 'photo' | 'tonal' | 'complementary' | 'analogous' | 'triadic' | 'split' | 'two-tone';

export const HARMONY_LABELS: Record<HarmonyKind, string> = {
  photo: 'Photo match',
  tonal: 'Tonal',
  complementary: 'Complementary',
  analogous: 'Analogous',
  triadic: 'Triadic',
  split: 'Split complementary',
  'two-tone': 'Two-tone',
};

export interface ColorwayIdea {
  kind: HarmonyKind;
  /** Its colours in words: "rust", "bone and royal blue". */
  colours: string;
  /** The harmony and its colours: "Complementary rust". */
  name: string;
  parts: Colorway['parts'];
  /** The ink that reads worst on the fabric under it, with its contrast ratio. Absent without inks. */
  weakest?: { ink: Ink; ratio: number };
}

/** How well artwork reads on fabric, by its weakest ink. */
export function readability(ratio: number): 'good' | 'fair' | 'poor' {
  return ratio >= 3 ? 'good' : ratio >= 1.8 ? 'fair' : 'poor';
}

/**
 * The colour harmonies turn around, and where it came from: a reference photo's main colour when
 * one was picked, else the garment's colour, else the artwork's main coloured ink, else the brand
 * kit's first colour, else a classic blue.
 */
export function harmonyAnchor(
  body: string,
  inks: string[],
  brand: string[] = [],
  reference: string[] = [],
): { hue: number; hex: string; from: 'reference' | 'garment' | 'artwork' | 'brand' | 'default' } {
  const photo = reference.find((c) => !isNeutral(c));
  if (photo) return { hue: hexToHsl(photo).h, hex: photo, from: 'reference' };
  if (!isNeutral(body)) return { hue: hexToHsl(body).h, hex: body, from: 'garment' };
  const ink = inks.find((c) => !isNeutral(c));
  if (ink) return { hue: hexToHsl(ink).h, hex: ink, from: 'artwork' };
  const own = brand.find((c) => !isNeutral(c));
  if (own) return { hue: hexToHsl(own).h, hex: own, from: 'brand' };
  return { hue: 220, hex: '#1F4FB8', from: 'default' };
}

export const anchorHue = (body: string, inks: string[], brand: string[] = [], reference: string[] = []) => harmonyAnchor(body, inks, brand, reference).hue;

function weakestInk(parts: Colorway['parts'], inks: Ink[]): ColorwayIdea['weakest'] {
  let worst: ColorwayIdea['weakest'];
  for (const ink of inks) {
    const under = ink.part === 'sleeves' ? parts.sleeves : ink.part === 'pants' ? (parts.pants ?? parts.body) : parts.body;
    const ratio = inkContrast(ink, under);
    if (!worst || ratio < worst.ratio) worst = { ink, ratio };
  }
  return worst;
}

/** The fabric band for a hue that lets the artwork read best, trying the preferred bands first. */
function pickBand(hue: number, inks: Ink[], preferred: Band[]): Band {
  if (!inks.length) return preferred[0];
  const scored = preferred.map((band) => {
    const body = fabric(hue, band);
    return { band, ratio: Math.min(...inks.map((i) => inkContrast(i, body))) };
  });
  return (scored.find((x) => readability(x.ratio) === 'good') ?? scored.reduce((a, b) => (b.ratio > a.ratio ? b : a))).band;
}

/** A trim colour that stands off a body of this band. */
const trimBand = (band: Band): Band => (band === 'mid' ? 'dark' : 'mid');

/** Two colours in words, once when both have the same name ("navy and sky", "teal"). */
const pair = (a: string, b: string) => (colourName(a) === colourName(b) ? colourName(a) : `${colourName(a)} and ${colourName(b)}`);

/**
 * Six colourway ideas around the base colourway: tonal, complementary, analogous, triadic,
 * split complementary and two-tone. With a reference photo's colours (biggest first), the photo's
 * own colourway leads and the harmonies turn around it. `variant` turns the wheel a little and
 * swaps fabric depths, for more ideas; the same input always gives the same ideas.
 */
export function suggestColorways(base: Colorway['parts'], inks: Ink[], options: { brand?: string[]; variant?: number; reference?: string[] } = {}): ColorwayIdea[] {
  const v = Math.abs(Math.round(options.variant ?? 0));
  const jitter = [0, 15, -15, 30, -30][v % 5];
  const dir = v % 2 ? -1 : 1;
  const photo = (options.reference ?? []).filter((c) => !isNeutral(c));
  const anchor = anchorHue(base.body, inks.map((i) => i.hex), options.brand, photo);
  const home = bandOf(base.body);
  const order: Band[] = ['dark', 'mid', 'light'];
  // The base colourway's depth first, then the others, turning with each variant.
  const rotate = (first: Band, by: number) => {
    const rest = order.filter((b) => b !== first);
    const list = [first, ...rest];
    return list.map((_, i) => list[(i + by) % list.length]);
  };
  const preferred = rotate(home, v % 3);

  const partsOf = (body: string, sleeves: string, collar: string): Colorway['parts'] => {
    const parts: Colorway['parts'] = { body, sleeves, collar, stitching: stitchFor(body) };
    if (base.pants !== undefined) parts.pants = base.pants === base.body ? body : base.pants;
    if (base.belt !== undefined) parts.belt = base.belt;
    return parts;
  };
  const idea = (kind: HarmonyKind, parts: Colorway['parts'], colours: string): ColorwayIdea => {
    const weakest = weakestInk(parts, inks);
    return { kind, colours, name: `${HARMONY_LABELS[kind]} ${colours}`, parts, ...(weakest ? { weakest } : {}) };
  };
  /** One hue for the body and sleeves, a trim hue (or a shade of the body) for the collar. */
  const solid = (kind: HarmonyKind, bodyHue: number, trimHue: number | null, bands: Band[] = preferred) => {
    const band = pickBand(bodyHue, inks, bands);
    const body = fabric(bodyHue, band);
    const collar = trimHue === null ? shade(body, band === 'light' ? -0.14 : 0.12) : fabric(trimHue, trimBand(band));
    return idea(kind, partsOf(body, body, collar), colourName(body));
  };

  const ideas: ColorwayIdea[] = [
    // The photo's own colours, made fabric: its main colour as the body, its second as the trim.
    ...(photo.length
      ? [
          (() => {
            const main = photo[(v % 2) % photo.length];
            const hue = hexToHsl(main).h;
            // A match keeps the photo's depth unless the artwork would fade on it.
            const own = bandOf(main);
            const keeps = !inks.length || readability(Math.min(...inks.map((i) => inkContrast(i, fabric(hue, own))))) !== 'poor';
            const band = keeps ? own : pickBand(hue, inks, [own, ...order.filter((b) => b !== own)]);
            const body = fabric(hue, band);
            const second = photo.find((c) => c !== main);
            const collar = second ? fabric(hexToHsl(second).h, trimBand(band)) : shade(body, band === 'light' ? -0.14 : 0.12);
            return idea('photo', partsOf(body, body, collar), pair(body, collar));
          })(),
        ]
      : []),
    // Tonal leads with a depth the garment isn't now, so it is new.
    solid('tonal', anchor + jitter / 3, null, rotate(home, 1 + (v % 2))),
    solid('complementary', anchor + 180 + jitter, anchor),
    (() => {
      const band = pickBand(anchor + 30 * dir + jitter, inks, preferred);
      const body = fabric(anchor + 30 * dir + jitter, band);
      const sleeves = fabric(anchor + 60 * dir + jitter, band);
      return idea('analogous', partsOf(body, sleeves, sleeves), pair(body, sleeves));
    })(),
    solid('triadic', anchor + 120 + jitter, anchor + 240 + jitter),
    solid('split', anchor + 150 + jitter, anchor + 210 + jitter),
    (() => {
      // A neutral body the artwork reads on, with coloured sleeves and collar.
      const neutrals = v % 2 ? ['#2B2D33', '#EDE8DD', '#A9AAAD'] : ['#EDE8DD', '#2B2D33', '#A9AAAD'];
      const reads = (fabricHex: string) => Math.min(...inks.filter((i) => i.part === 'body').map((i) => inkContrast(i, fabricHex)), 21);
      const body = inks.length ? neutrals.reduce((a, b) => (reads(b) > reads(a) ? b : a)) : neutrals[0];
      const accent = fabric(anchor + jitter, bandOf(body) === 'dark' ? 'mid' : bandOf(body) === 'light' ? 'mid' : 'dark');
      return idea('two-tone', partsOf(body, accent, accent), pair(body, accent));
    })(),
  ];
  // Never offer the colourway the garment already wears.
  return ideas.filter((i) => i.parts.body !== base.body || i.parts.sleeves !== base.sleeves || i.parts.collar !== base.collar);
}
