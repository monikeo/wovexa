'use client';
import { Archive, ArchiveRestore, Copy, Folder, FolderInput, MoreHorizontal, Pencil, Plus, RotateCcw, Tag, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GARMENT_LIST, garmentNoun, getGarment } from '@/domain/garments';
import { groupLibrary, MAX_SHELL_TRIANGLES } from '@/domain/model-library';
import { GarmentGlyph } from '@/components/studio/GarmentGlyph';
import { ModelThumb } from '@/components/studio/ModelThumb';
import { useModelLibrary } from '@/lib/model-library';
import {
  approvalState,
  archiveProject,
  createProject,
  daysLeft,
  deleteProject,
  duplicateProject,
  listProjects,
  projectOpenElsewhere,
  purgeDeletedProjects,
  renameProject,
  restoreProject,
  trashProject,
  TRASH_DAYS,
  type ProjectMeta,
} from '@/lib/local-db';
import { ConfirmDialog, toast, useMenuKeyboard } from '@/components/ui/primitives';

/** Projects in use (`active`), with the archived ones (`archived`), or in Recently deleted (`deleted`). */
export function useProjects(view: 'active' | 'archived' | 'deleted' = 'active') {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    // Projects past their time in Recently deleted go for good whenever the list loads.
    purgeDeletedProjects()
      .catch(() => 0)
      .then(() => listProjects(view === 'deleted' ? { deleted: 'only' } : { includeArchived: view === 'archived' }))
      .then(
      (list) => {
        if (!alive) return;
        setProjects(list);
        setError(null);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Projects could not be loaded from this browser.');
        setProjects([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [view, version]);
  return { projects, error, refresh };
}

/** Shows a Blob as an image without holding it in React state; the URL is revoked on change. */
export function BlobImage({ blob, className }: { blob: Blob; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (ref.current) ref.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} alt="" className={className} />;
}

export function relativeTime(ms: number) {
  const diff = Date.now() - ms;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(-days, 'day');
  return new Date(ms).toLocaleDateString();
}

/** Tee silhouette in the project's body colour, used until a real thumbnail exists. */
export function TeeGlyph({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 120 110" className="h-3/5 w-auto" aria-hidden>
      <path
        d="M42 8c4 6 10 9 18 9s14-3 18-9l26 10 14 26-20 9-6-6v63H28V47l-6 6-20-9L16 18z"
        fill={color}
        stroke="rgba(110,114,125,.55)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Thumbnail({ meta }: { meta: ProjectMeta }) {
  return (
    <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-t-xl bg-[var(--surface-hover)]">
      {meta.thumbnail ? <BlobImage blob={meta.thumbnail} className="h-full w-full object-contain p-2" /> : <TeeGlyph color={meta.bodyColor} />}
    </div>
  );
}

/** Filing a project from its menu, where the page offers it (the Projects page does). */
export interface FilingActions {
  onFile?: (ids: string[]) => void;
  onTag?: (ids: string[]) => void;
}

export function ProjectActions({ meta, onChanged, onFile, onTag }: { meta: ProjectMeta; onChanged: () => void } & FilingActions) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
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
  /** Runs a menu action: `fn` resolves false (or null) when there was nothing it could do. */
  const act = (fn: () => Promise<unknown>, message: string, failed = 'That didn’t work: this browser’s storage refused the change. Try again.') => async () => {
    setOpen(false);
    try {
      const done = await fn();
      if (done === false || done === null) toast(failed, 'error');
      else toast(message);
    } catch {
      toast(failed, 'error');
    }
    onChanged();
  };
  const item = 'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-hover';
  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        className="icon-btn"
        aria-label={`Actions for ${meta.title}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && meta.deletedAt ? (
        <div ref={menuRef} role="menu" aria-label={`Actions for ${meta.title}`} className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-line bg-floating p-1 shadow-xl">
          <button role="menuitem" className={item} onClick={act(() => restoreProject(meta.id), `Restored ${meta.title}.`)}>
            <RotateCcw size={15} /> Restore
          </button>
          <button
            role="menuitem"
            className={`${item} text-danger`}
            onClick={() => {
              setOpen(false);
              setConfirm(true);
            }}
          >
            <Trash2 size={15} /> Delete forever…
          </button>
        </div>
      ) : open ? (
        <div ref={menuRef} role="menu" aria-label={`Actions for ${meta.title}`} className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-line bg-floating p-1 shadow-xl">
          <button
            role="menuitem"
            className={item}
            onClick={async () => {
              setOpen(false);
              // That tab's next save would put the old name back.
              if (await projectOpenElsewhere(meta.id)) {
                toast(`${meta.title} is open in another tab or window. Rename it there, or close it first.`, 'error');
                return;
              }
              const name = prompt('Project name', meta.title)?.trim();
              if (name && name !== meta.title) {
                await act(() => renameProject(meta.id, name.slice(0, 120)), 'Renamed.', 'This project couldn’t be opened to rename it.')();
              }
            }}
          >
            <Pencil size={15} /> Rename
          </button>
          <button role="menuitem" className={item} onClick={act(() => duplicateProject(meta.id), 'Duplicated.', 'This project couldn’t be opened to copy it.')}>
            <Copy size={15} /> Duplicate
          </button>
          {onFile ? (
            <button
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                onFile([meta.id]);
              }}
            >
              <FolderInput size={15} /> Move to folder…
            </button>
          ) : null}
          {onTag ? (
            <button
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                onTag([meta.id]);
              }}
            >
              <Tag size={15} /> Tags…
            </button>
          ) : null}
          {meta.archivedAt ? (
            <button role="menuitem" className={item} onClick={act(() => archiveProject(meta.id, false), 'Restored.')}>
              <ArchiveRestore size={15} /> Restore
            </button>
          ) : (
            <button role="menuitem" className={item} onClick={act(() => archiveProject(meta.id, true), 'Archived. Find it under Show archived.')}>
              <Archive size={15} /> Archive
            </button>
          )}
          <button role="menuitem" className={`${item} text-danger`} onClick={act(() => trashProject(meta.id), `Moved ${meta.title} to Recently deleted. Restore it there within ${TRASH_DAYS} days.`)}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm}
        title={`Delete ${meta.title} forever?`}
        body="This removes the project, its versions and its export history from this browser for good. It can't be undone."
        confirmLabel="Delete forever"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          await act(() => deleteProject(meta.id), 'Project deleted for good.')();
        }}
      />
    </div>
  );
}

export function ProjectCard({
  meta,
  onChanged,
  selected = false,
  selecting = false,
  onSelect,
  onFile,
  onTag,
}: {
  meta: ProjectMeta;
  onChanged: () => void;
  selected?: boolean;
  /** Some projects are selected: a click on a card selects it instead of opening it. */
  selecting?: boolean;
  /** Select or unselect; with Shift, every project from the last one chosen to this one. */
  onSelect?: (range: boolean) => void;
} & FilingActions) {
  return (
    <article className={`group relative rounded-xl border bg-panel transition-shadow hover:shadow-md ${selected ? 'border-accent ring-2 ring-[var(--accent)]/40' : 'border-line'}`}>
      <Link
        href={`/studio/${meta.id}`}
        className="block rounded-xl focus-visible:outline-offset-4"
        aria-label={`Open ${meta.title}`}
        onClick={(e) => {
          if (!onSelect || !(selecting || e.shiftKey)) return;
          e.preventDefault();
          onSelect(e.shiftKey);
        }}
      >
        <Thumbnail meta={meta} />
      </Link>
      {onSelect ? (
        <label
          className={`absolute left-2 top-2 grid h-8 w-8 cursor-pointer place-items-center rounded-lg bg-panel/90 shadow-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100 ${selected || selecting ? 'opacity-100' : 'opacity-0'}`}
        >
          {/* A click (or Space) selects; with Shift, a range. The page holds which are selected. */}
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={selected} readOnly aria-label={`Select ${meta.title}`} onClick={(e) => onSelect(e.shiftKey)} />
        </label>
      ) : null}
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{meta.title}</h3>
          {meta.deletedAt ? (
            <p className="mt-0.5 text-xs text-warning">
              Deleted {relativeTime(meta.deletedAt)}. Gone for good in {daysLeft(meta)} {daysLeft(meta) === 1 ? 'day' : 'days'}.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-fg-2">
              Edited {relativeTime(meta.updatedAt)}, {meta.layerCount} {meta.layerCount === 1 ? 'layer' : 'layers'}
            </p>
          )}
          {meta.approvedHash && !meta.deletedAt ? (
            <p className={`mt-1 text-xs font-semibold ${approvalState(meta) === 'approved' ? 'text-success' : 'text-warning'}`}>
              {approvalState(meta) === 'approved' ? `Approved, v${meta.approvedVersionNumber}` : 'Changed since approval'}
            </p>
          ) : null}
          {meta.folder || meta.tags?.length ? (
            <p className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
              {meta.folder ? (
                <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-[var(--surface-hover)] px-1.5 py-0.5 text-fg-2" title={`In the folder ${meta.folder}`}>
                  <Folder size={11} aria-hidden /> {meta.folder}
                </span>
              ) : null}
              {meta.tags?.map((t) => (
                <span key={t} className="max-w-full truncate rounded-md border border-line px-1.5 py-0.5 text-fg-2">
                  {t}
                </span>
              ))}
            </p>
          ) : null}
        </div>
        <ProjectActions meta={meta} onChanged={onChanged} onFile={onFile} onTag={onTag} />
      </div>
    </article>
  );
}

export function NewProjectButton({ className = 'btn btn-primary' }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const meta = await createProject('Untitled tee');
          router.push(`/studio/${meta.id}`);
        } catch (e) {
          toast(e instanceof Error ? e.message : 'The project could not be created.', 'error');
          setBusy(false);
        }
      }}
    >
      <Plus size={16} /> New project
    </button>
  );
}

/**
 * Start a blank design on any garment: the flats come from the same pattern data as the 3D model.
 * Below the styles, every model in the app's 3D model library (its `3d_models` folder), named
 * after its file: a new design wears it from the start.
 */
export function QuickStart() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const library = useModelLibrary();
  const start = async (key: string, run: () => Promise<{ id: string }>) => {
    setBusy(key);
    try {
      const meta = await run();
      router.push(`/studio/${meta.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The project could not be created.', 'error');
      setBusy(null);
    }
  };
  const usable = (library ?? []).filter((m) => m.triangles <= MAX_SHELL_TRIANGLES);
  return (
    <div className="space-y-4">
      <StyleStarts busy={busy} start={start} />
      {usable.length ? (
        <section className="space-y-3" aria-label="Start from a 3D model">
          <h3 className="text-sm font-semibold">From the 3D model library</h3>
          {groupLibrary(usable).map((group) => (
            <div key={group.category} className="space-y-1.5">
              <h4 className="text-xs font-medium text-fg-2">
                {group.category} <span className="num text-fg-3">{group.models.length}</span>
              </h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {group.models.map((m) => {
                  const style = getGarment(m.styleId);
                  return (
                    <button
                      key={m.file}
                      disabled={busy !== null}
                      className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-2.5 text-left transition-colors hover:border-line-strong disabled:opacity-60"
                      onClick={() =>
                        void start(m.file, () =>
                          createProject(`Untitled ${m.name}`.slice(0, 120), 0, style.id, { kind: 'shell', library: m.file, name: m.name, modelId: style.id, sizeCode: style.defaultSize, ...(m.credit ? { credit: m.credit } : {}) }),
                        )
                      }
                    >
                      <span className="grid h-14 w-14 flex-none place-items-center rounded-lg bg-[var(--surface-hover)] text-fg-2 group-hover:text-fg">
                        <ModelThumb model={m} className="h-12 w-12" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{m.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-fg-2">{m.credit ? `${style.shortName} model` : `${style.shortName} model, no licence in the file`}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function StyleStarts({ busy, start }: { busy: string | null; start: (key: string, run: () => Promise<{ id: string }>) => Promise<void> }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {GARMENT_LIST.map((m) => (
        <button
          key={m.id}
          disabled={busy !== null}
          className="group flex flex-col items-start gap-2 rounded-xl border border-line bg-panel p-3 text-left transition-colors hover:border-line-strong disabled:opacity-60"
          onClick={() => void start(m.id, () => createProject(`Untitled ${garmentNoun(m)}`, 0, m.id))}
        >
          <span className="grid aspect-[4/3] w-full place-items-center rounded-lg bg-[var(--surface-hover)] text-fg-2 group-hover:text-fg">
            <GarmentGlyph model={m} className="h-16 w-16" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{m.name}</span>
            <span className="mt-0.5 line-clamp-2 block text-xs text-fg-2">{m.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
