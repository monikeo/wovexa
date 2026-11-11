/**
 * Turning a picture into vector shapes: one filled path per ink colour, ready to recolour, edit
 * point by point and print at any size. The picture's colours are found the way screen-print
 * separations find inks (so the shapes match its films), the colour around the artwork can be
 * left out, specks are cleaned up, and every colour is traced round its pixels.
 *
 * Colours are stacked, largest first: each one also covers what the colours above it cover, so
 * no hairline gaps open between neighbouring colours when it prints. The core is pure over RGBA
 * pixels, so it is unit-tested; `traceImageLayer` renders a layer in the browser and returns layers.
 */
import { newId } from '@/domain/factory';
import { LIMITS } from '@/domain/limits';
import type { ArtworkLayer, LayerTransform, ShapeContent } from '@/domain/schema';
import { assignInks, colorDistance, findInks, type Ink } from '@/lib/export/separations';
import { ringArea, simplifyRing, traceContours, type Ring } from '@/lib/render/trace';

export type TraceDetail = 'low' | 'medium' | 'high';

export interface TraceOptions {
  /** Ink colours to trace, 1–8. One makes a single-colour silhouette. */
  colours: number;
  detail: TraceDetail;
  /**
   * The colour around the artwork (the colour most of its border is): kept as a colour, left out
   * where it surrounds the artwork (enclosed areas of it, like white details inside a badge, stay),
   * or left out everywhere (the middle of an O shows the garment too).
   */
  background: 'keep' | 'around' | 'everywhere';
}

export const TRACE_DEFAULTS: TraceOptions = { colours: 4, detail: 'medium', background: 'everywhere' };
export const MAX_TRACE_COLOURS = 8;

/** Longest side the picture is traced at, in pixels: finer and slower going up. */
export const TRACE_SIDE: Record<TraceDetail, number> = { low: 600, medium: 900, high: 1300 };

const SETTINGS: Record<TraceDetail, { tolerance: number; minArea: number; passes: number }> = {
  // How far (px) an outline may stray from the pixels, the smallest area (px²) kept, and how many speck-cleaning passes.
  low: { tolerance: 1.4, minArea: 36, passes: 2 },
  medium: { tolerance: 0.8, minArea: 12, passes: 1 },
  high: { tolerance: 0.45, minArea: 4, passes: 0 },
};

export interface TracedColour {
  hex: string;
  /** Outlines in pixels, unsimplified, filled even-odd: this colour and every colour above it. */
  rings: Ring[];
  /** Share of the artwork's ink this colour shows, 0–1. */
  share: number;
}

export interface TraceResult {
  /** Bottom first, as they stack. */
  colours: TracedColour[];
  /** The colour left out around the artwork, if any. */
  background: string | null;
  /** Many more shades than colours: a photo or a gradient, which traces into blotches. */
  tonal: boolean;
  /** Flat colours the picture has, apart from its background: more than asked for join their nearest. */
  found: number;
}

const NONE = 255;
const BACKGROUND = 254;

/** The colour around the artwork: what most of its opaque border is, when most of it is one colour. */
export function borderColour(data: Uint8ClampedArray, w: number, h: number): [number, number, number] | null {
  const border: number[][] = [];
  const visit = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] >= 200) border.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < w; x++) {
    visit(x, 0);
    if (h > 1) visit(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    visit(0, y);
    if (w > 1) visit(w - 1, y);
  }
  const perimeter = Math.max(1, 2 * (w + h) - 4);
  // A mostly see-through border has no colour to leave out: the image has none around it.
  if (border.length < perimeter * 0.5) return null;
  const bins = new Map<number, number>();
  let top = -1;
  for (const [r, g, b] of border) {
    const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const n = (bins.get(bin) ?? 0) + 1;
    bins.set(bin, n);
    if (top < 0 || n > bins.get(top)!) top = bin;
  }
  const near = border.filter(([r, g, b]) => ((r >> 4) << 8) + ((g >> 4) << 4) + (b >> 4) === top);
  const mean = [0, 1, 2].map((k) => near.reduce((s, p) => s + p[k], 0) / near.length) as [number, number, number];
  const alike = border.filter((p) => colorDistance(p, mean) < 60).length;
  return alike >= border.length * 0.6 ? mean : null;
}

/** Each pixel's label replaced by the most common label around it (3 × 3), keeping its own on a tie: specks and fringes go. */
function cleanSpecks(labels: Uint8Array, w: number, h: number, passes: number) {
  let src: Uint8Array = labels;
  let dst: Uint8Array = new Uint8Array(labels.length);
  const counts = new Uint16Array(256);
  const seen = new Uint8Array(9);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const own = src[y * w + x];
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
            const l = src[yy * w + xx];
            if (counts[l]++ === 0) seen[n++] = l;
          }
        }
        let best = own;
        for (let k = 0; k < n; k++) if (counts[seen[k]] > counts[best]) best = seen[k];
        dst[y * w + x] = best;
        for (let k = 0; k < n; k++) counts[seen[k]] = 0;
      }
    }
    [src, dst] = [dst, src];
  }
  if (src !== labels) labels.set(src);
}

/** Pixels labelled `label` that connect to the picture's edge (side by side, not corner to corner), relabelled `to`. */
function floodFromEdge(labels: Uint8Array, w: number, h: number, label: number, to: number) {
  const stack: number[] = [];
  const push = (p: number) => {
    if (labels[p] === label) {
      labels[p] = to;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < (h - 1) * w) push(p + w);
  }
}

/** How `c` sits against the line from `a` to `b` in colour: how far along it (0 at a, 1 at b) and how far off it. */
function mixOf(c: readonly number[], a: readonly number[], b: readonly number[]) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (!len2) return { t: 0, off: Infinity };
  const t = ((c[0] - a[0]) * d[0] + (c[1] - a[1]) * d[1] + (c[2] - a[2]) * d[2]) / len2;
  return { t, off: colorDistance(c, [a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]]) };
}

/**
 * The flat colours of a picture, most-used first. Candidates come from the separations' ink
 * finder. Soft edges (anti-aliasing, JPEG ringing) make in-between colours that are only ever
 * edges: a candidate that is a mix of two others and has hardly any inside (pixels whose
 * neighbours are all the same colour) is one of those, and so is a speck of a colour with no inside.
 * A real colour between two others (orange beside red and yellow) has an inside, and a thin line
 * is no mix of what surrounds it, so both stay.
 */
function flatColours(data: Uint8ClampedArray, w: number, h: number, opaque: number): Ink[] {
  const candidates = findInks(data, { maxInks: MAX_TRACE_COLOURS + 8, merge: 60, minShare: 0.0005 });
  if (candidates.length <= 1) return candidates;
  const labels = assignInks(data, candidates);
  const total = new Uint32Array(256);
  const core = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (data[p * 4 + 3] < 128) continue;
      const l = labels[p];
      total[l]++;
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1 && labels[p - 1] === l && labels[p + 1] === l && labels[p - w] === l && labels[p + w] === l) core[l]++;
    }
  }
  const edgeOnly = (k: number) => core[k] < total[k] * 0.25;
  const alive = candidates.map((_, k) => k).filter((k) => total[k] > 0 && !(edgeOnly(k) && total[k] < opaque * 0.002));
  for (;;) {
    // The clearest blend left, if any: the one closest to the line between two other colours.
    let blend = -1;
    let best = Infinity;
    for (const c of alive) {
      if (!edgeOnly(c)) continue;
      for (const a of alive)
        for (const b of alive) {
          if (a === c || b === c || b <= a) continue;
          const { t, off } = mixOf(candidates[c].rgb, candidates[a].rgb, candidates[b].rgb);
          // Generous about how far off the line: JPEG colour bleed pushes edge blends off it, and colours with an inside are safe anyway.
          if (t > 0.04 && t < 0.96 && off < 55 && off < best) {
            best = off;
            blend = c;
          }
        }
    }
    if (blend < 0 || alive.length <= 1) break;
    alive.splice(alive.indexOf(blend), 1);
  }
  return alive.sort((a, b) => total[b] - total[a]).map((k) => candidates[k]);
}

/** Share of the picture's pixels its colours don't describe well: high for photos and gradients. */
function misfit(data: Uint8ClampedArray, labels: Uint8Array, inks: Ink[]) {
  let opaque = 0;
  let far = 0;
  for (let p = 0; p < labels.length; p += 3) {
    const l = labels[p];
    if (l >= inks.length || data[p * 4 + 3] < 128) continue;
    opaque++;
    if (colorDistance(inks[l].rgb, [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]]) > 110) far++;
  }
  return opaque ? far / opaque : 0;
}

/**
 * The picture's ink colours traced into outlines (in pixels, unsimplified: see `simplifyOutlines`).
 * Transparent pixels are never ink. Colours too small to keep are folded into their nearest.
 */
export function traceColours(data: Uint8ClampedArray, w: number, h: number, opts: TraceOptions): TraceResult {
  const settings = SETTINGS[opts.detail];
  const wanted = Math.max(1, Math.min(MAX_TRACE_COLOURS, Math.round(opts.colours)));
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 128) opaque++;
  if (!opaque) return { colours: [], background: null, tonal: false, found: 0 };
  const flat = flatColours(data, w, h, opaque);
  const around = opts.background !== 'keep' ? borderColour(data, w, h) : null;
  // The background takes a place among the inks while sorting pixels, then is left out.
  let bg: Ink | undefined;
  if (around) {
    bg = flat.filter((ink) => colorDistance(ink.rgb, around) < 60).sort((a, b) => colorDistance(a.rgb, around) - colorDistance(b.rgb, around))[0];
    bg ??= { hex: toHex(around), rgb: around.map(Math.round) as [number, number, number], share: 0 };
  }
  const found = flat.filter((ink) => ink !== bg);
  const inks = [...found.slice(0, wanted), ...(bg ? [bg] : [])];
  const bgIndex = bg ? inks.length - 1 : -1;
  const background = bg?.hex ?? null;
  // Shades that none of the picture's own colours describe, all over it: a photo or a gradient.
  const tonal = misfit(data, assignInks(data, flat), flat) > 0.12;
  const labels = assignInks(data, inks);
  for (let p = 0; p < labels.length; p++) if (data[p * 4 + 3] < 128) labels[p] = NONE;
  if (settings.passes) cleanSpecks(labels, w, h, settings.passes);
  if (bgIndex >= 0) {
    // Around the artwork only, enclosed areas of the colour stay as a colour of their own.
    if (opts.background === 'around') floodFromEdge(labels, w, h, bgIndex, BACKGROUND);
    else for (let p = 0; p < labels.length; p++) if (labels[p] === bgIndex) labels[p] = BACKGROUND;
  }

  // Ink colours, largest first: the bottom of the stack.
  const counts = new Uint32Array(256);
  for (let p = 0; p < labels.length; p++) counts[labels[p]]++;
  const ink = inks.map((_, k) => k).filter((k) => counts[k] >= settings.minArea);
  ink.sort((a, b) => counts[b] - counts[a]);
  const total = ink.reduce((s, k) => s + counts[k], 0);
  if (!total) return { colours: [], background, tonal, found: found.length };

  const above = new Uint8Array(256);
  const field = new Float32Array(w * h);
  const colours: TracedColour[] = [];
  for (let i = 0; i < ink.length; i++) {
    // This colour and everything stacked above it.
    above.fill(0);
    for (let j = i; j < ink.length; j++) above[ink[j]] = 1;
    for (let p = 0; p < field.length; p++) field[p] = above[labels[p]] ? 1 : -1;
    const rings = traceContours(field, w, h).filter((r) => r.length >= 3 && ringArea(r) >= settings.minArea);
    if (rings.length) colours.push({ hex: inks[ink[i]].hex, rings, share: counts[ink[i]] / total });
  }
  return { colours, background, tonal, found: found.length };
}

function toHex(rgb: readonly number[]) {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Outlines with the points a print would never show left out, and specks below the detail's smallest area dropped. */
export function simplifyOutlines(rings: Ring[], detail: TraceDetail, looser = 1): Ring[] {
  const { tolerance, minArea } = SETTINGS[detail];
  return rings.map((r) => simplifyRing(r, tolerance * looser)).filter((r) => r.length >= 3 && ringArea(r) >= minArea * looser);
}

/** Outlines as a path in their own 0–100 box (even-odd, so holes stay holes), with the box in pixels. */
export function outlinesToPath(rings: Ring[]): { path: string; box: { x: number; y: number; w: number; h: number } } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  const w = x1 - x0;
  const h = y1 - y0;
  if (!(w > 0.5) || !(h > 0.5)) return null;
  const n = (v: number) => String(Math.round(v * 100) / 100);
  const path = rings.map((r) => `M${r.map(([x, y]) => `${n(((x - x0) / w) * 100)} ${n(((y - y0) / h) * 100)}`).join('L')}Z`).join('');
  return { path, box: { x: x0, y: y0, w, h } };
}

/**
 * A colour's outlines as a path no longer than `maxChars`: simplified for the detail, then more
 * loosely, then without its smallest pieces. Null when nothing is left.
 */
export function fittedPath(rings: Ring[], detail: TraceDetail, maxChars: number): { path: string; box: { x: number; y: number; w: number; h: number }; loosened: boolean } | null {
  let looser = 1;
  for (let attempt = 0; attempt < 5; attempt++, looser *= 1.8) {
    const out = outlinesToPath(simplifyOutlines(rings, detail, looser));
    if (!out) return null;
    if (out.path.length <= maxChars) return { ...out, loosened: attempt > 0 };
  }
  // Still too detailed: keep the largest pieces that fit.
  const pieces = simplifyOutlines(rings, detail, looser).sort((a, b) => ringArea(b) - ringArea(a));
  let kept = pieces;
  while (kept.length > 1) {
    kept = kept.slice(0, Math.max(1, Math.floor(kept.length * 0.7)));
    const out = outlinesToPath(kept);
    if (out && out.path.length <= maxChars) return { ...out, loosened: true };
  }
  const out = outlinesToPath(kept);
  return out && out.path.length <= maxChars ? { ...out, loosened: true } : null;
}

// ---- In the browser: a layer in, shape layers out ----

export class TraceError extends Error {}

export interface TracedImage {
  /** Shape layers bottom first, grouped, placed exactly over the image. */
  layers: ArtworkLayer[];
  /** What the trace looks like, in pixels of a `width` × `height` picture: for a preview. */
  preview: { width: number; height: number; shapes: { hex: string; d: string }[] };
  background: string | null;
  tonal: boolean;
  found: number;
  /** Some outlines were simplified further, or small pieces left out, to stay within the size a shape can have. */
  loosened: boolean;
}

/** A point in a layer's own frame (mm from its centre) as an offset on the artboard, turned and mirrored as the layer is. */
function turned(t: Pick<LayerTransform, 'rotationDeg' | 'flipX' | 'flipY'>, x: number, y: number): [number, number] {
  const a = (t.rotationDeg * Math.PI) / 180;
  const fx = t.flipX ? -x : x;
  const fy = t.flipY ? -y : y;
  return [fx * Math.cos(a) - fy * Math.sin(a), fx * Math.sin(a) + fy * Math.cos(a)];
}

/**
 * An image layer traced into one shape layer per colour, from the image as it shows (its crop,
 * frame shape and adjustments included), each placed, turned and mirrored exactly over it.
 * `side` is the longest side traced, in pixels: smaller for a quick preview. Browser only.
 */
export async function traceImageLayer(layer: ArtworkLayer, opts: TraceOptions, side = TRACE_SIDE[opts.detail]): Promise<TracedImage> {
  if (layer.content.kind !== 'image') throw new TraceError('Only images can be traced.');
  const [{ renderRawLayer }, { loadAssetImage }] = await Promise.all([import('@/lib/render/zone-renderer'), import('@/lib/assets')]);
  const t = layer.transform;
  const ppm = side / Math.max(t.widthMm, t.heightMm, 1);
  // No margin: the picture's own border tells its background colour (outside counts as outside anyway).
  const pad = 0;
  let canvas = renderRawLayer(layer, ppm, pad);
  if (!canvas) {
    await loadAssetImage(layer.content.assetId);
    canvas = renderRawLayer(layer, ppm, pad);
  }
  if (!canvas) throw new TraceError('The image is still loading. Try again in a moment.');
  const W = canvas.width;
  const H = canvas.height;
  const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  canvas.width = canvas.height = 0;
  const traced = traceColours(data, W, H, opts);

  const cx = pad + (t.widthMm * ppm) / 2;
  const cy = pad + (t.heightMm * ppm) / 2;
  const groupId = `g-${newId()}`;
  const base = layer.name.replace(/\.[a-z0-9]{2,4}$/i, '').slice(0, 40) || 'Image';
  const layers: ArtworkLayer[] = [];
  const shapes: TracedImage['preview']['shapes'] = [];
  let loosened = false;
  traced.colours.forEach((colour) => {
    const fit = fittedPath(colour.rings, opts.detail, LIMITS.pathChars);
    if (!fit) return;
    loosened ||= fit.loosened;
    const { box } = fit;
    shapes.push({ hex: colour.hex, d: fit.path.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x: string, y: string) => `${Math.round((box.x + (Number(x) / 100) * box.w) * 10) / 10} ${Math.round((box.y + (Number(y) / 100) * box.h) * 10) / 10}`) });
    const [ox, oy] = turned(t, (box.x + box.w / 2 - cx) / ppm, (box.y + box.h / 2 - cy) / ppm);
    const content: ShapeContent = { kind: 'shape', shape: 'path', fill: colour.hex, cornerRadiusMm: 0, path: fit.path };
    layers.push({
      id: newId(),
      name: `${base} colour ${layers.length + 1}`,
      visible: true,
      locked: false,
      groupId,
      transform: { centerXmm: t.centerXmm + ox, centerYmm: t.centerYmm + oy, widthMm: box.w / ppm, heightMm: box.h / ppm, rotationDeg: t.rotationDeg, flipX: t.flipX, flipY: t.flipY },
      style: { opacity: layer.style.opacity, blendMode: layer.style.blendMode, finish: layer.style.finish },
      content,
    });
  });
  // A single shape needs no group.
  if (layers.length === 1) delete layers[0].groupId;
  return { layers, preview: { width: W, height: H, shapes }, background: traced.background, tonal: traced.tonal, found: traced.found, loosened };
}
