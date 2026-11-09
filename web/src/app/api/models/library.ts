/**
 * The 3D model library's folder on the server: `3d_models` beside the app. Every .glb in it (and
 * in its subfolders, up to two deep) is a library model; adding, moving or replacing a file needs
 * no code change. Read on each request, so a file dropped in shows up at once while developing,
 * and production serves the folder it shipped with.
 */
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  baseName,
  displayName,
  folderLabel,
  garmentKind,
  glbJson,
  glbJsonLength,
  GLB_PREAMBLE,
  guessStyle,
  isLibraryPath,
  MAX_LIBRARY_DEPTH,
  MODEL_FILE,
  summarizeGlb,
  VIEW_FILE,
  type LibraryModel,
  type ModelViews,
} from '@/domain/model-library';

export const MODEL_FOLDER = path.join(process.cwd(), '3d_models');

/** A JSON chunk longer than this is not read for listing (the model still loads in full). */
const MAX_JSON_BYTES = 16 * 1048576;

/** The disk path of a library path ("Hoodies/Hoodie1.glb"), or null for one the library doesn't serve. */
export function modelPath(rel: string): string | null {
  if (!isLibraryPath(rel)) return null;
  // Plain names joined under the folder (no "..", no leading dot): it cannot walk out of it.
  const full = path.join(MODEL_FOLDER, rel);
  return full.startsWith(MODEL_FOLDER + path.sep) ? full : null;
}

/** A file's version: its size and modification time, so caches follow replacements. */
export const versionOf = (info: { size: number; mtimeMs: number }) => `${info.size}-${Math.round(info.mtimeMs)}`;

/** The JSON chunk of a GLB on disk, read without loading its geometry. */
async function readJson(full: string): Promise<unknown | null> {
  const handle = await open(full, 'r');
  try {
    const head = new Uint8Array(GLB_PREAMBLE);
    await handle.read(head, 0, GLB_PREAMBLE, 0);
    const length = glbJsonLength(head);
    if (length === null || length > MAX_JSON_BYTES) return null;
    const bytes = new Uint8Array(GLB_PREAMBLE + length);
    await handle.read(bytes, 0, bytes.byteLength, 0);
    return glbJson(bytes);
  } finally {
    await handle.close();
  }
}

/** Every library path in the folder and its subfolders (models and 2D views), "/"-joined. */
async function walk(dir: string, prefix: string, depth: number, out: string[]) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (depth + 1 < MAX_LIBRARY_DEPTH && !e.name.startsWith('.')) await walk(path.join(dir, e.name), rel, depth + 1, out);
    } else if (e.isFile() && isLibraryPath(rel)) out.push(rel);
  }
}

/** Every model in the folder, by name, with its category and 2D views. A file that can't be read is left out rather than failing the list. */
export async function listModels(): Promise<LibraryModel[]> {
  const paths: string[] = [];
  await walk(MODEL_FOLDER, '', 0, paths);
  // 2D views by the model they belong to: "Hoodies/Hoodie1.front.png" → "Hoodies/Hoodie1.glb".
  // A view older than its model was drawn from an earlier file, so it is left out (WOVEXA draws a fresh one).
  const views = new Map<string, ModelViews>();
  // Paths written out in full (not through modelPath) so the server bundle traces only this folder.
  const modified = async (rel: string) => (modelPath(rel) ? ((await stat(path.join(process.cwd(), '3d_models', rel)).catch(() => null))?.mtimeMs ?? 0) : 0);
  for (const rel of paths) {
    const m = VIEW_FILE.exec(rel);
    if (!m) continue;
    const model = `${rel.slice(0, m.index)}.glb`;
    if (!paths.includes(model) || (await modified(rel)) + 1000 < (await modified(model))) continue;
    const side = m[1].toLowerCase() as keyof ModelViews;
    const v = views.get(model) ?? {};
    // One view per side: a vector file wins, then PNG, then the rest.
    const rank = (p?: string) => (!p ? -1 : /\.svg$/i.test(p) ? 3 : /\.png$/i.test(p) ? 2 : 1);
    if (rank(rel) > rank(v[side])) v[side] = rel;
    views.set(model, v);
  }
  const models: LibraryModel[] = [];
  for (const file of paths.filter((p) => MODEL_FILE.test(p)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    try {
      const full = modelPath(file)!;
      const info = await stat(path.join(process.cwd(), '3d_models', file));
      if (!info.isFile()) continue;
      const json = await readJson(full);
      if (!json) continue;
      const { triangles, credit } = summarizeGlb(json);
      const folder = file.includes('/') ? file.slice(0, file.length - baseName(file).length - 1) : null;
      const styleId = guessStyle(file);
      models.push({
        file,
        name: displayName(file),
        folder,
        category: folder ? folderLabel(folder) : garmentKind(file, styleId),
        bytes: info.size,
        version: versionOf(info),
        triangles,
        styleId,
        credit,
        views: views.get(file) ?? {},
      });
    } catch {
      // Unreadable (locked, half-copied): it appears once it can be read.
    }
  }
  return models;
}
