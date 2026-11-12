/**
 * 3D extrusion defaults (spec TYP-03): the block behind extruded artwork takes the artwork's own
 * colour, darker for light artwork and lighter for dark artwork, so its sides read as depth on
 * any garment instead of vanishing into the letters.
 */
import type { ArtworkLayer, LayerExtrude } from './schema';

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const toHex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');

/** The colour for the sides of `fill`'s block: a third of its brightness for light colours, mixed halfway to grey for dark ones. */
export function extrudeColorFor(fill: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(fill)) return '#1A1A1A';
  const rgb = [0, 1, 2].map((i) => channel(fill, i));
  const lum = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2];
  const out = lum > 90 ? rgb.map((v) => v * 0.35) : rgb.map((v) => v + (150 - v) * 0.5);
  return `#${out.map(toHex).join('')}`.toUpperCase();
}

/** A first extrusion for a layer: 3 mm deep, down and to the right, shaded toward the back. */
export function defaultExtrude(layer: Pick<ArtworkLayer, 'content'>): LayerExtrude {
  const c = layer.content;
  const fill = c.kind === 'text' || c.kind === 'shape' ? c.fill : '#FFFFFF';
  return { color: extrudeColorFor(fill), depthMm: 3, angleDeg: 45, shade: true };
}
