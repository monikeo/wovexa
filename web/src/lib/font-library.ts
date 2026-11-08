/**
 * Uploaded fonts (spec AST-07 font vault). Files are checked by signature and by actually loading
 * them, stored on this device with the licence statement given at upload, and registered with
 * the page on demand so every renderer (2D, 3D, print) draws them.
 */
import { newId } from '@/domain/factory';
import { ARTWORK_FONTS } from './fonts';
import { db, deleteFont as removeFont, getFont, listFonts, putFont, type StoredFont } from './local-db';

export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';
export const MAX_FONT_BYTES = 15 * 1024 * 1024;

export class FontError extends Error {}

export { listFonts };

async function sniffFont(file: Blob): Promise<StoredFont['format'] | null> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const tag = String.fromCharCode(...head);
  if ((head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0) || tag === 'true') return 'ttf';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  return null;
}

/** A family name safe to use in CSS font strings: letters, numbers, spaces and hyphens. */
export function cleanFamilyName(name: string) {
  return name
    .replace(/\.(ttf|otf|woff2?)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const registered = new Map<string, Promise<boolean>>();

async function register(font: StoredFont) {
  const face = new FontFace(font.family, await font.blob.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  return true;
}

export async function importFontFile(file: File, family: string, licenseNote: string): Promise<StoredFont> {
  if (file.size > MAX_FONT_BYTES) throw new FontError(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_FONT_BYTES / 1048576} MB.`);
  const format = await sniffFont(file);
  if (!format) throw new FontError(`${file.name} isn't a TTF, OTF, WOFF or WOFF2 font.`);
  const name = cleanFamilyName(family);
  if (!name) throw new FontError('Give the font a name.');
  if (ARTWORK_FONTS.some((f) => f.family.toLowerCase() === name.toLowerCase())) throw new FontError(`${name} is already a built-in font. Choose another name.`);
  if ((await listFonts()).some((f) => f.family.toLowerCase() === name.toLowerCase())) throw new FontError(`You already have a font called ${name}.`);
  const buffer = await file.arrayBuffer();
  // Loading it is the real check: a corrupt or unsupported file fails here, not at render time.
  const face = new FontFace(name, buffer.slice(0));
  try {
    await face.load();
  } catch {
    throw new FontError(`${file.name} couldn't be read as a font.`);
  }
  document.fonts.add(face);
  const now = Date.now();
  const font: StoredFont = {
    id: newId(),
    family: name,
    fileName: file.name.slice(0, 120),
    format,
    bytes: file.size,
    sha256: await sha256(buffer),
    blob: new Blob([buffer], { type: `font/${format}` }),
    licenseNote: licenseNote.trim().slice(0, 300),
    licenseConfirmedAt: now,
    createdAt: now,
  };
  await putFont(font);
  registered.set(font.id, Promise.resolve(true));
  return font;
}

/** Register uploaded fonts with the page. Resolves true if any face was newly added. */
export async function ensureCustomFonts(ids: string[]): Promise<boolean> {
  if (typeof document === 'undefined' || typeof indexedDB === 'undefined') return false;
  const results = await Promise.all(
    ids.map((id) => {
      const known = registered.get(id);
      if (known) return known.then(() => false);
      const pending = getFont(id)
        .then((font) => (font ? register(font) : false))
        .catch(() => false);
      registered.set(id, pending);
      return pending;
    }),
  );
  return results.some(Boolean);
}

/** Whether an uploaded font is on this device (designs can travel to devices without it). */
export async function hasFont(id: string) {
  return !!(await getFont(id));
}

/** Project titles that use a font, so deleting it can be refused while in use. */
export async function fontUsage(id: string): Promise<string[]> {
  const docs = await (await db()).getAll('documents');
  return docs.filter(({ document }) => JSON.stringify(document).includes(`"${id}"`)).map(({ document }) => (document as { title?: string }).title ?? 'Untitled');
}

export async function deleteFont(id: string) {
  const used = await fontUsage(id);
  if (used.length) throw new FontError(`This font is used in ${used.slice(0, 3).join(', ')}${used.length > 3 ? ` and ${used.length - 3} more` : ''}.`);
  await removeFont(id);
}
