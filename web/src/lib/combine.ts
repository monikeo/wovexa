/**
 * Combining shapes (spec ED2-09): union, subtract (the bottom one minus everything in front),
 * intersect and exclude, into one vector path. Shapes use their exact outlines, curves followed to
 * a few hundredths of a millimetre; text and images are traced round their own pixels, so lettering
 * can be cut out of a badge. Each layer's own area follows the even-odd rule it is drawn with.
 */
import polygonClipping, { type MultiPolygon, type Ring as ClipRing } from 'polygon-clipping';
import { flattenSubpath, parsePath } from '@/domain/path-edit';
import type { ArtworkLayer, LayerTransform } from '@/domain/schema';
import { shapePathData } from '@/domain/shape-path';
import { ringArea, simplifyRing, traceContours, type Ring } from '@/lib/render/trace';

export type CombineOp = 'union' | 'subtract' | 'intersect' | 'exclude';

/** How closely traced and simplified outlines follow the true edge, in mm; shape curves follow it closer still. */
const TOLERANCE_MM = 0.03;
const CURVE_TOLERANCE_MM = 0.01;

/** A layer-local point (mm from its centre) on the artboard, turned and mirrored as the layer is. */
function placer(t: LayerTransform) {
  const a = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return (x: number, y: number): [number, number] => {
    const lx = t.flipX ? -x : x;
    const ly = t.flipY ? -y : y;
    return [t.centerXmm + lx * cos - ly * sin, t.centerYmm + lx * sin + ly * cos];
  };
}

/** Rings filled by the even-odd rule, as one clean area. */
function evenOdd(rings: Ring[]): MultiPolygon {
  const polys = rings.filter((r) => r.length >= 3).map((r) => [r as ClipRing]);
  if (!polys.length) return [];
  return polys.length === 1 ? polygonClipping.union(polys[0]) : polygonClipping.xor(polys[0], ...polys.slice(1));
}

/** A shape's exact filled area on the artboard. */
export function shapeRegion(layer: ArtworkLayer): MultiPolygon {
  if (layer.content.kind !== 'shape') return [];
  const t = layer.transform;
  const place = placer(t);
  const rings = parsePath(shapePathData(layer.content, t.widthMm, t.heightMm))
    .filter((s) => s.closed || s.nodes.length > 2)
    .map((s) => flattenSubpath(s, CURVE_TOLERANCE_MM).map(([x, y]) => place(x, y)));
  return evenOdd(rings);
}

/** Text or an image as the area its own pixels cover, traced at about 0.1 mm. Browser only. */
async function tracedRegion(layer: ArtworkLayer): Promise<MultiPolygon> {
  const { layerBleedMm, renderRawLayer } = await import('@/lib/render/zone-renderer');
  const t = layer.transform;
  const padMm = layerBleedMm(layer) + 1;
  const ppm = Math.max(2, Math.min(10, 2400 / (Math.max(t.widthMm, t.heightMm) + 2 * padMm)));
  const pad = Math.ceil(padMm * ppm);
  const canvas = renderRawLayer(layer, ppm, pad);
  if (!canvas) return [];
  const W = canvas.width;
  const H = canvas.height;
  const alpha = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  canvas.width = canvas.height = 0;
  const field = new Float32Array(W * H);
  for (let i = 0; i < field.length; i++) field[i] = alpha[i * 4 + 3] - 127.5;
  const cx = pad + (t.widthMm * ppm) / 2;
  const cy = pad + (t.heightMm * ppm) / 2;
  const place = placer(t);
  const rings = traceContours(field, W, H)
    .map((r) => simplifyRing(r, TOLERANCE_MM * ppm))
    .filter((r) => r.length >= 3 && ringArea(r) / (ppm * ppm) > 0.02)
    .map((r) => r.map(([x, y]) => place((x - cx) / ppm, (y - cy) / ppm)));
  return evenOdd(rings);
}

/**
 * The area a layer prints on the artboard: exact for filled shapes; traced for text, images and
 * outline-only shapes (a ring or a pencil line prints its line, not the area inside it).
 */
export async function layerRegion(layer: ArtworkLayer): Promise<MultiPolygon> {
  return layer.content.kind === 'shape' && !layer.content.hollow ? shapeRegion(layer) : tracedRegion(layer);
}

/** Areas combined: `regions` bottom first, as the layers stack. */
export function combineRegions(op: CombineOp, regions: MultiPolygon[]): MultiPolygon {
  const [first, ...rest] = regions.filter((r) => r.length);
  if (!first) return [];
  if (!rest.length) return op === 'intersect' ? [] : first;
  switch (op) {
    case 'union':
      return polygonClipping.union(first, ...rest);
    case 'subtract':
      return polygonClipping.difference(first, ...rest);
    case 'intersect':
      return polygonClipping.intersection(first, ...rest);
    case 'exclude':
      return polygonClipping.xor(first, ...rest);
  }
}

/**
 * An area as a path layer's geometry: path data in a 0–100 box (even-odd, so holes stay holes)
 * and the box on the artboard. Null when nothing is left.
 */
export function regionToPath(region: MultiPolygon): { path: string; box: { x: number; y: number; w: number; h: number } } | null {
  const rings: Ring[] = [];
  for (const polygon of region) {
    for (const ring of polygon) {
      const open: Ring = ring.slice(0, ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? -1 : undefined) as Ring;
      const simple = simplifyRing(open, TOLERANCE_MM / 2);
      if (simple.length >= 3 && ringArea(simple) > 0.01) rings.push(simple);
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
  const n = (v: number) => String(Math.round(v * 100) / 100);
  const path = rings.map((r) => `M${r.map(([px, py]) => `${n(((px - x) / w) * 100)} ${n(((py - y) / h) * 100)}`).join('L')}Z`).join('');
  return { path, box: { x, y, w, h } };
}

/** Layers (bottom first) combined into one path's geometry, or null when nothing is left. */
export async function combineLayers(op: CombineOp, layers: ArtworkLayer[]) {
  const regions = await Promise.all(layers.map(layerRegion));
  return regionToPath(combineRegions(op, regions));
}

/** Total area of a region in mm² (holes taken out), for checks and tests. */
export function regionArea(region: MultiPolygon) {
  let total = 0;
  for (const polygon of region) polygon.forEach((ring, i) => (total += (i === 0 ? 1 : -1) * ringArea(ring as Ring)));
  return total;
}
