/**
 * 2D views of the 3D model library's models (their flats). A view saved beside a model in the
 * folder ("Hoodie1.front.png") is used as it is; otherwise WOVEXA draws one from the model
 * itself, once per version of the file, and keeps it in the browser's cache.
 */
import { useEffect, useState } from 'react';
import { MAX_SHELL_TRIANGLES, type LibraryModel } from '@/domain/model-library';
import { fetchLibraryModel, libraryUrl } from './model-library';

export type ViewSide = 'front' | 'back';

const CACHE = 'wovexa-model-views-v1';
/** Drawn views kept in memory too, for browsers without the Cache API and for this visit. */
const drawn = new Map<string, Promise<Record<ViewSide, Blob> | null>>();
/** One model drawn at a time: drawing loads the whole model. */
let queue: Promise<unknown> = Promise.resolve();

const keyOf = (m: LibraryModel, side: ViewSide) => `${location.origin}/__model-views/${encodeURIComponent(m.file)}/${encodeURIComponent(m.version)}/${side}.png`;

async function cached(m: LibraryModel): Promise<Record<ViewSide, Blob> | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(CACHE);
    const [front, back] = await Promise.all([cache.match(keyOf(m, 'front')), cache.match(keyOf(m, 'back'))]);
    return front && back ? { front: await front.blob(), back: await back.blob() } : null;
  } catch {
    return null;
  }
}

async function keep(m: LibraryModel, views: Record<ViewSide, Blob>) {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(CACHE);
    await Promise.all((['front', 'back'] as const).map((side) => cache.put(keyOf(m, side), new Response(views[side], { headers: { 'Content-Type': 'image/png' } }))));
  } catch {
    // Storage full or blocked: drawn again next visit.
  }
}

/** A model's drawn views: from the cache, else drawn (queued behind any other model being drawn). Null when it can't be drawn. */
export function drawnViews(m: LibraryModel): Promise<Record<ViewSide, Blob> | null> {
  const id = `${m.file}@${m.version}`;
  let pending = drawn.get(id);
  if (!pending) {
    pending = cached(m).then((hit) => {
      if (hit) return hit;
      const job = queue.then(async () => {
        try {
          const [{ renderModelViews }, data] = await Promise.all([import('@/components/studio/viewer3d/model-sketch'), fetchLibraryModel(m.file)]);
          const views = await renderModelViews(data, m.styleId);
          void keep(m, views);
          return views;
        } catch {
          return null;
        }
      });
      queue = job;
      return job;
    });
    drawn.set(id, pending);
  }
  return pending;
}

/** Whether WOVEXA can draw a model's views (too heavy a model isn't loaded). */
export const canDraw = (m: LibraryModel) => m.triangles <= MAX_SHELL_TRIANGLES;

/** Models that have no 2D view saved in the folder for one side or both, and can be drawn. */
export const unsavedViews = (models: readonly LibraryModel[]) => models.filter((m) => canDraw(m) && (!m.views.front || !m.views.back));

/**
 * Save each model's drawn views beside it in the library folder ("Hoodie1.front.png"), so they
 * ship with the app and show at once. Only while developing (the server refuses otherwise).
 * Returns how many models got their views saved.
 */
export async function saveViewsToLibrary(models: readonly LibraryModel[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const todo = unsavedViews(models);
  let saved = 0;
  for (const [i, m] of todo.entries()) {
    onProgress?.(i, todo.length);
    const views = await drawnViews(m);
    if (!views) continue;
    const base = m.file.replace(/\.glb$/i, '');
    const sides = (['front', 'back'] as const).filter((side) => !m.views[side]);
    const results = await Promise.all(sides.map((side) => fetch(libraryUrl(`${base}.${side}.png`), { method: 'PUT', body: views[side], headers: { 'Content-Type': 'image/png' } })));
    if (results.every((r) => r.ok)) saved++;
  }
  onProgress?.(todo.length, todo.length);
  return saved;
}

/**
 * A model's 2D view as an image URL: the one saved in the folder, else one drawn from the model,
 * or null while it is drawn (or when it can't be).
 */
export function useModelView(m: LibraryModel, side: ViewSide): string | null {
  const saved = m.views[side];
  const [url, setUrl] = useState<{ id: string; url: string } | null>(null);
  const id = `${m.file}@${m.version}:${side}`;
  useEffect(() => {
    if (saved || !canDraw(m)) return;
    let alive = true;
    let objectUrl: string | null = null;
    void drawnViews(m).then((views) => {
      if (!alive || !views) return;
      objectUrl = URL.createObjectURL(views[side]);
      setUrl({ id, url: objectUrl });
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, saved, m, side]);
  if (saved) return libraryUrl(saved);
  return url?.id === id ? url.url : null;
}
