/**
 * Text on a path (spec TYP-02): the layer box that lands a text layer's letters exactly on a path
 * drawn on the artboard, and keeps that path where it is as the words, the font or the text's
 * place along it change. Browser only (text is measured).
 */
import { boundsOf, flattenSubpath, isClockwise, mapSubpaths, parsePath, pathData, pathLength, reverseSubpath, type PathSpace, type Subpath } from '@/domain/path-edit';
import type { LayerTransform, TextContent, TextPath } from '@/domain/schema';
import { isOnPath, layoutText, pathTrack } from '@/lib/render/zone-renderer';

type Box = { x: number; y: number; w: number; h: number };

/** A path in millimetres as path data in its own 0–100 box, with the box's aspect and place. */
function boxPath(sub: Subpath): { d: string; aspect: number; box: Box } {
  const b = boundsOf([sub]);
  // A straight line has no height to speak of: give the box some, keeping the aspect within bounds.
  const h = Math.max(b.h, 0.5, b.w / 500);
  const w = Math.max(b.w, 0.5, h / 500);
  const box = { x: b.x - (w - b.w) / 2, y: b.y - (h - b.h) / 2, w, h };
  const d = pathData(mapSubpaths([sub], (px, py) => [((px - box.x) / w) * 100, ((py - box.y) / h) * 100]));
  return { d, aspect: w / h, box };
}

/** A point in a layer's own frame (mm from its centre) turned and mirrored as the layer is: its offset on the artboard. */
function turned(t: Pick<LayerTransform, 'rotationDeg' | 'flipX' | 'flipY'>, x: number, y: number): [number, number] {
  const ang = (t.rotationDeg * Math.PI) / 180;
  const fx = t.flipX ? -x : x;
  const fy = t.flipY ? -y : y;
  return [fx * Math.cos(ang) - fy * Math.sin(ang), fx * Math.sin(ang) + fy * Math.cos(ang)];
}

/**
 * A path drawn on the artboard (mm) as a text path. A closed one (a circle's outline) runs
 * clockwise and starts so the text is centred at its top, reading left to right, over 40% of it;
 * an open line carries the text from end to end.
 */
export function textPathFrom(drawn: Subpath, side: TextPath['side'] = 'above'): { onPath: TextPath; box: Box } {
  const sub = drawn.closed && !isClockwise(drawn) ? reverseSubpath(drawn) : drawn;
  const { d, aspect, box } = boxPath(sub);
  const onPath: TextPath = { d, aspect, start: 0, span: 1, side };
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
  // The path's origin (the layout's 0, 0) on the artboard, which must not move.
  const [ox, oy] = turned(t, -a.cx * kA, -a.cy * kA);
  const originX = t.centerXmm + ox;
  const originY = t.centerYmm + oy;
  const [nx, ny] = turned(t, -b.cx * kB, -b.cy * kB);
  return { centerXmm: originX - nx, centerYmm: originY - ny, widthMm: b.width * kB, heightMm: b.height * kB };
}

/**
 * Where a text-on-path layer's path units land in the layer, exactly as the renderer draws it:
 * path units to the layout (across times the aspect, then the path scale), the layout's ink box
 * stretched over the layer box. Null when the text isn't on a path.
 */
export function textPathSpace(content: TextContent, t: Pick<LayerTransform, 'widthMm' | 'heightMm'>): PathSpace | null {
  if (!content.onPath || !isOnPath(content)) return null;
  const m = layoutText(content);
  const s = m.pathScale;
  if (!s || !(m.width > 0) || !(m.height > 0) || !(t.widthMm > 0) || !(t.heightMm > 0)) return null;
  const across = content.onPath.aspect * s;
  const kx = t.widthMm / m.width;
  const ky = t.heightMm / m.height;
  return {
    toLocal: (u, v) => [(u * across - m.cx) * kx, (v * s - m.cy) * ky],
    fromLocal: (x, y) => [(x / kx + m.cx) / across, (y / ky + m.cy) / s],
  };
}

/** Shorter than this (mm), a line can't carry letters. */
const MIN_TEXT_PATH_MM = 2;

/**
 * A text-on-path layer after the points of its path are edited (`edited` is in the path's own
 * units, as shown while editing): the path stays exactly where it was dragged to on the artboard,
 * and the letters keep their size, centred where they were along it, shrinking only when the line
 * gets too short for them. Null when the edited line is too short to carry text.
 */
export function editedTextPath(
  content: TextContent,
  t: LayerTransform,
  edited: Subpath,
): { onPath: TextPath; transform: Pick<LayerTransform, 'centerXmm' | 'centerYmm' | 'widthMm' | 'heightMm'> } | null {
  const space = textPathSpace(content, t);
  const p = content.onPath;
  const before = p ? parsePath(p.d)[0] : undefined;
  if (!space || !p || !before || edited.nodes.length < (edited.closed ? 3 : 2)) return null;
  // Both paths in the layer's own millimetres, where their lengths compare.
  const oldMm = mapSubpaths([before], space.toLocal)[0];
  const newMm = mapSubpaths([edited], space.toLocal)[0];
  const newLength = pathLength(newMm);
  if (!(newLength >= MIN_TEXT_PATH_MM)) return null;
  // The words keep their length in millimetres, so they cover more or less of the new line.
  const span = Math.min(1, Math.max(0.05, (p.span * pathLength(oldMm)) / newLength));
  const centre = p.start + p.span / 2;
  const start = newMm.closed ? (((centre - span / 2) % 1) + 1) % 1 : Math.min(Math.max(0, centre - span / 2), 1 - span);
  const { d, aspect, box } = boxPath(newMm);
  const onPath: TextPath = { ...p, d, aspect, start, span };
  // Placed in the layer's own frame, then turned and mirrored onto the artboard as before.
  const placed = placeOnPath({ ...content, onPath }, box);
  const [ox, oy] = turned(t, placed.centerXmm, placed.centerYmm);
  return { onPath, transform: { centerXmm: t.centerXmm + ox, centerYmm: t.centerYmm + oy, widthMm: placed.widthMm, heightMm: placed.heightMm } };
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
