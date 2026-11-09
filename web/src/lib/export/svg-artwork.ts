/**
 * Print artwork as SVG, for print shops and cutters that work in vector (screen print films,
 * vinyl, embroidery digitising, Illustrator or Inkscape). The same print area at true size, in
 * millimetres, as the PNG print file:
 * - text stays live text (laid out exactly as WOVEXA lays it out, curves and waves included),
 * - shapes and library graphics are paths, their outlines true to size,
 * - gradient fills stay gradients; pattern fills repeat a tile,
 * - photos, image repeats and raster effects (distress, cracked ink, text shadows) are placed as
 *   images at print resolution, exactly where the PNG puts them.
 * Browser only (it measures text and draws raster parts on a canvas).
 */
import type { ArtworkLayer, FillStyle, LayerStack, ShapeContent, TextContent } from '@/domain/schema';
import { layoutText, MAX_EXPORT_SIDE, needsEffectPass, patternTile, renderLayerBitmap, TEXT_REF_PX } from '@/lib/render/zone-renderer';

/** An SVG print file and what a print shop should know about it. */
export interface SvgArtwork {
  svg: string;
  /** Font families its live text uses: install them, or outline the text, before printing. */
  fonts: string[];
  /** Layers placed as images (photos, repeats, raster effects), by name. */
  rasterLayers: string[];
}

const n = (x: number) => String(Math.round(x * 1000) / 1000);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** SVG `matrix()` of a DOMMatrix. */
const matrix = (m: DOMMatrix) => `matrix(${n(m.a)} ${n(m.b)} ${n(m.c)} ${n(m.d)} ${n(m.e)} ${n(m.f)})`;

/** Parameters each path command takes. */
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/**
 * Path data scaled and moved (x·sx + tx, y·sy + ty), every command kept: so an outline drawn on
 * it keeps one width, which a scaled `transform` would stretch.
 */
export function transformPathData(d: string, sx: number, sy: number, tx: number, ty: number): string {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let cmd = '';
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/[A-Za-z]/.test(tok)) {
      cmd = tok;
      i++;
      if (cmd.toLowerCase() === 'z') {
        out.push(cmd);
        continue;
      }
    } else if (!cmd) {
      i++;
      continue;
    }
    const lower = cmd.toLowerCase();
    const arity = ARITY[lower];
    const args = tokens.slice(i, i + arity).map(Number);
    if (args.length < arity || args.some((x) => !Number.isFinite(x))) break;
    i += arity;
    const rel = cmd === lower;
    const X = (x: number) => (rel ? x * sx : x * sx + tx);
    const Y = (y: number) => (rel ? y * sy : y * sy + ty);
    let p: number[];
    if (lower === 'h') p = [X(args[0])];
    else if (lower === 'v') p = [Y(args[0])];
    else if (lower === 'a') p = [Math.abs(args[0] * sx), Math.abs(args[1] * sy), args[2], args[3], sx * sy < 0 ? 1 - args[4] : args[4], X(args[5]), Y(args[6])];
    else p = args.map((v, k) => (k % 2 ? Y(v) : X(v)));
    out.push(cmd + p.map(n).join(' '));
    // After a move, further pairs are lines.
    if (lower === 'm') cmd = rel ? 'l' : 'L';
  }
  return out.join(' ');
}

/** A shape's outline as path data, centred on the origin in a w × h box (mm), as the renderer draws it. */
export function shapePathData(c: ShapeContent, w: number, h: number): string {
  const hw = w / 2;
  const hh = h / 2;
  switch (c.shape) {
    case 'rect':
    case 'line': {
      const r = Math.min(c.cornerRadiusMm, hw, hh);
      if (r <= 0) return `M${n(-hw)} ${n(-hh)}H${n(hw)}V${n(hh)}H${n(-hw)}Z`;
      return `M${n(-hw + r)} ${n(-hh)}H${n(hw - r)}A${n(r)} ${n(r)} 0 0 1 ${n(hw)} ${n(-hh + r)}V${n(hh - r)}A${n(r)} ${n(r)} 0 0 1 ${n(hw - r)} ${n(hh)}H${n(-hw + r)}A${n(r)} ${n(r)} 0 0 1 ${n(-hw)} ${n(hh - r)}V${n(-hh + r)}A${n(r)} ${n(r)} 0 0 1 ${n(-hw + r)} ${n(-hh)}Z`;
    }
    case 'ellipse':
      return `M${n(-hw)} 0A${n(hw)} ${n(hh)} 0 1 0 ${n(hw)} 0A${n(hw)} ${n(hh)} 0 1 0 ${n(-hw)} 0Z`;
    case 'triangle':
      return `M0 ${n(-hh)}L${n(hw)} ${n(hh)}L${n(-hw)} ${n(hh)}Z`;
    case 'star': {
      const pts = c.points ?? 5;
      const inner = c.innerRatio ?? 0.45;
      const p: string[] = [];
      for (let i = 0; i < pts * 2; i++) {
        const r = i % 2 ? inner : 1;
        const a = -Math.PI / 2 + (i * Math.PI) / pts;
        p.push(`${i ? 'L' : 'M'}${n(Math.cos(a) * r * hw)} ${n(Math.sin(a) * r * hh)}`);
      }
      return `${p.join('')}Z`;
    }
    case 'polygon': {
      const pts = c.points ?? 6;
      const p: string[] = [];
      for (let i = 0; i < pts; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / pts;
        p.push(`${i ? 'L' : 'M'}${n(Math.cos(a) * hw)} ${n(Math.sin(a) * hh)}`);
      }
      return `${p.join('')}Z`;
    }
    case 'heart': {
      const X = (u: number) => n((u - 0.5) * w);
      const Y = (v: number) => n((v - 0.5) * h);
      return [
        `M${X(0.5)} ${Y(0.28)}`,
        `C${X(0.5)} ${Y(0.2)} ${X(0.42)} ${Y(0)} ${X(0.25)} ${Y(0)}`,
        `C${X(0.05)} ${Y(0)} ${X(0)} ${Y(0.18)} ${X(0)} ${Y(0.32)}`,
        `C${X(0)} ${Y(0.55)} ${X(0.22)} ${Y(0.74)} ${X(0.5)} ${Y(1)}`,
        `C${X(0.78)} ${Y(0.74)} ${X(1)} ${Y(0.55)} ${X(1)} ${Y(0.32)}`,
        `C${X(1)} ${Y(0.18)} ${X(0.95)} ${Y(0)} ${X(0.75)} ${Y(0)}`,
        `C${X(0.58)} ${Y(0)} ${X(0.5)} ${Y(0.2)} ${X(0.5)} ${Y(0.28)}Z`,
      ].join('');
    }
    case 'path':
      // Library graphics are drawn in a 0–100 box.
      return c.path ? transformPathData(c.path, w / 100, h / 100, -w / 2, -h / 2) : '';
  }
  return '';
}

/** Collects gradients and pattern tiles into one <defs>. */
class Defs {
  private items: string[] = [];
  private count = 0;
  constructor(private readonly ppmTile: number) {}
  get svg() {
    return this.items.length ? `<defs>${this.items.join('')}</defs>` : '';
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
      const a = (style.angleDeg * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const L = (Math.abs(w * cos) + Math.abs(h * sin)) / 2;
      this.items.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(-L * cos)}" y1="${n(-L * sin)}" x2="${n(L * cos)}" y2="${n(L * sin)}"${tf ? ` gradientTransform="${tf}"` : ''}><stop offset="0" stop-color="${esc(base)}"/><stop offset="1" stop-color="${esc(style.to)}"/></linearGradient>`,
      );
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
  const stroke = c.strokeColor && c.strokeWidthMm ? ` stroke="${esc(c.strokeColor)}" stroke-width="${n((c.strokeWidthMm * 2) / sy)}" stroke-linejoin="round" paint-order="stroke"` : '';
  const parts: string[] = [];
  if (m.glyphs) {
    for (const g of m.glyphs) {
      // Gradients and patterns stay anchored to the layer, not to each turned letter.
      const fill = c.fillStyle ? defs.paint(c.fill, c.fillStyle, w, h, new DOMMatrix().rotate((-g.rot * 180) / Math.PI).translate(-g.x, -g.y).multiply(toText)) : esc(c.fill);
      parts.push(`<text transform="translate(${n(g.x)} ${n(g.y)}) rotate(${n((g.rot * 180) / Math.PI)})" text-anchor="middle" dominant-baseline="central" fill="${fill}"${stroke}>${esc(g.g)}</text>`);
    }
  } else {
    const fill = defs.paint(c.fill, c.fillStyle, w, h, toText);
    const anchor = c.align === 'left' ? 'start' : c.align === 'right' ? 'end' : 'middle';
    const x = c.align === 'left' ? -m.width / 2 : c.align === 'right' ? m.width / 2 : 0;
    const lineH = TEXT_REF_PX * c.lineHeight;
    const spacing = c.letterSpacingEm ? ` letter-spacing="${n(c.letterSpacingEm * TEXT_REF_PX)}"` : '';
    m.lines.forEach((line, i) => {
      const y = -m.height / 2 + lineH * (i + 0.5);
      parts.push(`<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" dominant-baseline="central" fill="${fill}"${stroke}${spacing} xml:space="preserve">${esc(line)}</text>`);
    });
  }
  return `<g transform="scale(${n(sx)} ${n(sy)}) translate(${n(-m.cx)} ${n(-m.cy)})" ${font}>${parts.join('')}</g>`;
}

function shapeSvg(c: ShapeContent, w: number, h: number, defs: Defs): string {
  const d = shapePathData(c, w, h);
  if (!d) return '';
  const stroke = c.strokeColor && c.strokeWidthMm ? ` stroke="${esc(c.strokeColor)}" stroke-width="${n(c.strokeWidthMm)}" stroke-linejoin="round"` : '';
  return `<path d="${d}" fill="${defs.paint(c.fill, c.fillStyle, w, h)}"${c.shape === 'path' ? ' fill-rule="evenodd"' : ''}${stroke}/>`;
}

/** A layer drawn as pixels at print resolution (with its effects), placed over its box and bleed. */
function rasterSvg(layer: ArtworkLayer, dpiPxPerMm: number): string | null {
  // As the PNG print file does, a very large layer is drawn a little coarser rather than past what a canvas holds.
  const pxPerMm = Math.min(dpiPxPerMm, MAX_EXPORT_SIDE / Math.max(layer.transform.widthMm, layer.transform.heightMm, 1));
  const { canvas, bleed } = renderLayerBitmap(layer, pxPerMm);
  if (!canvas.width || !canvas.height) return null;
  const w = layer.transform.widthMm;
  const h = layer.transform.heightMm;
  const b = bleed / pxPerMm;
  return `<image href="${canvas.toDataURL('image/png')}" x="${n(-w / 2 - b)}" y="${n(-h / 2 - b)}" width="${n(w + 2 * b)}" height="${n(h + 2 * b)}" preserveAspectRatio="none"/>`;
}

/** Whether a layer can be written as vector (text and shapes without raster effects). */
export function isVectorLayer(layer: ArtworkLayer): boolean {
  return layer.content.kind !== 'image' && !needsEffectPass(layer, false);
}

const BLEND: Record<ArtworkLayer['style']['blendMode'], string> = { normal: '', multiply: 'multiply', screen: 'screen', overlay: 'overlay' };

/**
 * A zone's or design area's artwork as an SVG print file: `widthMm` × `heightMm` at true size.
 * Images and fonts must be loaded first (prepareDocument). `dpi` sets the resolution of the parts
 * placed as images.
 */
export function zoneSvg(zone: LayerStack, widthMm: number, heightMm: number, opts: { dpi: number; title: string }): SvgArtwork {
  const ppm = opts.dpi / 25.4;
  const defs = new Defs(ppm);
  const fonts = new Set<string>();
  const rasterLayers: string[] = [];
  const body: string[] = [];
  for (const id of zone.orderedLayerIds) {
    const layer = zone.layers[id];
    if (!layer?.visible) continue;
    const t = layer.transform;
    const w = t.widthMm;
    const h = t.heightMm;
    let content: string | null;
    if (isVectorLayer(layer)) {
      if (layer.content.kind === 'text') {
        fonts.add(layer.content.fontFamily);
        content = textSvg(layer.content, w, h, defs);
      } else content = layer.content.kind === 'shape' ? shapeSvg(layer.content, w, h, defs) : null;
    } else {
      content = rasterSvg(layer, ppm);
      if (content) rasterLayers.push(layer.name);
    }
    if (!content) continue;
    const flip = t.flipX || t.flipY ? ` scale(${t.flipX ? -1 : 1} ${t.flipY ? -1 : 1})` : '';
    const opacity = layer.style.opacity < 1 ? ` opacity="${n(layer.style.opacity)}"` : '';
    const blend = BLEND[layer.style.blendMode] ? ` style="mix-blend-mode:${BLEND[layer.style.blendMode]}"` : '';
    body.push(`<g id="${esc(`layer-${layer.id}`)}" data-name="${esc(layer.name)}" transform="translate(${n(t.centerXmm)} ${n(t.centerYmm)}) rotate(${n(t.rotationDeg)})${flip}"${opacity}${blend}>${content}</g>`);
  }
  const desc = [
    `${n(widthMm)} × ${n(heightMm)} mm print area at true size (1 unit = 1 mm).`,
    fonts.size ? `Live text in: ${[...fonts].join(', ')}. Install these fonts or outline the text before printing.` : '',
    rasterLayers.length ? `Placed as images at ${Math.round(opts.dpi)} dpi: ${rasterLayers.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(widthMm)}mm" height="${n(heightMm)}mm" viewBox="0 0 ${n(widthMm)} ${n(heightMm)}">` +
    `<title>${esc(opts.title)}</title><desc>${esc(desc)}</desc>${defs.svg}${body.join('')}</svg>\n`;
  return { svg, fonts: [...fonts], rasterLayers };
}
