/**
 * In-studio ink count (spec PRT-06): the print area drawn small, its colours folded into the inks a
 * screen printer would mix, and a white underbase on dark garments. The same analysis that makes
 * the production package's films, at preview resolution, so the count matches what gets printed.
 */
import type { LayerStack } from '@/domain/schema';
import { assignInks, colorDistance, findInks, isTonal, type Ink } from '@/lib/export/separations';
import { drawZone } from '@/lib/render/zone-renderer';

export interface InkReport {
  inks: Ink[];
  /** Photos or wide gradients: they print flat unless halftoned. */
  tonal: boolean;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** The ink printing each pixel (255 where nothing prints). */
  index: Uint8Array;
  /** False while an image was still loading: count again once it arrives. */
  complete: boolean;
}

/** Most inks the studio counts; past a press's usual 6 to 8 heads it says so. */
export const MAX_COUNTED_INKS = 12;
export const PRESS_HEADS = 8;

/** Draw the print area at about 2 px a millimetre and find its inks. */
export function analyzeInks(stack: LayerStack, widthMm: number, heightMm: number): InkReport {
  const ppm = Math.min(2, 900 / Math.max(widthMm, heightMm));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(widthMm * ppm));
  canvas.height = Math.max(1, Math.round(heightMm * ppm));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const complete = drawZone(ctx, stack, { pxPerMm: ppm });
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = canvas.height = 0;
  const inks = findInks(data, { maxInks: MAX_COUNTED_INKS });
  return { inks, tonal: isTonal(data, inks), width: Math.round(widthMm * ppm), height: Math.round(heightMm * ppm), data, index: assignInks(data, inks), complete };
}

/** An ink close enough to the garment that a printer would leave it off and let the fabric show (a knockout). */
export function matchesGarment(ink: Ink, garmentHex: string) {
  const h = garmentHex.replace('#', '');
  return colorDistance(ink.rgb, [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))) < 60;
}

/**
 * What one screen prints, over the print area: white for the underbase (not under inks that match
 * the garment, which are left off), else that ink's colour. Transparent elsewhere.
 */
export function plateCanvas(report: InkReport, plate: 'underbase' | number, garmentHex: string): HTMLCanvasElement {
  const { width, height, data, index } = report;
  const out = new ImageData(Math.max(1, width), Math.max(1, height));
  const rgb = plate === 'underbase' ? [255, 255, 255] : report.inks[plate].rgb;
  const knockout = report.inks.map((ink) => matchesGarment(ink, garmentHex));
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const on = plate === 'underbase' ? index[p] !== 255 && !knockout[index[p]] : index[p] === plate;
    if (!on) continue;
    out.data[i] = rgb[0];
    out.data[i + 1] = rgb[1];
    out.data[i + 2] = rgb[2];
    out.data[i + 3] = data[i + 3];
  }
  const canvas = document.createElement('canvas');
  canvas.width = out.width;
  canvas.height = out.height;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  return canvas;
}
