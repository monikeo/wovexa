/**
 * Freehand drawing (spec ED2-09). The pencil turns a stroke drawn by hand into a smooth line that
 * stays editable point by point (an outline-only path with round ends). The brush turns it into a
 * filled stroke shaped by a brush: round, ink (tapered at both ends), marker (flat ends) or a
 * calligraphy nib held at 45°, thicker where a stylus presses harder. Both land as path layers, so
 * they print, export (SVG included) and combine like any drawn shape. Artboard millimetres.
 */
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import { LIMITS } from '@/domain/limits';
import { boundsOf, mapSubpaths, parsePath, pathData } from '@/domain/path-edit';
import { ringArea, simplifyRing, type Ring } from '@/lib/render/trace';

/** A sample of the stroke: where the pointer was, and the stylus pressure (0–1) when it reports one. */
export interface StrokePoint {
  x: number;
  y: number;
  p?: number;
}

export const BRUSHES = ['round', 'taper', 'marker', 'calligraphy'] as const;
export type Brush = (typeof BRUSHES)[number];
export const BRUSH_LABELS: Record<Brush, string> = { round: 'Round', taper: 'Ink', marker: 'Marker', calligraphy: 'Calligraphy' };

/** Samples kept from one stroke: minutes of drawing, well past what a gesture takes. */
export const MAX_STROKE_POINTS = 5000;

export interface DrawnPath {
  /** Path data in a 0–100 box, placed over `box` (mm). */
  path: string;
  box: { x: number; y: number; w: number; h: number };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** The stroke with samples closer than `minMm` to the last kept one dropped (a hand's jitter); the last sample is kept. */
export function thinStroke(points: readonly StrokePoint[], minMm: number): StrokePoint[] {
  const out: StrokePoint[] = [];
  for (const q of points) if (!out.length || dist(out[out.length - 1], q) >= minMm) out.push(q);
  const last = points[points.length - 1];
  if (last && out.length > 1 && out[out.length - 1] !== last && dist(out[out.length - 1], last) > minMm * 0.25) out.push(last);
  return out;
}

/** Each point eased toward its neighbours, more passes for more `amount` (0–1). An open stroke keeps its ends. */
export function smoothStroke(points: readonly StrokePoint[], amount: number, closed = false): StrokePoint[] {
  if (amount <= 0 || points.length < 3) return [...points];
  let pts = [...points];
  const passes = Math.round(1 + amount * 5);
  for (let k = 0; k < passes; k++) {
    pts = pts.map((q, i) => {
      if (!closed && (i === 0 || i === pts.length - 1)) return q;
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[(i + 1) % pts.length];
      return { ...q, x: q.x * 0.5 + (a.x + b.x) * 0.25, y: q.y * 0.5 + (a.y + b.y) * 0.25 };
    });
  }
  return pts;
}

/** Points that matter for the shape (Ramer–Douglas–Peucker): every other point within `tolerance` mm of the line kept. */
export function simplifyStroke(points: readonly StrokePoint[], tolerance: number): StrokePoint[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = points[a];
    const B = points[b];
    const len = dist(A, B);
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const P = points[i];
      const d = len < 1e-9 ? dist(P, A) : Math.abs((B.x - A.x) * (A.y - P.y) - (A.x - P.x) * (B.y - A.y)) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

/** A smooth curve through the points (Catmull-Rom, as cubic curves), as path data in their own units. */
export function curveThrough(points: readonly { x: number; y: number }[], closed: boolean): string {
  const n = points.length;
  if (n < 2) return '';
  const at = (i: number) => (closed ? points[((i % n) + n) % n] : points[Math.max(0, Math.min(n - 1, i))]);
  const out = [`M${fmt(points[0].x)} ${fmt(points[0].y)}`];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    out.push(`C${fmt(p1.x + (p2.x - p0.x) / 6)} ${fmt(p1.y + (p2.y - p0.y) / 6)} ${fmt(p2.x - (p3.x - p1.x) / 6)} ${fmt(p2.y - (p3.y - p1.y) / 6)} ${fmt(p2.x)} ${fmt(p2.y)}`);
  }
  if (closed) out.push('Z');
  return out.join(' ');
}

/** Path data in mm as a path in its own 0–100 box, the box at least `minMm` each way (a straight line still has a box). */
function boxed(d: string, minMm: number): DrawnPath | null {
  const subs = parsePath(d);
  if (!subs.length) return null;
  const b = boundsOf(subs);
  const w = Math.max(b.w, minMm);
  const h = Math.max(b.h, minMm);
  const x = b.x - (w - b.w) / 2;
  const y = b.y - (h - b.h) / 2;
  return { path: pathData(mapSubpaths(subs, (px, py) => [((px - x) / w) * 100, ((py - y) / h) * 100])), box: { x, y, w, h } };
}

/**
 * The pencil: a smooth line through the stroke, `smoothing` 0–1 easing a shaky hand. It closes
 * into a loop when it ends within `closeMm` of where it began. Null for a stroke too short to keep.
 */
export function pencilStroke(raw: readonly StrokePoint[], opts: { smoothing: number; closeMm: number }): (DrawnPath & { closed: boolean }) | null {
  let pts = thinStroke(raw.slice(0, MAX_STROKE_POINTS), 0.25);
  if (pts.length < 2) return null;
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);
  if (length < 1) return null;
  const closed = pts.length >= 4 && dist(pts[0], pts[pts.length - 1]) <= opts.closeMm && length > opts.closeMm * 4;
  if (closed) pts = pts.slice(0, -1);
  pts = smoothStroke(pts, opts.smoothing, closed);
  // Looser for a smoother line, and looser again until the path fits a layer.
  let tolerance = 0.05 + opts.smoothing * 0.45;
  for (let attempt = 0; attempt < 8; attempt++, tolerance *= 1.8) {
    const simple = simplifyStroke(pts, tolerance);
    if (simple.length < 2) return null;
    const out = boxed(curveThrough(simple, closed && simple.length >= 3), 1);
    if (out && out.path.length <= LIMITS.pathChars) return { ...out, closed: closed && simple.length >= 3 };
  }
  return null;
}

const CIRCLE_SIDES = 16;

function disc(x: number, y: number, r: number): Polygon {
  const ring: [number, number][] = [];
  for (let i = 0; i < CIRCLE_SIDES; i++) {
    const a = (i / CIRCLE_SIDES) * Math.PI * 2;
    ring.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  ring.push(ring[0]);
  return [ring];
}

function quad(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): Polygon | null {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]) + ((c[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (c[1] - a[1]));
  return Math.abs(area) < 1e-6 ? null : [[a, b, c, d, a]];
}

/** How wide the stroke is at each point: the brush's profile along the stroke, times the stylus pressure. */
export function brushWidths(points: readonly StrokePoint[], brush: Brush, widthMm: number): number[] {
  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + dist(points[i - 1], points[i]));
  const length = along[along.length - 1];
  const taper = Math.max(1e-6, Math.min(length / 2.5, widthMm * 6));
  return points.map((q, i) => {
    const pressure = q.p === undefined ? 1 : 0.25 + 0.75 * Math.max(0, Math.min(1, q.p));
    if (brush !== 'taper') return widthMm * pressure;
    const ends = Math.min(1, along[i] / taper, (length - along[i]) / taper);
    return widthMm * pressure * Math.max(0.06, Math.sqrt(Math.max(0, ends)));
  });
}

/** The area a brush covers along the stroke: one clean region, however the stroke crosses itself. */
export function brushRegion(points: readonly StrokePoint[], brush: Brush, widthMm: number): MultiPolygon {
  const pts = points;
  if (!pts.length) return [];
  const widths = brushWidths(pts, brush, widthMm);
  const polys: Polygon[] = [];
  if (pts.length === 1) return unionAll([disc(pts[0].x, pts[0].y, widths[0] / 2)]);
  if (brush === 'calligraphy') {
    // A flat nib at 45°: broad across it, a hairline along it (never nothing).
    const nx = Math.cos(-Math.PI / 4) / 2;
    const ny = Math.sin(-Math.PI / 4) / 2;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const [wa, wb] = [widths[i], widths[i + 1]];
      const len = dist(a, b);
      if (len < 1e-9) continue;
      // How thick the nib sweeps here: its width times how square the stroke runs to it.
      const sweep = Math.min(wa, wb) * Math.abs(((b.x - a.x) / len) * ny * 2 - ((b.y - a.y) / len) * nx * 2);
      const hair = Math.max(0.1, Math.min(wa, wb) * 0.06);
      if (sweep >= hair * 2) {
        const q = quad([a.x + nx * wa, a.y + ny * wa], [b.x + nx * wb, b.y + ny * wb], [b.x - nx * wb, b.y - ny * wb], [a.x - nx * wa, a.y - ny * wa]);
        if (q) polys.push(q);
        continue;
      }
      // Running along the nib: a hairline instead, so the stroke never vanishes.
      const [px, py] = [(-(b.y - a.y) / len) * hair, ((b.x - a.x) / len) * hair];
      const line = quad([a.x + px, a.y + py], [b.x + px, b.y + py], [b.x - px, b.y - py], [a.x - px, a.y - py]);
      if (line) polys.push(line);
    }
  } else {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const len = dist(a, b);
      if (len < 1e-9) continue;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const [ha, hb] = [widths[i] / 2, widths[i + 1] / 2];
      const q = quad([a.x + nx * ha, a.y + ny * ha], [b.x + nx * hb, b.y + ny * hb], [b.x - nx * hb, b.y - ny * hb], [a.x - nx * ha, a.y - ny * ha]);
      if (q) polys.push(q);
    }
    // Round joins between segments, and round ends; a marker's ends stay flat, so no join pokes past them.
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + dist(pts[i - 1], pts[i]));
    const length = along[along.length - 1];
    pts.forEach((q, i) => {
      if (brush === 'marker' && (along[i] < widths[i] / 2 || length - along[i] < widths[i] / 2)) return;
      polys.push(disc(q.x, q.y, widths[i] / 2));
    });
  }
  return unionAll(polys);
}

/**
 * Many small pieces as one area. The union is done on a fine grid (a ten-thousandth of a
 * millimetre), and coarser ones if pieces meeting edge to edge still trip it up.
 */
function unionAll(polys: Polygon[]): MultiPolygon {
  if (!polys.length) return [];
  const snap = (grid: number) => polys.map((poly) => poly.map((ring) => ring.map(([x, y]) => [Math.round(x / grid) * grid, Math.round(y / grid) * grid] as [number, number])));
  for (const grid of [1e-4, 1e-3, 1e-2]) {
    const snapped = snap(grid);
    try {
      return polygonClipping.union(snapped[0], ...snapped.slice(1));
    } catch {
      // Edges that nearly coincide: try again on a coarser grid.
    }
  }
  // Last resort: one piece at a time, leaving out any piece that still can't be joined, rather than nothing.
  let area: MultiPolygon = [];
  for (const piece of snap(1e-3)) {
    try {
      area = area.length ? polygonClipping.union(area, piece) : polygonClipping.union(piece);
    } catch {
      // This piece is left out.
    }
  }
  return area;
}

/** A region as a path in its own 0–100 box (even-odd, so holes stay holes), simplified until it fits a layer. */
export function regionPath(region: MultiPolygon, toleranceMm = 0.02): DrawnPath | null {
  for (let attempt = 0, tolerance = toleranceMm; attempt < 8; attempt++, tolerance *= 2) {
    const rings: Ring[] = [];
    for (const polygon of region) {
      for (const ring of polygon) {
        const open = (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring) as Ring;
        const simple = simplifyRing(open, tolerance);
        if (simple.length >= 3 && ringArea(simple) > 0.005) rings.push(simple);
      }
    }
    if (!rings.length) return null;
    const xs = rings.flat().map((p) => p[0]);
    const ys = rings.flat().map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x;
    const h = Math.max(...ys) - y;
    if (w < 0.1 || h < 0.1) return null;
    const path = rings.map((r) => `M${r.map(([px, py]) => `${fmt(((px - x) / w) * 100)} ${fmt(((py - y) / h) * 100)}`).join('L')}Z`).join('');
    if (path.length <= LIMITS.pathChars) return { path, box: { x, y, w, h } };
  }
  return null;
}

/**
 * The brush: the stroke as a filled shape, `widthMm` wide (before pressure and the brush's own
 * shape), `smoothing` 0–1 easing a shaky hand. Null for nothing to keep.
 */
export function brushStroke(raw: readonly StrokePoint[], opts: { brush: Brush; widthMm: number; smoothing: number }): DrawnPath | null {
  if (!raw.length) return null;
  // Samples about a quarter of the width apart give a smooth edge without needless pieces.
  let pts = thinStroke(raw.slice(0, MAX_STROKE_POINTS), Math.max(0.2, opts.widthMm / 4));
  if (!pts.length) pts = [raw[0]];
  pts = smoothStroke(pts, opts.smoothing);
  // Very long strokes keep at most 700 samples, enough for any edge to stay smooth.
  if (pts.length > 700) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 700) === 0 || i === pts.length - 1);
  return regionPath(brushRegion(pts, opts.brush, opts.widthMm));
}
