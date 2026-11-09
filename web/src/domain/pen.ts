/**
 * The pen: a shape drawn point by point on the artboard. Each point is a corner, or a smooth
 * point with a handle (dragged out as it is placed) that bends the curve through it. The finished
 * shape is a path in a 0–100 box, like the graphics library's, placed over its own bounds, so it
 * prints, renders and exports (SVG included) like any shape. Pure geometry, millimetres.
 */

/** A pen point in artboard millimetres, with its outgoing handle offset (the incoming one mirrors it). */
export interface PenPoint {
  x: number;
  y: number;
  hx?: number;
  hy?: number;
}

/** At most this many points per shape: plenty for a badge or a letterform, within a layer's path limit. */
export const MAX_PEN_POINTS = 120;

const fmt = (v: number) => String(Math.round(v * 100) / 100);

/** The cubic segment from point `a` to point `b`: a's outgoing handle, b's incoming one (mirrored). */
function segment(a: PenPoint, b: PenPoint): [number, number, number, number, number, number] {
  return [a.x + (a.hx ?? 0), a.y + (a.hy ?? 0), b.x - (b.hx ?? 0), b.y - (b.hy ?? 0), b.x, b.y];
}

const straight = (a: PenPoint, b: PenPoint) => !a.hx && !a.hy && !b.hx && !b.hy;

/** Path data through the points, in their own units, closed back to the first when `closed`. */
export function penPathData(points: readonly PenPoint[], closed: boolean, map: (x: number, y: number) => [number, number] = (x, y) => [x, y]): string {
  if (!points.length) return '';
  const P = (x: number, y: number) => map(x, y).map(fmt).join(' ');
  const out = [`M${P(points[0].x, points[0].y)}`];
  const pairs = points.map((p, i) => [p, points[i + 1]] as const).filter(([, b]) => b);
  if (closed && points.length > 2) pairs.push([points[points.length - 1], points[0]]);
  for (const [a, b] of pairs) {
    if (!b) continue;
    if (straight(a, b)) out.push(`L${P(b.x, b.y)}`);
    else {
      const [x1, y1, x2, y2, x, y] = segment(a, b);
      out.push(`C${P(x1, y1)} ${P(x2, y2)} ${P(x, y)}`);
    }
  }
  if (closed) out.push('Z');
  return out.join(' ');
}

/** The tight bounds of the closed shape: anchors, plus each curve sampled along its length. */
export function penBounds(points: readonly PenPoint[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  points.forEach((a, i) => {
    add(a.x, a.y);
    const b = points[(i + 1) % points.length];
    if (points.length < 2 || straight(a, b)) return;
    const [cx1, cy1, cx2, cy2, x, y] = segment(a, b);
    for (let k = 1; k < 24; k++) {
      const t = k / 24;
      const u = 1 - t;
      add(u * u * u * a.x + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x, u * u * u * a.y + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y);
    }
  });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * A finished pen shape: its path in a 0–100 box and where that box sits on the artboard (mm).
 * Null for fewer than three points or a shape with no area to speak of.
 */
export function penShape(points: readonly PenPoint[]): { path: string; box: { x: number; y: number; w: number; h: number } } | null {
  if (points.length < 3) return null;
  const box = penBounds(points);
  if (box.w < 0.5 || box.h < 0.5) return null;
  const path = penPathData(points.slice(0, MAX_PEN_POINTS), true, (x, y) => [((x - box.x) / box.w) * 100, ((y - box.y) / box.h) * 100]);
  return { path, box };
}
