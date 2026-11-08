'use client';
/**
 * Studio shell with three purpose-built layouts (spec §21):
 * desktop ≥1280 (rail, layers, stage, inspector), tablet 768–1279 (rail, stage, drawers),
 * phone <768 (one focus surface, bottom action rail, bottom sheets).
 */
import {
  AlertTriangle,
  Circle,
  Download,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  MousePointer2,
  Plus,
  Redo2,
  Settings2,
  Shirt,
  Square,
  Triangle,
  Type,
  Undo2,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { renameDocument } from '@/domain/commands';
import { getGarment } from '@/domain/garments';
import { summarize } from '@/domain/preflight';
import { ZONE_IDS } from '@/domain/schema';
import { ACCEPTED_TYPES } from '@/lib/assets';
import { WovexaSymbol } from '@/components/brand/Logo';
import { Sheet, Toaster, useLayoutMode } from '@/components/ui/primitives';
import { useStudio, type ViewMode } from '@/stores/studio-store';
import { addImages, addShape, addText, deleteSelection, duplicateSelection, moveSelectionInStack, nudgeSelection } from './actions';
import { ExportPanel } from './ExportDialog';
import { GarmentPanel } from './GarmentPanel';
import { Inspector } from './Inspector';
import { LayerPanel } from './LayerPanel';
import { PreflightPanel, usePreflight } from './PreflightPanel';

const Editor2D = dynamic(() => import('./editor2d/Editor2D').then((m) => m.Editor2D), {
  ssr: false,
  loading: () => <StageLoading label="Loading editor" />,
});
const Viewer3D = dynamic(() => import('./viewer3d/Viewer3D').then((m) => m.Viewer3D), {
  ssr: false,
  loading: () => <StageLoading label="Loading 3D garment" />,
});

function StageLoading({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center text-sm text-fg-2">
      <span className="flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" /> {label}
      </span>
    </div>
  );
}

// ---- Top bar ----

function SaveStatus() {
  const saveState = useStudio((s) => s.saveState);
  const error = useStudio((s) => s.saveError);
  const saveNow = useStudio((s) => s.saveNow);
  const online = useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  if (saveState === 'error') {
    return (
      <button className="text-xs font-medium text-danger underline" onClick={() => void saveNow()} title={error ?? undefined}>
        Couldn’t save. Retry
      </button>
    );
  }
  const text = saveState === 'saving' ? 'Saving…' : saveState === 'unsaved' ? 'Unsaved changes' : online ? 'Saved on this device' : 'Offline, saved on this device';
  return (
    <span className="whitespace-nowrap text-xs text-fg-2" role="status" aria-live="polite">
      {text}
    </span>
  );
}

function TitleField() {
  const title = useStudio((s) => s.document?.title ?? '');
  const dispatch = useStudio((s) => s.dispatch);
  const [draft, setDraft] = useState(title);
  const [synced, setSynced] = useState(title);
  if (synced !== title) {
    setSynced(title);
    setDraft(title);
  }
  return (
    <input
      className="min-w-0 max-w-[16rem] flex-1 truncate rounded-md bg-transparent px-1.5 py-1 text-sm font-semibold hover:bg-hover focus:bg-panel focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
      value={draft}
      aria-label="Project name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const t = draft.trim();
        if (t && t !== title) dispatch(renameDocument(t.slice(0, 120)));
        else setDraft(title);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function useWideStage() {
  return useSyncExternalStore(
    (cb) => {
      const q = matchMedia('(min-width: 1024px)');
      q.addEventListener('change', cb);
      return () => q.removeEventListener('change', cb);
    },
    () => matchMedia('(min-width: 1024px)').matches,
    () => true,
  );
}

function ViewSwitch({ modes: requested }: { modes: ViewMode[] }) {
  const viewMode = useStudio((s) => s.viewMode);
  const setViewMode = useStudio((s) => s.setViewMode);
  const wide = useWideStage();
  // Split needs room for two stages; below 1024 px it is replaced by a one-tap switch (spec §21.5).
  const modes = wide ? requested : requested.filter((m) => m !== 'split');
  const labels: Record<ViewMode, string> = { '2d': '2D', split: 'Split', '3d': '3D' };
  const current = modes.includes(viewMode) ? viewMode : viewMode === 'split' ? (requested.length === 2 ? '3d' : '2d') : modes[0];
  return (
    <div className="seg" role="group" aria-label="View">
      {modes.map((m) => (
        <button key={m} aria-pressed={current === m} onClick={() => setViewMode(m)}>
          {labels[m]}
        </button>
      ))}
    </div>
  );
}

function PreflightBadge({ onClick }: { onClick: () => void }) {
  const { errors, warnings } = summarize(usePreflight());
  if (!errors && !warnings) return null;
  return (
    <button className={`btn btn-ghost min-h-8 px-2 text-xs ${errors ? 'text-danger' : 'text-warning'}`} onClick={onClick}>
      <AlertTriangle size={14} />
      {errors ? `${errors} to fix` : `${warnings} to check`}
    </button>
  );
}

function Topbar({ mode, onOpenChecks }: { mode: 'desktop' | 'tablet' | 'mobile'; onOpenChecks: () => void }) {
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const canUndo = useStudio((s) => s.history.past.length > 0);
  const canRedo = useStudio((s) => s.history.future.length > 0);
  const projectId = useStudio((s) => s.projectId);
  const setExportOpen = useStudio((s) => s.setExportOpen);
  const setMobileSheet = useStudio((s) => s.setMobileSheet);
  const lastLabel = useStudio((s) => s.history.past.at(-1)?.label);
  const nextLabel = useStudio((s) => s.history.future[0]?.label);
  return (
    <header className="flex h-[var(--toolbar-height)] flex-none items-center gap-2 border-b border-line bg-panel px-2 md:px-3">
      <Link href="/dashboard" className="icon-btn" aria-label="Back to projects" title="Projects">
        <WovexaSymbol className="h-[18px] w-auto" />
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <TitleField />
        {mode !== 'mobile' ? <SaveStatus /> : null}
      </div>
      <div className="flex items-center gap-0.5">
        <button className="icon-btn" disabled={!canUndo} onClick={undo} aria-label={lastLabel ? `Undo ${lastLabel}` : 'Undo'} title={`Undo${lastLabel ? `: ${lastLabel}` : ''} (Ctrl+Z)`}>
          <Undo2 size={17} />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={redo} aria-label={nextLabel ? `Redo ${nextLabel}` : 'Redo'} title={`Redo${nextLabel ? `: ${nextLabel}` : ''} (Ctrl+Shift+Z)`}>
          <Redo2 size={17} />
        </button>
      </div>
      {mode !== 'mobile' ? (
        <>
          <ViewSwitch modes={['2d', 'split', '3d']} />
          {mode === 'desktop' ? <PreflightBadge onClick={onOpenChecks} /> : null}
          <Link href={`/production/${projectId}`} className="btn btn-ghost hidden px-2.5 lg:inline-flex" title="Tech pack">
            <FileText size={15} /> Tech pack
          </Link>
          <button className="btn btn-primary" onClick={() => setExportOpen(true)}>
            <Download size={15} /> Export
          </button>
        </>
      ) : (
        <button className="icon-btn" onClick={() => setMobileSheet('export')} aria-label="Export">
          <Download size={18} />
        </button>
      )}
    </header>
  );
}

// ---- Tool rail and add menu ----

function FileButton({ children, className, label }: { children: React.ReactNode; className: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className={className} onClick={() => ref.current?.click()} aria-label={label} title={label}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.length) void addImages(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}

function ToolRail({ onLayers, onInspector, tablet }: { onLayers?: () => void; onInspector?: () => void; tablet?: boolean }) {
  const select = useStudio((s) => s.select);
  return (
    <nav className="flex w-[var(--toolrail-width)] flex-none flex-col items-center gap-1 border-r border-line bg-panel py-2" aria-label="Tools">
      <button className="icon-btn" onClick={() => select([])} aria-label="Select" title="Select (Esc)">
        <MousePointer2 size={18} />
      </button>
      <button className="icon-btn" onClick={() => addText()} aria-label="Add text" title="Add text (T)">
        <Type size={18} />
      </button>
      <FileButton className="icon-btn" label="Add image">
        <ImageIcon size={18} />
      </FileButton>
      <button className="icon-btn" onClick={() => addShape('rect')} aria-label="Add rectangle" title="Rectangle">
        <Square size={17} />
      </button>
      <button className="icon-btn" onClick={() => addShape('ellipse')} aria-label="Add ellipse" title="Ellipse">
        <Circle size={17} />
      </button>
      <button className="icon-btn" onClick={() => addShape('triangle')} aria-label="Add triangle" title="Triangle">
        <Triangle size={17} />
      </button>
      {tablet ? (
        <>
          <span className="my-1 h-px w-7 bg-line" aria-hidden />
          <button className="icon-btn" onClick={onLayers} aria-label="Layers" title="Layers">
            <Layers size={18} />
          </button>
          <button className="icon-btn" onClick={onInspector} aria-label="Properties" title="Properties">
            <Settings2 size={18} />
          </button>
        </>
      ) : null}
    </nav>
  );
}

function ZoneBar() {
  const doc = useStudio((s) => s.document);
  const active = useStudio((s) => s.activeZoneId);
  const setActiveZone = useStudio((s) => s.setActiveZone);
  const issues = usePreflight();
  if (!doc) return null;
  const model = getGarment(doc.garment.modelId);
  return (
    <div className="flex flex-none items-center gap-1 overflow-x-auto border-t border-line bg-panel px-2 py-1.5" role="tablist" aria-label="Print zones">
      {ZONE_IDS.map((z) => {
        const count = doc.zones[z].orderedLayerIds.length;
        const errs = issues.filter((i) => i.zoneId === z && i.severity === 'error').length;
        return (
          <button
            key={z}
            role="tab"
            aria-selected={active === z}
            onClick={() => setActiveZone(z)}
            className={`flex min-h-9 flex-none items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium ${active === z ? 'bg-inverse text-fg-inverse' : 'text-fg-2 hover:bg-hover'}`}
          >
            {model.zones[z].label}
            {count ? <span className={`num text-xs ${active === z ? 'opacity-70' : 'text-fg-3'}`}>{count}</span> : null}
            {errs ? <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-label={`${errs} issues`} /> : null}
          </button>
        );
      })}
    </div>
  );
}

// ---- Stage ----

function Stage({ mode }: { mode: 'desktop' | 'tablet' | 'mobile' }) {
  const viewMode = useStudio((s) => s.viewMode);
  const wide = useWideStage();
  const effective: ViewMode = mode === 'mobile' ? (viewMode === '2d' ? '2d' : '3d') : viewMode === 'split' && !wide ? '2d' : viewMode;
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) void addImages(e.dataTransfer.files);
  };
  return (
    <main className="relative flex min-h-0 min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} aria-label="Design stage">
      {effective !== '3d' ? (
        <div className={`relative min-w-0 ${effective === 'split' ? 'w-1/2 border-r border-line' : 'flex-1'}`}>
          <Editor2D />
        </div>
      ) : null}
      {effective !== '2d' ? (
        <div className={`relative min-w-0 ${effective === 'split' ? 'w-1/2' : 'flex-1'}`}>
          <Viewer3D compact={mode === 'mobile'} />
        </div>
      ) : null}
    </main>
  );
}

// ---- Keyboard shortcuts (spec DSK-01) ----

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const s = useStudio.getState();
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && key === 's') {
        e.preventDefault();
        void s.saveNow();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedLayerIds.length) {
          e.preventDefault();
          deleteSelection();
        }
      } else if (e.key === 'Escape') {
        s.select([]);
      } else if (e.key.startsWith('Arrow') && s.selectedLayerIds.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelection(dx, dy);
      } else if (!mod && key === 't') {
        addText();
      } else if (!mod && e.key === ']') {
        moveSelectionInStack(1);
      } else if (!mod && e.key === '[') {
        moveSelectionInStack(-1);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void addImages(files);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
}

// ---- Mobile ----

function MobileAddSheet({ onDone }: { onDone: () => void }) {
  const item = 'flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-xl border border-line text-[13px] font-medium';
  return (
    <div className="grid grid-cols-3 gap-2 p-4">
      <button className={item} onClick={() => { addText(); onDone(); }}>
        <Type size={20} /> Text
      </button>
      <label className={item}>
        <ImageIcon size={20} /> Image
        <input type="file" accept={ACCEPTED_TYPES} multiple className="sr-only" onChange={(e) => { if (e.target.files?.length) void addImages(e.target.files); onDone(); }} />
      </label>
      <button className={item} onClick={() => { addShape('rect'); onDone(); }}>
        <Square size={20} /> Rectangle
      </button>
      <button className={item} onClick={() => { addShape('ellipse'); onDone(); }}>
        <Circle size={20} /> Ellipse
      </button>
      <button className={item} onClick={() => { addShape('triangle'); onDone(); }}>
        <Triangle size={20} /> Triangle
      </button>
    </div>
  );
}

function MobileRail() {
  const setSheet = useStudio((s) => s.setMobileSheet);
  const hasSelection = useStudio((s) => s.selectedLayerIds.length > 0);
  const { errors } = summarize(usePreflight());
  const item = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-fg-2';
  return (
    <nav className="safe-bottom flex flex-none border-t border-line bg-panel" aria-label="Studio actions">
      <button className={item} onClick={() => setSheet('add')}>
        <Plus size={20} className="text-fg" /> Add
      </button>
      <button className={item} onClick={() => setSheet('layers')}>
        <Layers size={20} className="text-fg" /> Layers
      </button>
      <button className={`${item} ${hasSelection ? 'text-accent' : ''}`} onClick={() => setSheet('inspect')}>
        <Settings2 size={20} className={hasSelection ? '' : 'text-fg'} /> {hasSelection ? 'Edit' : 'Style'}
      </button>
      <button className={item} onClick={() => setSheet('garment')}>
        <Shirt size={20} className="text-fg" /> Garment
      </button>
      <button className={item} onClick={() => setSheet('preflight')}>
        <span className="relative">
          <AlertTriangle size={20} className={errors ? 'text-danger' : 'text-fg'} />
        </span>
        Checks
      </button>
    </nav>
  );
}

// ---- Shell ----

export function StudioShell() {
  const mode = useLayoutMode();
  useShortcuts();
  const exportOpen = useStudio((s) => s.exportOpen);
  const setExportOpen = useStudio((s) => s.setExportOpen);
  const sheet = useStudio((s) => s.mobileSheet);
  const setSheet = useStudio((s) => s.setMobileSheet);
  const inspectorOpen = useStudio((s) => s.inspectorOpen);
  const setInspectorOpen = useStudio((s) => s.setInspectorOpen);
  const layersOpen = useStudio((s) => s.layersOpen);
  const setLayersOpen = useStudio((s) => s.setLayersOpen);
  const [checksOpen, setChecksOpen] = useState(false);
  const closeSheet = useCallback(() => setSheet(null), [setSheet]);
  const closeExport = useCallback(() => setExportOpen(false), [setExportOpen]);
  const closeInspector = useCallback(() => setInspectorOpen(false), [setInspectorOpen]);
  const closeLayers = useCallback(() => setLayersOpen(false), [setLayersOpen]);
  const closeChecks = useCallback(() => setChecksOpen(false), []);

  // Open the right panel when a text layer is double-clicked or added on smaller screens.
  useEffect(() => {
    const onEdit = () => {
      if (mode === 'tablet') setInspectorOpen(true);
      if (mode === 'mobile') setSheet('inspect');
    };
    window.addEventListener('wovexa:edit-layer', onEdit);
    return () => window.removeEventListener('wovexa:edit-layer', onEdit);
  }, [mode, setInspectorOpen, setSheet]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <Topbar mode={mode} onOpenChecks={() => setChecksOpen(true)} />

      {mode === 'mobile' ? (
        <div className="flex flex-none items-center justify-between gap-2 border-b border-line bg-panel px-2 py-1.5">
          <SaveStatus />
          <ViewSwitch modes={['2d', '3d']} />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {mode !== 'mobile' ? <ToolRail tablet={mode === 'tablet'} onLayers={() => setLayersOpen(true)} onInspector={() => setInspectorOpen(true)} /> : null}
        {mode === 'desktop' ? (
          <aside className="w-[var(--panel-width)] flex-none overflow-hidden border-r border-line bg-panel" aria-label="Layers">
            <LayerPanel />
          </aside>
        ) : null}
        <Stage mode={mode} />
        {mode === 'desktop' ? (
          <aside className="w-[var(--inspector-width)] flex-none overflow-y-auto border-l border-line bg-panel" aria-label="Properties">
            <Inspector />
          </aside>
        ) : null}
      </div>

      <ZoneBar />
      {mode === 'mobile' ? <MobileRail /> : null}

      {/* Tablet drawers */}
      <Sheet open={mode === 'tablet' && layersOpen} onClose={closeLayers} title="Layers" side="left">
        <LayerPanel />
      </Sheet>
      <Sheet open={mode === 'tablet' && inspectorOpen} onClose={closeInspector} title="Properties" side="right">
        <Inspector />
      </Sheet>

      {/* Phone bottom sheets */}
      <Sheet open={mode === 'mobile' && sheet === 'add'} onClose={closeSheet} title="Add to design">
        <MobileAddSheet onDone={closeSheet} />
      </Sheet>
      <Sheet open={mode === 'mobile' && sheet === 'layers'} onClose={closeSheet} title="Layers">
        <LayerPanel />
      </Sheet>
      <Sheet open={mode === 'mobile' && sheet === 'inspect'} onClose={closeSheet} title="Edit">
        <Inspector />
      </Sheet>
      <Sheet open={mode === 'mobile' && sheet === 'garment'} onClose={closeSheet} title="Garment">
        <GarmentPanel />
      </Sheet>
      <Sheet open={mode === 'mobile' && sheet === 'preflight'} onClose={closeSheet} title="Print checks">
        <PreflightPanel onNavigate={closeSheet} />
      </Sheet>
      <Sheet open={mode === 'mobile' && sheet === 'export'} onClose={closeSheet} title="Export">
        <ExportPanel />
      </Sheet>

      {/* Desktop and tablet dialogs */}
      <Sheet open={mode !== 'mobile' && exportOpen} onClose={closeExport} title="Export" side="right">
        <ExportPanel />
      </Sheet>
      <Sheet open={checksOpen} onClose={closeChecks} title="Print checks" side="right">
        <PreflightPanel onNavigate={closeChecks} />
      </Sheet>

      <Toaster />
    </div>
  );
}
