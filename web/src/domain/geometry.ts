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

/** Whether a zone point (mm) falls inside a layer's rotated box. */
export function pointInLayer(t: Pick<LayerTransform, 'centerXmm' | 'centerYmm' | 'widthMm' | 'heightMm' | 'rotationDeg'>, xMm: number, yMm: number) {
  const r = (-t.rotationDeg * Math.PI) / 180;
  const dx = xMm - t.centerXmm;
  const dy = yMm - t.centerYmm;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= t.widthMm / 2 && Math.abs(ly) <= t.heightMm / 2;
}

/** Topmost visible layer under a zone point, or null (spec ED3-04 surface selection). */
export function hitTestLayer(zone: { orderedLayerIds: string[]; layers: Record<string, { visible: boolean; transform: LayerTransform }> }, xMm: number, yMm: number): string | null {
  for (let i = zone.orderedLayerIds.length - 1; i >= 0; i--) {
    const id = zone.orderedLayerIds[i];
    const layer = zone.layers[id];
    if (layer?.visible && pointInLayer(layer.transform, xMm, yMm)) return id;
  }
  return null;
}

/** Rotation folded into [-180, 180). */
export function normalizeDeg(deg: number) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/**
 * A layer's box after its image is cropped to `crop` (pixels of a `natW` × `natH` image): a tighter
 * box with the artwork exactly where it was, turned and mirrored as the layer is.
 */
export function croppedTransform(t: LayerTransform, natW: number, natH: number, crop: { x: number; y: number; w: number; h: number }): Pick<LayerTransform, 'centerXmm' | 'centerYmm' | 'widthMm' | 'heightMm'> {
  const sx = t.widthMm / natW;
  const sy = t.heightMm / natH;
  // The crop's centre from the image's centre, in the layer's own millimetres...
  let dx = (crop.x + crop.w / 2 - natW / 2) * sx;
  let dy = (crop.y + crop.h / 2 - natH / 2) * sy;
  // ...mirrored and turned as the layer draws (translate, rotate, then flip).
  if (t.flipX) dx = -dx;
  if (t.flipY) dy = -dy;
  const a = (t.rotationDeg * Math.PI) / 180;
  return {
    centerXmm: t.centerXmm + dx * Math.cos(a) - dy * Math.sin(a),
    centerYmm: t.centerYmm + dx * Math.sin(a) + dy * Math.cos(a),
    widthMm: crop.w * sx,
    heightMm: crop.h * sy,
  };
}

type Box = Pick<LayerTransform, 'centerXmm' | 'centerYmm' | 'widthMm' | 'heightMm' | 'rotationDeg'>;

/**
 * Scale and rotate a selection about the centre of its bounds, as one rigid unit (direct
 * manipulation on the 3D garment: pinch, twist, wheel). No layer shrinks below `minMm`.
 */
export function scaleRotateAbout(transforms: Record<string, Box>, scale: number, rotateDeg: number, minMm = 2): Record<string, Box> {
  const ids = Object.keys(transforms);
  if (!ids.length) return {};
  const bounds = ids.map((id) => rotatedBounds(transforms[id]));
  const x0 = Math.min(...bounds.map((b) => b.x));
  const y0 = Math.min(...bounds.map((b) => b.y));
  const x1 = Math.max(...bounds.map((b) => b.x + b.width));
  const y1 = Math.max(...bounds.map((b) => b.y + b.height));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const smallest = Math.min(...ids.map((id) => Math.min(transforms[id].widthMm, transforms[id].heightMm)));
  const largest = Math.max(...ids.map((id) => Math.max(transforms[id].widthMm, transforms[id].heightMm)));
  const k = clamp(scale, minMm / smallest, 3000 / largest);
  const a = (rotateDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const out: Record<string, Box> = {};
  for (const id of ids) {
    const t = transforms[id];
    const dx = t.centerXmm - cx;
    const dy = t.centerYmm - cy;
    out[id] = {
      centerXmm: cx + (dx * cos - dy * sin) * k,
      centerYmm: cy + (dx * sin + dy * cos) * k,
      widthMm: t.widthMm * k,
      heightMm: t.heightMm * k,
      rotationDeg: normalizeDeg(t.rotationDeg + rotateDeg),
    };
  }
  return out;
}

/** Round to a sensible display precision for millimetres. */
export const roundMm = (mm: number) => Math.round(mm * 10) / 10;

export function formatLength(mm: number, unit: 'mm' | 'in') {
  return unit === 'mm' ? `${roundMm(mm).toFixed(1)} mm` : `${mmToInch(mm).toFixed(2)} in`;
}
