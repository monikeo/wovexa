/**
 * Text on a path (spec TYP-02): the layer box that lands a text layer's letters exactly on a path
 * drawn on the artboard, and keeps that path where it is as the words, the font or the text's
 * place along it change. Browser only (text is measured).
 */
import { boundsOf, flattenSubpath, isClockwise, mapSubpaths, parsePath, pathData, reverseSubpath, type Subpath } from '@/domain/path-edit';
import type { LayerTransform, TextContent, TextPath } from '@/domain/schema';
import { isOnPath, layoutText, pathTrack } from '@/lib/render/zone-renderer';

type Box = { x: number; y: number; w: number; h: number };

/**
 * A path drawn on the artboard (mm) as a text path. A closed one (a circle's outline) runs
 * clockwise and starts so the text is centred at its top, reading left to right, over 40% of it;
 * an open line carries the text from end to end.
 */
export function textPathFrom(drawn: Subpath, side: TextPath['side'] = 'above'): { onPath: TextPath; box: Box } {
  const sub = drawn.closed && !isClockwise(drawn) ? reverseSubpath(drawn) : drawn;
  const b = boundsOf([sub]);
  // A straight line has no height to speak of: give the box some, keeping the aspect within bounds.
  const h = Math.max(b.h, 0.5, b.w / 500);
  const w = Math.max(b.w, 0.5, h / 500);
  const box = { x: b.x - (w - b.w) / 2, y: b.y - (h - b.h) / 2, w, h };
  const d = pathData(mapSubpaths([sub], (px, py) => [((px - box.x) / w) * 100, ((py - box.y) / h) * 100]));
  const onPath: TextPath = { d, aspect: w / h, start: 0, span: 1, side };
  if (sub.closed) {
    const track = pathTrack(onPath);
    if (track) {
      // The top of the shape: the point with the least y, as a share of the way round.
      const pts = flattenSubpath(parsePath(d)[0], 0.05);
      let top = 0;
      pts.forEach(([, py], i) => py < pts[top][1] && (top = i));
      const along = nearestAlong(track, pts[top][0] * onPath.aspect, pts[top][1]);
      onPath.span = 0.4;
      onPath.start = (((along / track.length - onPath.span / 2) % 1) + 1) % 1;
    }
  }
  return { onPath, box };
}

/** How far along a track the point nearest (x, y) is. */
function nearestAlong(track: NonNullable<ReturnType<typeof pathTrack>>, x: number, y: number) {
  let best = 0;
  let bestD = Infinity;
  track.pts.forEach(([px, py], i) => {
    const d = Math.hypot(px - x, py - y);
    if (d < bestD) {
      bestD = d;
      best = track.dist[i];
    }
  });
  return best;
}

/** The layer box that lands text with `onPath` set exactly on its path, drawn over `box` on the artboard. */
export function placeOnPath(content: TextContent, box: Box): Pick<LayerTransform, 'centerXmm' | 'centerYmm' | 'widthMm' | 'heightMm' | 'rotationDeg' | 'flipX' | 'flipY'> {
  const m = layoutText(content);
  const s = m.pathScale ?? 1;
  // 100 path units span the box's height; across, the aspect stretches them to its width.
  const unitMm = box.h / 100;
  const k = unitMm / s;
  return { centerXmm: box.x + (m.cx / s) * unitMm, centerYmm: box.y + (m.cy / s) * unitMm, widthMm: m.width * k, heightMm: m.height * k, rotationDeg: 0, flipX: false, flipY: false };
}

/**
 * A text-on-path layer's box after its content changes (new words, font, spacing, start, span or
 * side), so the path it follows stays exactly where it is on the artboard, turned and mirrored as before.
 */
export function keepPathInPlace(t: LayerTransform, before: TextContent, after: TextContent): Pick<LayerTransform, 'centerXmm' | 'centerYmm' | 'widthMm' | 'heightMm'> | undefined {
  const a = layoutText(before);
  const b = layoutText(after);
  if (!a.pathScale || !b.pathScale) return undefined;
  const kA = t.widthMm / a.width;
  // Millimetres per path unit now, which the path keeps.
  const unitMm = kA * a.pathScale;
  const kB = unitMm / b.pathScale;
  const ang = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const place = (x: number, y: number): [number, number] => {
    const fx = t.flipX ? -x : x;
    const fy = t.flipY ? -y : y;
    return [fx * cos - fy * sin, fx * sin + fy * cos];
  };
  // The path's origin (the layout's 0, 0) on the artboard, which must not move.
  const [ox, oy] = place(-a.cx * kA, -a.cy * kA);
  const originX = t.centerXmm + ox;
  const originY = t.centerYmm + oy;
  const [nx, ny] = place(-b.cx * kB, -b.cy * kB);
  return { centerXmm: originX - nx, centerYmm: originY - ny, widthMm: b.width * kB, heightMm: b.height * kB };
}

/**
 * Text on a path after its words or font change, keeping the letter size the way straight text
 * keeps its height: the words cover more or less of the path, centred where they were, and shrink
 * only when they no longer fit along it.
 */
export function keepLetterSize(before: TextContent, after: TextContent): TextPath | undefined {
  const p = before.onPath;
  if (!p || !isOnPath(before) || !isOnPath(after)) return after.onPath;
  const a = layoutText(before);
  const b = layoutText({ ...after, onPath: p });
  if (!a.pathScale || !b.pathScale) return p;
  // Same span: the path scale grows with the length of the words, so the span that keeps the old
  // scale (the letter size) grows by the same ratio.
  const span = Math.min(1, Math.max(0.05, p.span * (b.pathScale / a.pathScale)));
  const start = p.start + (p.span - span) / 2;
  return { ...p, span, start: pathTrack(p)?.closed ? ((start % 1) + 1) % 1 : Math.min(Math.max(0, start), 1 - span) };
}

/** The path reversed, so the text runs the other way (along the bottom of a circle badge). */
export function reversePath(onPath: TextPath): TextPath {
  const sub = parsePath(onPath.d)[0];
  if (!sub) return onPath;
  const start = sub.closed ? (((1 - onPath.start - onPath.span) % 1) + 1) % 1 : Math.max(0, 1 - onPath.start - onPath.span);
  return { ...onPath, d: pathData([reverseSubpath(sub)]), start };
}
