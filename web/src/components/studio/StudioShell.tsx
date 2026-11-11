'use client';
/**
 * Studio shell with three purpose-built layouts (spec §21):
 * desktop ≥1280 (rail, layers, stage, inspector), tablet 768–1279 (rail, stage, drawers),
 * phone <768 (one focus surface, bottom action rail, bottom sheets).
 */
import {
  AlertTriangle,
  BadgeCheck,
  Circle,
  Clapperboard,
  Component,
  Download,
  Ellipsis,
  FileText,
  GitCompare,
  Heart,
  Hexagon,
  Image as ImageIcon,
  Layers,
  Keyboard,
  LayoutTemplate,
  Loader2,
  Minus,
  MousePointer2,
  PenTool,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Settings2,
  Shapes,
  Shirt,
  Square,
  SquareDashed,
  Star,
  Triangle,
  Type,
  Undo2,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { renameDocument } from '@/domain/commands';
import { designAreas } from '@/domain/areas';
import { getGarment } from '@/domain/garments';
import { lockupsOf } from '@/domain/lockups';
import { summarize } from '@/domain/preflight';
import type { AreaId, ShapeContent } from '@/domain/schema';
import { ACCEPTED_TYPES } from '@/lib/assets';
import { approvalState, daysLeft, restoreProject } from '@/lib/local-db';
import { WovexaSymbol } from '@/components/brand/Logo';
import { Sheet, toast, Toaster, useLayoutMode, useMenuKeyboard } from '@/components/ui/primitives';
import { useStudio, type StudioPanel, type ViewMode } from '@/stores/studio-store';
import {
  addImages,
  addGraphic,
  addShape,
  addText,
  copySelection,
  deleteSelection,
  duplicateSelection,
  editLockup,
  groupSelection,
  isOwnClipboard,
  moveSelectionInStack,
  nudgeSelection,
  pasteLayers,
  rotateSelection,
  selectAll,
  selectNextLayer,
  startPen,
  switchArtboard,
  ungroupSelection,
  clipSelection,
  zoomToSelection,
} from './actions';
import { deleteProjection, duplicateProjection, moveProjectionBy, nudgeProjection } from './projection-actions';
import { activeBareArea, addDesignArea, nudgeArea } from './area-actions';
import { BrandKitProvider } from './brand-context';
import { BrandPanel } from './BrandPanel';
import { CommandPalette, openCommandPalette, useModKey } from './CommandPalette';
import { GarmentPanel } from './GarmentPanel';
import { GraphicsGrid, GraphicsMenu } from './GraphicsLibrary';
import { Inspector } from './Inspector';
import { LayerPanel } from './LayerPanel';
import { PreflightPanel, usePreflight } from './PreflightPanel';
import { StudioTour } from './StudioTour';

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

function PanelLoading() {
  return (
    <p className="flex items-center gap-2 p-4 text-sm text-fg-2">
      <Loader2 size={15} className="animate-spin" /> Loading…
    </p>
  );
}

// Panels opened on demand (export, render, versions, compare, templates, keys) load their code
// when first needed, and are fetched in the background once the studio is idle: the studio
// starts lighter, and the first open is still instant.
const loadExport = () => import('./ExportDialog');
const loadRender = () => import('./RenderPanel');
const loadHistory = () => import('./HistoryPanel');
const loadCompare = () => import('./ColorwayCompare');
const loadTemplate = () => import('./SaveTemplatePanel');
const loadShortcuts = () => import('./ShortcutsPanel');
const ExportPanel = dynamic(() => loadExport().then((m) => m.ExportPanel), { ssr: false, loading: PanelLoading });
const RenderPanel = dynamic(() => loadRender().then((m) => m.RenderPanel), { ssr: false, loading: PanelLoading });
const HistoryPanel = dynamic(() => loadHistory().then((m) => m.HistoryPanel), { ssr: false, loading: PanelLoading });
const ColorwayCompare = dynamic(() => loadCompare().then((m) => m.ColorwayCompare), { ssr: false, loading: PanelLoading });
const SaveTemplatePanel = dynamic(() => loadTemplate().then((m) => m.SaveTemplatePanel), { ssr: false, loading: PanelLoading });
const ShortcutsPanel = dynamic(() => loadShortcuts().then((m) => m.ShortcutsPanel), { ssr: false, loading: PanelLoading });

/** Fetch the on-demand panels while nothing else is happening, so opening one never waits. */
function usePrefetchPanels() {
  useEffect(() => {
    const fetchAll = () => {
      for (const load of [loadExport, loadRender, loadHistory, loadCompare, loadTemplate, loadShortcuts]) void load().catch(() => {});
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) {
      const id = idle(fetchAll, { timeout: 8000 });
      return () => (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const t = setTimeout(fetchAll, 3000);
    return () => clearTimeout(t);
  }, []);
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
  // An edit refused for going past a limit of the design says which limit.
  const refusal = useStudio((s) => s.refusal);
  useEffect(() => {
    if (refusal) toast(refusal.text, 'error');
  }, [refusal]);
  // Say why a save failed where it can be read, not only in a tooltip; once, not on every edit.
  const told = useRef<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (saveState !== 'error' || !error) return;
    const last = told.current;
    if (last && last.text === error && Date.now() - last.at < 15_000) return;
    told.current = { text: error, at: Date.now() };
    toast(error, 'error');
  }, [saveState, error]);
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

function ApprovalBadge() {
  const meta = useStudio((s) => s.meta);
  const setPanel = useStudio((s) => s.setPanel);
  if (!meta?.approvedHash) return null;
  const state = approvalState(meta);
  return (
    <button
      className={`btn btn-ghost hidden min-h-8 px-2 text-xs sm:inline-flex ${state === 'approved' ? 'text-success' : 'text-warning'}`}
      onClick={() => setPanel('history')}
      title={state === 'approved' ? `Matches approved version ${meta.approvedVersionNumber}` : `Changed since version ${meta.approvedVersionNumber} was approved`}
    >
      <BadgeCheck size={14} /> {state === 'approved' ? `Approved v${meta.approvedVersionNumber}` : 'Changed since approval'}
    </button>
  );
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const setPanel = useStudio((s) => s.setPanel);
  const projectId = useStudio((s) => s.projectId);
  const closeMenu = useCallback((restore: boolean) => {
    setOpen(false);
    if (restore) triggerRef.current?.focus();
  }, []);
  useMenuKeyboard(menuRef, open, closeMenu);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const item = 'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-hover';
  const pick = (panel: StudioPanel) => () => {
    setOpen(false);
    setPanel(panel);
  };
  const mod = useModKey();
  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        className="icon-btn"
        aria-label="More project actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Ellipsis size={18} />
      </button>
      {open ? (
        <div ref={menuRef} role="menu" aria-label="Project actions" className="absolute right-0 top-full z-40 mt-1 w-56 rounded-xl border border-line bg-floating p-1 shadow-xl">
          <button
            role="menuitem"
            className={`${item} mb-1 border-b border-line`}
            onClick={() => {
              setOpen(false);
              openCommandPalette();
            }}
          >
            <Search size={15} /> Find an action
            <span className="ml-auto text-[11px] text-fg-3 [@media(hover:none)]:hidden">{mod}+K</span>
          </button>
          <button role="menuitem" className={item} onClick={pick('render')}>
            <Clapperboard size={15} /> Wovexa Render
          </button>
          <button role="menuitem" className={item} onClick={pick('history')}>
            <RotateCcw size={15} /> Versions and approval
          </button>
          <button role="menuitem" className={item} onClick={pick('compare')}>
            <GitCompare size={15} /> Compare colourways
          </button>
          <button role="menuitem" className={item} onClick={pick('save-template')}>
            <LayoutTemplate size={15} /> Save as template
          </button>
          <Link role="menuitem" className={item} href={`/production/${projectId}`} onClick={() => setOpen(false)}>
            <FileText size={15} /> Tech pack
          </Link>
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new CustomEvent('wovexa:shortcuts'));
            }}
          >
            <Keyboard size={15} /> Keys and gestures
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Opens the command palette; on wide screens it shows its shortcut, to teach it. */
function PaletteButton({ showKeys }: { showKeys: boolean }) {
  const mod = useModKey();
  return (
    <button
      className="btn btn-ghost min-h-9 gap-2 px-2 text-fg-2 hover:text-fg"
      onClick={openCommandPalette}
      aria-label="Find an action"
      aria-keyshortcuts="Control+K Meta+K"
      title={`Find an action (${mod}+K)`}
    >
      <Search size={16} />
      {showKeys ? <kbd className="rounded border border-line px-1 py-px font-sans text-[10.5px] font-medium text-fg-2">{mod} K</kbd> : null}
    </button>
  );
}

function Topbar({ mode, onOpenChecks }: { mode: 'desktop' | 'tablet' | 'mobile'; onOpenChecks: () => void }) {
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const canUndo = useStudio((s) => s.history.past.length > 0);
  const canRedo = useStudio((s) => s.history.future.length > 0);
  const setExportOpen = useStudio((s) => s.setExportOpen);
  const setMobileSheet = useStudio((s) => s.setMobileSheet);
  const lastLabel = useStudio((s) => s.history.past.at(-1)?.label);
  const nextLabel = useStudio((s) => s.history.future[0]?.label);
  return (
    <header className="flex h-[calc(var(--toolbar-height)+env(safe-area-inset-top))] flex-none items-center gap-2 border-b border-line bg-panel pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]">
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
          <ApprovalBadge />
          <PaletteButton showKeys={mode === 'desktop'} />
          <MoreMenu />
          <button className="btn btn-primary" onClick={() => setExportOpen(true)}>
            <Download size={15} /> Export
          </button>
        </>
      ) : (
        <>
          <button className="icon-btn" onClick={() => setMobileSheet('export')} aria-label="Export">
            <Download size={18} />
          </button>
          <MoreMenu />
        </>
      )}
    </header>
  );
}

/** A project opened while it is in Recently deleted says so, with the way back. */
function DeletedBanner() {
  const meta = useStudio((s) => s.meta);
  const refreshMeta = useStudio((s) => s.refreshMeta);
  if (!meta?.deletedAt) return null;
  const days = daysLeft(meta);
  return (
    <div className="flex flex-none items-center gap-3 border-b border-line bg-warning/10 px-3 py-1.5 text-xs" role="status">
      <span className="flex-1">
        This project is in Recently deleted and goes for good in {days} {days === 1 ? 'day' : 'days'}.
      </span>
      <button
        className="btn btn-outline min-h-7 px-2.5 text-xs"
        onClick={async () => {
          await restoreProject(meta.id);
          await refreshMeta();
          toast(`Restored ${meta.title}.`, 'success');
        }}
      >
        Restore
      </button>
    </div>
  );
}

/** Layers and the brand kit share the left panel. */
function LeftPanel() {
  const [tab, setTab] = useState<'layers' | 'brand'>('layers');
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 px-3 pt-3" role="tablist" aria-label="Left panel">
        {(['layers', 'brand'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="rounded-md px-2.5 py-1 text-[13px] font-semibold text-fg-2 aria-selected:bg-inverse aria-selected:text-fg-inverse"
          >
            {t === 'layers' ? 'Layers' : 'Brand'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'layers' ? <LayerPanel /> : <BrandPanel />}</div>
    </div>
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
        // The labelled button opens it; screen readers skip the bare file field.
        aria-hidden
        onChange={(e) => {
          if (e.target.files?.length) void addImages(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}

const SHAPE_ITEMS: { shape: ShapeContent['shape']; label: string; Icon: typeof Square }[] = [
  { shape: 'rect', label: 'Rectangle', Icon: Square },
  { shape: 'ellipse', label: 'Ellipse', Icon: Circle },
  { shape: 'triangle', label: 'Triangle', Icon: Triangle },
  { shape: 'star', label: 'Star', Icon: Star },
  { shape: 'polygon', label: 'Hexagon', Icon: Hexagon },
  { shape: 'heart', label: 'Heart', Icon: Heart },
  { shape: 'line', label: 'Line', Icon: Minus },
];

/** All shapes behind one rail button, as a keyboard-navigable menu. */
function ShapeMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback((restore: boolean) => {
    setOpen(false);
    if (restore) triggerRef.current?.focus();
  }, []);
  useMenuKeyboard(menuRef, open, closeMenu);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        className="icon-btn"
        aria-label="Add a shape"
        title="Shapes"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Shapes size={18} />
      </button>
      {open ? (
        <div ref={menuRef} role="menu" aria-label="Shapes" className="absolute left-full top-0 z-40 ml-2 grid w-44 gap-0.5 rounded-xl border border-line bg-floating p-1 shadow-xl">
          {SHAPE_ITEMS.map(({ shape, label, Icon }) => (
            <button
              key={shape}
              role="menuitem"
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-hover"
              onClick={() => {
                addShape(shape);
                closeMenu(false);
              }}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
          <button
            role="menuitem"
            className="flex items-center gap-2.5 rounded-md border-t border-line px-3 py-2 text-left text-sm hover:bg-hover"
            onClick={() => {
              closeMenu(false);
              startPen();
            }}
          >
            <PenTool size={15} /> Draw your own (P)
          </button>
        </div>
      ) : null}
    </div>
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
      <ShapeMenu />
      <GraphicsMenu />
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
    <div className="safe-x flex flex-none items-center gap-1 overflow-x-auto border-t border-line bg-panel px-2 py-1.5" role="tablist" aria-label="Print zones">
      {model.zoneOrder.map((z) => {
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
            {model.zones[z]?.label}
            {count ? <span className={`num text-xs ${active === z ? 'opacity-70' : 'text-fg-3'}`}>{count}</span> : null}
            {errs ? <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-label={errs === 1 ? '1 issue' : `${errs} issues`} /> : null}
          </button>
        );
      })}
      {designAreas(doc).map((a) => {
        const on = active === a.id;
        const count = a.orderedLayerIds.length;
        return (
          <button
            key={a.id}
            role="tab"
            aria-selected={on}
            onClick={() => setActiveZone(a.id as AreaId)}
            title={`${a.name}: a design area you placed on the garment, ${Math.round(a.widthMm)} × ${Math.round(a.heightMm)} mm`}
            className={`flex min-h-9 flex-none items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium ${on ? 'bg-inverse text-fg-inverse' : 'text-fg-2 hover:bg-hover'} ${a.visible ? '' : 'opacity-60'}`}
          >
            <SquareDashed size={13} aria-hidden />
            {a.name}
            {count ? <span className={`num text-xs ${on ? 'opacity-70' : 'text-fg-3'}`}>{count}</span> : null}
          </button>
        );
      })}
      <button className="flex min-h-9 flex-none items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-fg-2 hover:bg-hover" onClick={addDesignArea} title="Add a design area anywhere on the garment: a hood, a side panel, across a seam" aria-label="Add a design area">
        <Plus size={14} /> Area
      </button>
      {lockupsOf(doc).length ? <span className="mx-1 h-5 w-px flex-none bg-line" aria-hidden /> : null}
      {lockupsOf(doc).map((l) => {
        const on = active === l.id;
        return (
          <button
            key={l.id}
            role="tab"
            aria-selected={on}
            onClick={() => editLockup(l.id)}
            title={`${l.name}: a lockup. Edit it here and every placement follows.`}
            className={`flex min-h-9 flex-none items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium ${on ? 'bg-inverse text-fg-inverse' : 'text-fg-2 hover:bg-hover'}`}
          >
            <Component size={13} aria-hidden />
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

// ---- Stage ----

// Split view's share for the 2D artboard, remembered on this device.
const SPLIT_KEY = 'wovexa.split';
const SPLIT_MIN = 0.25;
const SPLIT_MAX = 0.75;
const clampSplit = (v: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v));
function readSplit() {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v ? clampSplit(v) : 0.5;
  } catch {
    return 0.5;
  }
}
function saveSplit(v: number) {
  try {
    localStorage.setItem(SPLIT_KEY, String(Math.round(v * 1000) / 1000));
  } catch {}
}

/** The divider between the 2D artboard and the 3D view: drag it, use the arrow keys, or double-click to centre it. */
function SplitDivider({ split, onChange, stageRef }: { split: number; onChange: (v: number, save: boolean) => void; stageRef: React.RefObject<HTMLElement | null> }) {
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage || e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    try {
      // Keep the drag when the pointer runs over the canvases on either side.
      el.setPointerCapture(e.pointerId);
    } catch {}
    const rect = stage.getBoundingClientRect();
    let last = split;
    const move = (ev: PointerEvent) => {
      last = clampSplit((ev.clientX - rect.left) / rect.width);
      onChange(last, false);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onChange(last, true);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the 2D and 3D views"
      aria-valuemin={SPLIT_MIN * 100}
      aria-valuemax={SPLIT_MAX * 100}
      aria-valuenow={Math.round(split * 100)}
      aria-valuetext={`2D artboard ${Math.round(split * 100)}%`}
      tabIndex={0}
      title="Drag to resize; double-click to centre"
      className="group relative z-10 w-px flex-none cursor-col-resize touch-none bg-line outline-none focus-visible:bg-[var(--accent)]"
      onPointerDown={startDrag}
      onDoubleClick={() => onChange(0.5, true)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.05;
        const next = e.key === 'ArrowLeft' ? split - step : e.key === 'ArrowRight' ? split + step : e.key === 'Home' ? SPLIT_MIN : e.key === 'End' ? SPLIT_MAX : null;
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        onChange(clampSplit(next), true);
      }}
    >
      {/* A wider grip than the 1 px line, and a handle that shows on hover and focus. */}
      <span className="absolute inset-y-0 -left-2 -right-2" aria-hidden />
      <span className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:bg-[var(--accent)] group-focus-visible:opacity-100" aria-hidden />
    </div>
  );
}

function Stage({ mode }: { mode: 'desktop' | 'tablet' | 'mobile' }) {
  const viewMode = useStudio((s) => s.viewMode);
  const wide = useWideStage();
  const effective: ViewMode = mode === 'mobile' ? (viewMode === '2d' ? '2d' : '3d') : viewMode === 'split' && !wide ? '2d' : viewMode;
  const [split, setSplit] = useState(readSplit);
  const stageRef = useRef<HTMLElement>(null);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) void addImages(e.dataTransfer.files);
  };
  return (
    <main ref={stageRef} className="relative flex min-h-0 min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} aria-label="Design stage">
      {effective !== '3d' ? (
        <div className={`relative min-w-0 ${effective === 'split' ? 'flex-none' : 'flex-1'}`} style={effective === 'split' ? { width: `${split * 100}%` } : undefined}>
          <Editor2D />
        </div>
      ) : null}
      {effective === 'split' ? (
        <SplitDivider
          split={split}
          stageRef={stageRef}
          onChange={(v, save) => {
            setSplit(v);
            if (save) saveSplit(v);
          }}
        />
      ) : null}
      {effective !== '2d' ? (
        <div className="relative min-w-0 flex-1">
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
      // The command palette opens from anywhere in the studio, a text field included, but not over another dialog.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        if (!document.querySelector('[aria-modal="true"]')) {
          e.preventDefault();
          openCommandPalette();
        }
        return;
      }
      // Keys sent to the window itself (no element focused) act on the page.
      const target = e.target instanceof Element ? e.target : document.body;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      // Dialogs and menus own the keyboard while open: Delete or arrows there must not edit the design.
      if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]') || document.querySelector('[aria-modal="true"]')) return;
      // The 3D view uses arrow keys, +/− and comma/period to orbit, zoom and turn artwork when it has focus.
      if (target.closest('[data-viewer3d]') && (/^(Arrow|\+|=|-)/.test(e.key) || e.code === 'Comma' || e.code === 'Period')) return;
      const mod = e.metaKey || e.ctrlKey;
      const s = useStudio.getState();
      const key = e.key.toLowerCase();
      if (e.key === 'Tab' && !mod && !e.altKey) {
        // On the canvas, Tab steps through the layers, then on out of the canvas.
        if (target.closest('[role="application"], [data-viewer3d]') && selectNextLayer(e.shiftKey ? -1 : 1)) e.preventDefault();
        return;
      }
      if (e.key === '?' && !mod) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('wovexa:shortcuts'));
      } else if (!mod && !e.altKey && (e.code === 'Comma' || e.code === 'Period')) {
        e.preventDefault();
        rotateSelection((e.code === 'Comma' ? -1 : 1) * (e.shiftKey ? 15 : 1));
      } else if (!mod && !e.altKey && (e.key === 'PageUp' || e.key === 'PageDown')) {
        e.preventDefault();
        switchArtboard(e.key === 'PageDown' ? 1 : -1);
      } else if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('wovexa:open-context-menu'));
      } else if (mod && key === 'a') {
        e.preventDefault();
        selectAll();
      } else if (!mod && !e.altKey && (e.key === '+' || e.key === '=')) {
        window.dispatchEvent(new CustomEvent('wovexa:zoom-step', { detail: 1.25 }));
      } else if (!mod && !e.altKey && (e.key === '-' || e.key === '_')) {
        window.dispatchEvent(new CustomEvent('wovexa:zoom-step', { detail: 0.8 }));
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        if (s.selectedProjectionId) duplicateProjection(s.selectedProjectionId);
        else duplicateSelection();
      } else if (mod && e.altKey && e.code === 'KeyG') {
        // Alt changes the key's character on some layouts, so match the physical key.
        e.preventDefault();
        clipSelection();
      } else if (mod && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
      } else if (e.shiftKey && !mod && e.code === 'Digit1') {
        window.dispatchEvent(new CustomEvent('wovexa:fit'));
      } else if (e.shiftKey && !mod && e.code === 'Digit2') {
        zoomToSelection();
      } else if (mod && key === 's') {
        e.preventDefault();
        void s.saveNow();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedProjectionId) {
          e.preventDefault();
          deleteProjection(s.selectedProjectionId);
        } else if (s.selectedLayerIds.length) {
          e.preventDefault();
          deleteSelection();
        }
      } else if (e.key === 'Escape') {
        s.select([]);
      } else if (e.key.startsWith('Arrow') && (s.selectedLayerIds.length || s.selectedProjectionId || activeBareArea())) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const bare = activeBareArea();
        if (s.selectedProjectionId) nudgeProjection(s.selectedProjectionId, dx, dy);
        else if (bare) nudgeArea(bare.id, dx, dy);
        else nudgeSelection(dx, dy);
      } else if (!mod && key === 't') {
        addText();
      } else if (!mod && !e.altKey && key === 'p' && !target.closest('[data-viewer3d]') && s.viewMode !== '3d') {
        // The pen, on the 2D artboard (P in the 3D view switches it to Place mode instead).
        window.dispatchEvent(new CustomEvent('wovexa:pen'));
      } else if (!mod && e.key === ']') {
        if (s.selectedProjectionId) moveProjectionBy(s.selectedProjectionId, 1);
        else moveSelectionInStack(1);
      } else if (!mod && e.key === '[') {
        if (s.selectedProjectionId) moveProjectionBy(s.selectedProjectionId, -1);
        else moveSelectionInStack(-1);
      }
    };
    /** Whether a clipboard event belongs to a field or dialog (their own copy and paste), not the design. */
    const elsewhere = (e: ClipboardEvent) => e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]');
    // Copy and cut the selected layers; the system clipboard gets their words (or names).
    const onCopy = (cut: boolean) => (e: ClipboardEvent) => {
      if (elsewhere(e) || window.getSelection()?.toString()) return;
      const text = copySelection(cut);
      if (text === null) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', text);
    };
    const onCopyEvent = onCopy(false);
    const onCutEvent = onCopy(true);
    const onPaste = (e: ClipboardEvent) => {
      if (elsewhere(e)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void addImages(files);
        return;
      }
      // Layers copied here come back as layers; any other text becomes a text layer.
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (isOwnClipboard(text)) {
        e.preventDefault();
        pasteLayers();
      } else if (text.trim()) {
        e.preventDefault();
        addText(text.trim().slice(0, 500));
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('copy', onCopyEvent);
    window.addEventListener('cut', onCutEvent);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('copy', onCopyEvent);
      window.removeEventListener('cut', onCutEvent);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
}

// ---- Mobile ----

function MobileAddSheet({ onDone }: { onDone: () => void }) {
  const item = 'flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-xl border border-line text-[13px] font-medium';
  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-3 gap-2">
        <button className={item} onClick={() => { addText(); onDone(); }}>
          <Type size={20} /> Text
        </button>
        <label className={`${item} relative`}>
          <ImageIcon size={20} /> Image
          <input type="file" accept={ACCEPTED_TYPES} multiple className="sr-only" onChange={(e) => { if (e.target.files?.length) void addImages(e.target.files); onDone(); }} />
        </label>
        {SHAPE_ITEMS.map(({ shape, label, Icon }) => (
          <button key={shape} className={item} onClick={() => { addShape(shape); onDone(); }}>
            <Icon size={20} /> {label}
          </button>
        ))}
        <button className={item} onClick={() => { onDone(); startPen(); }}>
          <PenTool size={20} /> Draw
        </button>
      </div>
      <section>
        <h3 className="panel-title mb-2">Graphics</h3>
        <GraphicsGrid columns={5} onPick={(g) => { addGraphic(g); onDone(); }} />
      </section>
    </div>
  );
}

function MobileRail() {
  const setSheet = useStudio((s) => s.setMobileSheet);
  const hasSelection = useStudio((s) => s.selectedLayerIds.length > 0 || !!s.selectedProjectionId);
  const { errors } = summarize(usePreflight());
  const item = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-fg-2';
  return (
    <nav className="safe-bottom safe-x flex flex-none border-t border-line bg-panel" aria-label="Studio actions">
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
  usePrefetchPanels();
  const exportOpen = useStudio((s) => s.exportOpen);
  const setExportOpen = useStudio((s) => s.setExportOpen);
  const sheet = useStudio((s) => s.mobileSheet);
  const setSheet = useStudio((s) => s.setMobileSheet);
  const inspectorOpen = useStudio((s) => s.inspectorOpen);
  const setInspectorOpen = useStudio((s) => s.setInspectorOpen);
  const layersOpen = useStudio((s) => s.layersOpen);
  const setLayersOpen = useStudio((s) => s.setLayersOpen);
  const [checksOpen, setChecksOpen] = useState(false);
  const panel = useStudio((s) => s.panel);
  const setPanel = useStudio((s) => s.setPanel);
  const upgradedFrom = useStudio((s) => s.upgradedFrom);
  const closeSheet = useCallback(() => setSheet(null), [setSheet]);
  const closeExport = useCallback(() => setExportOpen(false), [setExportOpen]);
  const closeInspector = useCallback(() => setInspectorOpen(false), [setInspectorOpen]);
  const closeLayers = useCallback(() => setLayersOpen(false), [setLayersOpen]);
  const closeChecks = useCallback(() => setChecksOpen(false), []);
  const openChecks = useCallback(() => (mode === 'mobile' ? setSheet('preflight') : setChecksOpen(true)), [mode, setSheet]);
  const closePanel = useCallback(() => setPanel(null), [setPanel]);
  const panelSide = mode === 'mobile' ? 'bottom' : 'right';
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  useEffect(() => {
    const open = () => setShortcutsOpen(true);
    window.addEventListener('wovexa:shortcuts', open);
    return () => window.removeEventListener('wovexa:shortcuts', open);
  }, []);

  // Tell people once when an older project was upgraded, and where the backup is.
  useEffect(() => {
    if (upgradedFrom) {
      toast('This project was upgraded to the latest format. The original is kept in Versions.');
      useStudio.setState({ upgradedFrom: null });
    }
  }, [upgradedFrom]);

  // Open the right panel when a layer is double-clicked, a text added or a crop opened on smaller screens.
  useEffect(() => {
    const onEdit = () => {
      if (mode === 'tablet') setInspectorOpen(true);
      if (mode === 'mobile') setSheet('inspect');
    };
    window.addEventListener('wovexa:edit-layer', onEdit);
    return () => window.removeEventListener('wovexa:edit-layer', onEdit);
  }, [mode, setInspectorOpen, setSheet]);

  return (
    <BrandKitProvider>
    {/* Positioned, so visually hidden helpers deep in a scrolling panel stay inside the studio
        instead of stretching the page and letting the whole studio scroll. */}
    <div className="relative flex h-dvh flex-col overflow-hidden bg-canvas">
      <Topbar mode={mode} onOpenChecks={() => setChecksOpen(true)} />
      <DeletedBanner />

      {mode === 'mobile' ? (
        <div className="flex flex-none items-center justify-between gap-2 border-b border-line bg-panel px-2 py-1.5">
          <SaveStatus />
          <ViewSwitch modes={['2d', '3d']} />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {mode !== 'mobile' ? <ToolRail tablet={mode === 'tablet'} onLayers={() => setLayersOpen(true)} onInspector={() => setInspectorOpen(true)} /> : null}
        {mode === 'desktop' ? (
          <aside className="w-[var(--panel-width)] flex-none overflow-hidden border-r border-line bg-panel" aria-label="Layers and brand">
            <LeftPanel />
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
      <Sheet open={mode === 'tablet' && layersOpen} onClose={closeLayers} title="Layers and brand" side="left">
        <LeftPanel />
      </Sheet>
      <Sheet open={mode === 'tablet' && inspectorOpen} onClose={closeInspector} title="Properties" side="right">
        <Inspector />
      </Sheet>

      {/* Phone bottom sheets */}
      <Sheet open={mode === 'mobile' && sheet === 'add'} onClose={closeSheet} title="Add to design">
        <MobileAddSheet onDone={closeSheet} />
      </Sheet>
      <Sheet open={mode === 'mobile' && sheet === 'layers'} onClose={closeSheet} title="Layers and brand">
        <LeftPanel />
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
      <Sheet open={mode !== 'mobile' && exportOpen} onClose={closeExport} title="Export" side="right" wide>
        <ExportPanel />
      </Sheet>
      <Sheet open={checksOpen} onClose={closeChecks} title="Print checks" side="right">
        <PreflightPanel onNavigate={closeChecks} />
      </Sheet>

      {/* Project panels, from the More menu */}
      <Sheet open={panel === 'history'} onClose={closePanel} title="Versions and approval" side={panelSide}>
        <HistoryPanel />
      </Sheet>
      <Sheet open={panel === 'compare'} onClose={closePanel} title="Compare colourways" side={panelSide}>
        <ColorwayCompare />
      </Sheet>
      <Sheet open={panel === 'save-template'} onClose={closePanel} title="Save as template" side={panelSide}>
        <SaveTemplatePanel onDone={closePanel} />
      </Sheet>
      {/* Non-modal on larger screens: the 3D view stays visible and usable while framing renders. */}
      <Sheet open={panel === 'render'} onClose={closePanel} title="Wovexa Render" side={mode === 'mobile' ? 'bottom' : 'left'} modal={mode === 'mobile'}>
        <RenderPanel />
      </Sheet>
      <Sheet open={shortcutsOpen} onClose={closeShortcuts} title="Keys and gestures" side={panelSide} wide>
        <ShortcutsPanel />
      </Sheet>
      <CommandPalette mode={mode} onOpenChecks={openChecks} />

      <StudioTour mobile={mode === 'mobile'} />
      <Toaster />
    </div>
    </BrandKitProvider>
  );
}
