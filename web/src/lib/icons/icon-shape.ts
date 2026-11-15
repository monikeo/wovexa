/**
 * A library icon as a WOVEXA line shape. Lucide draws each icon as a few SVG elements (paths,
 * circles, rectangles, lines, polylines) stroked 2 units wide on a 24 unit grid, with round ends
 * and corners. Here they become one outline-only path in the 0–100 box shape layers use, with the
 * icon's own proportions, so it lands editable point by point, recolours like any shape, and its
 * line can be turned into a filled shape with Outline stroke. Outline-only lines are drawn with
 * round corners everywhere (2D view, PNG, PDF and SVG print files), as Lucide draws them.
 */
import { createGraphicLayer } from '@/domain/factory';
import { boundsOf, mapSubpaths, parsePath, pathData } from '@/domain/path-edit';
import type { ArtworkLayer } from '@/domain/schema';
import { ellipsePath, pointsPath, rectPath } from '@/lib/svg-import';

/** One drawing element: its SVG tag and attributes, as Lucide ships them. */
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

/** A placed icon's ink (its drawing and line), as library graphics land: this share of the print area's shorter side. */
export const ICON_PLACE_SHARE = 0.45;

/** The heaviest line an icon lands with, in mm (the most the line width field takes): a dot or a dash lands smaller instead. */
export const ICON_MAX_LINE_MM = 20;

/**
 * A library icon as a new layer, in `ink`: one outline-only path holding every piece of the icon,
 * with round ends, centred in the print area and keeping the icon's proportions. Its ink (the
 * drawing and the line round it) lands as big as library graphics do, its line as heavy for that
 * size as the icon is drawn. It remembers the icon it came from, so export packages can credit it.
 * Null when the icon draws nothing.
 */
export function iconLayer(zone: { printableWidthMm: number; printableHeightMm: number }, icon: IconData, label: string, ink: string): ArtworkLayer | null {
  const shape = iconShape(icon);
  if (!shape) return null;
  const { w, h } = shape.box;
  // The line reaches half its width (one unit) past the drawing all round.
  const inkUnits = Math.max(w, h) + ICON_STROKE_UNITS;
  const mmPerUnit = Math.min((Math.min(zone.printableWidthMm, zone.printableHeightMm) * ICON_PLACE_SHARE) / inkUnits, ICON_MAX_LINE_MM / ICON_STROKE_UNITS);
  const layer = createGraphicLayer(zone, { id: 'icon', name: `${label} icon`.slice(0, 120), path: shape.path, aspect: w / h }, ink);
  if (layer.content.kind !== 'shape') return null;
  Object.assign(layer.transform, { widthMm: w * mmPerUnit, heightMm: h * mmPerUnit });
  delete layer.content.graphicId;
  const strokeWidthMm = Math.max(0.3, Math.round(ICON_STROKE_UNITS * mmPerUnit * 10) / 10);
  Object.assign(layer.content, { hollow: true, strokeWidthMm, roundCaps: true, icon: { set: 'lucide', name: icon.name } });
  return layer;
}
