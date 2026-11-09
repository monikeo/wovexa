/**
 * The 3D model library: garment GLBs kept in the app's `3d_models` folder. Each file is a
 * ready-made look anyone can pick, named after its file, with the style it most likely is and
 * the credit it carries. Drop a new .glb into the folder and it is listed, no code needed.
 *
 * Organising it: a subfolder is a category ("3d_models/Hoodies/Hoodie1.glb" lists under
 * Hoodies); a file at the top is grouped by the kind of garment its name says it is. 2D views
 * saved beside a model with its name ("Hoodie1.front.png", "Hoodie1.back.svg") are its flats.
 *
 * Pure helpers, shared by the server (listing the folder) and the studio. No engine imports.
 */
import { GARMENTS } from './garments';

/** Who made a model and on what terms, as the file states it (Sketchfab writes these into the asset record). */
export interface ModelCredit {
  title?: string;
  author?: string;
  license?: string;
  source?: string;
}

/** A model's 2D views (flats), as library paths: front and back. */
export interface ModelViews {
  front?: string;
  back?: string;
}

/** One model in the library. */
export interface LibraryModel {
  /** Path in the folder, subfolders joined by "/" ("Hoodies/Hoodie1.glb"): the model's id. */
  file: string;
  /** Shown name: the file name without its extension. */
  name: string;
  /** The subfolder it is in ("Hoodies", "Tops/Hoodies"), or null at the top of the folder. */
  folder: string | null;
  /** Its group in the library: its folder's name, or the kind of garment its name says. */
  category: string;
  bytes: number;
  /** Changes whenever the file does (its size and modification time). */
  version: string;
  triangles: number;
  /** The garment style it most likely is, read from its name. */
  styleId: string;
  credit: ModelCredit | null;
  /** 2D views saved beside it, if any. */
  views: ModelViews;
}

/** Garment GLBs above this many triangles are refused as shells: slim them first (Blender's Decimate, gltf-transform). */
export const MAX_SHELL_TRIANGLES = 600_000;

/** One folder or file name in a library path: plain characters, never starting with a dot. */
const SEGMENT = /^(?!\.)[\w .()+,&'-]{1,120}$/;
/** Subfolders a library path may go into: "Category/Group/file.glb". */
export const MAX_LIBRARY_DEPTH = 3;
/** A library model. */
export const MODEL_FILE = /\.glb$/i;
/** A model's 2D view, saved beside it with its name: "Hoodie1.front.png", "Hoodie1.back.svg". */
export const VIEW_FILE = /\.(front|back)\.(png|jpe?g|webp|svg)$/i;

/** Whether a library path is one the library lists and serves: a model or a 2D view, plain names, nothing that walks out of the folder. */
export function isLibraryPath(rel: string): boolean {
  const parts = rel.split('/');
  return parts.length <= MAX_LIBRARY_DEPTH && parts.every((p) => SEGMENT.test(p)) && (MODEL_FILE.test(rel) || VIEW_FILE.test(rel));
}

/** The file name at the end of a library path. */
export const baseName = (rel: string) => rel.slice(rel.lastIndexOf('/') + 1);

/** The name a model is shown by: its file name, without the extension and with underscores as spaces. */
export function displayName(file: string): string {
  const base = baseName(file);
  return base.replace(/\.glb$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || base;
}

/** A folder's name as a category: its last part, underscores as spaces. */
export function folderLabel(folder: string): string {
  return displayName(folder.slice(folder.lastIndexOf('/') + 1)) || folder;
}

/** The kinds of garment a top-level model is grouped by, in library order. */
export const GARMENT_KINDS = ['T-shirts', 'Shirts', 'Long sleeves', 'Polos', 'Tanks', 'Hoodies and sweatshirts', 'Jerseys', 'Uniforms', 'Other'] as const;

const KIND_OF_CATEGORY: Record<string, (typeof GARMENT_KINDS)[number]> = {
  tee: 'T-shirts',
  longsleeve: 'Long sleeves',
  polo: 'Polos',
  tank: 'Tanks',
  hoodie: 'Hoodies and sweatshirts',
  jersey: 'Jerseys',
  uniform: 'Uniforms',
};

/** The kind of garment a model is, from its file name and the style it most likely is. A "shirt" that isn't a T-shirt is a shirt. */
export function garmentKind(file: string, styleId: string): (typeof GARMENT_KINDS)[number] {
  const name = wordsOf(baseName(file));
  const style = GARMENTS[styleId];
  if (style?.category === 'tee' && /\bshirts?\b/i.test(name) && !/\bt[\s_-]?shirts?\b|\btees?\b/i.test(name)) return 'Shirts';
  return (style && KIND_OF_CATEGORY[style.category]) ?? 'Other';
}

/** The library's groups: folder categories first (by name), then garment kinds in their order, each with its models by name. */
export function groupLibrary(models: readonly LibraryModel[]): { category: string; models: LibraryModel[] }[] {
  const groups = new Map<string, LibraryModel[]>();
  for (const m of models) {
    const list = groups.get(m.category);
    if (list) list.push(m);
    else groups.set(m.category, [m]);
  }
  const kinds: readonly string[] = GARMENT_KINDS;
  const rank = (c: string) => (kinds.includes(c) && !models.some((m) => m.folder && folderLabel(m.folder) === c) ? 1000 + kinds.indexOf(c) : 0);
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'en', { numeric: true }))
    .map(([category, list]) => ({ category, models: list.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })) }));
}

/** Words in a file name that say which style a model is, most specific first. */
const STYLE_HINTS: [RegExp, string][] = [
  [/dobok|taekwondo|\btkd\b|martial/i, 'taekwondo-dobok'],
  [/hood/i, 'hoodie-pullover'],
  [/sweat/i, 'sweatshirt-crew'],
  [/polo/i, 'polo-classic'],
  [/basket/i, 'jersey-basketball'],
  [/jersey|football|soccer/i, 'jersey-v'],
  [/tank|singlet|sleeveless/i, 'tank-top'],
  [/crop/i, 'tee-crop'],
  [/over ?sized?|boxy/i, 'tee-oversized'],
  [/long ?sleeve|\bls\b/i, 'tee-long'],
];

/** Words of a name: camel case, numbers and underscores split ("TaekwondoDobok" reads "Taekwondo Dobok", "Shirt2" reads "Shirt 2"). */
const wordsOf = (name: string) =>
  name
    .replace(/\.glb$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2');

/** The style a model most likely is, from its file name, else its folders' names; a classic tee when nothing says otherwise. */
export function guessStyle(file: string, fallback = 'tee-classic'): string {
  const name = wordsOf(baseName(file));
  const folders = wordsOf(file.slice(0, Math.max(0, file.lastIndexOf('/'))));
  return STYLE_HINTS.find(([re]) => re.test(name))?.[1] ?? (folders ? STYLE_HINTS.find(([re]) => re.test(folders))?.[1] : undefined) ?? fallback;
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** The credit in a glTF asset record: title, author (or copyright), licence and source. */
export function creditOf(asset: unknown): ModelCredit | null {
  const a = (asset ?? {}) as { copyright?: unknown; extras?: Record<string, unknown> };
  const extras = a.extras && typeof a.extras === 'object' ? a.extras : {};
  const credit: ModelCredit = {};
  const title = text(extras.title, 200);
  const author = text(extras.author, 200) ?? text(a.copyright, 200);
  const license = text(extras.license, 200);
  const source = text(extras.source, 500);
  if (title) credit.title = title;
  if (author) credit.author = author;
  if (license) credit.license = license;
  if (source) credit.source = source;
  return Object.keys(credit).length ? credit : null;
}

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

/** Bytes a GLB needs to show its JSON chunk's length: the 12-byte header and the chunk header. */
export const GLB_PREAMBLE = 20;

/** Length of a GLB's JSON chunk from its first 20 bytes, or null when it isn't a binary glTF. */
export function glbJsonLength(head: Uint8Array): number | null {
  if (head.byteLength < GLB_PREAMBLE) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== JSON_CHUNK) return null;
  return view.getUint32(12, true);
}

/** A GLB's JSON chunk (its description of meshes, materials and the asset), or null. */
export function glbJson(bytes: Uint8Array): unknown | null {
  const length = glbJsonLength(bytes);
  if (length === null || bytes.byteLength < GLB_PREAMBLE + length) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes.subarray(GLB_PREAMBLE, GLB_PREAMBLE + length)));
  } catch {
    return null;
  }
}

interface GltfJson {
  asset?: unknown;
  accessors?: { count?: number }[];
  meshes?: { primitives?: { mode?: number; indices?: number; attributes?: Record<string, number> }[] }[];
  nodes?: { mesh?: number }[];
}

/** What a GLB says about itself from its JSON alone: how many triangles it draws, and its credit. */
export function summarizeGlb(json: unknown): { triangles: number; credit: ModelCredit | null } {
  const g = (json ?? {}) as GltfJson;
  const accessors = g.accessors ?? [];
  const meshTriangles = (g.meshes ?? []).map((m) =>
    (m.primitives ?? []).reduce((sum, p) => {
      if (p.mode !== undefined && p.mode !== 4) return sum;
      const count = p.indices !== undefined ? accessors[p.indices]?.count : accessors[p.attributes?.POSITION ?? -1]?.count;
      return sum + Math.floor((count ?? 0) / 3);
    }, 0),
  );
  // Each node that shows a mesh draws it once; files without nodes count each mesh once.
  const used = (g.nodes ?? []).filter((n) => typeof n.mesh === 'number').map((n) => meshTriangles[n.mesh!] ?? 0);
  const triangles = used.length ? used.reduce((a, b) => a + b, 0) : meshTriangles.reduce((a, b) => a + b, 0);
  return { triangles, credit: creditOf(g.asset) };
}
