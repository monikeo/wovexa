/**
 * Print PNGs rendered in the background (spec EXP-04): a print area's artwork at print resolution,
 * drawn by the canonical renderer in a worker and encoded there, so a 300 dpi export doesn't hold
 * up the studio. When a worker can't do it exactly (no worker canvas or fonts in this browser, a
 * font that won't load there) the page renders it as before: the file is the same either way.
 * Images and fonts must already be loaded on the page (prepareDocument).
 */
import type { Grade } from '@/domain/grading';
import { deepLayers } from '@/domain/lockups';
import type { LayerStack } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from '@/lib/assets';
import { canvasToBlob } from '@/lib/download';
import { buildPdfX, cmykRaster, type CmykRaster, type PdfXPage } from '@/lib/export/pdf-x';
import { pngBlobWithDpi } from '@/lib/export/png-dpi';
import { getFont } from '@/lib/local-db';
import { fontNeeds, type PrintFonts } from './print-fonts';
import type { PrintJob, PrintReply } from './print.worker';
import { MAX_EXPORT_SIDE, renderZoneArtwork } from './zone-renderer';

export interface PrintPng {
  blob: Blob;
  dpi: number;
  width: number;
  height: number;
}

/** A worker that takes longer than this is given up on, and the page renders the file. */
const WORKER_TIMEOUT_MS = 180_000;
/** An idle worker (and the images and fonts it holds) is let go after this. */
const IDLE_MS = 30_000;
/** Largest side a vector image is drawn at for the worker (it draws pixels, not the SVG). */
const MAX_SVG_PX = 8192;

let worker: Worker | null = null;
/** Assets the current worker already has. */
let sentImages = new Set<string>();
let jobs = 0;
const waiting = new Map<number, (reply: PrintReply) => void>();
let idle: ReturnType<typeof setTimeout> | undefined;
/** Set once the worker can't run here at all, so later files go straight to the page. */
let unsupported = false;

function canUseWorker() {
  return !unsupported && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

function stopWorker() {
  worker?.terminate();
  worker = null;
  sentImages = new Set();
  for (const done of waiting.values()) done({ id: -1, ok: false, error: 'Print worker stopped' });
  waiting.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  let w: Worker;
  try {
    w = new Worker(new URL('./print.worker.ts', import.meta.url), { type: 'module', name: 'wovexa-print' });
  } catch (error) {
    unsupported = true;
    throw error;
  }
  w.onmessage = (event: MessageEvent<PrintReply>) => {
    const done = waiting.get(event.data.id);
    waiting.delete(event.data.id);
    done?.(event.data);
  };
  w.onerror = (event) => {
    event.preventDefault();
    // A worker that fails to start (or crashes) won't do better next time on this page.
    unsupported = true;
    stopWorker();
  };
  worker = w;
  sentImages = new Set();
  return w;
}

/** How many pixels across each image asset is drawn at, at most, for print at `pxPerMm`. */
function imageSizes(stack: LayerStack, pxPerMm: number) {
  const sizes = new Map<string, { svg: boolean; px: number }>();
  const visit = (layer: LayerStack['layers'][string], scale: number) => {
    const c = layer.content;
    if (c.kind === 'image') {
      const px = Math.max(layer.transform.widthMm, layer.transform.heightMm) * scale * pxPerMm;
      const known = sizes.get(c.assetId);
      sizes.set(c.assetId, { svg: c.mime === 'image/svg+xml', px: Math.max(px, known?.px ?? 0) });
    } else if (c.kind === 'lockup') {
      const k = Math.max(layer.transform.widthMm / c.widthMm, layer.transform.heightMm / c.heightMm);
      for (const inner of Object.values(c.layers)) visit(inner, scale * k);
    }
  };
  for (const layer of Object.values(stack.layers)) visit(layer, 1);
  return sizes;
}

/** Bitmaps of the images the worker doesn't have yet: photos at their own size, vectors drawn at the size they print. */
async function bitmapsFor(stack: LayerStack, pxPerMm: number) {
  const out: { id: string; bitmap: ImageBitmap }[] = [];
  for (const [id, { svg, px }] of imageSizes(stack, pxPerMm)) {
    if (sentImages.has(id)) continue;
    const img = getLoadedImage(id) ?? (await loadAssetImage(id));
    if (svg) {
      const longest = Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
      const k = Math.min(MAX_SVG_PX, Math.max(longest, Math.ceil(px))) / longest;
      out.push({ id, bitmap: await createImageBitmap(img, { resizeWidth: Math.max(1, Math.round((img.naturalWidth || 1) * k)), resizeHeight: Math.max(1, Math.round((img.naturalHeight || 1) * k)), resizeQuality: 'high' }) });
    } else {
      out.push({ id, bitmap: await createImageBitmap(img) });
    }
  }
  return out;
}

async function fontsFor(stack: LayerStack): Promise<PrintFonts> {
  const needs = fontNeeds([stack]);
  const uploaded: PrintFonts['uploaded'] = [];
  for (const id of needs.uploadedIds) {
    const font = await getFont(id);
    // A design's uploaded font missing on this device renders in a stand-in on the page too; the worker can't do better.
    if (!font) throw new Error('An uploaded font is missing on this device');
    uploaded.push({ id, family: font.family, data: await font.blob.arrayBuffer() });
  }
  return { css: needs.css, uploaded, wanted: needs.wanted, families: needs.families };
}

async function renderInWorker(format: PrintJob['format'], stack: LayerStack, widthMm: number, heightMm: number, dpi: number, grade?: Grade): Promise<PrintReply> {
  const pxPerMm = Math.min(dpi / 25.4, MAX_EXPORT_SIDE / Math.max(widthMm, heightMm));
  // Graded-up artwork draws its vector images bigger too.
  const [images, fonts] = await Promise.all([bitmapsFor(stack, pxPerMm * Math.max(1, grade?.factor ?? 1)), fontsFor(stack)]);
  const w = getWorker();
  const id = ++jobs;
  const job: PrintJob = { id, format, stack, widthMm, heightMm, dpi, images, fonts, ...(grade ? { grade } : {}) };
  const reply = await new Promise<PrintReply>((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      // A stuck worker is let go; the next file starts a fresh one.
      stopWorker();
      resolve({ id, ok: false, error: 'Print worker timed out' });
    }, WORKER_TIMEOUT_MS);
    waiting.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    w.postMessage(
      job,
      images.map((i) => i.bitmap),
    );
    // The bitmaps moved to the worker with the job; it keeps them for the next files.
    for (const i of images) sentImages.add(i.id);
  });
  clearTimeout(idle);
  idle = setTimeout(() => !waiting.size && stopWorker(), IDLE_MS);
  return reply;
}

/** The print file drawn on the page itself: the way without a worker, and the fallback. */
export async function renderPrintPngOnPage(stack: LayerStack, widthMm: number, heightMm: number, dpi: number, grade?: Grade): Promise<PrintPng> {
  const { canvas, dpi: used } = renderZoneArtwork(stack, widthMm, heightMm, dpi, grade);
  const blob = await pngBlobWithDpi(await canvasToBlob(canvas), used);
  const out = { blob, dpi: used, width: canvas.width, height: canvas.height };
  canvas.width = 0;
  canvas.height = 0;
  return out;
}

/**
 * A print area's artwork as a true-size PNG with its dpi written in: rendered in the background
 * when it can be, on the page otherwise. The same pixels either way. `grade` prints artwork graded
 * by garment size.
 */
export async function renderPrintPng(stack: LayerStack, widthMm: number, heightMm: number, dpi: number, grade?: Grade): Promise<PrintPng & { background: boolean }> {
  if (canUseWorker() && deepLayers(stack).length) {
    try {
      const done = await renderInWorker('png', stack, widthMm, heightMm, dpi, grade);
      if (done.ok && done.format === 'png') return { blob: done.blob, dpi: done.dpi, width: done.width, height: done.height, background: true };
    } catch {
      // Anything the worker can't do, the page does.
    }
  }
  return { ...(await renderPrintPngOnPage(stack, widthMm, heightMm, dpi, grade)), background: false };
}

/** A print area's artwork as CMYK rows and a mask for a PDF/X page, drawn on the page itself. */
export async function renderCmykOnPage(stack: LayerStack, widthMm: number, heightMm: number, dpi: number): Promise<{ raster: CmykRaster; dpi: number }> {
  const { canvas, dpi: used } = renderZoneArtwork(stack, widthMm, heightMm, dpi);
  const raster = await cmykRaster(canvas.getContext('2d', { willReadFrequently: true })!, canvas.width, canvas.height);
  canvas.width = 0;
  canvas.height = 0;
  return { raster, dpi: used };
}

/** A print area's artwork as CMYK for a PDF/X page: in the background when it can be, on the page otherwise. */
export async function renderCmyk(stack: LayerStack, widthMm: number, heightMm: number, dpi: number): Promise<{ raster: CmykRaster; dpi: number }> {
  if (canUseWorker() && deepLayers(stack).length) {
    try {
      const done = await renderInWorker('cmyk', stack, widthMm, heightMm, dpi);
      if (done.ok && done.format === 'cmyk') return { raster: done.raster, dpi: done.dpi };
    } catch {
      // Anything the worker can't do, the page does.
    }
  }
  return renderCmykOnPage(stack, widthMm, heightMm, dpi);
}

/**
 * Print areas as one CMYK PDF/X-1a file, a page each at true size (spec EXP-05). Images and
 * fonts must already be loaded on the page.
 */
export async function buildPrintPdfX(areas: { stack: LayerStack; widthMm: number; heightMm: number; label: string }[], dpi: number, title: string, onPage?: (index: number) => void): Promise<{ blob: Blob; dpi: number }> {
  const pages: PdfXPage[] = [];
  let used = dpi;
  for (const [i, area] of areas.entries()) {
    onPage?.(i);
    const { raster, dpi: d } = await renderCmyk(area.stack, area.widthMm, area.heightMm, dpi);
    used = Math.min(used, d);
    pages.push({ ...raster, widthMm: area.widthMm, heightMm: area.heightMm, label: area.label });
  }
  return { blob: buildPdfX(pages, { title }), dpi: used };
}

// Development-only handle for checking the worker's files against the page's from the console.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __wovexaPrint: { renderPrintPng, renderPrintPngOnPage, renderCmyk, renderCmykOnPage, buildPrintPdfX } });
