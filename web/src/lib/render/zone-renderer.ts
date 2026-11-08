/**
 * Canonical Canvas 2D renderer. The single implementation that turns layers into pixels,
 * used by the 2D editor (per-layer bitmaps), the 3D garment textures and print exports, so
 * all three always agree (spec §27, EXP-04).
 */
import type { ArtworkLayer, LayerTransform, ShapeContent, TextContent, ZoneDesign } from '@/domain/schema';
import { getLoadedImage } from '@/lib/assets';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const TEXT_REF_PX = 200;

export function fontString(c: Pick<TextContent, 'italic' | 'fontWeight' | 'fontFamily'>, px: number) {
  return `${c.italic ? 'italic ' : ''}${c.fontWeight} ${px}px "${c.fontFamily}", "Noto Sans Khmer", "Noto Sans SC", sans-serif`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer() {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  return measureCtx!;
}

function setLetterSpacing(ctx: Ctx, px: number) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D).letterSpacing = `${px}px`;
}

/** Split into user-perceived characters so combining marks (Khmer, accents) stay on their base letter. */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

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
}

export function isCurved(c: Pick<TextContent, 'curveDeg' | 'value'>) {
  return Math.abs(c.curveDeg) >= 0.5 && !c.value.includes('\n') && c.value.length > 0;
}

const layoutCache = new Map<string, TextLayout>();

export function layoutText(c: TextContent): TextLayout {
  const key = JSON.stringify([c.value, c.fontFamily, c.fontWeight, c.italic, c.letterSpacingEm, c.lineHeight, isCurved(c) ? c.curveDeg : 0]);
  const cached = layoutCache.get(key);
  if (cached) return cached;
  const ctx = measurer();
  ctx.save();
  ctx.font = fontString(c, TEXT_REF_PX);
  const lineH = TEXT_REF_PX * c.lineHeight;
  let layout: TextLayout;

  if (isCurved(c)) {
    setLetterSpacing(ctx, 0);
    const spacing = c.letterSpacingEm * TEXT_REF_PX;
    const gs = graphemes(c.value);
    const widths = gs.map((g) => Math.max(1, ctx.measureText(g).width));
    const length = widths.reduce((a, b) => a + b, 0) + spacing * (gs.length - 1);
    const theta = (c.curveDeg * Math.PI) / 180;
    const radius = length / Math.abs(theta);
    const up = theta > 0;
    let s = -length / 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const glyphs = gs.map((g, i) => {
      const mid = s + widths[i] / 2;
      s += widths[i] + spacing;
      const phi = mid / radius;
      const x = radius * Math.sin(phi);
      const y = (up ? 1 : -1) * radius * (1 - Math.cos(phi));
      const rot = up ? phi : -phi;
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

/** Forget measured layouts, e.g. after a web font finishes loading and metrics change. */
export function clearTextLayoutCache() {
  layoutCache.clear();
}

/** Box aspect (width / height) that shows the text undistorted, straight or curved. */
export function textAspect(c: TextContent) {
  const m = layoutText(c);
  return m.width / m.height;
}

function drawText(ctx: Ctx, c: TextContent, w: number, h: number, pxPerMm: number) {
  const m = layoutText(c);
  const scaleY = h / m.height;
  ctx.save();
  ctx.scale(w / m.width, scaleY);
  ctx.translate(-m.cx, -m.cy);
  ctx.font = fontString(c, TEXT_REF_PX);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // The stroke is centred on the glyph edge and the fill covers its inner half,
  // so draw it twice as wide to show the requested outline width outside the letter.
  const stroke = c.strokeColor && c.strokeWidthMm ? { color: c.strokeColor, width: (c.strokeWidthMm * pxPerMm * 2) / scaleY } : null;

  if (m.glyphs) {
    setLetterSpacing(ctx, 0);
    ctx.textAlign = 'center';
    for (const pass of stroke ? ['stroke', 'fill'] : ['fill']) {
      for (const glyph of m.glyphs) {
        ctx.save();
        ctx.translate(glyph.x, glyph.y);
        ctx.rotate(glyph.rot);
        if (pass === 'stroke' && stroke) {
          ctx.strokeStyle = stroke.color;
          ctx.lineWidth = stroke.width;
          ctx.strokeText(glyph.g, 0, 0);
        } else {
          ctx.fillStyle = c.fill;
          ctx.fillText(glyph.g, 0, 0);
        }
        ctx.restore();
      }
    }
  } else {
    setLetterSpacing(ctx, c.letterSpacingEm * TEXT_REF_PX);
    ctx.textAlign = c.align;
    const x = c.align === 'left' ? -m.width / 2 : c.align === 'right' ? m.width / 2 : 0;
    const lineH = TEXT_REF_PX * c.lineHeight;
    m.lines.forEach((line, i) => {
      const y = -m.height / 2 + lineH * (i + 0.5);
      if (stroke) {
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.strokeText(line, x, y);
      }
      ctx.fillStyle = c.fill;
      ctx.fillText(line, x, y);
    });
  }
  ctx.restore();
}

function drawShape(ctx: Ctx, c: ShapeContent, w: number, h: number, pxPerMm: number) {
  ctx.beginPath();
  if (c.shape === 'rect') {
    const r = Math.min(c.cornerRadiusMm * pxPerMm, w / 2, h / 2);
    if ('roundRect' in ctx && r > 0) ctx.roundRect(-w / 2, -h / 2, w, h, r);
    else ctx.rect(-w / 2, -h / 2, w, h);
  } else if (c.shape === 'ellipse') {
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w / 2, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
  }
  ctx.fillStyle = c.fill;
  ctx.fill();
  if (c.strokeColor && c.strokeWidthMm) {
    ctx.strokeStyle = c.strokeColor;
    ctx.lineWidth = c.strokeWidthMm * pxPerMm;
    ctx.stroke();
  }
}

const BLEND: Record<ArtworkLayer['style']['blendMode'], GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
};

/**
 * Draw one layer's content centred on the current origin, `w` × `h` px, without its position.
 * Returns false when an image isn't decoded yet (callers re-render once it loads).
 */
export function drawLayerContent(ctx: Ctx, layer: ArtworkLayer, w: number, h: number, pxPerMm: number): boolean {
  const c = layer.content;
  if (c.kind === 'image') {
    const img = getLoadedImage(c.assetId);
    if (!img) return false;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    return true;
  }
  if (c.kind === 'text') drawText(ctx, c, w, h, pxPerMm);
  else drawShape(ctx, c, w, h, pxPerMm);
  return true;
}

export interface DrawZoneOptions {
  pxPerMm: number;
  /** Pixel position of the zone's (0, 0) mm corner. */
  originX?: number;
  originY?: number;
  /** Live transforms during a drag, so previews follow the pointer before the command commits. */
  overrides?: Record<string, Partial<LayerTransform>>;
}

/** Draw every visible layer of a zone. Returns false if any image was still loading. */
export function drawZone(ctx: Ctx, zone: ZoneDesign, opts: DrawZoneOptions): boolean {
  let complete = true;
  const { pxPerMm, originX = 0, originY = 0, overrides } = opts;
  for (const id of zone.orderedLayerIds) {
    const layer = zone.layers[id];
    if (!layer || !layer.visible) continue;
    const t = overrides?.[id] ? { ...layer.transform, ...overrides[id] } : layer.transform;
    ctx.save();
    ctx.globalAlpha = layer.style.opacity;
    ctx.globalCompositeOperation = BLEND[layer.style.blendMode];
    ctx.translate(originX + t.centerXmm * pxPerMm, originY + t.centerYmm * pxPerMm);
    ctx.rotate((t.rotationDeg * Math.PI) / 180);
    ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
    complete = drawLayerContent(ctx, layer, t.widthMm * pxPerMm, t.heightMm * pxPerMm, pxPerMm) && complete;
    ctx.restore();
  }
  return complete;
}

/** Bitmap of a single layer at a given pixel size, for the 2D editor's Fabric objects. */
export function renderLayerBitmap(layer: ArtworkLayer, pxPerMm: number, target?: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = target ?? document.createElement('canvas');
  const w = Math.max(1, Math.round(layer.transform.widthMm * pxPerMm));
  const h = Math.max(1, Math.round(layer.transform.heightMm * pxPerMm));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  drawLayerContent(ctx, layer, w, h, pxPerMm);
  ctx.restore();
  return canvas;
}

export const MAX_EXPORT_SIDE = 8192;

/** Isolated print artwork for one zone: transparent background, true physical size. */
export function renderZoneArtwork(zone: ZoneDesign, widthMm: number, heightMm: number, dpi: number) {
  let pxPerMm = dpi / 25.4;
  const longest = Math.max(widthMm, heightMm) * pxPerMm;
  let effectiveDpi = dpi;
  if (longest > MAX_EXPORT_SIDE) {
    pxPerMm = MAX_EXPORT_SIDE / Math.max(widthMm, heightMm);
    effectiveDpi = Math.floor(pxPerMm * 25.4);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(widthMm * pxPerMm);
  canvas.height = Math.round(heightMm * pxPerMm);
  const ctx = canvas.getContext('2d')!;
  drawZone(ctx, zone, { pxPerMm });
  return { canvas, dpi: effectiveDpi };
}

/** Resolve once every font used by text layers is ready. Returns true if any font had to load. */
export async function ensureFonts(zones: ZoneDesign[]): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const wanted = new Set<string>();
  for (const zone of zones) {
    for (const layer of Object.values(zone.layers)) {
      if (layer.content.kind === 'text') wanted.add(fontString(layer.content, 40));
    }
  }
  const pending = [...wanted].filter((f) => !document.fonts.check(f));
  if (!pending.length) return false;
  await Promise.all(pending.map((f) => document.fonts.load(f).catch(() => undefined)));
  // Newly loaded faces change glyph metrics, so layouts measured with a fallback font are stale.
  clearTextLayoutCache();
  return true;
}
