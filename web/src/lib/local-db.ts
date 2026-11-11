/**
 * Local-first persistence in IndexedDB (spec PWA-03, §29.5 steps 2–3).
 * Projects work fully offline; the sync coordinator pushes them to Supabase when configured.
 * Browser storage is not an encrypted vault (spec §23.3): signing out clears it.
 *
 * Database versions: 1 projects, documents, assets. 2 adds versions, templates, brand kits.
 * 3 adds the font library (uploaded fonts) and saved scene looks. 4 to 6 add the export history.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { allStacks } from '@/domain/areas';
import { createDocument, newId } from '@/domain/factory';
import { documentHash } from '@/domain/hash';
import { migrateDesignDocument, type DesignDocument, type Scene } from '@/domain/schema';

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
  /** In Recently deleted since then; deleted for good after TRASH_DAYS (spec PRJ-03). */
  deletedAt?: number;
  /** Last revision the server accepted (0 = never synced). */
  serverRevision: number;
  syncState: SyncState;
  thumbnail?: Blob;
  /** Hash of the current design content (see domain/hash). */
  contentHash?: string;
  approvedVersionId?: string;
  approvedVersionNumber?: number;
  approvedHash?: string;
}

export type ApprovalState = 'draft' | 'approved' | 'changed';

export function approvalState(meta: Pick<ProjectMeta, 'approvedHash' | 'contentHash'>): ApprovalState {
  if (!meta.approvedHash) return 'draft';
  return meta.contentHash === meta.approvedHash ? 'approved' : 'changed';
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

export interface Approval {
  approvedAt: number;
  approvedBy: string;
  note: string;
}

/** An immutable snapshot of a design (spec PRJ-08). The document is stored as it was, in its own format version. */
export interface StoredVersion {
  id: string;
  projectId: string;
  number: number;
  label: string;
  createdAt: number;
  source: 'manual' | 'approval' | 'before-restore' | 'before-upgrade';
  hash: string;
  document: unknown;
  thumbnail?: Blob;
  approval?: Approval;
}

export interface StoredTemplate {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  document: DesignDocument;
  thumbnail?: Blob;
}

export interface BrandColor {
  id: string;
  name: string;
  hex: string;
}

/** Brand kit (spec BRD-01/02): approved logos, palette and fonts shared across projects. */
export interface BrandKit {
  id: string;
  name: string;
  colors: BrandColor[];
  fonts: string[];
  logoAssetIds: string[];
  notes: string;
  createdAt: number;
  updatedAt: number;
}

/** A font uploaded to this device (spec AST-07). Stored with the licence statement given at upload. */
export interface StoredFont {
  id: string;
  family: string;
  fileName: string;
  format: 'ttf' | 'otf' | 'woff' | 'woff2';
  bytes: number;
  sha256: string;
  blob: Blob;
  licenseNote: string;
  licenseConfirmedAt: number;
  createdAt: number;
}

/** A reusable studio look: lighting, exposure, backdrop and lens, without saved camera views (spec MED-07). */
export interface StoredScene {
  id: string;
  name: string;
  scene: Omit<Scene, 'cameras'>;
  createdAt: number;
}

export type ExportKind = 'package' | 'print' | 'proof' | 'team' | 'manifest' | 'mockups';

/** A finished export (spec EXP-10): what was made, from which revision, without the files themselves. */
export interface ExportRecord {
  id: string;
  projectId: string;
  createdAt: number;
  kind: ExportKind;
  label: string;
  revision: number;
  /** v3, r12 or a design ID, as in the exported file names. */
  revisionLabel?: string;
  contentHash: string;
  fileName: string;
  fileCount: number;
  bytes: number;
  settings: Record<string, unknown>;
}

interface WovexaDB extends DBSchema {
  exports: { key: string; value: ExportRecord; indexes: { projectId: string } };
  projects: { key: string; value: ProjectMeta; indexes: { updatedAt: number } };
  documents: { key: string; value: { projectId: string; document: unknown; savedAt: number } };
  assets: { key: string; value: StoredAsset; indexes: { sha256: string; createdAt: number } };
  versions: { key: string; value: StoredVersion; indexes: { projectId: string } };
  templates: { key: string; value: StoredTemplate; indexes: { createdAt: number } };
  brandKits: { key: string; value: BrandKit; indexes: { updatedAt: number } };
  fonts: { key: string; value: StoredFont; indexes: { createdAt: number } };
  scenes: { key: string; value: StoredScene; indexes: { createdAt: number } };
}

let dbPromise: Promise<IDBPDatabase<WovexaDB>> | null = null;
const DB_VERSION = 6;

export function db() {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available in this browser');
  dbPromise ??= openDB<WovexaDB>('wovexa', DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const projects = database.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('updatedAt', 'updatedAt');
        database.createObjectStore('documents', { keyPath: 'projectId' });
        const assets = database.createObjectStore('assets', { keyPath: 'id' });
        assets.createIndex('sha256', 'sha256');
        assets.createIndex('createdAt', 'createdAt');
      }
      if (oldVersion < 2) {
        database.createObjectStore('versions', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        database.createObjectStore('templates', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        database.createObjectStore('brandKits', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      }
      if (oldVersion < 3) {
        database.createObjectStore('fonts', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        database.createObjectStore('scenes', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
      // Export history (versions 4 to 6). Checked by name rather than by version, so a database
      // that reached a newer version without the store still gets it.
      if (!database.objectStoreNames.contains('exports')) {
        database.createObjectStore('exports', { keyPath: 'id' }).createIndex('projectId', 'projectId');
      }
    },
    // Another tab is upgrading the database: step aside so it can, and reopen on next use.
    blocking() {
      void dbPromise?.then((d) => d.close());
      dbPromise = null;
    },
    terminated() {
      dbPromise = null;
    },
  });
  return dbPromise;
}

function metaFromDocument(doc: DesignDocument, hash: string, previous?: ProjectMeta): ProjectMeta {
  const colorway = doc.colorways.find((c) => c.id === doc.activeColorwayId) ?? doc.colorways[0];
  const layerCount = allStacks(doc).reduce((n, z) => n + z.orderedLayerIds.length, 0) + (doc.projections?.orderedLayerIds.length ?? 0);
  const now = Date.now();
  return {
    ...previous,
    id: doc.projectId,
    title: doc.title,
    garmentModelId: doc.garment.modelId,
    bodyColor: colorway.parts.body,
    layerCount,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    serverRevision: previous?.serverRevision ?? 0,
    syncState: previous && previous.serverRevision > 0 ? 'pending' : (previous?.syncState ?? 'local'),
    contentHash: hash,
  };
}

/**
 * Projects, most recently edited first. By default the ones in use (archived ones with
 * `includeArchived`); `deleted: 'only'` lists Recently deleted, `deleted: 'include'` everything.
 */
export async function listProjects(opts: { includeArchived?: boolean; deleted?: 'exclude' | 'only' | 'include' } = {}): Promise<ProjectMeta[]> {
  const all = await (await db()).getAllFromIndex('projects', 'updatedAt');
  const deleted = opts.deleted ?? 'exclude';
  return all.reverse().filter((p) => (deleted === 'include' || (deleted === 'only') === !!p.deletedAt) && (deleted === 'only' || opts.includeArchived || !p.archivedAt));
}

export async function getProject(id: string) {
  return (await db()).get('projects', id);
}

export async function createProject(title: string, colorwayIndex = 0, modelId?: string, shape?: DesignDocument['garment']['shape']): Promise<ProjectMeta> {
  const projectId = newId();
  const document = createDocument({ projectId, title, colorwayIndex, modelId });
  // A model from the 3D model library, worn from the start.
  if (shape) document.garment.shape = shape;
  return saveDocument(document);
}

/** Save a ready-made document (from a template or a copy) as a new project. */
export async function createProjectFromDocument(document: DesignDocument, thumbnail?: Blob): Promise<ProjectMeta> {
  return saveDocument(document, thumbnail ? { thumbnail } : undefined);
}

/** Durable local save. Returns the updated project metadata. */
export async function saveDocument(document: DesignDocument, extra?: Partial<ProjectMeta>): Promise<ProjectMeta> {
  // Hash before opening the transaction: IndexedDB transactions close while awaiting other work.
  const hash = await documentHash(document);
  const database = await db();
  const tx = database.transaction(['projects', 'documents'], 'readwrite');
  const previous = await tx.objectStore('projects').get(document.projectId);
  const meta = { ...metaFromDocument(document, hash, previous), ...extra };
  await tx.objectStore('documents').put({ projectId: document.projectId, document, savedAt: Date.now() });
  await tx.objectStore('projects').put(meta);
  await tx.done;
  return meta;
}

export type LoadResult =
  | { ok: true; document: DesignDocument; meta: ProjectMeta; upgradedFrom?: number }
  | { ok: false; reason: 'not_found' | 'invalid'; errors?: string[] };

const inflightLoads = new Map<string, Promise<LoadResult>>();

/**
 * Load and, if needed, upgrade a project's document. Concurrent loads of the same project
 * share one promise, so an upgrade (and its backup version) happens exactly once.
 */
export function loadDocument(projectId: string): Promise<LoadResult> {
  let pending = inflightLoads.get(projectId);
  if (!pending) {
    pending = loadDocumentOnce(projectId).finally(() => inflightLoads.delete(projectId));
    inflightLoads.set(projectId, pending);
  }
  return pending;
}

async function loadDocumentOnce(projectId: string): Promise<LoadResult> {
  const database = await db();
  const [record, meta] = await Promise.all([database.get('documents', projectId), database.get('projects', projectId)]);
  if (!record || !meta) return { ok: false, reason: 'not_found' };
  const parsed = migrateDesignDocument(record.document);
  if (!parsed.ok) return { ok: false, reason: 'invalid', errors: parsed.errors };
  if (parsed.migratedFrom) {
    // Keep the original exactly as stored before writing the upgraded copy (spec §26.4).
    await saveVersion({ projectId, label: `Backup before format upgrade (format ${parsed.migratedFrom})`, document: record.document, source: 'before-upgrade', hash: 'pre-upgrade' });
    const upgraded = await saveDocument(parsed.document);
    return { ok: true, document: parsed.document, meta: upgraded, upgradedFrom: parsed.migratedFrom };
  }
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
  return saveDocument(copy, {
    serverRevision: 0,
    syncState: 'local',
    thumbnail: result.meta.thumbnail,
    approvedHash: undefined,
    approvedVersionId: undefined,
    approvedVersionNumber: undefined,
  });
}

export async function archiveProject(id: string, archived: boolean) {
  await updateProjectMeta(id, { archivedAt: archived ? Date.now() : undefined });
}

/** Days a deleted project stays in Recently deleted before it is gone for good. */
export const TRASH_DAYS = 30;

/** Move a project to Recently deleted: out of every list, restorable for TRASH_DAYS. */
export async function trashProject(id: string) {
  await updateProjectMeta(id, { deletedAt: Date.now() });
}

/** Bring a project back from Recently deleted, as it was. */
export async function restoreProject(id: string) {
  await updateProjectMeta(id, { deletedAt: undefined });
}

/** Delete for good the projects in Recently deleted longer than TRASH_DAYS. Returns how many went. */
export async function purgeDeletedProjects(now = Date.now()): Promise<number> {
  const cutoff = now - TRASH_DAYS * 86400000;
  const expired = (await listProjects({ deleted: 'only' })).filter((p) => p.deletedAt! < cutoff);
  for (const p of expired) await deleteProject(p.id);
  return expired.length;
}

/** Days left before a project in Recently deleted is deleted for good. */
export function daysLeft(meta: Pick<ProjectMeta, 'deletedAt'>, now = Date.now()) {
  return meta.deletedAt ? Math.max(0, Math.ceil((meta.deletedAt + TRASH_DAYS * 86400000 - now) / 86400000)) : TRASH_DAYS;
}

/** Permanent local delete, including the project's version history. Callers confirm first. */
export async function deleteProject(id: string) {
  const database = await db();
  const tx = database.transaction(['projects', 'documents', 'versions', 'exports'], 'readwrite');
  await tx.objectStore('projects').delete(id);
  await tx.objectStore('documents').delete(id);
  const versionKeys = await tx.objectStore('versions').index('projectId').getAllKeys(id);
  await Promise.all(versionKeys.map((k) => tx.objectStore('versions').delete(k)));
  const exportKeys = await tx.objectStore('exports').index('projectId').getAllKeys(id);
  await Promise.all(exportKeys.map((k) => tx.objectStore('exports').delete(k)));
  await tx.done;
}

// ---- Export history (spec EXP-10) ----

const EXPORTS_KEPT = 40;

export async function addExportRecord(record: Omit<ExportRecord, 'id' | 'createdAt'>): Promise<ExportRecord> {
  const database = await db();
  const full: ExportRecord = { ...record, id: newId(), createdAt: Date.now() };
  await database.put('exports', full);
  // Keep the newest few per project.
  const all = (await database.getAllFromIndex('exports', 'projectId', record.projectId)).sort((a, b) => b.createdAt - a.createdAt);
  await Promise.all(all.slice(EXPORTS_KEPT).map((r) => database.delete('exports', r.id)));
  return full;
}

export async function listExports(projectId: string, limit = 12): Promise<ExportRecord[]> {
  const all = await (await db()).getAllFromIndex('exports', 'projectId', projectId);
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/** Every recorded export on this device, newest first (the Exports page). */
export async function listAllExports(limit = 400): Promise<ExportRecord[]> {
  const all = await (await db()).getAll('exports');
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/** Forget one export (the files already downloaded are not touched). */
export async function deleteExportRecord(id: string) {
  await (await db()).delete('exports', id);
}

export async function clearExports(projectId: string) {
  const database = await db();
  const keys = await database.getAllKeysFromIndex('exports', 'projectId', projectId);
  await Promise.all(keys.map((k) => database.delete('exports', k)));
}

// ---- Versions (spec PRJ-08, COL-04, FAC-06) ----

export async function listVersions(projectId: string): Promise<StoredVersion[]> {
  const all = await (await db()).getAllFromIndex('versions', 'projectId', projectId);
  return all.sort((a, b) => b.number - a.number);
}

export async function getVersion(id: string) {
  return (await db()).get('versions', id);
}

export async function saveVersion(input: {
  projectId: string;
  label: string;
  document: unknown;
  source: StoredVersion['source'];
  hash: string;
  thumbnail?: Blob;
  approval?: Approval;
}): Promise<StoredVersion> {
  const database = await db();
  const tx = database.transaction('versions', 'readwrite');
  const existing = await tx.store.index('projectId').getAll(input.projectId);
  const version: StoredVersion = {
    id: newId(),
    number: existing.reduce((n, v) => Math.max(n, v.number), 0) + 1,
    createdAt: Date.now(),
    ...input,
    label: input.label.slice(0, 120),
  };
  await tx.store.put(version);
  await tx.done;
  return version;
}

/** Approve a version once. Approved versions are never edited again. */
export async function approveVersion(versionId: string, approval: Approval): Promise<StoredVersion> {
  const database = await db();
  const version = await database.get('versions', versionId);
  if (!version) throw new Error('That version no longer exists.');
  if (version.approval) throw new Error(`Version ${version.number} is already approved.`);
  const approved = { ...version, approval };
  await database.put('versions', approved);
  await updateProjectMeta(version.projectId, { approvedVersionId: version.id, approvedVersionNumber: version.number, approvedHash: version.hash });
  return approved;
}

// ---- User templates (spec BRD-03) ----

export async function listUserTemplates(): Promise<StoredTemplate[]> {
  return (await (await db()).getAllFromIndex('templates', 'createdAt')).reverse();
}

export async function saveUserTemplate(template: Omit<StoredTemplate, 'id' | 'createdAt'>): Promise<StoredTemplate> {
  const stored: StoredTemplate = { ...template, id: newId(), createdAt: Date.now() };
  await (await db()).put('templates', stored);
  return stored;
}

export async function deleteUserTemplate(id: string) {
  await (await db()).delete('templates', id);
}

// ---- Brand kits (spec BRD-01/02) ----

export async function listBrandKits(): Promise<BrandKit[]> {
  return (await (await db()).getAllFromIndex('brandKits', 'updatedAt')).reverse();
}

export async function getBrandKit(id: string) {
  return (await db()).get('brandKits', id);
}

export async function saveBrandKit(kit: BrandKit): Promise<BrandKit> {
  const stored = { ...kit, updatedAt: Date.now() };
  await (await db()).put('brandKits', stored);
  return stored;
}

export async function deleteBrandKit(id: string) {
  await (await db()).delete('brandKits', id);
}

// ---- Font library (spec AST-07) ----

export async function listFonts(): Promise<StoredFont[]> {
  return (await (await db()).getAllFromIndex('fonts', 'createdAt')).reverse();
}

export async function getFont(id: string) {
  return (await db()).get('fonts', id);
}

export async function putFont(font: StoredFont) {
  await (await db()).put('fonts', font);
}

export async function deleteFont(id: string) {
  await (await db()).delete('fonts', id);
}

// ---- Saved scene looks (spec MED-07) ----

export async function listScenes(): Promise<StoredScene[]> {
  return (await (await db()).getAllFromIndex('scenes', 'createdAt')).reverse();
}

export async function saveScene(name: string, scene: Omit<Scene, 'cameras'>): Promise<StoredScene> {
  const stored: StoredScene = { id: newId(), name: name.slice(0, 40), scene, createdAt: Date.now() };
  await (await db()).put('scenes', stored);
  return stored;
}

export async function deleteScene(id: string) {
  await (await db()).delete('scenes', id);
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

/** Stored assets, newest first. Images by default; 3D shapes (GLB) live in the same store. */
export async function listAssets(kind: 'image' | 'all' = 'image'): Promise<StoredAsset[]> {
  const all = await (await db()).getAllFromIndex('assets', 'createdAt');
  return (kind === 'all' ? all : all.filter((a) => a.mime.startsWith('image/'))).reverse();
}

/** Projects, versions and brand kits that reference an asset, so deletes can be refused while in use. */
export async function assetUsage(assetId: string): Promise<string[]> {
  const database = await db();
  const [docs, kits] = await Promise.all([database.getAll('documents'), database.getAll('brandKits')]);
  const usesAsset = (doc: unknown) => JSON.stringify(doc).includes(`"${assetId}"`);
  return [
    ...docs.filter(({ document }) => usesAsset(document)).map(({ document }) => (document as { title?: string }).title ?? 'Untitled'),
    ...kits.filter((k) => k.logoAssetIds.includes(assetId)).map((k) => `brand kit ${k.name}`),
  ];
}

export async function deleteAsset(id: string) {
  await (await db()).delete('assets', id);
}

/** Clears every local project, version, template, brand kit, asset, font and saved look. Used at sign-out (spec §23.3). */
export async function clearLocalData() {
  const database = await db();
  const stores = ['projects', 'documents', 'assets', 'versions', 'templates', 'brandKits', 'fonts', 'scenes', 'exports'] as const;
  const tx = database.transaction([...stores], 'readwrite');
  await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
  await tx.done;
}

/**
 * Whether the browser keeps this site's data when space runs low (persistent storage), or may
 * clear it; null where the browser doesn't say. Projects live only here, so this is their safety.
 */
export async function storagePersisted(): Promise<boolean | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return null;
  return navigator.storage.persisted().catch(() => null);
}

/** Ask the browser to keep this site's data (some browsers ask the person). True when it will. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  if (await storagePersisted()) return true;
  return navigator.storage.persist().catch(() => false);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
