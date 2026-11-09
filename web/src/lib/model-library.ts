/**
 * The studio's view of the 3D model library (the app's `3d_models` folder, served by
 * /api/models): the list, fetched once per visit and on request, and each model's file.
 */
import { useEffect, useState } from 'react';
import type { LibraryModel } from '@/domain/model-library';

let listing: Promise<LibraryModel[]> | null = null;

/** The library's models; `fresh` asks the folder again (a file was just added). */
export function loadModelLibrary(fresh = false): Promise<LibraryModel[]> {
  if (!listing || fresh) {
    listing = fetch('/api/models', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((j: { models?: unknown }) => (Array.isArray(j.models) ? (j.models as LibraryModel[]) : []))
      .catch(() => []);
  }
  return listing;
}

/** The library's models, or null while they load. Rescans the folder each time a picker opens, and when `rescan` changes. */
export function useModelLibrary(rescan = 0): LibraryModel[] | null {
  const [models, setModels] = useState<LibraryModel[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadModelLibrary(true).then((m) => alive && setModels(m));
    return () => {
      alive = false;
    };
  }, [rescan]);
  return models;
}

/** Where the library serves a file: its path in the folder, each part encoded. */
export function libraryUrl(rel: string): string {
  return `/api/models/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

/** A library model's GLB. The browser keeps it and asks again only when the file changed. */
export async function fetchLibraryModel(file: string): Promise<ArrayBuffer> {
  const response = await fetch(libraryUrl(file));
  if (!response.ok) throw new Error(`The 3D model “${file}” isn’t in the library any more.`);
  return response.arrayBuffer();
}
