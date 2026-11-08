'use client';
/**
 * Studio state (spec §26.3, §36 stores). The canonical document and its history live here;
 * transient UI state lives beside it but is never saved into the document.
 * High-frequency drag previews use the separate live store so they don't re-render panels.
 */
import { create } from 'zustand';
import type { Command } from '@/domain/commands';
import { getGarment } from '@/domain/garments';
import { applyCommand, emptyHistory, redo as redoHistory, undo as undoHistory, type History } from '@/domain/history';
import type { DesignDocument, LayerTransform, ZoneId } from '@/domain/schema';
import { getProject, loadDocument, saveDocument, type ProjectMeta } from '@/lib/local-db';
import { renderThumbnail } from '@/lib/thumbnail';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';
export type ViewMode = '2d' | 'split' | '3d';
export type MobileSheet = null | 'add' | 'layers' | 'inspect' | 'garment' | 'preflight' | 'export';
export type StudioPanel = null | 'history' | 'save-template' | 'compare';

interface StudioState {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'invalid';
  loadErrors: string[];
  projectId: string | null;
  document: DesignDocument | null;
  meta: ProjectMeta | null;
  history: History;
  saveState: SaveState;
  saveError: string | null;
  lastSavedAt: number | null;
  /** Set when the stored document was upgraded from an older format on open. */
  upgradedFrom: number | null;
  panel: StudioPanel;

  activeZoneId: ZoneId;
  selectedLayerIds: string[];
  viewMode: ViewMode;
  mobileSheet: MobileSheet;
  exportOpen: boolean;
  inspectorOpen: boolean;
  layersOpen: boolean;

  load: (projectId: string) => Promise<void>;
  refreshMeta: () => Promise<void>;
  setPanel: (panel: StudioPanel) => void;
  dispatch: (command: Command) => boolean;
  undo: () => void;
  redo: () => void;
  saveNow: () => Promise<void>;
  setActiveZone: (zoneId: ZoneId) => void;
  select: (ids: string[]) => void;
  setViewMode: (mode: ViewMode) => void;
  setMobileSheet: (sheet: MobileSheet) => void;
  setExportOpen: (open: boolean) => void;
  setInspectorOpen: (open: boolean) => void;
  setLayersOpen: (open: boolean) => void;
}

const SAVE_DEBOUNCE_MS = 400;
// Saves already wait for a pause in editing, so a fresh thumbnail on each save stays cheap.
const THUMBNAIL_INTERVAL_MS = 0;
let lastThumbnailAt = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain: Promise<void> = Promise.resolve();

export const useStudio = create<StudioState>((set, get) => {
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().saveNow(), SAVE_DEBOUNCE_MS);
  }

  function afterChange(document: DesignDocument, history: History) {
    const zone = document.zones[get().activeZoneId];
    const selected = get().selectedLayerIds.filter((id) => zone.layers[id]);
    set({ document, history, saveState: 'unsaved', selectedLayerIds: selected });
    scheduleSave();
  }

  return {
    status: 'idle',
    loadErrors: [],
    projectId: null,
    document: null,
    meta: null,
    history: emptyHistory(),
    saveState: 'saved',
    saveError: null,
    lastSavedAt: null,
    upgradedFrom: null,
    panel: null,

    activeZoneId: 'front',
    selectedLayerIds: [],
    viewMode: 'split',
    mobileSheet: null,
    exportOpen: false,
    inspectorOpen: false,
    layersOpen: false,

    async load(projectId) {
      if (get().projectId === projectId && (get().status === 'ready' || get().status === 'loading')) return;
      set({ status: 'loading', projectId, document: null, history: emptyHistory(), selectedLayerIds: [], loadErrors: [] });
      try {
        const result = await loadDocument(projectId);
        if (get().projectId !== projectId) return;
        if (!result.ok) {
          set({ status: result.reason === 'not_found' ? 'missing' : 'invalid', loadErrors: result.errors ?? [] });
          return;
        }
        set({
          status: 'ready',
          document: result.document,
          meta: result.meta,
          saveState: 'saved',
          lastSavedAt: result.meta.updatedAt,
          activeZoneId: 'front',
          upgradedFrom: result.upgradedFrom ?? null,
          panel: null,
        });
      } catch (error) {
        set({ status: 'invalid', loadErrors: [error instanceof Error ? error.message : String(error)] });
      }
    },

    async refreshMeta() {
      const id = get().projectId;
      if (!id) return;
      const meta = await getProject(id);
      if (meta) set({ meta });
    },

    setPanel(panel) {
      set({ panel });
    },

    dispatch(command) {
      const { document, history } = get();
      if (!document) return false;
      const result = applyCommand(document, history, command);
      if (result.changed) afterChange(result.document, result.history);
      return result.changed;
    },

    undo() {
      const { document, history } = get();
      if (!document) return;
      const result = undoHistory(document, history);
      if (result.changed) afterChange(result.document, result.history);
    },

    redo() {
      const { document, history } = get();
      if (!document) return;
      const result = redoHistory(document, history);
      if (result.changed) afterChange(result.document, result.history);
    },

    saveNow() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      // Serialize saves so an older snapshot never lands after a newer one.
      saveChain = saveChain.then(async () => {
        const document = get().document;
        if (!document || get().saveState === 'saved') return;
        set({ saveState: 'saving' });
        try {
          let thumbnail: Blob | undefined;
          if (Date.now() - lastThumbnailAt > THUMBNAIL_INTERVAL_MS) {
            lastThumbnailAt = Date.now();
            thumbnail = await renderThumbnail(document).catch(() => undefined);
          }
          const meta = await saveDocument(document, thumbnail ? { thumbnail } : undefined);
          // Another edit may have arrived while writing; keep it marked unsaved.
          const stillCurrent = get().document === document;
          set({ meta, lastSavedAt: Date.now(), saveError: null, saveState: stillCurrent ? 'saved' : 'unsaved' });
          if (!stillCurrent) scheduleSave();
        } catch (error) {
          set({ saveState: 'error', saveError: error instanceof Error ? error.message : 'Could not save on this device' });
        }
      });
      return saveChain;
    },

    setActiveZone(zoneId) {
      set({ activeZoneId: zoneId, selectedLayerIds: [] });
    },
    select(ids) {
      const same = ids.length === get().selectedLayerIds.length && ids.every((id, i) => id === get().selectedLayerIds[i]);
      if (!same) set({ selectedLayerIds: ids });
    },
    setViewMode(viewMode) {
      set({ viewMode });
    },
    setMobileSheet(mobileSheet) {
      set({ mobileSheet });
    },
    setExportOpen(exportOpen) {
      set({ exportOpen });
    },
    setInspectorOpen(inspectorOpen) {
      set({ inspectorOpen });
    },
    setLayersOpen(layersOpen) {
      set({ layersOpen });
    },
  };
});

/** Zone spec for the active zone of the open document. */
export function useActiveZoneSpec() {
  const modelId = useStudio((s) => s.document?.garment.modelId);
  const zoneId = useStudio((s) => s.activeZoneId);
  return getGarment(modelId ?? 'tee-classic').zones[zoneId];
}

export function useActiveColorway() {
  return useStudio((s) => s.document?.colorways.find((c) => c.id === s.document?.activeColorwayId) ?? s.document?.colorways[0]);
}

// ---- Live drag previews (not saved, not in history) ----

interface LiveState {
  zoneId: ZoneId | null;
  overrides: Record<string, Partial<LayerTransform>>;
  /** Shown instead of the active colourway while batch-rendering every colourway. */
  colorwayOverride: string | null;
  setOverrides: (zoneId: ZoneId, overrides: Record<string, Partial<LayerTransform>>) => void;
  setColorwayOverride: (id: string | null) => void;
  clear: () => void;
}

export const useLive = create<LiveState>((set) => ({
  zoneId: null,
  overrides: {},
  colorwayOverride: null,
  setOverrides: (zoneId, overrides) => set({ zoneId, overrides }),
  setColorwayOverride: (colorwayOverride) => set({ colorwayOverride }),
  clear: () => set({ zoneId: null, overrides: {} }),
}));

/** The colourway the 3D view should show: a batch-export override, else the active one. */
export function useDisplayColorway() {
  const override = useLive((s) => s.colorwayOverride);
  return useStudio((s) => {
    const d = s.document;
    if (!d) return undefined;
    return d.colorways.find((c) => c.id === (override ?? d.activeColorwayId)) ?? d.colorways[0];
  });
}

if (typeof window !== 'undefined') {
  // Development-only handle for inspecting studio state from the console.
  if (process.env.NODE_ENV !== 'production') Object.assign(window, { __wovexaStudio: useStudio });
  // Flush pending edits when the tab is hidden or closed, so a reload never loses work.
  const flush = () => {
    if (useStudio.getState().saveState !== 'saved') void useStudio.getState().saveNow();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}
