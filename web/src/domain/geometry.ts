/** Physical-unit geometry helpers (spec §10, PRT-01). One place for every conversion. */
import type { LayerTransform } from './schema';

export const MM_PER_INCH = 25.4;

export const mmToInch = (mm: number) => mm / MM_PER_INCH;
export const inchToMm = (inch: number) => inch * MM_PER_INCH;

/** Pixels per millimetre for a given DPI. */
export const pxPerMm = (dpi: number) => dpi / MM_PER_INCH;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axis-aligned bounds of a rotated layer box, in zone millimetres. */
export function rotatedBounds(t: Pick<LayerTransform, 'centerXmm' | 'centerYmm' | 'widthMm' | 'heightMm' | 'rotationDeg'>): Rect {
  const rad = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = t.widthMm * cos + t.heightMm * sin;
  const h = t.widthMm * sin + t.heightMm * cos;
  return { x: t.centerXmm - w / 2, y: t.centerYmm - h / 2, width: w, height: h };
}

/** How far a rect sticks out past each side of a container (positive = outside). */
export function overflow(inner: Rect, outer: Rect) {
  return {
    left: outer.x - inner.x,
    top: outer.y - inner.y,
    right: inner.x + inner.width - (outer.x + outer.width),
    bottom: inner.y + inner.height - (outer.y + outer.height),
  };
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Round to a sensible display precision for millimetres. */
export const roundMm = (mm: number) => Math.round(mm * 10) / 10;

export function formatLength(mm: number, unit: 'mm' | 'in') {
  return unit === 'mm' ? `${roundMm(mm).toFixed(1)} mm` : `${mmToInch(mm).toFixed(2)} in`;
}
