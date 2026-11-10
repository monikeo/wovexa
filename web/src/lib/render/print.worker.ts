/// <reference lib="webworker" />
/**
 * Print worker (spec EXP-04, EXP-05): draws a print area's artwork at print resolution with the
 * canonical renderer on an OffscreenCanvas, then encodes it there (a PNG with its dpi, or CMYK rows
 * and a mask for a PDF/X page), so a 300 dpi export never freezes the studio. The page sends the
 * artwork, its images as bitmaps and what fonts it needs.
 */
import type { LayerStack } from '@/domain/schema';
import { registerImage } from '@/lib/assets';
import { cmykRaster, type CmykRaster } from '@/lib/export/pdf-x';
import { pngBlobWithDpi } from '@/lib/export/png-dpi';
import { loadPrintFonts, type PrintFonts } from './print-fonts';
import { clearTextLayoutCache, renderZoneArtwork } from './zone-renderer';

export interface PrintJob {
  id: number;
  format: 'png' | 'cmyk';
  stack: LayerStack;
  widthMm: number;
  heightMm: number;
  dpi: number;
  images: { id: string; bitmap: ImageBitmap }[];
  fonts: PrintFonts;
}

export type PrintReply =
  | { id: number; ok: true; format: 'png'; blob: Blob; dpi: number; width: number; height: number }
  | { id: number; ok: true; format: 'cmyk'; raster: CmykRaster; dpi: number }
  | { id: number; ok: false; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<PrintJob>) => {
  const job = event.data;
  try {
    for (const { id, bitmap } of job.images) registerImage(id, bitmap);
    // New faces change how text measures: layouts made before them are stale.
    if (await loadPrintFonts(job.fonts)) clearTextLayoutCache();
    const { canvas, dpi } = renderZoneArtwork(job.stack, job.widthMm, job.heightMm, job.dpi);
    const surface = canvas as unknown as OffscreenCanvas;
    if (job.format === 'cmyk') {
      const raster = await cmykRaster(surface.getContext('2d')!, surface.width, surface.height);
      // The deflated parts move to the page rather than being copied (each buffer once).
      const buffers = [...new Set([...raster.cmyk, ...(raster.mask ?? [])].map((part) => part.buffer as ArrayBuffer))];
      scope.postMessage({ id: job.id, ok: true, format: 'cmyk', raster, dpi } satisfies PrintReply, buffers);
    } else {
      const png = await surface.convertToBlob({ type: 'image/png' });
      const blob = await pngBlobWithDpi(png, dpi);
      scope.postMessage({ id: job.id, ok: true, format: 'png', blob, dpi, width: surface.width, height: surface.height } satisfies PrintReply);
    }
    // Free the print-size pixels now rather than when they are collected.
    surface.width = 0;
    surface.height = 0;
  } catch (error) {
    scope.postMessage({ id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies PrintReply);
  }
};
