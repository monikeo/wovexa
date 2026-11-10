/**
 * Canonical Canvas 2D renderer. The single implementation that turns layers into pixels,
 * used by the 2D editor (per-layer bitmaps), the 3D garment textures and print exports, so
 * all three always agree (spec §27, EXP-04).
 *
 * Artwork effects are part of the print: outlines (and outline-only lines), shadows and glows,
 * sticker outlines, halftone screens, gradient and pattern fills, image adjustments and repeats,
 * and distress. Finish simulation (puff relief, embroidery thread, metallic sheen) is
 * preview-only (spec TYP-06): callers opt in with `simulateFinish`, and print files never do.
 */
import type {
  ArtworkLayer,
  FillStyle,
  ImageAdjust,
  ImageContent,
  ImageRepeat,
  LayerHalftone,
  LayerShadow,
  LayerStack,
  LayerStyle,
  LayerTransform,
  LockupContent,
  PrintMethod,
  ShapeContent,
  Surface,
  TextContent,
  TextPath,
} from '@/domain/schema';
import { clipRuns } from '@/domain/clipping';
import { rotatedBounds } from '@/domain/geometry';
import { graphemes, letterInks } from '@/domain/letter-colors';
import { deepLayers } from '@/domain/lockups';
import { flattenSubpath, parsePath } from '@/domain/path-edit';
import { getLoadedImage } from '@/lib/assets';
import { ensureCustomFonts } from '@/lib/font-library';
import { loadFontStylesheets, scriptFallbacks } from '@/lib/fonts';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Text is laid out at this font size, then scaled to fill its box (vector exports use the same layout). */
export const TEXT_REF_PX = 200;

export function fontString(c: Pick<TextContent, 'italic' | 'fontWeight' | 'fontFamily'>, px: number) {
  return `${c.italic ? 'italic ' : ''}${c.fontWeight} ${px}px "${c.fontFamily}", "Noto Sans Khmer", "Noto Sans KR", "Noto Sans SC", sans-serif`;
}

function makeCanvas(w: number, h: number) {
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  // In a print worker there is no document: an OffscreenCanvas draws exactly the same.
  if (typeof document === 'undefined') return new OffscreenCanvas(W, H) as unknown as HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

/** Least-recently-used canvas cache bounded by total pixels, so print-size renders never pile up. */
class CanvasCache {
  private map = new Map<string, HTMLCanvasElement>();
  private pixels = 0;
  constructor(
    private budget: number,
    private maxEntry: number,
  ) {}
  get(key: string) {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }
  set(key: string, canvas: HTMLCanvasElement) {
    const px = canvas.width * canvas.height;
    if (px > this.maxEntry) return;
    const old = this.map.get(key);
    if (old) {
      this.pixels -= old.width * old.height;
      this.map.delete(key);
    }
    this.map.set(key, canvas);
    this.pixels += px;
    while (this.pixels > this.budget && this.map.size > 1) {
      const [k, v] = this.map.entries().next().value!;
      this.map.delete(k);
      this.pixels -= v.width * v.height;
    }
  }
  clear() {
    this.map.clear();
    this.pixels = 0;
  }
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer() {
  measureCtx ??= makeCanvas(1, 1).getContext('2d');
  return measureCtx!;
}

function setLetterSpacing(ctx: Ctx, px: number) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D).letterSpacing = `${px}px`;
}

/** Split into user-perceived characters so combining marks (Khmer, accents) stay on their base letter. */
export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Text layout
// ---------------------------------------------------------------------------

interface Glyph {
  g: string;
  x: number;
  y: number;
  rot: number;
}

/** Text laid out at the reference size. The renderer scales it to fill the layer box. */
export interface TextLayout {
  width: number;
  height: number;
  /** Centre of the ink box relative to the layout origin. */
  cx: number;
  cy: number;
  lines: string[];
  glyphs?: Glyph[];
  /** Text on a path: layout units per path unit (the path's own 0–100 box, its width times its aspect). */
  pathScale?: number;
}

/** Single-line text with a path to follow. A path takes precedence over a curve or a wave. */
export function isOnPath(c: Pick<TextContent, 'value' | 'onPath'>) {
  return !!c.onPath && !c.value.includes('\n') && c.value.length > 0;
}

export function isCurved(c: Pick<TextContent, 'curveDeg' | 'value' | 'onPath'>) {
  return !isOnPath(c) && Math.abs(c.curveDeg) >= 0.5 && !c.value.includes('\n') && c.value.length > 0;
}

/** Wave warp applies to straight single-line text; a curve takes precedence. */
export function isWaved(c: Pick<TextContent, 'curveDeg' | 'value' | 'wave' | 'onPath'>) {
  return !isOnPath(c) && !isCurved(c) && Math.abs(c.wave ?? 0) >= 0.5 && !c.value.includes('\n') && c.value.length > 0;
}

/** True when the text follows a path (a drawn one, an arc or a wave) rather than straight lines. */
export function isWarped(c: Pick<TextContent, 'curveDeg' | 'value' | 'wave' | 'onPath'>) {
  return isOnPath(c) || isCurved(c) || isWaved(c);
}

/** A path for text to follow: a polyline in path units with the distance along it to each point. */
interface Track {
  pts: [number, number][];
  dist: number[];
  length: number;
  closed: boolean;
}

const trackCache = new Map<string, Track | null>();

/** The path's first line as a track, in path units: x across the box times its aspect, y down it. */
export function pathTrack(onPath: Pick<TextPath, 'd' | 'aspect'>): Track | null {
  const key = `${onPath.aspect}|${onPath.d}`;
  if (trackCache.has(key)) return trackCache.get(key)!;
  const sub = parsePath(onPath.d)[0];
  let track: Track | null = null;
  if (sub && sub.nodes.length >= 2) {
    const pts = flattenSubpath(sub, 0.05).map(([x, y]) => [x * onPath.aspect, y] as [number, number]);
    if (sub.closed) pts.push(pts[0]);
    const dist = [0];
    for (let i = 1; i < pts.length; i++) dist.push(dist[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const length = dist[dist.length - 1];
    if (length > 1e-6) track = { pts, dist, length, closed: sub.closed };
  }
  if (trackCache.size > 100) trackCache.delete(trackCache.keys().next().value!);
  trackCache.set(key, track);
  return track;
}

/** The point and direction `along` path units into a track: round again on a closed path, straight on past an open one's ends. */
export function trackAt(track: Track, along: number): { x: number; y: number; angle: number } {
  let s = along;
  if (track.closed) s = ((s % track.length) + track.length) % track.length;
  const { pts, dist } = track;
  let i = 1;
  if (s >= track.length) i = pts.length - 1;
  else if (s > 0) {
    let lo = 1;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dist[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    i = lo;
  }
  const [x0, y0] = pts[i - 1];
  const [x1, y1] = pts[i];
  const seg = dist[i] - dist[i - 1] || 1e-9;
  const t = (s - dist[i - 1]) / seg;
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, angle: Math.atan2(y1 - y0, x1 - x0) };
}

const layoutCache = new Map<string, TextLayout>();

export function layoutText(c: TextContent): TextLayout {
  const onPath = isOnPath(c) ? c.onPath : undefined;
  const track = onPath ? pathTrack(onPath) : null;
  const curved = isCurved(c);
  const waved = isWaved(c);
  const key = JSON.stringify([c.value, c.fontFamily, c.fontWeight, c.italic, c.letterSpacingEm, c.lineHeight, curved ? c.curveDeg : 0, waved ? c.wave : 0, track ? onPath : null]);
  const cached = layoutCache.get(key);
  if (cached) return cached;
  const ctx = measurer();
  ctx.save();
  ctx.font = fontString(c, TEXT_REF_PX);
  const lineH = TEXT_REF_PX * c.lineHeight;
  let layout: TextLayout;

  if (onPath && track) {
    // Along a path: the letters cover `span` of it from `start`, each turned to the line under it
    // and lifted to sit on it (baseline on the line), straddle it, or hang below it (tops on it).
    setLetterSpacing(ctx, 0);
    const spacing = c.letterSpacingEm * TEXT_REF_PX;
    const gs = graphemes(c.value);
    const widths = gs.map((g) => Math.max(1, ctx.measureText(g).width));
    const length = widths.reduce((a, b) => a + b, 0) + spacing * (gs.length - 1);
    const scale = length / Math.max(1e-6, onPath.span * track.length);
    const lift = onPath.side === 'above' ? 0.32 * TEXT_REF_PX : onPath.side === 'below' ? -0.38 * TEXT_REF_PX : 0;
    let s = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const glyphs = gs.map((g, i) => {
      const mid = s + widths[i] / 2;
      s += widths[i] + spacing;
      const p = trackAt(track, onPath.start * track.length + mid / scale);
      const cos = Math.cos(p.angle);
      const sin = Math.sin(p.angle);
      // Lifted along the line's normal, to the left of travel: up, for text running left to right.
      const x = p.x * scale + sin * lift;
      const y = p.y * scale - cos * lift;
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px = (dx * widths[i]) / 2;
        const py = (dy * lineH) / 2;
        const X = x + px * cos - py * sin;
        const Y = y + px * sin + py * cos;
        minX = Math.min(minX, X);
        maxX = Math.max(maxX, X);
        minY = Math.min(minY, Y);
        maxY = Math.max(maxY, Y);
      }
      return { g, x, y, rot: p.angle };
    });
    layout = { width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, lines: [c.value], glyphs, pathScale: scale };
  } else if (curved || waved) {
    setLetterSpacing(ctx, 0);
    const spacing = c.letterSpacingEm * TEXT_REF_PX;
    const gs = graphemes(c.value);
    const widths = gs.map((g) => Math.max(1, ctx.measureText(g).width));
    const length = widths.reduce((a, b) => a + b, 0) + spacing * (gs.length - 1);
    const theta = (c.curveDeg * Math.PI) / 180;
    const radius = length / Math.max(Math.abs(theta), 1e-6);
    const up = theta > 0;
    const amp = ((c.wave ?? 0) / 100) * TEXT_REF_PX * 0.6;
    const k = (Math.PI * 2) / Math.max(length, 1);
    let s = -length / 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const glyphs = gs.map((g, i) => {
      const mid = s + widths[i] / 2;
      s += widths[i] + spacing;
      let x: number;
      let y: number;
      let rot: number;
      if (curved) {
        const phi = mid / radius;
        x = radius * Math.sin(phi);
        y = (up ? 1 : -1) * radius * (1 - Math.cos(phi));
        rot = up ? phi : -phi;
      } else {
        // One full wave across the text: the first half rises, the second dips.
        const phase = (mid + length / 2) * k;
        x = mid;
        y = -amp * Math.sin(phase);
        rot = Math.atan(-amp * k * Math.cos(phase));
      }
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px = (dx * widths[i]) / 2;
        const py = (dy * lineH) / 2;
        const X = x + px * cos - py * sin;
        const Y = y + px * sin + py * cos;
        minX = Math.min(minX, X);
        maxX = Math.max(maxX, X);
        minY = Math.min(minY, Y);
        maxY = Math.max(maxY, Y);
      }
      return { g, x, y, rot };
    });
    layout = { width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, lines: [c.value], glyphs };
  } else {
    setLetterSpacing(ctx, c.letterSpacingEm * TEXT_REF_PX);
    const lines = (c.value || ' ').split('\n');
    const widths = lines.map((line) => Math.max(1, ctx.measureText(line || ' ').width));
    layout = { width: Math.max(...widths), height: lines.length * lineH, cx: 0, cy: 0, lines };
  }
  ctx.restore();
  if (layoutCache.size > 300) layoutCache.delete(layoutCache.keys().next().value!);
  layoutCache.set(key, layout);
  return layout;
}

let textEpoch = 0;
/** Changes whenever text may render differently (a web font loaded): part of any cached artwork's key. */
export function textRenderEpoch() {
  return textEpoch;
}

/** Forget measured layouts and cached renders, e.g. after a web font loads and metrics change. */
export function clearTextLayoutCache() {
  layoutCache.clear();
  fxCache.clear();
  textEpoch++;
}

/** Box aspect (width / height) that shows the text undistorted, straight or warped. */
export function textAspect(c: TextContent) {
  const m = layoutText(c);
  return m.width / m.height;
}

// ---------------------------------------------------------------------------
// Fills: flat colour, gradient or pattern
// ---------------------------------------------------------------------------

const tileCache = new Map<string, HTMLCanvasElement>();

/** One repeat of a pattern fill, `size` px square (vector exports place it as an SVG pattern tile). */
export function patternTile(style: Extract<FillStyle, { kind: 'pattern' }>, color: string, size: number) {
  const key = [style.pattern, color, style.color2, size].join('|');
  const hit = tileCache.get(key);
  if (hit) return hit;
  const tile = makeCanvas(size, size);
  const t = tile.getContext('2d')!;
  const s = size;
  t.fillStyle = style.color2;
  t.fillRect(0, 0, s, s);
  t.fillStyle = color;
  t.strokeStyle = color;
  switch (style.pattern) {
    case 'stripes':
      t.fillRect(0, 0, s / 2, s);
      break;
    case 'checks':
      t.fillRect(0, 0, s / 2, s / 2);
      t.fillRect(s / 2, s / 2, s / 2, s / 2);
      break;
    case 'dots':
      for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]]) {
        t.beginPath();
        t.arc(x * s, y * s, s * 0.17, 0, Math.PI * 2);
        t.fill();
      }
      break;
    case 'grid': {
      const lw = Math.max(1, s * 0.12);
      t.fillRect(0, 0, lw, s);
      t.fillRect(0, 0, s, lw);
      break;
    }
    case 'zigzag':
      t.lineWidth = Math.max(1, s * 0.16);
      t.beginPath();
      t.moveTo(-s / 2, s * 0.3);
      t.lineTo(0, s * 0.7);
      t.lineTo(s / 2, s * 0.3);
      t.lineTo(s, s * 0.7);
      t.lineTo(s * 1.5, s * 0.3);
      t.stroke();
      break;
    case 'waves':
      t.lineWidth = Math.max(1, s * 0.14);
      for (const base of [0.25, 0.75]) {
        t.beginPath();
        for (let k = 0; k <= 32; k++) {
          const x = (k / 32) * s;
          const y = (base + 0.12 * Math.sin((k / 32) * Math.PI * 2)) * s;
          if (k) t.lineTo(x, y);
          else t.moveTo(x, y);
        }
        t.stroke();
      }
      break;
    case 'diamonds':
      t.beginPath();
      t.moveTo(s / 2, 0);
      t.lineTo(s, s / 2);
      t.lineTo(s / 2, s);
      t.lineTo(0, s / 2);
      t.closePath();
      t.fill();
      break;
    case 'camo': {
      // Seamless three-tone camouflage: periodic noise thresholded into the two colours and their mix.
      const img = t.getImageData(0, 0, s, s);
      const a = hexRgb(color);
      const b = hexRgb(style.color2);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const n = 0.62 * periodicNoise((x / s) * 4, (y / s) * 4, 4, 11) + 0.38 * periodicNoise((x / s) * 8, (y / s) * 8, 8, 23);
          const c = n < 0.42 ? b : n < 0.58 ? mid : a;
          const o = (y * s + x) * 4;
          img.data[o] = c[0];
          img.data[o + 1] = c[1];
          img.data[o + 2] = c[2];
          img.data[o + 3] = 255;
        }
      }
      t.putImageData(img, 0, 0);
      break;
    }
  }
  if (tileCache.size > 64) tileCache.delete(tileCache.keys().next().value!);
  tileCache.set(key, tile);
  return tile;
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Value noise whose lattice wraps every `period` cells, so tiles repeat without seams. */
function periodicNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = (n: number) => ((n % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed);
  const b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---------------------------------------------------------------------------
// Fabric dye effects
// ---------------------------------------------------------------------------

type EffectSurface = Extract<Surface, { kind: 'effect' }>;

/** Value noise wrapping every `px` cells across and `py` cells down. */
function periodicNoise2(x: number, y: number, px: number, py: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const wx = (n: number) => ((n % px) + px) % px;
  const wy = (n: number) => ((n % py) + py) % py;
  const a = hash2(wx(xi), wy(yi), seed);
  const b = hash2(wx(xi + 1), wy(yi), seed);
  const c = hash2(wx(xi), wy(yi + 1), seed);
  const d = hash2(wx(xi + 1), wy(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Fractal noise, 0–1, with features `scaleMm` across. With a circumference, it wraps exactly
 * around the body, so the side seam where the texture meets itself shows no join.
 */
function fabricNoise(xMm: number, yMm: number, scaleMm: number, seed: number, octaves: number, wrapMm = 0) {
  const cells = wrapMm ? Math.max(1, Math.round(wrapMm / scaleMm)) : 1 << 20;
  const sx = wrapMm ? wrapMm / cells : scaleMm;
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0, f = 1; o < octaves; o++, f *= 2) {
    sum += amp * periodicNoise2((xMm / sx) * f, (yMm / scaleMm) * f, cells * f, 1 << 20, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

const effectCache = new Map<string, HTMLCanvasElement>();
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mixRgb = (a: readonly number[], b: readonly number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Heather (melange): fine vertical fibre streaks and flecks, as a seamless 40 mm tile. */
function heatherTile(s: EffectSurface, base: string, res: number) {
  const tileMm = 40;
  const n = Math.max(8, Math.round(tileMm * res));
  const key = JSON.stringify(['heather', s.color2, s.intensity, s.seed, base, n]);
  const hit = effectCache.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(n, n);
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(n, n);
  const A = hexRgb(base);
  const B = hexRgb(s.color2);
  const cx = 48;
  const cy = 6;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cx;
      const fy = (y / n) * cy;
      const streak = 0.65 * periodicNoise2(fx, fy, cx, cy, s.seed) + 0.35 * periodicNoise2(fx * 2, fy * 2, cx * 2, cy * 2, s.seed + 7);
      const fleck = hash2(x, y, s.seed + 31) > 0.94 ? 0.55 : 0;
      const t = Math.min(1, (smooth(0.48, 0.72, streak) * 0.75 + fleck) * s.intensity);
      const c = mixRgb(A, B, t);
      const o = (y * n + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (effectCache.size > 12) effectCache.delete(effectCache.keys().next().value!);
  effectCache.set(key, canvas);
  return canvas;
}

/**
 * A dye effect over a w × h px area, generated at a soft working resolution and cached.
 * `anchor` is the front centre at the top of the garment. With `wrapPx` (a torso wrapped around
 * the body) the back mirrors the front, as when a garment is folded flat and dyed, so spirals sit
 * on both chest and back and meet cleanly at the side seams.
 */
function effectCanvas(s: EffectSurface, base: string, w: number, h: number, pxPerMm: number, anchor: { x: number; y: number }, wrapPx?: number) {
  // Soft effects build at about 2 mm a pixel; crumple and spiral keep their fine resist lines.
  const res = Math.min(pxPerMm, s.effect === 'marble' || s.effect === 'acid-wash' || s.effect === 'dip-dye' ? 0.5 : 0.85);
  const k = res / pxPerMm;
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const ax = anchor.x * k;
  const ay = anchor.y * k;
  const P = wrapPx ? wrapPx * k : 0;
  const key = JSON.stringify([s, base, cw, ch, res.toFixed(4), Math.round(ax), Math.round(ay), Math.round(P)]);
  const hit = effectCache.get(key);
  if (hit) {
    effectCache.delete(key);
    effectCache.set(key, hit);
    return hit;
  }
  const canvas = makeCanvas(cw, ch);
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(cw, ch);
  const A = hexRgb(base);
  const B = hexRgb(s.color2);
  const C = s.color3 ? hexRgb(s.color3) : mixRgb(B, [255, 255, 255], 0.45);
  const mm = 1 / res;
  const wrapMm = P * mm;
  const I = s.intensity;
  const S = s.scaleMm;
  const bands = s.color3 ? [B, C, mixRgb(B, C, 0.5)] : [B, C];
  for (let py = 0; py < ch; py++) {
    const y = (py - ay) * mm;
    for (let px = 0; px < cw; px++) {
      let dx = px - ax;
      let fold = dx;
      if (P) {
        dx = ((((dx + P / 2) % P) + P) % P) - P / 2;
        fold = dx > P / 4 ? P / 2 - dx : dx < -P / 4 ? -P / 2 - dx : dx;
      }
      const x = dx * mm;
      const fx = fold * mm;
      let c: number[];
      switch (s.effect) {
        case 'spiral': {
          // Folded and twisted from the chest: coloured arms with undyed resist lines between them.
          const ry = y - 260;
          const r = Math.hypot(fx, ry);
          const n = fabricNoise(fx, y, 70, s.seed, 3);
          const phase = Math.atan2(ry, fx) / (Math.PI * 2) + r / S + 0.4 * (n - 0.5);
          const t = (((phase % 1) + 1) % 1) * bands.length;
          const idx = Math.floor(t);
          const f = t - idx;
          let col = mixRgb(bands[idx], bands[(idx + 1) % bands.length], smooth(0.72, 1, f));
          col = mixRgb(col, A, (1 - smooth(0, 0.09 + 0.08 * n, f)) * 0.85);
          c = mixRgb(A, col, I * (0.55 + 0.45 * smooth(0, 60, r)));
          break;
        }
        case 'crumple': {
          // Scrunched and dyed: blotches of each colour with fine undyed crinkle veins.
          const n1 = fabricNoise(x, y, S, s.seed, 4, wrapMm);
          const n2 = fabricNoise(x, y, S * 0.32, s.seed + 9, 3, wrapMm);
          let col = mixRgb(B, C, smooth(0.4, 0.52, n1));
          col = mixRgb(col, A, smooth(0.56, 0.66, n1) * 0.9);
          col = mixRgb(col, A, (1 - smooth(0, 0.035, Math.abs(n2 - 0.5))) * 0.8);
          c = mixRgb(A, col, I);
          break;
        }
        case 'acid-wash': {
          // Bleached marbling: ridged veins lighten toward the wash colour, with a fine speckle.
          const n = fabricNoise(x, y, S, s.seed, 4, wrapMm);
          const ridge = 1 - Math.abs(2 * n - 1);
          const bleach = smooth(0.55, 0.95, ridge) * 0.85 + smooth(0.35, 0.6, fabricNoise(x, y, S * 2.5, s.seed + 3, 2, wrapMm)) * 0.15;
          const speck = (hash2(px, py, s.seed) - 0.5) * 0.08;
          c = mixRgb(A, B, Math.min(1, Math.max(0, bleach * I + speck)));
          break;
        }
        case 'dip-dye': {
          // Dipped from the hem: the dye line wanders a little, with a soft wicking edge.
          const fromHem = (ch - py) * mm;
          const edge = S * (1 + 0.16 * (fabricNoise(x, 0, 90, s.seed, 3, wrapMm) - 0.5) * 2);
          const above = smooth(edge - 0.2 * S, edge + 0.03 * S, fromHem);
          const lower = s.color3 ? mixRgb(B, C, smooth(0.25 * S, 0.65 * S, fromHem)) : B;
          c = mixRgb(mixRgb(A, lower, I), A, above);
          break;
        }
        default: {
          // Marble: domain-warped veins swirling through two tones. Every term is periodic around
          // the body, so the veins run on unbroken where the torso texture meets itself.
          const wx = x + 0.35 * S * (fabricNoise(x, y, S, s.seed, 3, wrapMm) - 0.5) * 2;
          const wy = y + 0.35 * S * (fabricNoise(x, y, S, s.seed + 5, 3, wrapMm) - 0.5) * 2;
          const v = 0.5 + 0.5 * Math.sin(wy / (S * 0.18) + 7 * fabricNoise(wx, wy, S * 0.8, s.seed + 11, 3, wrapMm));
          let col = mixRgb(A, B, smooth(0.25, 0.75, v) * 0.7);
          col = mixRgb(col, C, (1 - smooth(0, 0.07, Math.abs(v - 0.5))) * 0.85);
          c = mixRgb(A, col, I);
        }
      }
      const o = (py * cw + px) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (effectCache.size > 12) effectCache.delete(effectCache.keys().next().value!);
  effectCache.set(key, canvas);
  return canvas;
}

/**
 * Fill a garment part's texture area with its colour and any all-over print, at physical scale.
 * `anchor` (px) is where the print is centred, e.g. the front centre line, so patterns sit
 * symmetrically. `wrapPx` is the width of a texture that wraps around the body (the torso), so
 * dye effects join seamlessly. Returns false while an image print is still loading.
 */
export function paintFabric(ctx: Ctx, color: string, surface: Surface | undefined, w: number, h: number, pxPerMm: number, anchor: { x: number; y: number }, wrapPx?: number): boolean {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  let ok = true;
  if (surface?.kind === 'effect') {
    if (surface.effect === 'heather') {
      const res = Math.min(pxPerMm, 4);
      const tile = heatherTile(surface, color, res);
      const pattern = ctx.createPattern(tile, 'repeat');
      if (pattern) {
        pattern.setTransform(new DOMMatrix().translate(anchor.x, anchor.y).scale(pxPerMm / res));
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(effectCanvas(surface, color, w, h, pxPerMm, anchor, wrapPx), 0, 0, w, h);
    }
  }
  if (surface?.kind === 'gradient') {
    const a = (surface.angleDeg * Math.PI) / 180;
    const L = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
    const g = surface.radial
      ? ctx.createRadialGradient(anchor.x, h / 2, 0, anchor.x, h / 2, Math.max(1, Math.hypot(w, h) / 2))
      : ctx.createLinearGradient(anchor.x - L * Math.cos(a), h / 2 - L * Math.sin(a), anchor.x + L * Math.cos(a), h / 2 + L * Math.sin(a));
    ctx.fillStyle = addStops(g, color, surface);
    ctx.fillRect(0, 0, w, h);
  } else if (surface?.kind === 'pattern') {
    const period = Math.max(2, surface.scaleMm * pxPerMm);
    const size = Math.max(2, Math.min(1024, Math.round(period)));
    const pattern = ctx.createPattern(patternTile(surface, color, size), 'repeat');
    if (pattern) {
      pattern.setTransform(new DOMMatrix().translate(anchor.x, anchor.y).rotate(surface.angleDeg).scale(period / size));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  } else if (surface?.kind === 'image') {
    const img = getLoadedImage(surface.assetId);
    if (!img) ok = false;
    else {
      const tw = Math.max(2, surface.tileWidthMm * pxPerMm);
      const th = (tw * surface.naturalHeightPx) / surface.naturalWidthPx;
      ctx.translate(anchor.x, anchor.y);
      ctx.rotate((surface.angleDeg * Math.PI) / 180);
      const reach = Math.hypot(w, h);
      const nx = Math.min(400, Math.ceil(reach / tw) + 1);
      const ny = Math.min(400, Math.ceil(reach / th) + 1);
      for (let i = -nx; i <= nx; i++) for (let j = -ny; j <= ny; j++) ctx.drawImage(img, i * tw - tw / 2, j * th - th / 2, tw, th);
    }
  }
  ctx.restore();
  return ok;
}

/**
 * Paint for a fill, defined in the layer box (px, origin at its centre).
 * `toUser` maps box space into the current drawing space when that differs (scaled text).
 */
/** A gradient's stops: from, an optional middle colour, to. */
function addStops(g: CanvasGradient, from: string, style: Extract<FillStyle, { kind: 'gradient' }>) {
  g.addColorStop(0, from);
  if (style.via) g.addColorStop(0.5, style.via);
  g.addColorStop(1, style.to);
  return g;
}

function paint(ctx: Ctx, base: string, style: FillStyle | undefined, w: number, h: number, pxPerMm: number, toUser?: DOMMatrix): string | CanvasGradient | CanvasPattern {
  if (!style) return base;
  if (style.kind === 'gradient') {
    if (style.radial) {
      // From the centre of the box out to its corners.
      let c: DOMPointInit = { x: 0, y: 0 };
      let r = Math.hypot(w, h) / 2;
      if (toUser) {
        c = toUser.transformPoint(c);
        r *= Math.sqrt(Math.abs(toUser.a * toUser.d - toUser.b * toUser.c));
      }
      return addStops(ctx.createRadialGradient(c.x!, c.y!, 0, c.x!, c.y!, Math.max(1, r)), base, style);
    }
    const a = (style.angleDeg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const L = (Math.abs(w * cos) + Math.abs(h * sin)) / 2;
    let p0: DOMPointInit = { x: -L * cos, y: -L * sin };
    let p1: DOMPointInit = { x: L * cos, y: L * sin };
    if (toUser) {
      p0 = toUser.transformPoint(p0);
      p1 = toUser.transformPoint(p1);
    }
    return addStops(ctx.createLinearGradient(p0.x!, p0.y!, p1.x!, p1.y!), base, style);
  }
  const period = Math.max(2, style.scaleMm * pxPerMm);
  const size = Math.max(2, Math.round(period));
  const pattern = ctx.createPattern(patternTile(style, base, size), 'repeat');
  if (!pattern) return base;
  pattern.setTransform((toUser ?? new DOMMatrix()).rotate(style.angleDeg).scale(period / size));
  return pattern;
}

// ---------------------------------------------------------------------------
// Text and shapes
// ---------------------------------------------------------------------------

/** How far italic letters lean (tan of about 12°): cuts between letter colours lean with them. */
const ITALIC_SLANT = Math.tan((12 * Math.PI) / 180);

/**
 * Draw one line of text in letter colours: the whole line is drawn once per colour run, cut to that
 * run's letters, so kerning, ligatures and complex scripts keep their shaping. Italic cuts lean
 * with the letters, pivoting on the baseline, so a letter's top doesn't take its neighbour's colour.
 */
function drawLetterRuns(ctx: Ctx, line: string, inks: (string | null)[], x: number, y: number, align: TextContent['align'], italic: boolean, draw: (color: string) => void) {
  const gs = graphemes(line);
  const width = ctx.measureText(line).width;
  const x0 = align === 'left' ? x : align === 'right' ? x - width : x - width / 2;
  const edge = (i: number) => x0 + ctx.measureText(gs.slice(0, i).join('')).width;
  // Runs of letters in one colour; a space joins the run before it.
  const runs: { color: string; from: number; to: number }[] = [];
  inks.forEach((color, i) => {
    const last = runs[runs.length - 1];
    if (last && (color === null || color === last.color)) last.to = i + 1;
    else if (color !== null) runs.push({ color, from: i, to: i + 1 });
  });
  const slant = italic ? ITALIC_SLANT : 0;
  const baseline = y + ctx.measureText('H').actualBoundingBoxDescent;
  const top = y - TEXT_REF_PX * 2;
  const bottom = y + TEXT_REF_PX * 2;
  // Where a cut at `at` (on the baseline) crosses height `yy`.
  const cut = (at: number, yy: number) => at + (baseline - yy) * slant;
  const reach = TEXT_REF_PX * 4;
  runs.forEach((run, k) => {
    // The first and last runs reach past the line, for letters that overhang it.
    const left = k === 0 ? x0 - reach : edge(run.from);
    const right = k === runs.length - 1 ? x0 + width + reach : edge(run.to);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cut(left, top), top);
    ctx.lineTo(cut(right, top), top);
    ctx.lineTo(cut(right, bottom), bottom);
    ctx.lineTo(cut(left, bottom), bottom);
    ctx.closePath();
    ctx.clip();
    draw(run.color);
    ctx.restore();
  });
}

function drawText(ctx: Ctx, c: TextContent, w: number, h: number, pxPerMm: number) {
  const m = layoutText(c);
  const sx = w / m.width;
  const sy = h / m.height;
  ctx.save();
  ctx.scale(sx, sy);
  ctx.translate(-m.cx, -m.cy);
  ctx.font = fontString(c, TEXT_REF_PX);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // Box space (layer px, origin at its centre) → this scaled text space.
  const toText = new DOMMatrix([1 / sx, 0, 0, 1 / sy, m.cx, m.cy]);
  const fill = paint(ctx, c.fill, c.fillStyle, w, h, pxPerMm, toText);
  // Outline only: the letters as lines in the fill (colour, gradient or pattern), centred on the glyph edge.
  const hollow = c.hollow ? { width: (lineWidthMm(c) * pxPerMm) / sy } : null;
  // An outline is centred on the glyph edge and the fill covers its inner half,
  // so draw it twice as wide to show the requested outline width outside the letter.
  const stroke = !hollow && c.strokeColor && c.strokeWidthMm ? { color: c.strokeColor, width: (c.strokeWidthMm * pxPerMm * 2) / sy } : null;
  // Letter colours take the place of the fill, letter by letter.
  const inks = c.letterColors?.length ? letterInks(m.glyphs ? [c.value] : m.lines, c.letterColors) : null;

  if (m.glyphs) {
    setLetterSpacing(ctx, 0);
    ctx.textAlign = 'center';
    for (const pass of hollow ? ['line'] : stroke ? ['stroke', 'fill'] : ['fill']) {
      m.glyphs.forEach((glyph, i) => {
        ctx.save();
        ctx.translate(glyph.x, glyph.y);
        ctx.rotate(glyph.rot);
        // Gradients and patterns paint in the space current at fill time, so map the box into
        // each rotated glyph's space: the fill stays anchored to the layer, not to the letter.
        const glyphPaint = () =>
          inks ? (inks[0][i] ?? c.fill) : c.fillStyle ? paint(ctx, c.fill, c.fillStyle, w, h, pxPerMm, new DOMMatrix().rotate((-glyph.rot * 180) / Math.PI).translate(-glyph.x, -glyph.y).multiply(toText)) : c.fill;
        if (pass === 'stroke' && stroke) {
          ctx.strokeStyle = stroke.color;
          ctx.lineWidth = stroke.width;
          ctx.strokeText(glyph.g, 0, 0);
        } else if (pass === 'line' && hollow) {
          ctx.strokeStyle = glyphPaint();
          ctx.lineWidth = hollow.width;
          ctx.strokeText(glyph.g, 0, 0);
        } else {
          ctx.fillStyle = glyphPaint();
          ctx.fillText(glyph.g, 0, 0);
        }
        ctx.restore();
      });
    }
  } else {
    setLetterSpacing(ctx, c.letterSpacingEm * TEXT_REF_PX);
    ctx.textAlign = c.align;
    const x = c.align === 'left' ? -m.width / 2 : c.align === 'right' ? m.width / 2 : 0;
    const lineH = TEXT_REF_PX * c.lineHeight;
    m.lines.forEach((line, i) => {
      const y = -m.height / 2 + lineH * (i + 0.5);
      if (hollow) {
        ctx.lineWidth = hollow.width;
        if (inks)
          drawLetterRuns(ctx, line, inks[i], x, y, c.align, c.italic, (color) => {
            ctx.strokeStyle = color;
            ctx.strokeText(line, x, y);
          });
        else {
          ctx.strokeStyle = fill;
          ctx.strokeText(line, x, y);
        }
        return;
      }
      if (stroke) {
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.strokeText(line, x, y);
      }
      if (inks)
        drawLetterRuns(ctx, line, inks[i], x, y, c.align, c.italic, (color) => {
          ctx.fillStyle = color;
          ctx.fillText(line, x, y);
        });
      else {
        ctx.fillStyle = fill;
        ctx.fillText(line, x, y);
      }
    });
  }
  ctx.restore();
}

/** The line width of outline-only text and shapes, in mm: the outline width, else a bold 1.5 mm. */
export function lineWidthMm(c: { strokeWidthMm?: number }) {
  return c.strokeWidthMm || 1.5;
}

function shapePath(ctx: Ctx, c: ShapeContent, w: number, h: number, pxPerMm: number) {
  const hw = w / 2;
  const hh = h / 2;
  ctx.beginPath();
  switch (c.shape) {
    case 'rect':
    case 'line': {
      const r = Math.min(c.cornerRadiusMm * pxPerMm, hw, hh);
      if ('roundRect' in ctx && r > 0) ctx.roundRect(-hw, -hh, w, h, r);
      else ctx.rect(-hw, -hh, w, h);
      break;
    }
    case 'ellipse':
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(0, -hh);
      ctx.lineTo(hw, hh);
      ctx.lineTo(-hw, hh);
      ctx.closePath();
      break;
    case 'star': {
      const n = c.points ?? 5;
      const inner = c.innerRatio ?? 0.45;
      for (let i = 0; i < n * 2; i++) {
        const r = i % 2 ? inner : 1;
        const a = -Math.PI / 2 + (i * Math.PI) / n;
        const x = Math.cos(a) * r * hw;
        const y = Math.sin(a) * r * hh;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      break;
    }
    case 'polygon': {
      const n = c.points ?? 6;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
        if (i) ctx.lineTo(Math.cos(a) * hw, Math.sin(a) * hh);
        else ctx.moveTo(Math.cos(a) * hw, Math.sin(a) * hh);
      }
      ctx.closePath();
      break;
    }
    case 'heart': {
      const X = (u: number) => (u - 0.5) * w;
      const Y = (v: number) => (v - 0.5) * h;
      ctx.moveTo(X(0.5), Y(0.28));
      ctx.bezierCurveTo(X(0.5), Y(0.2), X(0.42), Y(0), X(0.25), Y(0));
      ctx.bezierCurveTo(X(0.05), Y(0), X(0), Y(0.18), X(0), Y(0.32));
      ctx.bezierCurveTo(X(0), Y(0.55), X(0.22), Y(0.74), X(0.5), Y(1));
      ctx.bezierCurveTo(X(0.78), Y(0.74), X(1), Y(0.55), X(1), Y(0.32));
      ctx.bezierCurveTo(X(1), Y(0.18), X(0.95), Y(0), X(0.75), Y(0));
      ctx.bezierCurveTo(X(0.58), Y(0), X(0.5), Y(0.2), X(0.5), Y(0.28));
      ctx.closePath();
      break;
    }
  }
}

const pathCache = new Map<string, Path2D>();

/** A graphic's path (0–100 box) scaled to a w × h box centred on the origin. */
function graphicPath(d: string, w: number, h: number) {
  let base = pathCache.get(d);
  if (!base) {
    base = new Path2D(d);
    if (pathCache.size > 96) pathCache.delete(pathCache.keys().next().value!);
    pathCache.set(d, base);
  }
  const p = new Path2D();
  p.addPath(base, new DOMMatrix().translate(-w / 2, -h / 2).scale(w / 100, h / 100));
  return p;
}

const SHIELD = 'M50 2 L94 16 C94 58 78 82 50 98 C22 82 6 58 6 16 Z';

/** Clip shapes for cropping images (spec ED2-10 mask). */
function maskPath(ctx: Ctx, mask: NonNullable<ImageContent['mask']>, w: number, h: number) {
  const base = { kind: 'shape', fill: '#000000', cornerRadiusMm: 0 } as const;
  if (mask === 'shield') return graphicPath(SHIELD, w, h);
  const p = new Path2D();
  const stub = {
    beginPath: () => {},
    moveTo: (x: number, y: number) => p.moveTo(x, y),
    lineTo: (x: number, y: number) => p.lineTo(x, y),
    bezierCurveTo: (a: number, b: number, c: number, d: number, e: number, f: number) => p.bezierCurveTo(a, b, c, d, e, f),
    closePath: () => p.closePath(),
    ellipse: (...args: Parameters<Path2D['ellipse']>) => p.ellipse(...args),
    rect: (x: number, y: number, rw: number, rh: number) => p.rect(x, y, rw, rh),
    roundRect: (x: number, y: number, rw: number, rh: number, r: number) => p.roundRect(x, y, rw, rh, r),
  } as unknown as Ctx;
  void ctx;
  const shape: ShapeContent =
    mask === 'circle'
      ? { ...base, shape: 'ellipse' }
      : mask === 'rounded'
        ? { ...base, shape: 'rect', cornerRadiusMm: (Math.min(w, h) * 0.18) / 1 }
        : mask === 'star'
          ? { ...base, shape: 'star', points: 5, innerRatio: 0.5 }
          : mask === 'heart'
            ? { ...base, shape: 'heart' }
            : { ...base, shape: 'polygon', points: 6 };
  shapePath(stub, shape, w, h, 1);
  return p;
}

function drawShape(ctx: Ctx, c: ShapeContent, w: number, h: number, pxPerMm: number) {
  let path: Path2D | null = null;
  if (c.shape === 'path') {
    if (!c.path) return;
    path = graphicPath(c.path, w, h);
  } else {
    shapePath(ctx, c, w, h, pxPerMm);
  }
  if (c.hollow) {
    // Outline only: the shape as a line in its fill (colour, gradient or pattern).
    ctx.strokeStyle = paint(ctx, c.fill, c.fillStyle, w, h, pxPerMm);
    ctx.lineWidth = lineWidthMm(c) * pxPerMm;
    ctx.lineJoin = 'round';
    if (path) ctx.stroke(path);
    else ctx.stroke();
    return;
  }
  ctx.fillStyle = paint(ctx, c.fill, c.fillStyle, w, h, pxPerMm);
  if (path) ctx.fill(path, 'evenodd');
  else ctx.fill();
  if (c.strokeColor && c.strokeWidthMm) {
    ctx.strokeStyle = c.strokeColor;
    ctx.lineWidth = c.strokeWidthMm * pxPerMm;
    ctx.lineJoin = 'round';
    if (path) ctx.stroke(path);
    else ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Images: non-destructive adjustments and repeat patterns
// ---------------------------------------------------------------------------

export const NEUTRAL_ADJUST: ImageAdjust = { brightness: 100, contrast: 100, saturation: 100, hue: 0, grayscale: false, invert: false };

export function isNeutralAdjust(a: ImageAdjust | undefined) {
  return !a || (a.brightness === 100 && a.contrast === 100 && a.saturation === 100 && a.hue === 0 && !a.grayscale && !a.invert && !a.threshold);
}

type M = number[]; // 3×4 affine colour matrix, row-major, on 0–255 channels

function mul(a: M, b: M): M {
  // (a ∘ b): apply b first, then a.
  const out: M = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + (c === 3 ? a[r * 4 + 3] : 0);
    }
  }
  return out;
}

const lin = (m: number[], offset = 0): M => [m[0], m[1], m[2], offset, m[3], m[4], m[5], offset, m[6], m[7], m[8], offset];

function saturateMatrix(s: number): M {
  return lin([0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]);
}

function hueMatrix(deg: number): M {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return lin([
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ]);
}

/** One affine matrix in CSS filter order: brightness, contrast, saturation, hue, grayscale, invert. */
export function adjustMatrix(a: ImageAdjust): M {
  let m: M = lin([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const b = a.brightness / 100;
  m = mul(lin([b, 0, 0, 0, b, 0, 0, 0, b]), m);
  const k = a.contrast / 100;
  m = mul(lin([k, 0, 0, 0, k, 0, 0, 0, k], 128 * (1 - k)), m);
  m = mul(saturateMatrix(a.grayscale ? 0 : a.saturation / 100), m);
  if (a.hue) m = mul(hueMatrix(a.hue), m);
  if (a.invert) m = mul(lin([-1, 0, 0, 0, -1, 0, 0, 0, -1], 255), m);
  return m;
}

/** Apply adjustments in place to RGBA pixels. Pure, so it can be tested and runs identically everywhere. */
export function applyAdjust(data: Uint8ClampedArray, a: ImageAdjust) {
  const m = adjustMatrix(a);
  const t = a.threshold ?? 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let R = m[0] * r + m[1] * g + m[2] * b + m[3];
    let G = m[4] * r + m[5] * g + m[6] * b + m[7];
    let B = m[8] * r + m[9] * g + m[10] * b + m[11];
    if (t > 0) {
      const luma = 0.2126 * Math.min(255, Math.max(0, R)) + 0.7152 * Math.min(255, Math.max(0, G)) + 0.0722 * Math.min(255, Math.max(0, B));
      R = G = B = luma < t ? 0 : 255;
    }
    data[i] = R;
    data[i + 1] = G;
    data[i + 2] = B;
  }
}

const adjustCache = new CanvasCache(40e6, 40e6);

/** Pixels to draw for an image layer: the decoded original, or its adjusted copy. Undefined while loading. */
export function imageSource(c: ImageContent): CanvasImageSource | undefined {
  const img = getLoadedImage(c.assetId);
  if (!img) return undefined;
  if (isNeutralAdjust(c.adjust)) return img;
  const key = `${c.assetId}${JSON.stringify(c.adjust)}`;
  const hit = adjustCache.get(key);
  if (hit) return hit;
  const natW = img.naturalWidth || c.naturalWidthPx;
  const natH = img.naturalHeight || c.naturalHeightPx;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cap = memory <= 4 ? 2048 : 4096;
  // Vectors rasterize at the cap so they stay sharp; photos never upscale.
  const scale = c.mime === 'image/svg+xml' ? cap / Math.max(natW, natH) : Math.min(1, cap / Math.max(natW, natH));
  const canvas = makeCanvas(natW * scale, natH * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyAdjust(data.data, c.adjust!);
  ctx.putImageData(data, 0, 0);
  adjustCache.set(key, canvas);
  return canvas;
}

export const DEFAULT_REPEAT: ImageRepeat = { mode: 'grid', tileWidthMm: 40, spacingMm: 4, rotationDeg: 0, offsetXmm: 0, offsetYmm: 0 };

/** The part of the decoded source an image layer shows (its crop), in the source's own pixels. */
function cropSource(src: CanvasImageSource, c: ImageContent) {
  const W = (src as HTMLImageElement).naturalWidth || (src as HTMLCanvasElement).width || c.naturalWidthPx;
  const H = (src as HTMLImageElement).naturalHeight || (src as HTMLCanvasElement).height || c.naturalHeightPx;
  const k = c.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return { sx: k.x * W, sy: k.y * H, sw: Math.max(1e-3, k.w * W), sh: Math.max(1e-3, k.h * H) };
}

/** Width ÷ height of what an image layer shows: the crop's proportions, else the image's. */
export function shownAspect(c: Pick<ImageContent, 'naturalWidthPx' | 'naturalHeightPx' | 'crop'>) {
  return (c.naturalWidthPx * (c.crop?.w ?? 1)) / (c.naturalHeightPx * (c.crop?.h ?? 1));
}

/** Tile an image across the layer box: grid, half-drop, brick or mirrored repeats, clipped to the box. */
function drawRepeat(ctx: Ctx, src: CanvasImageSource, c: ImageContent, rep: ImageRepeat, w: number, h: number, pxPerMm: number) {
  const tileW = Math.max(1, rep.tileWidthMm * pxPerMm);
  // A cropped image repeats just what it shows.
  const tileH = tileW / shownAspect(c);
  const s = cropSource(src, c);
  const gap = rep.spacingMm * pxPerMm;
  const cw = tileW + gap;
  const ch = tileH + gap;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w / 2, -h / 2, w, h);
  ctx.clip();
  ctx.rotate((rep.rotationDeg * Math.PI) / 180);
  const ox = rep.offsetXmm * pxPerMm;
  const oy = rep.offsetYmm * pxPerMm;
  ctx.translate(ox % cw, oy % ch);
  const reach = Math.hypot(w, h) / 2 + Math.max(cw, ch);
  const nx = Math.min(200, Math.ceil(reach / cw));
  const ny = Math.min(200, Math.ceil(reach / ch));
  for (let i = -nx; i <= nx; i++) {
    for (let j = -ny; j <= ny; j++) {
      let x = i * cw;
      let y = j * ch;
      if (rep.mode === 'half-drop' && i & 1) y += ch / 2;
      if (rep.mode === 'brick' && j & 1) x += cw / 2;
      if (rep.mode === 'mirror' && (i & 1 || j & 1)) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(i & 1 ? -1 : 1, j & 1 ? -1 : 1);
        ctx.drawImage(src, s.sx, s.sy, s.sw, s.sh, -tileW / 2, -tileH / 2, tileW, tileH);
        ctx.restore();
      } else {
        ctx.drawImage(src, s.sx, s.sy, s.sw, s.sh, x - tileW / 2, y - tileH / 2, tileW, tileH);
      }
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Distress (prints) and finish simulation (preview only)
// ---------------------------------------------------------------------------

/** The distress a layer prints with: its own settings, or the default worn look for the distressed finish. */
export function effectiveDistress(layer: Pick<ArtworkLayer, 'id' | 'style'>): NonNullable<LayerStyle['distress']> | null {
  const d = layer.style.distress;
  if (d) return d.amount > 0 ? d : null;
  if (layer.style.finish === 'distressed') return { amount: 0.45, scaleMm: 6, seed: hashString(layer.id) % 100000 };
  return null;
}

function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). Deterministic for a given seed, at any resolution. */
export function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** How much ink a distress mask removes at a point in the layer, in millimetres from its top-left (0–1). */
export function distressAt(xMm: number, yMm: number, d: NonNullable<LayerStyle['distress']>) {
  const s = d.scaleMm;
  const blotch = 0.55 * valueNoise(xMm / s, yMm / s, d.seed) + 0.3 * valueNoise((xMm * 2) / s, (yMm * 2) / s, d.seed + 1) + 0.15 * valueNoise((xMm * 4) / s, (yMm * 4) / s, d.seed + 2);
  const grain = valueNoise((xMm * 9) / s, (yMm * 9) / s, d.seed + 3);
  const n = 0.72 * blotch + 0.28 * grain;
  const t = 1 - d.amount * 0.8;
  const e = Math.min(1, Math.max(0, (n - (t - 0.035)) / 0.07));
  return e * e * (3 - 2 * e);
}

const maskCache = new CanvasCache(24e6, 12e6);

/**
 * Cracked plastisol: a network of fine cracks like a heavy print after many washes. Cells are a
 * few millimetres across; each crack is the thin band where two cells meet (Voronoi edges), with
 * a finer second network of hairline cracks. Returns how much ink a crack removes (0–1).
 */
export function crackAt(xMm: number, yMm: number, cellMm: number, seed: number) {
  const edge = (cell: number, s: number) => {
    const gx = xMm / cell;
    const gy = yMm / cell;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    let f1 = Infinity;
    let f2 = Infinity;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const d = Math.hypot(gx - (cx + 0.12 + 0.76 * hash2(cx, cy, s)), gy - (cy + 0.12 + 0.76 * hash2(cx, cy, s + 17)));
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    }
    return ((f2 - f1) * cell) / 2;
  };
  const wobble = 0.6 + 0.8 * valueNoise(xMm / 3, yMm / 3, seed + 5);
  const main = 1 - Math.min(1, Math.max(0, (edge(cellMm, seed) - 0.12 * wobble) / 0.12));
  const fine = 1 - Math.min(1, Math.max(0, (edge(cellMm * 0.45, seed + 3) - 0.05) / 0.06));
  // Hairlines only run part of the way, so the fine network stays broken.
  const reach = valueNoise(xMm / (cellMm * 0.8), yMm / (cellMm * 0.8), seed + 9) > 0.55 ? 1 : 0;
  return Math.min(1, Math.max(main, fine * reach * 0.85));
}

function crackMask(widthMm: number, heightMm: number, bleedMm: number, seed: number, pxPerMm: number) {
  // Cracks are fractions of a millimetre, so the mask keeps up to 8 px/mm.
  const r = Math.min(pxPerMm, 8);
  const W = Math.max(1, Math.ceil((widthMm + 2 * bleedMm) * r));
  const H = Math.max(1, Math.ceil((heightMm + 2 * bleedMm) * r));
  const key = ['crack', W, H, bleedMm.toFixed(3), seed, r.toFixed(3)].join('|');
  const hit = maskCache.get(key);
  if (hit) return hit;
  const mask = makeCanvas(W, H);
  const ctx = mask.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    const y = (py + 0.5) / r - bleedMm;
    for (let px = 0; px < W; px++) img.data[(py * W + px) * 4 + 3] = crackAt((px + 0.5) / r - bleedMm, y, 4.5, seed) * 255;
  }
  ctx.putImageData(img, 0, 0);
  maskCache.set(key, mask);
  return mask;
}

function distressMask(widthMm: number, heightMm: number, bleedMm: number, d: NonNullable<LayerStyle['distress']>, pxPerMm: number) {
  // Masks are computed at up to 6 px/mm and scaled; their features are millimetres, not pixels.
  const r = Math.min(pxPerMm, 6);
  const W = Math.max(1, Math.ceil((widthMm + 2 * bleedMm) * r));
  const H = Math.max(1, Math.ceil((heightMm + 2 * bleedMm) * r));
  const key = [W, H, bleedMm.toFixed(3), d.amount, d.scaleMm, d.seed, r.toFixed(3)].join('|');
  const hit = maskCache.get(key);
  if (hit) return hit;
  const mask = makeCanvas(W, H);
  const ctx = mask.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const data = img.data;
  for (let py = 0; py < H; py++) {
    const y = (py + 0.5) / r - bleedMm;
    for (let px = 0; px < W; px++) {
      data[(py * W + px) * 4 + 3] = distressAt((px + 0.5) / r - bleedMm, y, d) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  maskCache.set(key, mask);
  return mask;
}

const SIMULATED = new Set<LayerStyle['finish']>(['puff', 'embroidery', 'metallic']);

/** Raised finishes cast a soft shadow onto the fabric in previews. */
const RAISED: Partial<Record<LayerStyle['finish'], { color: string; blurMm: number; dxMm: number; dyMm: number }>> = {
  puff: { color: 'rgba(0,0,0,0.42)', blurMm: 1.4, dxMm: 0.4, dyMm: 0.9 },
  embroidery: { color: 'rgba(0,0,0,0.36)', blurMm: 0.7, dxMm: 0.25, dyMm: 0.5 },
};

/** The part of `src` not covered by itself shifted by (dx, dy), filled with one colour: a lit or shaded edge. */
function edgeRim(src: HTMLCanvasElement, dx: number, dy: number, color: string) {
  const rim = makeCanvas(src.width, src.height);
  const c = rim.getContext('2d')!;
  c.drawImage(src, 0, 0);
  c.globalCompositeOperation = 'destination-out';
  c.drawImage(src, dx, dy);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = color;
  c.fillRect(0, 0, rim.width, rim.height);
  return rim;
}

/** Shade artwork in place to suggest its finish. Visual only; never used for print files. */
function shadeFinish(canvas: HTMLCanvasElement, finish: LayerStyle['finish'], pxPerMm: number) {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (finish === 'embroidery') {
    // Satin stitches: diagonal threads, each lit along its crown. Wider than real thread
    // (about 0.4 mm) so the texture still reads at screen scale.
    const period = Math.max(4, Math.round(1.1 * pxPerMm));
    const tile = makeCanvas(period, 1);
    const t = tile.getContext('2d')!;
    const g = t.createLinearGradient(0, 0, period, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.36)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    t.fillStyle = g;
    t.fillRect(0, 0, period, 1);
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) {
      pattern.setTransform(new DOMMatrix().rotate(-38));
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const d = Math.max(1, 0.35 * pxPerMm);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(edgeRim(canvas, -d, -d, '#000000'), 0, 0);
  } else if (finish === 'puff') {
    // Soft relief: lit from the top left, a darker lower edge, and a slightly lighter, matte body.
    const d = Math.max(1, 0.55 * pxPerMm);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const lit = edgeRim(canvas, d, d, '#ffffff');
    const shade = edgeRim(canvas, -d, -d, '#000000');
    ctx.globalAlpha = 0.5;
    ctx.drawImage(lit, 0, 0);
    ctx.globalAlpha = 0.32;
    ctx.drawImage(shade, 0, 0);
  } else if (finish === 'metallic') {
    // Faux foil: bright and dark bands sweeping across the artwork.
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height * 0.6);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.4, 'rgba(0,0,0,0.3)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.22)');
    g.addColorStop(0.88, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(255,255,255,0.45)');
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Sticker outline and halftone: effects that print
// ---------------------------------------------------------------------------

/** One line of the squared Euclidean distance transform (Felzenszwalb and Huttenlocher), in place. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
  for (let q = 0; q < n; q++) f[q] = d[q];
}

/** Squared distance from every cell to the nearest inside cell (0 inside), for a w × h grid. */
export function distanceField(inside: (i: number) => boolean, w: number, h: number): Float64Array {
  const INF = 1e20;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = inside(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = f[y];
  }
  for (let y = 0; y < h; y++) {
    const row = grid.subarray(y * w, y * w + w);
    f.set(row);
    edt1d(f, w, d, v, z);
    row.set(f.subarray(0, w));
  }
  return grid;
}

/**
 * The silhouette of `src` grown by `radiusPx` in one colour: a sticker outline. Worked out on a
 * distance field at up to 1024 px and drawn back smoothly, so it stays fast at print resolution.
 */
function contour(src: HTMLCanvasElement, radiusPx: number, color: string): HTMLCanvasElement {
  const W = src.width;
  const H = src.height;
  const k = Math.max(1, Math.max(W, H) / 1024);
  const w = Math.max(1, Math.round(W / k));
  const h = Math.max(1, Math.round(H / k));
  const small = makeCanvas(w, h);
  const sc = small.getContext('2d', { willReadFrequently: true })!;
  sc.drawImage(src, 0, 0, w, h);
  const px = sc.getImageData(0, 0, w, h);
  const field = distanceField((i) => px.data[i * 4 + 3] > 24, w, h);
  const r = radiusPx / k;
  const [R, G, B] = hexRgb(color);
  for (let i = 0; i < w * h; i++) {
    px.data[i * 4] = R;
    px.data[i * 4 + 1] = G;
    px.data[i * 4 + 2] = B;
    px.data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, r - Math.sqrt(field[i]) + 0.5)) * 255);
  }
  sc.putImageData(px, 0, 0);
  if (k === 1) return small;
  const big = makeCanvas(W, H);
  const bc = big.getContext('2d')!;
  bc.imageSmoothingEnabled = true;
  bc.imageSmoothingQuality = 'high';
  bc.drawImage(small, 0, 0, W, H);
  return big;
}

/** How much ink a halftone cell carries, 0–1, from its averaged colour and opacity. */
export function halftoneCover(r: number, g: number, b: number, a: number, by: 'tone' | 'fade') {
  const alpha = a / 255;
  if (by === 'fade') return alpha;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return Math.min(1, alpha * (1 - luma));
}

/** One halftone mark: its cell's centre on the turned grid (px from the artwork's centre), its ink cover 0–1 and colour. */
export interface HalftoneMark {
  x: number;
  y: number;
  cover: number;
  color: string;
}

/**
 * The marks of a halftone screen over `src`: on a grid turned to the screen angle, one per cell that
 * carries ink. The canvas draws them; the SVG print file writes each as a circle or rectangle.
 */
export function halftoneMarks(src: HTMLCanvasElement, ht: LayerHalftone, pxPerMm: number): { cell: number; marks: HalftoneMark[] } {
  const W = src.width;
  const H = src.height;
  const cell = Math.max(1.5, ht.cellMm * pxPerMm);
  // Average the artwork down to about three pixels a cell, then sample one value per cell on the
  // turned grid, so each dot reflects its whole cell rather than one pixel.
  const mw = Math.max(1, Math.round((W / cell) * 3));
  const mh = Math.max(1, Math.round((H / cell) * 3));
  const mid = makeCanvas(mw, mh);
  const mc = mid.getContext('2d')!;
  mc.imageSmoothingEnabled = true;
  mc.imageSmoothingQuality = 'high';
  mc.drawImage(src, 0, 0, mw, mh);
  const n = Math.ceil(Math.hypot(W, H) / cell) + 2;
  const sample = makeCanvas(n, n);
  const sc = sample.getContext('2d', { willReadFrequently: true })!;
  sc.imageSmoothingEnabled = true;
  sc.imageSmoothingQuality = 'high';
  // Sample pixel (u, v) is cell (u, v) of the turned grid centred on the artwork.
  sc.setTransform(new DOMMatrix().translate(n / 2, n / 2).scale(1 / cell).rotate(-ht.angleDeg).translate(-W / 2, -H / 2).scale(W / mw, H / mh));
  sc.drawImage(mid, 0, 0);
  const data = sc.getImageData(0, 0, n, n).data;
  release(mid);
  release(sample);
  const marks: HalftoneMark[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = (j * n + i) * 4;
      if (data[p + 3] < 3) continue;
      const cover = halftoneCover(data[p], data[p + 1], data[p + 2], data[p + 3], ht.by);
      if (cover < 0.015) continue;
      // Dots in their own colour are rounded to fewer colours, so a photo needs few paths.
      const color = ht.color ?? `#${[data[p], data[p + 1], data[p + 2]].map((x) => ((x >> 3) << 3).toString(16).padStart(2, '0')).join('')}`;
      marks.push({ x: (i - n / 2 + 0.5) * cell, y: (j - n / 2 + 0.5) * cell, cover, color });
    }
  }
  return { cell, marks };
}

/** A halftone mark's size: a dot's radius (area true to the ink), a square's side, a line's thickness. */
export function halftoneMarkSize(shape: LayerHalftone['shape'], cell: number, cover: number) {
  return shape === 'dot' ? cell * Math.sqrt(cover / Math.PI) : shape === 'square' ? cell * Math.sqrt(cover) : cell * cover;
}

/**
 * The artwork as a halftone screen: each cell a dot, square or line sized by the ink there (a full
 * cell's dot just overlaps its neighbours into solid). Marks of one colour share one path.
 */
function halftoneCanvas(src: HTMLCanvasElement, ht: LayerHalftone, pxPerMm: number): HTMLCanvasElement {
  const W = src.width;
  const H = src.height;
  const { cell, marks } = halftoneMarks(src, ht, pxPerMm);
  const paths = new Map<string, Path2D>();
  for (const { x, y, cover, color } of marks) {
    let path = paths.get(color);
    if (!path) paths.set(color, (path = new Path2D()));
    const s = halftoneMarkSize(ht.shape, cell, cover);
    if (ht.shape === 'dot') {
      path.moveTo(x + s, y);
      path.arc(x, y, s, 0, Math.PI * 2);
    } else if (ht.shape === 'square') path.rect(x - s / 2, y - s / 2, s, s);
    else path.rect(x - cell / 2 - 0.25, y - s / 2, cell + 0.5, s);
  }
  const out = makeCanvas(W, H);
  const o = out.getContext('2d')!;
  o.setTransform(new DOMMatrix().translate(W / 2, H / 2).rotate(ht.angleDeg));
  for (const [color, path] of paths) {
    o.fillStyle = color;
    o.fill(path);
  }
  return out;
}

/** Draw only the shadow of `src` (the source itself lands outside the canvas). */
function castShadow(o: CanvasRenderingContext2D, src: HTMLCanvasElement, color: string, blurPx: number, dx: number, dy: number) {
  const far = src.width + 64;
  o.save();
  o.shadowColor = color;
  o.shadowBlur = blurPx;
  o.shadowOffsetX = dx + far;
  o.shadowOffsetY = dy;
  o.drawImage(src, -far, 0);
  o.restore();
}

/** Millimetres an effect paints outside the layer box: outlines, shadows, glyph overhangs, raised finishes. */
/** The drop shadow a layer casts: text keeps its own in its content, every other layer in its style. */
export function layerShadow(layer: Pick<ArtworkLayer, 'content' | 'style'>): LayerShadow | undefined {
  return (layer.content.kind === 'text' ? layer.content.shadow : undefined) ?? layer.style.shadow;
}

export function layerBleedMm(layer: ArtworkLayer, simulate = false): number {
  const c = layer.content;
  let mm = 0;
  if (c.kind === 'text') {
    const outline = c.hollow ? lineWidthMm(c) / 2 + 0.5 : c.strokeColor && c.strokeWidthMm ? c.strokeWidthMm + 0.5 : 0;
    mm = layer.transform.heightMm * 0.12 + outline;
  } else if (c.kind === 'shape' && (c.hollow || (c.strokeColor && c.strokeWidthMm))) {
    mm = (c.hollow ? lineWidthMm(c) : c.strokeWidthMm!) / 2 + 0.5;
  } else if (c.kind === 'lockup') {
    // Scaled with the placement: what reaches past the lockup's board reaches past this box.
    mm = lockupOverhangMm(c) * Math.max(layer.transform.widthMm / c.widthMm, layer.transform.heightMm / c.heightMm);
  }
  if (layer.style.outline) mm += layer.style.outline.widthMm + 0.5;
  const shadow = layerShadow(layer);
  if (shadow) mm += Math.max(Math.abs(shadow.offsetXmm), Math.abs(shadow.offsetYmm)) + shadow.blurMm * 1.5;
  if (simulate && RAISED[layer.style.finish]) mm += 2.5;
  return Math.min(mm, 150);
}

function bleedPx(layer: ArtworkLayer, pxPerMm: number, simulate: boolean) {
  return Math.ceil(layerBleedMm(layer, simulate) * pxPerMm) + 1;
}

/** Whether a layer needs the offscreen effect pass rather than drawing straight onto the target. */
export function needsEffectPass(layer: ArtworkLayer, simulate = false) {
  const s = layer.style;
  return !!effectiveDistress(layer) || s.finish === 'cracked' || !!layerShadow(layer) || !!s.outline || !!s.halftone || (simulate && SIMULATED.has(s.finish));
}

function drawRaw(ctx: Ctx, layer: ArtworkLayer, w: number, h: number, pxPerMm: number): boolean {
  const c = layer.content;
  if (c.kind === 'image') {
    const src = imageSource(c);
    if (!src) return false;
    if (c.mask) {
      ctx.save();
      ctx.clip(maskPath(ctx, c.mask, w, h));
    }
    if (c.repeat) drawRepeat(ctx, src, c, c.repeat, w, h, pxPerMm);
    else if (c.crop) {
      const s = cropSource(src, c);
      ctx.drawImage(src, s.sx, s.sy, s.sw, s.sh, -w / 2, -h / 2, w, h);
    } else ctx.drawImage(src, -w / 2, -h / 2, w, h);
    if (c.mask) ctx.restore();
    return true;
  }
  if (c.kind === 'lockup') return drawLockup(ctx, c, w, h, pxPerMm);
  if (c.kind === 'text') drawText(ctx, c, w, h, pxPerMm);
  else drawShape(ctx, c, w, h, pxPerMm);
  return true;
}

/**
 * A lockup placement (spec ED2-12): the lockup's own board of layers drawn into the `w` × `h` px
 * box. The layers draw at the resolution they end up at, so effects inside stay sharp at any size.
 */
function drawLockup(ctx: Ctx, c: LockupContent, w: number, h: number, pxPerMm: number): boolean {
  const sx = w / (c.widthMm * pxPerMm);
  const sy = h / (c.heightMm * pxPerMm);
  const k = Math.max(sx, sy);
  if (!(k > 0) || !Number.isFinite(k)) return true;
  ctx.save();
  ctx.translate(-w / 2, -h / 2);
  ctx.scale(sx / k, sy / k);
  const ok = drawZone(ctx, c, { pxPerMm: pxPerMm * k });
  ctx.restore();
  return ok;
}

/** How far a lockup's artwork reaches past its board (outlines, shadows, layers hanging over), in its own mm. */
function lockupOverhangMm(c: LockupContent): number {
  let mm = 0;
  for (const id of c.orderedLayerIds) {
    const layer = c.layers[id];
    if (!layer) continue;
    const t = layer.transform;
    const a = (t.rotationDeg * Math.PI) / 180;
    const hw = (Math.abs(Math.cos(a)) * t.widthMm + Math.abs(Math.sin(a)) * t.heightMm) / 2;
    const hh = (Math.abs(Math.sin(a)) * t.widthMm + Math.abs(Math.cos(a)) * t.heightMm) / 2;
    const reach = layerBleedMm(layer);
    mm = Math.max(mm, reach - (t.centerXmm - hw), t.centerXmm + hw + reach - c.widthMm, reach - (t.centerYmm - hh), t.centerYmm + hh + reach - c.heightMm);
  }
  return mm;
}

const fxCache = new CanvasCache(32e6, 8e6);

/** Render a layer with its effects into a padded, layer-local canvas. Null while an image loads. */
function renderEffects(layer: ArtworkLayer, w: number, h: number, pxPerMm: number, simulate: boolean): { canvas: HTMLCanvasElement; bleed: number } | null {
  const bleed = bleedPx(layer, pxPerMm, simulate);
  const distress = effectiveDistress(layer);
  const { halftone, outline } = layer.style;
  const shadow = layerShadow(layer);
  const key = JSON.stringify([layer.content, layer.style.finish, distress, halftone, outline, shadow, Math.round(w * 2), Math.round(h * 2), Math.round(pxPerMm * 1000), simulate]);
  const hit = fxCache.get(key);
  if (hit) return { canvas: hit, bleed };
  const W = Math.ceil(w) + 2 * bleed;
  const H = Math.ceil(h) + 2 * bleed;
  const base = makeCanvas(W, H);
  const b = base.getContext('2d')!;
  b.translate(bleed + w / 2, bleed + h / 2);
  if (!drawRaw(b, layer, w, h, pxPerMm)) return null;
  b.setTransform(1, 0, 0, 1, 0, 0);
  // The artwork as it prints: screened into a halftone, then ringed by its outline (traced
  // round the solid artwork, so it stays one clean band), then worn.
  let art = base;
  if (halftone) art = halftoneCanvas(base, halftone, pxPerMm);
  if (outline) {
    const ring = contour(base, outline.widthMm * pxPerMm, outline.color);
    const both = makeCanvas(W, H);
    const bc = both.getContext('2d')!;
    bc.drawImage(ring, 0, 0);
    bc.drawImage(art, 0, 0);
    if (art !== base) release(art);
    release(ring);
    art = both;
  }
  if (art !== base) release(base);
  const a = art.getContext('2d')!;
  if (distress) {
    const mask = distressMask(w / pxPerMm, h / pxPerMm, bleed / pxPerMm, distress, pxPerMm);
    a.globalCompositeOperation = 'destination-out';
    a.drawImage(mask, 0, 0, w + 2 * bleed, h + 2 * bleed);
    a.globalCompositeOperation = 'source-over';
  }
  // Cracks remove ink, so like distress they are part of the print, not a preview effect.
  if (layer.style.finish === 'cracked') {
    const mask = crackMask(w / pxPerMm, h / pxPerMm, bleed / pxPerMm, hashString(layer.id) % 100000, pxPerMm);
    a.globalCompositeOperation = 'destination-out';
    a.drawImage(mask, 0, 0, w + 2 * bleed, h + 2 * bleed);
    a.globalCompositeOperation = 'source-over';
  }
  if (simulate && SIMULATED.has(layer.style.finish)) shadeFinish(art, layer.style.finish, pxPerMm);
  const raised = simulate ? RAISED[layer.style.finish] : undefined;
  let out = art;
  if (shadow || raised) {
    out = makeCanvas(W, H);
    const o = out.getContext('2d')!;
    if (shadow) castShadow(o, art, shadow.color, shadow.blurMm * pxPerMm, shadow.offsetXmm * pxPerMm, shadow.offsetYmm * pxPerMm);
    if (raised) castShadow(o, art, raised.color, raised.blurMm * pxPerMm, raised.dxMm * pxPerMm, raised.dyMm * pxPerMm);
    o.drawImage(art, 0, 0);
    release(art);
  }
  fxCache.set(key, out);
  return { canvas: out, bleed };
}

/** Free a canvas's pixels now rather than when it is collected (big print-resolution intermediates). */
function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

export interface LayerDrawOptions {
  /** Preview-only finish simulation (embroidery thread, puff relief, metallic sheen). Never for print files. */
  simulateFinish?: boolean;
}

/**
 * Draw one layer's content centred on the current origin, `w` × `h` px, without its position.
 * Returns false when an image isn't decoded yet (callers re-render once it loads).
 */
export function drawLayerContent(ctx: Ctx, layer: ArtworkLayer, w: number, h: number, pxPerMm: number, opts: LayerDrawOptions = {}): boolean {
  const simulate = !!opts.simulateFinish;
  if (!needsEffectPass(layer, simulate)) return drawRaw(ctx, layer, w, h, pxPerMm);
  const fx = renderEffects(layer, w, h, pxPerMm, simulate);
  if (!fx) return false;
  ctx.drawImage(fx.canvas, -w / 2 - fx.bleed, -h / 2 - fx.bleed);
  return true;
}

export interface DrawZoneOptions extends LayerDrawOptions {
  pxPerMm: number;
  /** Pixel position of the zone's (0, 0) mm corner. */
  originX?: number;
  originY?: number;
  /** Live transforms during a drag, so previews follow the pointer before the command commits. */
  overrides?: Record<string, Partial<LayerTransform>>;
}

const BLEND: Record<ArtworkLayer['style']['blendMode'], GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
};

/** Move the origin to a layer's centre, turned and mirrored as the layer is. */
function place(ctx: Ctx, t: LayerTransform, pxPerMm: number, originX: number, originY: number) {
  ctx.translate(originX + t.centerXmm * pxPerMm, originY + t.centerYmm * pxPerMm);
  ctx.rotate((t.rotationDeg * Math.PI) / 180);
  ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
}

/** The part of the target that can show, in the context's current drawing units, or null if unknown. */
function visibleArea(ctx: Ctx) {
  const inverse = ctx.getTransform().inverse();
  const { width, height } = ctx.canvas;
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([x, y]) => inverse.transformPoint(new DOMPoint(x, y)));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const area = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  return Object.values(area).every(Number.isFinite) ? area : null;
}

/** Largest scratch canvas a clipping run uses (a full 300 dpi chest print fits); past it, it is drawn a little coarser. */
const MAX_CLIP_AREA = 2.8e7;

type PlacedDraw = (ctx: Ctx, layer: ArtworkLayer, t: LayerTransform, originX: number, originY: number) => boolean;
type Clipped = { layer: ArtworkLayer; t: LayerTransform };

/**
 * Draw layers clipped to a base layer: each is drawn alone into a scratch canvas around the base,
 * cut to the base's ink (`drawMask`), then laid over the target by `composite` with its opacity
 * times the base's, as a clipping mask does. Returns false if an image was still loading.
 */
function drawClipped(ctx: Ctx, base: Clipped, clipped: Clipped[], pxPerMm: number, originX: number, originY: number, drawMask: PlacedDraw, drawLayer: PlacedDraw, composite: (ctx: Ctx, layer: ArtworkLayer) => void): boolean {
  const bleed = layerBleedMm(base.layer, false);
  const r = rotatedBounds(base.t);
  let x0 = originX + (r.x - bleed) * pxPerMm;
  let y0 = originY + (r.y - bleed) * pxPerMm;
  let x1 = originX + (r.x + r.width + bleed) * pxPerMm;
  let y1 = originY + (r.y + r.height + bleed) * pxPerMm;
  // Only what can show on the target is worth drawing.
  const view = visibleArea(ctx);
  if (view) {
    x0 = Math.max(x0, view.x0);
    y0 = Math.max(y0, view.y0);
    x1 = Math.min(x1, view.x1);
    y1 = Math.min(y1, view.y1);
  }
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  const W = Math.ceil(x1) - x0;
  const H = Math.ceil(y1) - y0;
  if (W < 1 || H < 1) return true;
  const k = Math.min(1, Math.sqrt(MAX_CLIP_AREA / (W * H)));
  const mask = makeCanvas(W * k, H * k);
  const m = mask.getContext('2d')!;
  m.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  let complete = drawMask(m, base.layer, base.t, originX, originY);
  const piece = makeCanvas(W * k, H * k);
  const p = piece.getContext('2d')!;
  for (const { layer, t } of clipped) {
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.globalCompositeOperation = 'source-over';
    p.clearRect(0, 0, piece.width, piece.height);
    p.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    complete = drawLayer(p, layer, t, originX, originY) && complete;
    p.setTransform(1, 0, 0, 1, 0, 0);
    p.globalCompositeOperation = 'destination-in';
    p.drawImage(mask, 0, 0);
    ctx.save();
    composite(ctx, layer);
    ctx.globalAlpha *= base.layer.style.opacity;
    ctx.drawImage(piece, x0, y0, W, H);
    ctx.restore();
  }
  release(mask);
  release(piece);
  return complete;
}

/**
 * Walk a stack bottom to top as clipping runs: each base layer is drawn, then anything clipped to it.
 * A hidden base hides what is clipped to it, as in other design tools.
 */
function drawRuns(ctx: Ctx, zone: LayerStack, pxPerMm: number, originX: number, originY: number, overrides: DrawZoneOptions['overrides'], drawMask: PlacedDraw, drawLayer: PlacedDraw, composite: (ctx: Ctx, layer: ArtworkLayer) => void): boolean {
  let complete = true;
  const at = (layer: ArtworkLayer): Clipped => ({ layer, t: overrides?.[layer.id] ? { ...layer.transform, ...overrides[layer.id] } : layer.transform });
  for (const run of clipRuns(zone)) {
    const base = zone.layers[run.id];
    if (!base?.visible) continue;
    const placed = at(base);
    ctx.save();
    composite(ctx, base);
    complete = drawLayer(ctx, base, placed.t, originX, originY) && complete;
    ctx.restore();
    const clipped = run.clipped.map((id) => zone.layers[id]).filter((l): l is ArtworkLayer => !!l?.visible);
    if (clipped.length) complete = drawClipped(ctx, placed, clipped.map(at), pxPerMm, originX, originY, drawMask, drawLayer, composite) && complete;
  }
  return complete;
}

/** Draw every visible layer of a zone. Returns false if any image was still loading. */
export function drawZone(ctx: Ctx, zone: LayerStack, opts: DrawZoneOptions): boolean {
  const { pxPerMm, originX = 0, originY = 0, overrides } = opts;
  const draw: PlacedDraw = (c, layer, t, ox, oy) => {
    c.save();
    place(c, t, pxPerMm, ox, oy);
    const ok = drawLayerContent(c, layer, t.widthMm * pxPerMm, t.heightMm * pxPerMm, pxPerMm, opts);
    c.restore();
    return ok;
  };
  return drawRuns(ctx, zone, pxPerMm, originX, originY, overrides, draw, draw, (c, layer) => {
    c.globalAlpha = layer.style.opacity;
    c.globalCompositeOperation = BLEND[layer.style.blendMode];
  });
}

// ---------------------------------------------------------------------------
// Print surface: how the ink sits on the fabric, for physically based 3D shading
// ---------------------------------------------------------------------------

/** How a print reads under light: relative height, roughness and metalness, 0–1. */
export interface InkLook {
  height: number;
  roughness: number;
  metal: number;
  /** Soft, rounded edges (puff ink spreads as it rises), in mm. */
  blurMm?: number;
  /** Satin-stitch thread ridges. */
  stitch?: boolean;
}

/** The ink each method lays down. Sublimation dyes the fibres and leaves the surface as it was. */
const METHOD_INK: Record<PrintMethod, InkLook | null> = {
  DTG: { height: 0.03, roughness: 0.9, metal: 0 },
  SCREEN_PRINT: { height: 0.16, roughness: 0.6, metal: 0 },
  DTF: { height: 0.2, roughness: 0.48, metal: 0 },
  HEAT_TRANSFER: { height: 0.14, roughness: 0.36, metal: 0 },
  PUFF_PRINT: { height: 1, roughness: 0.74, metal: 0, blurMm: 0.9 },
  EMBROIDERY: { height: 0.72, roughness: 0.42, metal: 0, stitch: true },
  SUBLIMATION: null,
};

export function inkLook(method: PrintMethod, finish: LayerStyle['finish']): InkLook | null {
  if (finish === 'puff') return METHOD_INK.PUFF_PRINT;
  if (finish === 'embroidery') return METHOD_INK.EMBROIDERY;
  const base = METHOD_INK[method];
  if (finish === 'metallic') return { height: Math.max(0.1, base?.height ?? 0.1), roughness: 0.2, metal: 0.92 };
  return base;
}

const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** Thread crowns for satin stitches, encoded as height over a constant thread roughness. */
function stitchTile(look: InkLook, pxPerMm: number) {
  // Satin columns about 1.8 mm apart: each thread rounds up to a glossy crown and dips into
  // a matte groove, which is what makes embroidery catch the light in rows.
  const period = Math.max(5, Math.round(1.8 * pxPerMm));
  const tile = makeCanvas(period, 1);
  const t = tile.getContext('2d')!;
  const img = t.createImageData(period, 1);
  for (let x = 0; x < period; x++) {
    const crown = Math.sin((Math.PI * (x + 0.5)) / period) ** 0.7;
    img.data[x * 4] = byte(look.height * (0.18 + 0.82 * crown));
    img.data[x * 4 + 1] = byte(Math.min(1, look.roughness + (1 - crown) * 0.3));
    img.data[x * 4 + 2] = byte(look.metal);
    img.data[x * 4 + 3] = 255;
  }
  t.putImageData(img, 0, 0);
  return tile;
}

/** A layer's printed coverage (with any wear, cracks and text shadow), layer-local with bleed. */
function coverage(layer: ArtworkLayer, w: number, h: number, pxPerMm: number): { canvas: HTMLCanvasElement; bleed: number } | null {
  if (needsEffectPass(layer, false)) return renderEffects(layer, w, h, pxPerMm, false);
  const bleed = bleedPx(layer, pxPerMm, false);
  const canvas = makeCanvas(Math.ceil(w) + 2 * bleed, Math.ceil(h) + 2 * bleed);
  const c = canvas.getContext('2d')!;
  c.translate(bleed + w / 2, bleed + h / 2);
  return drawRaw(c, layer, w, h, pxPerMm) ? { canvas, bleed } : null;
}

export interface SurfaceDrawOptions {
  pxPerMm: number;
  originX?: number;
  originY?: number;
  overrides?: Record<string, Partial<LayerTransform>>;
  method: PrintMethod;
}

/**
 * Paint a zone's print surface into a material map: red is ink height (for bump), green is
 * roughness, blue is metalness, all linear 0–1. The canvas should already hold the bare fabric.
 * Returns false if any image was still loading.
 */
export function drawZoneSurface(ctx: CanvasRenderingContext2D, zone: LayerStack, opts: SurfaceDrawOptions): boolean {
  const { pxPerMm, originX = 0, originY = 0, overrides } = opts;
  // Where a layer's ink is, whatever it is made of (what clipped layers are cut to).
  const drawCoverage: PlacedDraw = (c, layer, t, ox, oy) => {
    const w = t.widthMm * pxPerMm;
    const h = t.heightMm * pxPerMm;
    const cov = coverage(layer, w, h, pxPerMm);
    if (!cov) return false;
    c.save();
    place(c, t, pxPerMm, ox, oy);
    c.drawImage(cov.canvas, -w / 2 - cov.bleed, -h / 2 - cov.bleed);
    c.restore();
    return true;
  };
  // The ink's material values over its coverage.
  const drawInk: PlacedDraw = (c, layer, t, ox, oy) => {
    const look = inkLook(opts.method, layer.style.finish);
    if (!look) return true;
    const w = t.widthMm * pxPerMm;
    const h = t.heightMm * pxPerMm;
    const cov = coverage(layer, w, h, pxPerMm);
    if (!cov) return false;
    const tinted = makeCanvas(cov.canvas.width, cov.canvas.height);
    const tc = tinted.getContext('2d')!;
    tc.drawImage(cov.canvas, 0, 0);
    tc.globalCompositeOperation = 'source-in';
    if (look.stitch) {
      const pattern = tc.createPattern(stitchTile(look, pxPerMm), 'repeat');
      pattern?.setTransform(new DOMMatrix().rotate(-38));
      tc.fillStyle = pattern ?? `rgb(${byte(look.height)}, ${byte(look.roughness)}, ${byte(look.metal)})`;
    } else {
      tc.fillStyle = `rgb(${byte(look.height)}, ${byte(look.roughness)}, ${byte(look.metal)})`;
    }
    tc.fillRect(0, 0, tinted.width, tinted.height);
    c.save();
    place(c, t, pxPerMm, ox, oy);
    if (look.blurMm) c.filter = `blur(${(look.blurMm * pxPerMm).toFixed(2)}px)`;
    c.drawImage(tinted, -w / 2 - cov.bleed, -h / 2 - cov.bleed);
    c.restore();
    release(tinted);
    return true;
  };
  return drawRuns(ctx, zone, pxPerMm, originX, originY, overrides, drawCoverage, drawInk, (c, layer) => {
    c.globalAlpha = layer.style.opacity;
  });
}

/**
 * A layer's own artwork, without effects, centred in a canvas padded by `padPx` on every side: what
 * sticker outlines are traced round and halftones are screened from. Null while an image loads.
 */
export function renderRawLayer(layer: ArtworkLayer, pxPerMm: number, padPx: number): HTMLCanvasElement | null {
  const w = layer.transform.widthMm * pxPerMm;
  const h = layer.transform.heightMm * pxPerMm;
  const canvas = makeCanvas(Math.ceil(w) + 2 * padPx, Math.ceil(h) + 2 * padPx);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.translate(padPx + w / 2, padPx + h / 2);
  return drawRaw(ctx, layer, w, h, pxPerMm) ? canvas : null;
}

/** Whether the 2D editor must draw an image layer through the renderer rather than show the decoded file. */
export function imageNeedsBitmap(layer: ArtworkLayer) {
  // A crop, a crop shape, a repeat or any effect is drawn by the renderer; a plain image shows its own pixels.
  return layer.content.kind === 'image' && (!!layer.content.repeat || !!layer.content.mask || !!layer.content.crop || needsEffectPass(layer));
}

/**
 * Bitmap of a single layer for the 2D editor's Fabric objects. The canvas is the layer box plus
 * `bleed` px on every side, so outlines and shadows that reach past the box are not clipped.
 */
export function renderLayerBitmap(layer: ArtworkLayer, pxPerMm: number, opts: LayerDrawOptions = {}): { canvas: HTMLCanvasElement; bleed: number } {
  const w = Math.max(1, Math.round(layer.transform.widthMm * pxPerMm));
  const h = Math.max(1, Math.round(layer.transform.heightMm * pxPerMm));
  const bleed = bleedPx(layer, pxPerMm, !!opts.simulateFinish);
  const canvas = makeCanvas(w + 2 * bleed, h + 2 * bleed);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(bleed + w / 2, bleed + h / 2);
  drawLayerContent(ctx, layer, w, h, pxPerMm, opts);
  return { canvas, bleed };
}

export const MAX_EXPORT_SIDE = 8192;

/** Isolated print artwork for one zone: transparent background, true physical size. */
export function renderZoneArtwork(zone: LayerStack, widthMm: number, heightMm: number, dpi: number) {
  let pxPerMm = dpi / 25.4;
  const longest = Math.max(widthMm, heightMm) * pxPerMm;
  let effectiveDpi = dpi;
  if (longest > MAX_EXPORT_SIDE) {
    pxPerMm = MAX_EXPORT_SIDE / Math.max(widthMm, heightMm);
    effectiveDpi = Math.floor(pxPerMm * 25.4);
  }
  const canvas = makeCanvas(1, 1);
  canvas.width = Math.max(1, Math.round(widthMm * pxPerMm));
  canvas.height = Math.max(1, Math.round(heightMm * pxPerMm));
  const ctx = canvas.getContext('2d')!;
  drawZone(ctx, zone, { pxPerMm });
  return { canvas, dpi: effectiveDpi };
}

/**
 * Resolve once every font used by text layers is ready: uploaded fonts are registered from this
 * device's font library, catalogue fonts load their stylesheet, and each face loads the glyphs
 * the text actually uses (so Khmer and Chinese subsets arrive). Returns true if anything loaded.
 */
export async function ensureFonts(zones: LayerStack[]): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const families = new Set<string>();
  const uploaded = new Set<string>();
  const wanted = new Map<string, string>();
  for (const zone of zones) {
    for (const layer of deepLayers(zone)) {
      const c = layer.content;
      if (c.kind !== 'text') continue;
      if (c.fontAssetId) uploaded.add(c.fontAssetId);
      else families.add(c.fontFamily);
      for (const fallback of scriptFallbacks(c.value)) families.add(fallback);
      const font = fontString(c, 40);
      wanted.set(font, (wanted.get(font) ?? '') + c.value);
    }
  }
  let loaded = false;
  if (uploaded.size) loaded = (await ensureCustomFonts([...uploaded])) || loaded;
  if (families.size) await loadFontStylesheets([...families]);
  const sample = (text: string) => Array.from(new Set(Array.from(text.replace(/\s+/g, '')))).join('') || ' ';
  const pending = [...wanted].filter(([font, text]) => !document.fonts.check(font, sample(text)));
  if (pending.length) {
    await Promise.all(pending.map(([font, text]) => document.fonts.load(font, sample(text)).catch(() => undefined)));
    loaded = true;
  }
  // Newly loaded faces change glyph metrics, so layouts measured with a fallback font are stale.
  if (loaded) clearTextLayoutCache();
  return loaded;
}
