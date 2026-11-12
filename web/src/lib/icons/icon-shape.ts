/**
 * A library icon as a WOVEXA line shape. Lucide draws each icon as a few SVG elements (paths,
 * circles, rectangles, lines, polylines) stroked 2 units wide on a 24 unit grid, with round ends
 * and corners. Here they become one outline-only path in the 0–100 box shape layers use, with the
 * icon's own proportions, so it lands editable point by point, recolours like any shape, and its
 * line can be turned into a filled shape with Outline stroke.
 */
import { boundsOf, mapSubpaths, parsePath, pathData } from '@/domain/path-edit';
import { ellipsePath, pointsPath, rectPath } from '@/lib/svg-import';

/** One drawing element: its SVG tag and attributes, as lucide-react ships them. */
export type IconElement = readonly [string, Readonly<Record<string, string | number | undefined>>];

export interface IconData {
  name: string;
  /** The grid the icon is drawn on (24). */
  size?: number;
  node: readonly IconElement[];
}

/** Lucide's line width, in its grid units. */
export const ICON_STROKE_UNITS = 2;

/** One element as path data in the icon's own units; empty for anything that draws nothing. */
export function elementPath([tag, attrs]: IconElement): string {
  const n = (key: string) => Number(attrs[key] ?? 0) || 0;
  switch (tag) {
    case 'path':
      return String(attrs.d ?? '');
    case 'circle':
      return ellipsePath(n('cx'), n('cy'), n('r'), n('r'));
    case 'ellipse':
      return ellipsePath(n('cx'), n('cy'), n('rx'), n('ry'));
    case 'rect':
      return rectPath(n('x'), n('y'), n('width'), n('height'), n('rx'), n('ry'));
    case 'line':
      return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
    case 'polyline':
      return pointsPath(String(attrs.points ?? ''), false);
    case 'polygon':
      return pointsPath(String(attrs.points ?? ''), true);
    default:
      return '';
  }
}

export interface IconShape {
  /** Every element as one path, in the 0–100 box. */
  path: string;
  /** The drawing's extent in icon units: the layer keeps its proportions. */
  box: { x: number; y: number; w: number; h: number };
}

/** The icon as one path over its own extent, or null when it draws nothing. */
export function iconShape(icon: IconData): IconShape | null {
  // Each element parsed on its own: a path may open with a relative "m", which counts from the
  // origin at the start of its own data but would count from the last point if the data were joined.
  const subpaths = icon.node.flatMap((el) => parsePath(elementPath(el)));
  if (!subpaths.length) return null;
  const b = boundsOf(subpaths);
  if (!Number.isFinite(b.w) || !Number.isFinite(b.h)) return null;
  // A dot or a straight line still gets a box to place and resize by.
  const w = Math.max(b.w, 0.5);
  const h = Math.max(b.h, 0.5);
  const x = b.x - (w - b.w) / 2;
  const y = b.y - (h - b.h) / 2;
  const path = pathData(mapSubpaths(subpaths, (px, py) => [((px - x) / w) * 100, ((py - y) / h) * 100]));
  return { path, box: { x, y, w, h } };
}
