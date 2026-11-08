/**
 * Local-first persistence in IndexedDB (spec PWA-03, §29.5 steps 2–3).
 * Projects work fully offline; the sync coordinator pushes them to Supabase when configured.
 * Browser storage is not an encrypted vault (spec §23.3): signing out clears it.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { createDocument, newId } from '@/domain/factory';
import { migrateDesignDocument, type DesignDocument } from '@/domain/schema';

export type SyncState = 'local' | 'synced' | 'pending' | 'conflict' | 'error';

export interface ProjectMeta {
  id: string;
  title: string;
  garmentModelId: string;
  bodyColor: string;
  layerCount: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  /** Last revision the server accepted (0 = never synced). */
  serverRevision: number;
  syncState: SyncState;
  thumbnail?: Blob;
}

export interface StoredAsset {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  blob: Blob;
  createdAt: number;
}

interface WovexaDB extends DBSchema {
  projects: { key: string; value: ProjectMeta; indexes: { updatedAt: number } };
  documents: { key: string; value: { projectId: string; document: DesignDocument; savedAt: number } };
  assets: { key: string; value: StoredAsset; indexes: { sha256: string; createdAt: number } };
}

let dbPromise: Promise<IDBPDatabase<WovexaDB>> | null = null;

export function db() {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available in this browser');
  dbPromise ??= openDB<WovexaDB>('wovexa', 1, {
    upgrade(database) {
      const projects = database.createObjectStore('projects', { keyPath: 'id' });
      projects.createIndex('updatedAt', 'updatedAt');
      database.createObjectStore('documents', { keyPath: 'projectId' });
      const assets = database.createObjectStore('assets', { keyPath: 'id' });
      assets.createIndex('sha256', 'sha256');
      assets.createIndex('createdAt', 'createdAt');
    },
  });
  return dbPromise;
}

function metaFromDocument(doc: DesignDocument, previous?: ProjectMeta): ProjectMeta {
  const colorway = doc.colorways.find((c) => c.id === doc.activeColorwayId) ?? doc.colorways[0];
  const layerCount = Object.values(doc.zones).reduce((n, z) => n + z.orderedLayerIds.length, 0);
  const now = Date.now();
  return {
    id: doc.projectId,
    title: doc.title,
    garmentModelId: doc.garment.modelId,
    bodyColor: colorway.parts.body,
    layerCount,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    archivedAt: previous?.archivedAt,
    serverRevision: previous?.serverRevision ?? 0,
    syncState: previous && previous.serverRevision > 0 ? 'pending' : (previous?.syncState ?? 'local'),
    thumbnail: previous?.thumbnail,
  };
}

export async function listProjects(opts: { includeArchived?: boolean } = {}): Promise<ProjectMeta[]> {
  const all = await (await db()).getAllFromIndex('projects', 'updatedAt');
  return all.reverse().filter((p) => opts.includeArchived || !p.archivedAt);
}

export async function getProject(id: string) {
  return (await db()).get('projects', id);
}

export async function createProject(title: string, colorwayIndex = 0): Promise<ProjectMeta> {
  const projectId = newId();
  const document = createDocument({ projectId, title, colorwayIndex });
  return saveDocument(document);
}

/** Durable local save. Returns the updated project metadata. */
export async function saveDocument(document: DesignDocument, extra?: Partial<ProjectMeta>): Promise<ProjectMeta> {
  const database = await db();
  const tx = database.transaction(['projects', 'documents'], 'readwrite');
  const previous = await tx.objectStore('projects').get(document.projectId);
  const meta = { ...metaFromDocument(document, previous), ...extra };
  await tx.objectStore('documents').put({ projectId: document.projectId, document, savedAt: Date.now() });
  await tx.objectStore('projects').put(meta);
  await tx.done;
  return meta;
}

export type LoadResult =
  | { ok: true; document: DesignDocument; meta: ProjectMeta }
  | { ok: false; reason: 'not_found' | 'invalid'; errors?: string[] };

export async function loadDocument(projectId: string): Promise<LoadResult> {
  const database = await db();
  const [record, meta] = await Promise.all([database.get('documents', projectId), database.get('projects', projectId)]);
  if (!record || !meta) return { ok: false, reason: 'not_found' };
  const parsed = migrateDesignDocument(record.document);
  if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors };
  return { ok: true, document: parsed.document, meta };
}

export async function updateProjectMeta(id: string, patch: Partial<ProjectMeta>) {
  const database = await db();
  const meta = await database.get('projects', id);
  if (!meta) return;
  await database.put('projects', { ...meta, ...patch });
}

export async function renameProject(id: string, title: string) {
  const result = await loadDocument(id);
  if (!result.ok) return;
  await saveDocument({ ...result.document, title });
}

export async function duplicateProject(id: string): Promise<ProjectMeta | null> {
  const result = await loadDocument(id);
  if (!result.ok) return null;
  const projectId = newId();
  const copy: DesignDocument = { ...structuredClone(result.document), id: newId(), projectId, title: `${result.document.title} copy`, revision: 0 };
  return saveDocument(copy, { serverRevision: 0, syncState: 'local', thumbnail: result.meta.thumbnail });
}

export async function archiveProject(id: string, archived: boolean) {
  await updateProjectMeta(id, { archivedAt: archived ? Date.now() : undefined });
}

/** Permanent local delete. Callers confirm with the user first. */
export async function deleteProject(id: string) {
  const database = await db();
  const tx = database.transaction(['projects', 'documents'], 'readwrite');
  await tx.objectStore('projects').delete(id);
  await tx.objectStore('documents').delete(id);
  await tx.done;
}

// ---- Assets ----

export async function putAsset(asset: StoredAsset) {
  await (await db()).put('assets', asset);
}

export async function getAsset(id: string) {
  return (await db()).get('assets', id);
}

export async function findAssetByHash(sha256: string) {
  return (await db()).getFromIndex('assets', 'sha256', sha256);
}

export async function listAssets(): Promise<StoredAsset[]> {
  const all = await (await db()).getAllFromIndex('assets', 'createdAt');
  return all.reverse();
}

/** Projects whose documents reference an asset, so deletes can be refused while in use. */
export async function assetUsage(assetId: string): Promise<string[]> {
  const docs = await (await db()).getAll('documents');
  return docs
    .filter(({ document }) =>
      Object.values(document.zones).some((z) =>
        Object.values(z.layers).some((l) => l.content.kind === 'image' && l.content.assetId === assetId),
      ),
    )
    .map(({ document }) => document.title);
}

export async function deleteAsset(id: string) {
  await (await db()).delete('assets', id);
}

/** Clears every local project and asset. Used at sign-out (spec §23.3). */
export async function clearLocalData() {
  const database = await db();
  const tx = database.transaction(['projects', 'documents', 'assets'], 'readwrite');
  await Promise.all([tx.objectStore('projects').clear(), tx.objectStore('documents').clear(), tx.objectStore('assets').clear()]);
  await tx.done;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
