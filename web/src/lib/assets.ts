/**
 * Safe file intake (spec AST-02/03, SEC-03/04). Every upload is checked by content signature,
 * size and pixel count; SVGs are sanitized before they are stored. Originals stay immutable.
 */
import DOMPurify from 'dompurify';
import { newId } from '@/domain/factory';
import { findAssetByHash, getAsset, putAsset, type StoredAsset } from './local-db';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/svg+xml,.svg';

export class AssetError extends Error {}

type Sniffed = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';

/** Identify the file from its first bytes, not its name or the browser-reported type. */
async function sniff(file: Blob): Promise<Sniffed | null> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'image/webp';
  const text = new TextDecoder().decode(head).trimStart().toLowerCase();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return 'image/svg+xml';
  return null;
}

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A link to something in the same SVG by its id: a reused symbol, a gradient taking another's stops. */
const INTERNAL_REF = /^#[A-Za-z_][\w.:-]*$/;

function sanitizeSvg(source: string): string {
  // Links go, except to something in the same file, which can't reach out of it: without them a
  // reused symbol vanishes, and a gradient built on another (as Inkscape writes them) loses its colours.
  const keepInternal = (_node: Element, data: { attrName: string; attrValue: string; forceKeepAttr?: boolean }) => {
    if ((data.attrName === 'href' || data.attrName === 'xlink:href') && INTERNAL_REF.test(data.attrValue.trim())) data.forceKeepAttr = true;
  };
  DOMPurify.addHook('uponSanitizeAttribute', keepInternal);
  let clean: string;
  try {
    clean = DOMPurify.sanitize(source, {
      USE_PROFILES: { svg: true, svgFilters: true },
      // <use> is safe once it can only point inside the file (the hook above): any other link is gone.
      ADD_TAGS: ['use'],
      FORBID_TAGS: ['foreignObject', 'script', 'iframe', 'image'],
      FORBID_ATTR: ['xlink:href', 'href'],
    });
  } finally {
    DOMPurify.removeHook('uponSanitizeAttribute', keepInternal);
  }
  if (!clean.includes('<svg')) throw new AssetError('This SVG has no drawable content after removing unsafe parts.');
  return clean;
}

/** Ensure an SVG has an intrinsic size so it rasterizes predictably. */
function svgDimensions(svg: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const el = doc.documentElement;
  const num = (v: string | null) => (v && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : NaN);
  let width = num(el.getAttribute('width'));
  let height = num(el.getAttribute('height'));
  const vb = el.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  if ((!width || !height) && vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    const scale = 1024 / Math.max(vb[2], vb[3]);
    width = vb[2] * scale;
    height = vb[3] * scale;
  }
  return { width: Math.round(width || 1024), height: Math.round(height || 1024) };
}

function withSize(svg: string, width: number, height: number) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  doc.documentElement.setAttribute('width', String(width));
  doc.documentElement.setAttribute('height', String(height));
  return new XMLSerializer().serializeToString(doc);
}

async function decodeSize(blob: Blob): Promise<{ width: number; height: number }> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  const img = await loadImage(URL.createObjectURL(blob));
  return { width: img.naturalWidth, height: img.naturalHeight };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new AssetError('The image could not be decoded.'));
    img.src = src;
  });
}

export async function importImageFile(file: File): Promise<StoredAsset> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new AssetError(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1048576} MB.`);
  }
  const type = await sniff(file);
  if (!type) throw new AssetError(`${file.name} isn't a PNG, JPEG, WebP or SVG image.`);

  let blob: Blob = file;
  let size: { width: number; height: number };
  if (type === 'image/svg+xml') {
    const clean = sanitizeSvg(await file.text());
    size = svgDimensions(clean);
    blob = new Blob([withSize(clean, size.width, size.height)], { type });
  } else {
    blob = new Blob([await file.arrayBuffer()], { type });
    size = await decodeSize(blob);
    if (size.width * size.height > MAX_PIXELS) {
      throw new AssetError(`${file.name} is ${size.width} × ${size.height} px. The limit is ${MAX_PIXELS / 1e6} megapixels.`);
    }
  }

  const hash = await sha256(blob);
  const existing = await findAssetByHash(hash);
  if (existing) return existing;

  const asset: StoredAsset = {
    id: newId(),
    name: file.name.slice(0, 120),
    mime: type,
    width: size.width,
    height: size.height,
    bytes: blob.size,
    sha256: hash,
    blob,
    createdAt: Date.now(),
  };
  await putAsset(asset);
  return asset;
}

// ---- Runtime image cache shared by the 2D editor, 3D textures and exports ----

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const loaded = new Map<string, HTMLImageElement>();
/** Images not on this device (a design from elsewhere, a deleted asset): nothing will ever load. */
const missing = new Set<string>();

export function loadAssetImage(assetId: string): Promise<HTMLImageElement> {
  let pending = imageCache.get(assetId);
  if (!pending) {
    pending = getAsset(assetId).then(async (asset) => {
      if (!asset) throw new AssetError('This image is missing from this device.');
      const img = await loadImage(URL.createObjectURL(asset.blob));
      loaded.set(assetId, img);
      missing.delete(assetId);
      return img;
    });
    pending.catch((error: unknown) => {
      imageCache.delete(assetId);
      if (error instanceof AssetError) missing.add(assetId);
    });
    imageCache.set(assetId, pending);
  }
  return pending;
}

/** Whether an image is known to be missing from this device, so waiting for it is pointless. */
export function imageMissing(assetId: string) {
  return missing.has(assetId);
}

/** Synchronous access for render loops; returns undefined until loadAssetImage resolves. */
export function getLoadedImage(assetId: string): HTMLImageElement | undefined {
  return loaded.get(assetId);
}

/**
 * Decoded pixels for an asset, put straight in the cache: how a print worker, which can't decode
 * SVG or reach the page's images, gets them. The renderer reads them like any loaded image.
 */
export function registerImage(assetId: string, image: ImageBitmap) {
  loaded.set(assetId, image as unknown as HTMLImageElement);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}
