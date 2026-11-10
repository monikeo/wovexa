/**
 * Print artwork as SVG, for print shops and cutters that work in vector (screen print films,
 * vinyl, embroidery digitising, Illustrator or Inkscape). The same print area at true size, in
 * millimetres, as the PNG print file:
 * - text stays live text (laid out exactly as WOVEXA lays it out, curves and waves included),
 * - shapes and library graphics are paths, their outlines true to size,
 * - gradient fills stay gradients; pattern fills repeat a tile,
 * - sticker outlines are traced paths (with a separate cut file of their edges for cutters), and
 *   halftones are one circle or rectangle a dot, ready for films,
 * - photos, image repeats and raster effects (distress, cracked ink, shadows) are placed as
 *   images at print resolution, exactly where the PNG puts them,
 * - a layer clipped to the one below is masked by that layer's own shape (vector when it is),
 * - a lockup placement is its lockup's own layers, written the same way, in a scaled group.
 * Browser only (it measures text and draws raster parts on a canvas).
 */
import { clipBases } from '@/domain/clipping';
import { graphemes, letterInks } from '@/domain/letter-colors';
import { shapePathData, transformPathData } from '@/domain/shape-path';
import type { ArtworkLayer, FillStyle, LayerHalftone, LayerStack, LockupContent, ShapeContent, TextContent } from '@/domain/schema';
import { ringArea, ringsPath, simplifyRing, traceContours } from '@/lib/render/trace';
import {
  distanceField,
  effectiveDistress,
  halftoneMarks,
  halftoneMarkSize,
  layerBleedMm,
  layerShadow,
  layoutText,
  lineWidthMm,
  MAX_EXPORT_SIDE,
  needsEffectPass,
  patternTile,
  renderLayerBitmap,
  renderRawLayer,
  TEXT_REF_PX,
} from '@/lib/render/zone-renderer';

/** An SVG print file and what a print shop should know about it. */
export interface SvgArtwork {
  svg: string;
  /** Font families its live text uses: install them, or outline the text, before printing. */
  fonts: string[];
  /** Layers placed as images (photos, repeats, raster effects), by name. */
  rasterLayers: string[];
  /** A matching cut file when layers have sticker outlines: their edges as one hairline for a cutter. */
  cut?: string;
}

const n = (x: number) => String(Math.round(x * 1000) / 1000);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** SVG `matrix()` of a DOMMatrix. */
const matrix = (m: DOMMatrix) => `matrix(${n(m.a)} ${n(m.b)} ${n(m.c)} ${n(m.d)} ${n(m.e)} ${n(m.f)})`;

// Shapes as path data live with the domain, for the editor too; re-exported for the print files.
export { shapePathData, transformPathData };

/** Collects gradients and pattern tiles into one <defs>. */
export class Defs {
  private items: string[] = [];
  private count = 0;
  constructor(private readonly ppmTile: number) {}
  get svg() {
    return this.items.length ? `<defs>${this.items.join('')}</defs>` : '';
  }
  /** A luminance mask over `area` (drawing millimetres): white artwork shows what it masks. Returns its id. */
  mask(content: string, area: { x: number; y: number; width: number; height: number }): string {
    const id = `m${++this.count}`;
    this.items.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${n(area.x)}" y="${n(area.y)}" width="${n(area.width)}" height="${n(area.height)}">${content}</mask>`);
    return id;
  }
  /**
   * A fill as SVG: a colour, or a url() to a gradient or pattern laid out in the layer box (mm,
   * origin at its centre), mapped into the drawing space by `toUser` when that differs (text).
   */
  paint(base: string, style: FillStyle | undefined, w: number, h: number, toUser?: DOMMatrix): string {
    if (!style) return esc(base);
    const id = `p${++this.count}`;
    const tf = toUser ? matrix(toUser) : '';
    if (style.kind === 'gradient') {
      const stops = `<stop offset="0" stop-color="${esc(base)}"/>${style.via ? `<stop offset="0.5" stop-color="${esc(style.via)}"/>` : ''}<stop offset="1" stop-color="${esc(style.to)}"/>`;
      const transform = tf ? ` gradientTransform="${tf}"` : '';
      if (style.radial) {
        this.items.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${n(Math.hypot(w, h) / 2)}"${transform}>${stops}</radialGradient>`);
        return `url(#${id})`;
      }
      const a = (style.angleDeg * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const L = (Math.abs(w * cos) + Math.abs(h * sin)) / 2;
      this.items.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(-L * cos)}" y1="${n(-L * sin)}" x2="${n(L * cos)}" y2="${n(L * sin)}"${transform}>${stops}</linearGradient>`);
      return `url(#${id})`;
    }
    // A pattern repeats one tile, drawn at print resolution.
    const period = Math.max(0.5, style.scaleMm);
    const size = Math.max(8, Math.min(1024, Math.round(period * this.ppmTile)));
    const href = patternTile(style, base, size).toDataURL('image/png');
    this.items.push(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${n(period)}" height="${n(period)}" patternTransform="${tf ? `${tf} ` : ''}rotate(${n(style.angleDeg)})"><image href="${href}" width="${n(period)}" height="${n(period)}" preserveAspectRatio="none"/></pattern>`,
    );
    return `url(#${id})`;
  }
}

function fontFamily(c: TextContent) {
  return `'${c.fontFamily.replace(/'/g, '')}', 'Noto Sans Khmer', 'Noto Sans KR', 'Noto Sans SC', sans-serif`;
}

/** Text as live SVG text, laid out by WOVEXA's own layout and scaled to its box like the renderer does. */
function textSvg(c: TextContent, w: number, h: number, defs: Defs): string {
  const m = layoutText(c);
  if (!m.width || !m.height) return '';
  const sx = w / m.width;
  const sy = h / m.height;
  // Box space (mm, origin at its centre) → this scaled text space.
  const toText = new DOMMatrix([1 / sx, 0, 0, 1 / sy, m.cx, m.cy]);
  const font = `font-family="${esc(fontFamily(c))}" font-size="${TEXT_REF_PX}" font-weight="${c.fontWeight}"${c.italic ? ' font-style="italic"' : ''}`;
  // An outline sits outside the letter: twice as wide, painted under the fill.
  const stroke = !c.hollow && c.strokeColor && c.strokeWidthMm ? ` stroke="${esc(c.strokeColor)}" stroke-width="${n((c.strokeWidthMm * 2) / sy)}" stroke-linejoin="round" paint-order="stroke"` : '';
  // Outline only: the letters as lines painted with the fill, centred on the glyph edge.
  const ink = (paint: string) => (c.hollow ? `fill="none" stroke="${paint}" stroke-width="${n(lineWidthMm(c) / sy)}" stroke-linejoin="round"` : `fill="${paint}"${stroke}`);
  // Letter colours: each letter painted in its own (the outline, if any, stays one colour).
  const inks = c.letterColors?.length ? letterInks(m.glyphs ? [c.value] : m.lines, c.letterColors) : null;
  const letter = (g: string, color: string | null | undefined) => (color ? `<tspan ${c.hollow ? 'stroke' : 'fill'}="${esc(color)}">${esc(g)}</tspan>` : esc(g));
  const parts: string[] = [];
  if (m.glyphs) {
    m.glyphs.forEach((g, i) => {
      // Gradients and patterns stay anchored to the layer, not to each turned letter.
      const fill = inks ? esc(inks[0][i] ?? c.fill) : c.fillStyle ? defs.paint(c.fill, c.fillStyle, w, h, new DOMMatrix().rotate((-g.rot * 180) / Math.PI).translate(-g.x, -g.y).multiply(toText)) : esc(c.fill);
      parts.push(`<text transform="translate(${n(g.x)} ${n(g.y)}) rotate(${n((g.rot * 180) / Math.PI)})" text-anchor="middle" dominant-baseline="central" ${ink(fill)}>${esc(g.g)}</text>`);
    });
  } else {
    const fill = inks ? esc(c.fill) : defs.paint(c.fill, c.fillStyle, w, h, toText);
    const anchor = c.align === 'left' ? 'start' : c.align === 'right' ? 'end' : 'middle';
    const x = c.align === 'left' ? -m.width / 2 : c.align === 'right' ? m.width / 2 : 0;
    const lineH = TEXT_REF_PX * c.lineHeight;
    const spacing = c.letterSpacingEm ? ` letter-spacing="${n(c.letterSpacingEm * TEXT_REF_PX)}"` : '';
    m.lines.forEach((line, i) => {
      const y = -m.height / 2 + lineH * (i + 0.5);
      const body = inks ? graphemes(line).map((g, k) => letter(g, inks[i][k])).join('') : esc(line);
      parts.push(`<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" dominant-baseline="central" ${ink(fill)}${spacing} xml:space="preserve">${body}</text>`);
    });
  }
  return `<g transform="scale(${n(sx)} ${n(sy)}) translate(${n(-m.cx)} ${n(-m.cy)})" ${font}>${parts.join('')}</g>`;
}

export function shapeSvg(c: ShapeContent, w: number, h: number, defs: Defs): string {
  const d = shapePathData(c, w, h);
  if (!d) return '';
  // Outline only: the shape as a line painted with its fill.
  if (c.hollow) return `<path d="${d}" fill="none" stroke="${defs.paint(c.fill, c.fillStyle, w, h)}" stroke-width="${n(lineWidthMm(c))}" stroke-linejoin="round"/>`;
  const stroke = c.strokeColor && c.strokeWidthMm ? ` stroke="${esc(c.strokeColor)}" stroke-width="${n(c.strokeWidthMm)}" stroke-linejoin="round"` : '';
  return `<path d="${d}" fill="${defs.paint(c.fill, c.fillStyle, w, h)}"${c.shape === 'path' ? ' fill-rule="evenodd"' : ''}${stroke}/>`;
}

/**
 * A layer drawn as pixels at print resolution (with its effects, or `raw` without them), placed over
 * its box and bleed. As a `silhouette`, its ink is all white: a mask of where it prints.
 */
function rasterSvg(layer: ArtworkLayer, dpiPxPerMm: number, silhouette = false, raw = false): string | null {
  // As the PNG print file does, a very large layer is drawn a little coarser rather than past what a canvas holds.
  const pxPerMm = Math.min(dpiPxPerMm, MAX_EXPORT_SIDE / Math.max(layer.transform.widthMm, layer.transform.heightMm, 1));
  const rawPad = Math.ceil(layerBleedMm(layer) * pxPerMm);
  const rawCanvas = raw ? renderRawLayer(layer, pxPerMm, rawPad) : null;
  const { canvas, bleed } = raw ? { canvas: rawCanvas, bleed: rawPad } : renderLayerBitmap(layer, pxPerMm);
  if (!canvas?.width || !canvas.height) return null;
  if (silhouette) {
    const c = canvas.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, canvas.width, canvas.height);
  }
  const w = layer.transform.widthMm;
  const h = layer.transform.heightMm;
  const b = bleed / pxPerMm;
  return `<image href="${canvas.toDataURL('image/png')}" x="${n(-w / 2 - b)}" y="${n(-h / 2 - b)}" width="${n(w + 2 * b)}" height="${n(h + 2 * b)}" preserveAspectRatio="none"/>`;
}

/** Whether a layer can be written as vector (text and shapes without raster effects). */
export function isVectorLayer(layer: ArtworkLayer): boolean {
  return layer.content.kind !== 'image' && !needsEffectPass(layer, false);
}

/**
 * Whether a layer's effects can all be written as vector: a sticker outline (a traced path) and a
 * halftone (one shape a dot). Wear, cracks and shadows still need pixels.
 */
export function hasVectorEffects(layer: ArtworkLayer): boolean {
  const s = layer.style;
  return (!!s.outline || !!s.halftone) && !effectiveDistress(layer) && s.finish !== 'cracked' && !layerShadow(layer);
}

/** Finest detail a traced outline keeps, and how far a traced point may stray from the true edge, in mm. */
const TRACE_MM = 0.1;
const TRACE_TOLERANCE_MM = 0.04;

/**
 * A layer's sticker outline as vector path data in its own box (mm, origin at its centre): the
 * silhouette grown by the outline width, traced from the same distance field the renderer draws.
 */
export function outlinePath(layer: ArtworkLayer): string | null {
  const outline = layer.style.outline;
  if (!outline) return null;
  const t = layer.transform;
  const padMm = layerBleedMm(layer) + 1;
  // About 0.1 mm a pixel, coarser for very large layers so the grid stays under 2400 px a side.
  const ppm = Math.max(2, Math.min(1 / TRACE_MM, 2400 / (Math.max(t.widthMm, t.heightMm) + 2 * padMm)));
  const pad = Math.ceil(padMm * ppm);
  const canvas = renderRawLayer(layer, ppm, pad);
  if (!canvas) return null;
  const W = canvas.width;
  const H = canvas.height;
  const alpha = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const d2 = distanceField((i) => alpha[i * 4 + 3] > 24, W, H);
  const r = outline.widthMm * ppm;
  const field = new Float32Array(W * H);
  for (let i = 0; i < field.length; i++) field[i] = r - Math.sqrt(d2[i]);
  const rings = traceContours(field, W, H)
    .map((ring) => simplifyRing(ring, TRACE_TOLERANCE_MM * ppm))
    // Specks smaller than a cutter's blade can follow are noise.
    .filter((ring) => ring.length >= 3 && ringArea(ring) / (ppm * ppm) > 0.05);
  if (!rings.length) return null;
  const cx = pad + (t.widthMm * ppm) / 2;
  const cy = pad + (t.heightMm * ppm) / 2;
  return ringsPath(rings, ([x, y]) => [(x - cx) / ppm, (y - cy) / ppm]);
}

/** A halftone as vector marks in the layer's box: dots as circles, squares and lines as rectangles, one group a colour. */
function halftoneSvg(layer: ArtworkLayer, ht: LayerHalftone): string | null {
  const t = layer.transform;
  // About four pixels a cell is plenty to weigh each cell's ink; very large layers stay under 4096 px a side.
  const ppm = Math.max(2, Math.min(4 / ht.cellMm, 4096 / Math.max(t.widthMm, t.heightMm)));
  const pad = Math.ceil(layerBleedMm(layer) * ppm);
  const canvas = renderRawLayer(layer, ppm, pad);
  if (!canvas) return null;
  const { cell, marks } = halftoneMarks(canvas, ht, ppm);
  // Marks are placed about the canvas centre, which is the layer's centre (the padding is even).
  const groups = new Map<string, string[]>();
  for (const m of marks) {
    const s = halftoneMarkSize(ht.shape, cell, m.cover) / ppm;
    const x = m.x / ppm;
    const y = m.y / ppm;
    const c = cell / ppm;
    const mark =
      ht.shape === 'dot'
        ? `<circle cx="${n(x)}" cy="${n(y)}" r="${n(s)}"/>`
        : ht.shape === 'square'
          ? `<rect x="${n(x - s / 2)}" y="${n(y - s / 2)}" width="${n(s)}" height="${n(s)}"/>`
          : // Lines overlap their neighbours a hair, so a run of them shows no seams.
            `<rect x="${n(x - c / 2 - 0.01)}" y="${n(y - s / 2)}" width="${n(c + 0.02)}" height="${n(s)}"/>`;
    const list = groups.get(m.color);
    if (list) list.push(mark);
    else groups.set(m.color, [mark]);
  }
  release(canvas);
  if (!groups.size) return null;
  return `<g transform="rotate(${n(ht.angleDeg)})">${[...groups].map(([color, list]) => `<g fill="${esc(color)}">${list.join('')}</g>`).join('')}</g>`;
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

const BLEND: Record<ArtworkLayer['style']['blendMode'], string> = { normal: '', multiply: 'multiply', screen: 'screen', overlay: 'overlay' };

/** Where a layer sits: an SVG transform from its own box (mm, origin at the centre) to the drawing. */
function placement(layer: ArtworkLayer) {
  const t = layer.transform;
  const flip = t.flipX || t.flipY ? ` scale(${t.flipX ? -1 : 1} ${t.flipY ? -1 : 1})` : '';
  return `translate(${n(t.centerXmm)} ${n(t.centerYmm)}) rotate(${n(t.rotationDeg)})${flip}`;
}

/** Where a layer prints, in white, in its own box: its own text or path when it is vector. */
function silhouetteSvg(layer: ArtworkLayer, ppm: number, defs: Defs): string | null {
  const { widthMm: w, heightMm: h } = layer.transform;
  const c = layer.content;
  if (isVectorLayer(layer) && (c.kind === 'text' || c.kind === 'shape')) {
    const white = { ...c, fill: '#ffffff', fillStyle: undefined, letterColors: undefined, strokeColor: c.strokeColor ? '#ffffff' : undefined };
    return white.kind === 'text' ? textSvg(white, w, h, defs) : shapeSvg(white, w, h, defs);
  }
  return rasterSvg(layer, ppm, true);
}

/** What writing a print file gathers as it goes: shared paints and masks, fonts, the parts placed as pixels, cut lines. */
interface SvgBuild {
  ppm: number;
  defs: Defs;
  fonts: Set<string>;
  rasterLayers: string[];
  vectorEffects: string[];
  cuts: string[];
}

/**
 * A lockup placement as vector (spec ED2-12): the lockup's own layers in a group scaled from its
 * board into the `w` × `h` box. `outer` is the transform down to the box, for cut lines.
 */
function lockupSvg(layer: ArtworkLayer & { content: LockupContent }, w: number, h: number, b: SvgBuild, outer: string): string {
  const c = layer.content;
  const inner = `translate(${n(-w / 2)} ${n(-h / 2)}) scale(${n(w / c.widthMm)} ${n(h / c.heightMm)})`;
  return `<g transform="${inner}">${stackSvg(c, c.widthMm, c.heightMm, b, { cutPrefix: `${outer}${inner} `, idPrefix: `${layer.id}-`, namePrefix: `${c.name}: ` }).join('')}</g>`;
}

/** The layers of a stack as SVG elements, bottom first, each placed on the stack's board. */
function stackSvg(zone: LayerStack, widthMm: number, heightMm: number, b: SvgBuild, nest: { cutPrefix: string; idPrefix: string; namePrefix: string } = { cutPrefix: '', idPrefix: '', namePrefix: '' }): string[] {
  const { ppm, defs, fonts, rasterLayers, vectorEffects, cuts } = b;
  const body: string[] = [];
  const bases = clipBases(zone);
  const masks = new Map<string, string | null>();
  // A clipped layer is masked by its base's silhouette, made once per base.
  const maskOf = (base: ArtworkLayer) => {
    if (!masks.has(base.id)) {
      const shape = silhouetteSvg(base, ppm, defs);
      masks.set(base.id, shape ? defs.mask(`<g transform="${placement(base)}">${shape}</g>`, { x: -widthMm, y: -heightMm, width: widthMm * 3, height: heightMm * 3 }) : null);
    }
    return masks.get(base.id) ?? null;
  };
  for (const id of zone.orderedLayerIds) {
    const layer = zone.layers[id];
    if (!layer?.visible) continue;
    const base = bases[id] ? zone.layers[bases[id]] : undefined;
    // A hidden base hides what is clipped to it, as it does on screen and in the PNG.
    if (base && !base.visible) continue;
    const t = layer.transform;
    const w = t.widthMm;
    const h = t.heightMm;
    const label = `${nest.namePrefix}${layer.name}`;
    // The layer's own artwork as vector (text, shapes and lockups), or as pixels (photos, or `withEffects` raster ones).
    const own = (withEffects: boolean) => {
      if (layer.content.kind === 'text') {
        fonts.add(layer.content.fontFamily);
        return textSvg(layer.content, w, h, defs);
      }
      if (layer.content.kind === 'shape') return shapeSvg(layer.content, w, h, defs);
      if (layer.content.kind === 'lockup' && !withEffects) return lockupSvg(layer as ArtworkLayer & { content: LockupContent }, w, h, b, `${nest.cutPrefix}${placement(layer)} `);
      const pixels = rasterSvg(layer, ppm, false, !withEffects);
      if (pixels) rasterLayers.push(label);
      return pixels;
    };
    let content: string | null;
    if (isVectorLayer(layer)) content = own(false);
    else if (hasVectorEffects(layer)) {
      // A sticker outline as a traced path under the artwork (and its cut line for the cut file),
      // and a halftone as one shape a dot in place of the artwork.
      const outline = layer.style.outline ? outlinePath(layer) : null;
      if (outline) cuts.push(`<path transform="${nest.cutPrefix}${placement(layer)}" d="${outline}"/>`);
      const art = layer.style.halftone ? halftoneSvg(layer, layer.style.halftone) : own(false);
      content = [outline ? `<path d="${outline}" fill="${esc(layer.style.outline!.color)}" fill-rule="evenodd"/>` : '', art ?? ''].join('') || null;
      vectorEffects.push(label);
    } else {
      content = rasterSvg(layer, ppm);
      if (content) rasterLayers.push(label);
    }
    if (!content) continue;
    const alpha = layer.style.opacity * (base ? base.style.opacity : 1);
    const opacity = alpha < 1 ? ` opacity="${n(alpha)}"` : '';
    const blend = BLEND[layer.style.blendMode] ? ` style="mix-blend-mode:${BLEND[layer.style.blendMode]}"` : '';
    const name = `id="${esc(`layer-${nest.idPrefix}${layer.id}`)}" data-name="${esc(label)}"`;
    if (base) {
      const mask = maskOf(base);
      // A base with no ink shows nothing of what is clipped to it.
      if (mask) body.push(`<g ${name}${opacity}${blend}><g mask="url(#${mask})"><g transform="${placement(layer)}">${content}</g></g></g>`);
      continue;
    }
    body.push(`<g ${name} transform="${placement(layer)}"${opacity}${blend}>${content}</g>`);
  }
  return body;
}

/**
 * A zone's or design area's artwork as an SVG print file: `widthMm` × `heightMm` at true size.
 * Images and fonts must be loaded first (prepareDocument). `dpi` sets the resolution of the parts
 * placed as images.
 */
export function zoneSvg(zone: LayerStack, widthMm: number, heightMm: number, opts: { dpi: number; title: string }): SvgArtwork {
  const ppm = opts.dpi / 25.4;
  const build: SvgBuild = { ppm, defs: new Defs(ppm), fonts: new Set<string>(), rasterLayers: [], vectorEffects: [], cuts: [] };
  const body = stackSvg(zone, widthMm, heightMm, build);
  const { defs, fonts, rasterLayers, vectorEffects, cuts } = build;
  const desc = [
    `${n(widthMm)} × ${n(heightMm)} mm print area at true size (1 unit = 1 mm).`,
    fonts.size ? `Live text in: ${[...fonts].join(', ')}. Install these fonts or outline the text before printing.` : '',
    vectorEffects.length ? `Sticker outlines and halftones as vector shapes: ${vectorEffects.join(', ')}.` : '',
    rasterLayers.length ? `Placed as images at ${Math.round(opts.dpi)} dpi: ${rasterLayers.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const open = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(widthMm)}mm" height="${n(heightMm)}mm" viewBox="0 0 ${n(widthMm)} ${n(heightMm)}">`;
  const svg = `${open}<title>${esc(opts.title)}</title><desc>${esc(desc)}</desc>${defs.svg}${body.join('')}</svg>\n`;
  // The cut file: just the sticker outlines' edges, as the hairline a vinyl cutter or plotter follows.
  const cut = cuts.length
    ? `${open}<title>${esc(`${opts.title}, cut line`)}</title><desc>${esc(`Cut line at true size (1 unit = 1 mm) for a vinyl cutter, plotter or print-and-cut: the outer edge of each sticker outline. Line it up with the print file's top-left corner.`)}</desc><g id="CutContour" fill="none" stroke="#FF00FF" stroke-width="0.25" stroke-linejoin="round">${cuts.join('')}</g></svg>\n`
    : undefined;
  return { svg, fonts: [...fonts], rasterLayers, cut };
}
