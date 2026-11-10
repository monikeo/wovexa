/**
 * The fonts a print file needs (spec EXP-04), worked out on the page and loaded in a print worker.
 * A worker has a font set of its own, so it loads the same Google Fonts faces the page does (from
 * the same stylesheets) and the device's uploaded fonts, then checks every face a design draws is
 * really there. If one isn't, the worker refuses the job and the page renders it, so a print file
 * never comes out in a stand-in font.
 */
import { deepLayers } from '@/domain/lockups';
import type { LayerStack } from '@/domain/schema';
import { findFont, fontCssHref, scriptFallbacks } from '@/lib/fonts';
import { fontString } from './zone-renderer';

export interface PrintFonts {
  /** Google Fonts stylesheets for the catalogue families the text uses. */
  css: string[];
  /** Uploaded fonts by family, as their files. */
  uploaded: { id: string; family: string; data: ArrayBuffer }[];
  /** Font strings with the text drawn in them: what must load before drawing. */
  wanted: [font: string, text: string][];
  /** Families that must be in the worker's font set once loaded. */
  families: string[];
}

/** What fonts the text in these stacks (lockup placements included) needs, without the uploaded files yet. */
export function fontNeeds(stacks: Pick<LayerStack, 'layers'>[]): { css: string[]; uploadedIds: string[]; wanted: [string, string][]; families: string[] } {
  const css = new Set<string>();
  const uploadedIds = new Set<string>();
  const wanted = new Map<string, string>();
  const families = new Set<string>();
  for (const stack of stacks) {
    for (const layer of deepLayers(stack)) {
      const c = layer.content;
      if (c.kind !== 'text' || !c.value.trim()) continue;
      // An uploaded font comes as its file; catalogue families (and the script fallbacks for
      // Khmer, Korean and Chinese) from their stylesheets.
      if (c.fontAssetId) {
        uploadedIds.add(c.fontAssetId);
        families.add(c.fontFamily);
      }
      for (const family of [...(c.fontAssetId ? [] : [c.fontFamily]), ...scriptFallbacks(c.value)]) {
        const font = findFont(family);
        if (!font) continue;
        css.add(fontCssHref(font));
        families.add(family);
      }
      const key = fontString(c, 40);
      wanted.set(key, (wanted.get(key) ?? '') + c.value);
    }
  }
  return { css: [...css], uploadedIds: [...uploadedIds], wanted: [...wanted], families: [...families] };
}

/** One sample of each character drawn, which is what a font face needs loaded. */
export const glyphSample = (text: string) => Array.from(new Set(Array.from(text.replace(/\s+/g, '')))).join('') || ' ';

// ---- In the worker ----

const sheets = new Map<string, Promise<void>>();
const uploaded = new Set<string>();

function workerFonts(): FontFaceSet & { add(face: FontFace): unknown } {
  const set = (globalThis as unknown as { fonts?: FontFaceSet & { add(face: FontFace): unknown } }).fonts;
  if (!set) throw new Error('This browser has no fonts in workers');
  return set;
}

const value = (body: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim();

/** Add every face a Google Fonts stylesheet declares (each script subset as its own face). */
function addStylesheetFaces(href: string): Promise<void> {
  let pending = sheets.get(href);
  if (!pending) {
    pending = fetch(href)
      .then((r) => {
        if (!r.ok) throw new Error(`Font stylesheet ${r.status}`);
        return r.text();
      })
      .then((css) => {
        const set = workerFonts();
        for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
          const family = value(body, 'font-family')?.replace(/^['"]|['"]$/g, '');
          const src = value(body, 'src');
          if (!family || !src) continue;
          const unicodeRange = value(body, 'unicode-range');
          set.add(new FontFace(family, src, { style: value(body, 'font-style') ?? 'normal', weight: value(body, 'font-weight') ?? '400', ...(unicodeRange ? { unicodeRange } : {}) }));
        }
      });
    pending.catch(() => sheets.delete(href));
    sheets.set(href, pending);
  }
  return pending;
}

/**
 * Load what a job needs into the worker's font set and check it is all there. Throws when a face
 * can't be had, so the page renders the job instead. Returns true when anything new loaded.
 */
export async function loadPrintFonts(fonts: PrintFonts): Promise<boolean> {
  const set = workerFonts();
  let added = false;
  for (const f of fonts.uploaded) {
    if (uploaded.has(f.id)) continue;
    const face = new FontFace(f.family, f.data);
    await face.load();
    set.add(face);
    uploaded.add(f.id);
    added = true;
  }
  const before = sheets.size;
  await Promise.all(fonts.css.map(addStylesheetFaces));
  if (sheets.size !== before) added = true;
  await Promise.all(fonts.wanted.map(([font, text]) => set.load(font, glyphSample(text))));
  // Every family must have a loaded face, and every font string must be ready for its text.
  const loadedFamilies = new Set<string>();
  set.forEach((face) => {
    if (face.status === 'loaded') loadedFamilies.add(face.family.replace(/^['"]|['"]$/g, ''));
  });
  const missing = fonts.families.filter((f) => !loadedFamilies.has(f));
  if (missing.length) throw new Error(`Fonts not ready in the worker: ${missing.join(', ')}`);
  if (fonts.wanted.some(([font, text]) => !set.check(font, glyphSample(text)))) throw new Error('Fonts not ready in the worker');
  return added;
}
