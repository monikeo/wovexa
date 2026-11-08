'use client';
import { Archive, ArchiveRestore, Copy, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GARMENT_LIST } from '@/domain/garments';
import { GarmentGlyph } from '@/components/studio/GarmentGlyph';
import {
  approvalState,
  archiveProject,
  createProject,
  deleteProject,
  duplicateProject,
  listProjects,
  renameProject,
  type ProjectMeta,
} from '@/lib/local-db';
import { ConfirmDialog, toast, useMenuKeyboard } from '@/components/ui/primitives';

export function useProjects(includeArchived = false) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    listProjects({ includeArchived }).then(
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
  }, [includeArchived, version]);
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

export function ProjectActions({ meta, onChanged }: { meta: ProjectMeta; onChanged: () => void }) {
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
  const act = (fn: () => Promise<unknown>, message: string) => async () => {
    setOpen(false);
    await fn();
    toast(message);
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
      {open ? (
        <div ref={menuRef} role="menu" aria-label={`Actions for ${meta.title}`} className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-line bg-floating p-1 shadow-xl">
          <button
            role="menuitem"
            className={item}
            onClick={async () => {
              setOpen(false);
              const name = prompt('Project name', meta.title)?.trim();
              if (name && name !== meta.title) {
                await renameProject(meta.id, name.slice(0, 120));
                toast('Renamed.');
                onChanged();
              }
            }}
          >
            <Pencil size={15} /> Rename
          </button>
          <button role="menuitem" className={item} onClick={act(() => duplicateProject(meta.id), 'Duplicated.')}>
            <Copy size={15} /> Duplicate
          </button>
          {meta.archivedAt ? (
            <button role="menuitem" className={item} onClick={act(() => archiveProject(meta.id, false), 'Restored.')}>
              <ArchiveRestore size={15} /> Restore
            </button>
          ) : (
            <button role="menuitem" className={item} onClick={act(() => archiveProject(meta.id, true), 'Archived. Find it under Show archived.')}>
              <Archive size={15} /> Archive
            </button>
          )}
          <button
            role="menuitem"
            className={`${item} text-danger`}
            onClick={() => {
              setOpen(false);
              setConfirm(true);
            }}
          >
            <Trash2 size={15} /> Delete…
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm}
        title={`Delete ${meta.title}?`}
        body="This removes the project from this browser permanently. Archive it instead if you might need it again."
        confirmLabel="Delete project"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          await deleteProject(meta.id);
          toast('Project deleted.');
          onChanged();
        }}
      />
    </div>
  );
}

export function ProjectCard({ meta, onChanged }: { meta: ProjectMeta; onChanged: () => void }) {
  return (
    <article className="group relative rounded-xl border border-line bg-panel transition-shadow hover:shadow-md">
      <Link href={`/studio/${meta.id}`} className="block rounded-xl focus-visible:outline-offset-4" aria-label={`Open ${meta.title}`}>
        <Thumbnail meta={meta} />
      </Link>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{meta.title}</h3>
          <p className="mt-0.5 text-xs text-fg-2">
            Edited {relativeTime(meta.updatedAt)}, {meta.layerCount} {meta.layerCount === 1 ? 'layer' : 'layers'}
          </p>
          {meta.approvedHash ? (
            <p className={`mt-1 text-xs font-semibold ${approvalState(meta) === 'approved' ? 'text-success' : 'text-warning'}`}>
              {approvalState(meta) === 'approved' ? `Approved, v${meta.approvedVersionNumber}` : 'Changed since approval'}
            </p>
          ) : null}
        </div>
        <ProjectActions meta={meta} onChanged={onChanged} />
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

/** Start a blank design on any garment: the flats come from the same pattern data as the 3D model. */
export function QuickStart() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {GARMENT_LIST.map((m) => (
        <button
          key={m.id}
          disabled={busy !== null}
          className="group flex flex-col items-start gap-2 rounded-xl border border-line bg-panel p-3 text-left transition-colors hover:border-line-strong disabled:opacity-60"
          onClick={async () => {
            setBusy(m.id);
            try {
              const meta = await createProject(`Untitled ${m.shortName.toLowerCase()}`, 0, m.id);
              router.push(`/studio/${meta.id}`);
            } catch (e) {
              toast(e instanceof Error ? e.message : 'The project could not be created.', 'error');
              setBusy(null);
            }
          }}
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
