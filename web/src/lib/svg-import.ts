/**
 * SVG artwork as editable vector shapes (spec ED2-09). Every shape an SVG draws (paths,
 * rectangles, circles, ellipses, lines, polylines and polygons, inside groups and reused symbols,
 * with their transforms, CSS classes and inherited styles, as the browser itself resolves them)
 * becomes a path layer in its own colour, laid exactly over the SVG image it came from and grouped:
 * fills as filled shapes, strokes as outline-only ones. Text, embedded pictures and the like aren't
 * shapes WOVEXA can edit: they are counted, so the image can be kept, hidden, underneath.
 */
import { newId } from '@/domain/factory';
import { LIMITS } from '@/domain/limits';
import { boundsOf, mapSubpaths, parsePath, pathData, type Subpath } from '@/domain/path-edit';
import type { ArtworkLayer, LayerTransform, ShapeContent } from '@/domain/schema';

export class SvgImportError extends Error {}

/** One shape of the SVG, in the image's own box: millimetres from its top-left corner, not turned. */
export interface SvgPiece {
  subpaths: Subpath[];
  fill: string;
  /** 0–1: the shape's own see-through-ness (fill or stroke opacity times its groups'). */
  opacity: number;
  /** An outline-only line this wide (mm), from a stroke; a filled shape without. */
  lineMm?: number;
  roundCaps?: boolean;
  name: string;
}

export interface SvgSkipped {
  text: number;
  pictures: number;
  /** Gradients and patterns, filled with one of their colours. */
  flattened: number;
  /** Clipping paths and masks, left out (their shapes are imported whole). */
  clipped: number;
}

const two = (v: number) => Math.round(v).toString(16).padStart(2, '0');

/** A CSS colour as the browser computes it (rgb(), rgba(), #hex) as #RRGGBB and its alpha; null for none. */
export function cssColor(value: string | null | undefined): { hex: string; alpha: number } | null {
  const v = (value ?? '').trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent') return null;
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    if (!(a > 0)) return null;
    return { hex: `#${two(+rgb[1])}${two(+rgb[2])}${two(+rgb[3])}`.toUpperCase(), alpha: Math.min(1, a) };
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return { hex: `#${h}`.toUpperCase(), alpha: 1 };
  }
  return null;
}

const f = (v: number) => String(Math.round(v * 1000) / 1000);

/** A rectangle, its corners rounded by rx and ry (each clamped to half the side, and one standing in for the other) as SVG draws it. */
export function rectPath(x: number, y: number, w: number, h: number, rxIn = 0, ryIn = 0): string {
  if (!(w > 0) || !(h > 0)) return '';
  let rx = rxIn > 0 ? rxIn : ryIn > 0 ? ryIn : 0;
  let ry = ryIn > 0 ? ryIn : rx;
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!rx || !ry) return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
  const arc = (ex: number, ey: number) => `A${f(rx)} ${f(ry)} 0 0 1 ${f(ex)} ${f(ey)}`;
  return `M${f(x + rx)} ${f(y)}H${f(x + w - rx)}${arc(x + w, y + ry)}V${f(y + h - ry)}${arc(x + w - rx, y + h)}H${f(x + rx)}${arc(x, y + h - ry)}V${f(y + ry)}${arc(x + rx, y)}Z`;
}

/** An ellipse (a circle when rx equals ry) as two arcs. */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  if (!(rx > 0) || !(ry > 0)) return '';
  return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`;
}

/** A polyline's or polygon's points attribute as path data. */
export function pointsPath(points: string, closed: boolean): string {
  const nums = (points.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  if (nums.length < 4) return '';
  const pairs: string[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pairs.push(`${f(nums[i])} ${f(nums[i + 1])}`);
  return `M${pairs.join('L')}${closed ? 'Z' : ''}`;
}

/** A point `x`, `y` mm from a layer's middle, turned and mirrored as the layer is. */
function turned(t: Pick<LayerTransform, 'rotationDeg' | 'flipX' | 'flipY'>, x: number, y: number): [number, number] {
  const a = (t.rotationDeg * Math.PI) / 180;
  const fx = t.flipX ? -x : x;
  const fy = t.flipY ? -y : y;
  return [fx * Math.cos(a) - fy * Math.sin(a), fx * Math.sin(a) + fy * Math.cos(a)];
}

const sameLook = (a: SvgPiece, b: SvgPiece) => a.fill === b.fill && Math.abs(a.opacity - b.opacity) < 0.005 && a.lineMm === b.lineMm && !!a.roundCaps === !!b.roundCaps;

/** One shape per run of neighbours that look alike (the stack keeps its order), or per look at all when `anyOrder`. */
export function mergePieces(pieces: readonly SvgPiece[], anyOrder: boolean): SvgPiece[] {
  const out: SvgPiece[] = [];
  for (const p of pieces) {
    const into = anyOrder ? out.find((o) => sameLook(o, p)) : out.length && sameLook(out[out.length - 1], p) ? out[out.length - 1] : undefined;
    if (into) into.subpaths = [...into.subpaths, ...p.subpaths];
    else out.push({ ...p, subpaths: [...p.subpaths] });
  }
  return out;
}

/**
 * SVG shapes (in the image's box) as path layers over `image`: each placed, turned and mirrored as
 * the image is, grouped. Neighbouring shapes that look alike share a layer; with more shapes than
 * `room` layers, every shape of one look does. Throws when they still don't fit.
 */
export function piecesToLayers(pieces: readonly SvgPiece[], image: ArtworkLayer, room: number): { layers: ArtworkLayer[]; mergedAcross: boolean; tooDetailed: number } {
  let merged = mergePieces(pieces, false);
  let mergedAcross = false;
  if (merged.length > room) {
    merged = mergePieces(pieces, true);
    mergedAcross = true;
  }
  if (merged.length > room) throw new SvgImportError(`This SVG has ${merged.length} colours of shapes, more than the ${room} layers left on this print area.`);
  const t = image.transform;
  const groupId = `g-${newId()}`;
  const base = image.name.replace(/\.svg$/i, '').slice(0, 40) || 'SVG';
  const layers: ArtworkLayer[] = [];
  let tooDetailed = 0;
  for (const piece of merged) {
    const b = boundsOf(piece.subpaths);
    if (!(b.w >= 0) || !(b.h >= 0) || (b.w < 0.05 && b.h < 0.05)) continue;
    // A straight line has no height (or width): give its box some, so it can be placed and edited.
    const w = Math.max(b.w, 0.5);
    const h = Math.max(b.h, 0.5);
    const x = b.x - (w - b.w) / 2;
    const y = b.y - (h - b.h) / 2;
    const path = pathData(mapSubpaths(piece.subpaths, (px, py) => [((px - x) / w) * 100, ((py - y) / h) * 100]));
    if (path.length > LIMITS.pathChars) {
      tooDetailed++;
      continue;
    }
    const content: ShapeContent = { kind: 'shape', shape: 'path', fill: piece.fill, cornerRadiusMm: 0, path };
    if (piece.lineMm !== undefined) Object.assign(content, { hollow: true, strokeWidthMm: Math.min(50, Math.max(0.05, piece.lineMm)) }, piece.roundCaps ? { roundCaps: true } : {});
    const [ox, oy] = turned(t, x + w / 2 - t.widthMm / 2, y + h / 2 - t.heightMm / 2);
    layers.push({
      id: newId(),
      name: piece.name ? piece.name.slice(0, 120) : `${base} shape ${layers.length + 1}`,
      visible: true,
      locked: false,
      groupId,
      ...(image.clip ? { clip: true } : {}),
      transform: { centerXmm: t.centerXmm + ox, centerYmm: t.centerYmm + oy, widthMm: w, heightMm: h, rotationDeg: t.rotationDeg, flipX: t.flipX, flipY: t.flipY },
      style: { opacity: Math.max(0, Math.min(1, image.style.opacity * piece.opacity)), blendMode: image.style.blendMode, finish: image.style.finish },
      content,
    });
  }
  if (layers.length === 1) delete layers[0].groupId;
  return { layers, mergedAcross, tooDetailed };
}

// ---- In the browser: the SVG as the browser draws it ----

const SHAPES = 'path, rect, circle, ellipse, line, polyline, polygon';
/** Containers whose contents are only drawn where something refers to them. */
const NOT_DRAWN = 'defs, clipPath, mask, symbol, pattern, marker, linearGradient, radialGradient, filter';

/** `<use>` copies of symbols and shapes written out as groups, so every drawn shape is in the tree. */
function expandUses(svg: SVGSVGElement) {
  for (let pass = 0; pass < 8; pass++) {
    const uses = [...svg.querySelectorAll('use')];
    if (!uses.length) return;
    for (const use of uses) {
      const href = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
      const target = href.startsWith('#') ? svg.querySelector(`#${CSS.escape(href.slice(1))}`) : null;
      const g = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
      for (const attr of [...use.attributes]) if (!['href', 'xlink:href', 'x', 'y', 'width', 'height', 'id', 'transform'].includes(attr.name)) g.setAttribute(attr.name, attr.value);
      const x = parseFloat(use.getAttribute('x') ?? '0') || 0;
      const y = parseFloat(use.getAttribute('y') ?? '0') || 0;
      g.setAttribute('transform', `${use.getAttribute('transform') ?? ''} translate(${x} ${y})`);
      if (target && !target.contains(use)) {
        const copy = target.cloneNode(true) as Element;
        if (copy.localName === 'symbol') {
          const inner = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
          for (const attr of [...copy.attributes]) if (!['id', 'viewBox', 'preserveAspectRatio'].includes(attr.name)) inner.setAttribute(attr.name, attr.value);
          inner.append(...copy.childNodes);
          g.appendChild(inner);
        } else {
          copy.removeAttribute('id');
          g.appendChild(copy);
        }
        for (const el of g.querySelectorAll('[id]')) el.removeAttribute('id');
      }
      use.replaceWith(g);
    }
  }
}

function geometry(el: SVGGraphicsElement): string {
  const len = (a: SVGAnimatedLength) => a.baseVal.value;
  switch (el.localName) {
    case 'path':
      return el.getAttribute('d') ?? '';
    case 'rect': {
      const r = el as SVGRectElement;
      return rectPath(len(r.x), len(r.y), len(r.width), len(r.height), r.hasAttribute('rx') ? len(r.rx) : 0, r.hasAttribute('ry') ? len(r.ry) : 0);
    }
    case 'circle': {
      const c = el as SVGCircleElement;
      return ellipsePath(len(c.cx), len(c.cy), len(c.r), len(c.r));
    }
    case 'ellipse': {
      const e = el as SVGEllipseElement;
      return ellipsePath(len(e.cx), len(e.cy), len(e.rx), len(e.ry));
    }
    case 'line': {
      const l = el as SVGLineElement;
      return `M${f(len(l.x1))} ${f(len(l.y1))}L${f(len(l.x2))} ${f(len(l.y2))}`;
    }
    case 'polyline':
    case 'polygon':
      return pointsPath(el.getAttribute('points') ?? '', el.localName === 'polygon');
    default:
      return '';
  }
}

/** How see-through an element is with every group round it: their opacities multiplied. */
function groupOpacity(el: Element, root: Element): number {
  let o = 1;
  for (let e: Element | null = el; e && e !== root.parentNode; e = e.parentElement) {
    const v = parseFloat(getComputedStyle(e).opacity);
    if (Number.isFinite(v)) o *= v;
    if (e === root) break;
  }
  return o;
}

/** The colour a paint server (gradient or pattern) mostly shows: its first stop's. */
function paintServerColor(svg: SVGSVGElement, value: string): { hex: string; alpha: number } | null {
  const id = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(value)?.[1];
  const server = id ? svg.querySelector(`#${CSS.escape(id)}`) : null;
  const stop = server?.querySelector('stop');
  if (!stop) return null;
  const cs = getComputedStyle(stop);
  const c = cssColor(cs.stopColor);
  const a = parseFloat(cs.stopOpacity);
  return c ? { hex: c.hex, alpha: c.alpha * (Number.isFinite(a) ? a : 1) } : null;
}

/**
 * The shapes of an SVG drawn at `naturalW` × `naturalH` px (as the image layer shows it), in a
 * `boxWmm` × `boxHmm` box, in drawing order. Browser only.
 */
export function svgPieces(svgText: string, naturalW: number, naturalH: number, boxWmm: number, boxHmm: number): { pieces: SvgPiece[]; skipped: SvgSkipped } {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const source = parsed.documentElement;
  if (source.localName !== 'svg' || parsed.querySelector('parsererror')) throw new SvgImportError('This SVG couldn’t be read.');
  // Drawn out of sight in a shadow root of its own: the page's styles don't reach it, its own do.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const svg = document.importNode(source, true) as unknown as SVGSVGElement;
  svg.setAttribute('width', String(naturalW));
  svg.setAttribute('height', String(naturalH));
  shadow.appendChild(svg);
  document.body.appendChild(host);
  try {
    expandUses(svg);
    const rootCtm = svg.getScreenCTM();
    if (!rootCtm) throw new SvgImportError('This SVG couldn’t be drawn to read its shapes.');
    const toRoot = rootCtm.inverse();
    const sx = boxWmm / naturalW;
    const sy = boxHmm / naturalH;
    const skipped: SvgSkipped = { text: 0, pictures: 0, flattened: 0, clipped: 0 };
    const drawn = (el: Element) => !el.closest(NOT_DRAWN);
    skipped.text = [...svg.querySelectorAll('text')].filter(drawn).length;
    skipped.pictures = [...svg.querySelectorAll('image, foreignObject')].filter(drawn).length;
    const pieces: SvgPiece[] = [];
    for (const el of svg.querySelectorAll<SVGGraphicsElement>(SHAPES)) {
      if (!drawn(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
      const d = geometry(el);
      const ctm = el.getScreenCTM();
      if (!d || !ctm) continue;
      if (el.closest('[clip-path], [mask]') || cs.clipPath !== 'none' || (cs.mask && cs.mask !== 'none')) skipped.clipped++;
      const m = toRoot.multiply(ctm);
      const subpaths = mapSubpaths(parsePath(d), (x, y) => [(m.a * x + m.c * y + m.e) * sx, (m.b * x + m.d * y + m.f) * sy]);
      if (!subpaths.length) continue;
      const opacity = groupOpacity(el, svg);
      const name = el.getAttribute('id') ?? el.closest('[id]:not(svg)')?.getAttribute('id') ?? '';
      // The fill, unless it's an open line (SVG fills those too, but a line has nothing to fill).
      const fillValue = cs.fill;
      let fill = cssColor(fillValue);
      if (!fill && fillValue.startsWith('url(')) {
        fill = paintServerColor(svg, fillValue);
        if (fill) skipped.flattened++;
      }
      const fillOpacity = parseFloat(cs.fillOpacity);
      if (fill && el.localName !== 'line') pieces.push({ subpaths, fill: fill.hex, opacity: opacity * fill.alpha * (Number.isFinite(fillOpacity) ? fillOpacity : 1), name });
      const strokeValue = cs.stroke;
      let stroke = cssColor(strokeValue);
      if (!stroke && strokeValue.startsWith('url(')) {
        stroke = paintServerColor(svg, strokeValue);
        if (stroke) skipped.flattened++;
      }
      const strokePx = parseFloat(cs.strokeWidth);
      if (stroke && strokePx > 0) {
        // The line's width as drawn: scaled by the shape's own transform, in mm.
        const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
        const strokeOpacity = parseFloat(cs.strokeOpacity);
        pieces.push({
          subpaths,
          fill: stroke.hex,
          opacity: opacity * stroke.alpha * (Number.isFinite(strokeOpacity) ? strokeOpacity : 1),
          lineMm: strokePx * scale * ((sx + sy) / 2),
          roundCaps: cs.strokeLinecap === 'round',
          name: name ? `${name} line` : '',
        });
      }
    }
    return { pieces, skipped };
  } finally {
    host.remove();
  }
}
