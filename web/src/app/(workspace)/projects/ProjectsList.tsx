'use client';
/**
 * Every project on this device (spec PRJ-01..03): search, sort, file into folders, tag, and act on
 * many at once. Folders and tags live with each project here, like archiving; a folder exists
 * while a project is in it.
 */
import { Archive, ArchiveRestore, Copy, Folder, FolderInput, FolderMinus, Pencil, RotateCcw, Search, Tag, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NewProjectButton, ProjectCard, useProjects } from '@/components/workspace/projects';
import { PageHeader } from '@/components/workspace/WorkspaceShell';
import { ConfirmDialog, Sheet, toast, useLayoutMode } from '@/components/ui/primitives';
import {
  archiveProjects,
  cleanLabel,
  deleteProject,
  duplicateProject,
  filterProjects,
  foldersAndTags,
  MAX_FOLDER_CHARS,
  MAX_TAG_CHARS,
  moveProjectsToFolder,
  NO_FOLDER,
  removeFolder,
  renameFolder,
  restoreProjects,
  tagProjects,
  trashProjects,
  TRASH_DAYS,
  type ProjectMeta,
} from '@/lib/local-db';

type View = 'active' | 'archived' | 'deleted';

const VIEWS: { id: View; label: string }[] = [
  { id: 'active', label: 'In use' },
  { id: 'archived', label: 'Archived' },
  { id: 'deleted', label: 'Recently deleted' },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const failed = (what: string) => toast(`${what} didn’t work: this browser couldn’t save the change. Try again.`, 'error');

/** File projects in a folder: an existing one, a new one, or none. */
function MoveSheet({ ids, projects, folders, onClose, onDone }: { ids: string[]; projects: ProjectMeta[]; folders: { name: string; count: number }[]; onClose: () => void; onDone: () => void }) {
  const mode = useLayoutMode();
  const [name, setName] = useState('');
  const current = new Set(projects.filter((p) => ids.includes(p.id)).map((p) => p.folder ?? NO_FOLDER));
  const move = async (folder: string | undefined) => {
    try {
      const n = await moveProjectsToFolder(ids, folder);
      toast(folder ? `Moved ${plural(n || ids.length, 'project')} to ${cleanLabel(folder, MAX_FOLDER_CHARS)}.` : `Took ${plural(n || ids.length, 'project')} out of ${n === 1 ? 'its folder' : 'their folders'}.`, 'success');
      onDone();
      onClose();
    } catch {
      failed('Moving');
    }
  };
  const fresh = cleanLabel(name, MAX_FOLDER_CHARS);
  return (
    <Sheet open onClose={onClose} title={`Move ${plural(ids.length, 'project')} to`} side={mode === 'mobile' ? 'bottom' : 'right'}>
      <div className="space-y-4 p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (fresh) void move(fresh);
          }}
        >
          <input className="field h-10" placeholder="New folder name" value={name} maxLength={MAX_FOLDER_CHARS} onChange={(e) => setName(e.target.value)} aria-label="New folder name" autoFocus />
          <button className="btn btn-primary flex-none" disabled={!fresh}>
            Move
          </button>
        </form>
        <ul className="space-y-1" aria-label="Folders">
          {folders.map((f) => (
            <li key={f.name}>
              <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover disabled:opacity-60" disabled={current.size === 1 && current.has(f.name)} onClick={() => void move(f.name)}>
                <Folder size={15} className="flex-none text-fg-2" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="num text-xs text-fg-3">{f.count}</span>
              </button>
            </li>
          ))}
          <li>
            <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover disabled:opacity-60" disabled={current.size === 1 && current.has(NO_FOLDER)} onClick={() => void move(undefined)}>
              <FolderMinus size={15} className="flex-none text-fg-2" aria-hidden /> Not in a folder
            </button>
          </li>
        </ul>
      </div>
    </Sheet>
  );
}

/** Add tags to projects, or take off the ones they carry. */
function TagSheet({ ids, projects, allTags, onClose, onDone }: { ids: string[]; projects: ProjectMeta[]; allTags: string[]; onClose: () => void; onDone: () => void }) {
  const mode = useLayoutMode();
  const [name, setName] = useState('');
  const chosen = projects.filter((p) => ids.includes(p.id));
  const carried = new Map<string, { tag: string; count: number }>();
  for (const p of chosen) for (const t of p.tags ?? []) carried.set(t.toLowerCase(), { tag: carried.get(t.toLowerCase())?.tag ?? t, count: (carried.get(t.toLowerCase())?.count ?? 0) + 1 });
  const apply = async (add: string[], remove: string[], message: string) => {
    try {
      await tagProjects(ids, add, remove);
      toast(message, 'success');
      onDone();
    } catch {
      failed('Tagging');
    }
  };
  const fresh = cleanLabel(name, MAX_TAG_CHARS);
  const listId = 'project-tag-suggestions';
  return (
    <Sheet open onClose={onClose} title={ids.length === 1 ? `Tags on ${chosen[0]?.title ?? 'the project'}` : `Tags on ${plural(ids.length, 'project')}`} side={mode === 'mobile' ? 'bottom' : 'right'}>
      <div className="space-y-4 p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!fresh) return;
            setName('');
            void apply([fresh], [], `Tagged ${plural(ids.length, 'project')} ${fresh}.`);
          }}
        >
          <input className="field h-10" placeholder="Add a tag, like a client or a season" list={listId} value={name} maxLength={MAX_TAG_CHARS} onChange={(e) => setName(e.target.value)} aria-label="Tag to add" autoFocus />
          <datalist id={listId}>
            {allTags.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <button className="btn btn-primary flex-none" disabled={!fresh}>
            Add
          </button>
        </form>
        {carried.size ? (
          <ul className="space-y-1" aria-label="Tags they carry">
            {[...carried.values()].map(({ tag, count }) => (
              <li key={tag} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm">
                <Tag size={14} className="flex-none text-fg-2" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{tag}</span>
                {ids.length > 1 ? <span className="text-xs text-fg-3">{count === ids.length ? 'all' : `${count} of ${ids.length}`}</span> : null}
                <button className="icon-btn h-8 w-8" aria-label={`Remove the tag ${tag}`} onClick={() => void apply([], [tag], `Took the tag ${tag} off ${plural(count, 'project')}.`)}>
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-2">{ids.length === 1 ? 'No tags yet.' : 'None of these has a tag yet.'}</p>
        )}
        {allTags.some((t) => !carried.has(t.toLowerCase())) ? (
          <div>
            <h3 className="label mb-1.5">Used on other projects</h3>
            <div className="flex flex-wrap gap-1.5">
              {allTags
                .filter((t) => !carried.has(t.toLowerCase()))
                .map((t) => (
                  <button key={t} className="rounded-lg border border-line px-2.5 py-1 text-xs hover:border-line-strong" onClick={() => void apply([t], [], `Tagged ${plural(ids.length, 'project')} ${t}.`)}>
                    + {t}
                  </button>
                ))}
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

export function ProjectsList() {
  const [view, setView] = useState<View>('active');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'name'>('updated');
  const [folder, setFolder] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [sheet, setSheet] = useState<{ kind: 'move' | 'tags'; ids: string[] } | null>(null);
  const [confirm, setConfirm] = useState<null | 'forever' | 'remove-folder'>(null);
  const [busy, setBusy] = useState(false);
  const anchor = useRef<string | null>(null);
  const { projects, error, refresh } = useProjects(view);

  // Folders and tags across every project in this view, before the filters narrow them.
  const inView = useMemo(() => (projects ?? []).filter((p) => (view === 'archived' ? !!p.archivedAt : true)), [projects, view]);
  const { folders, tags: allTags } = useMemo(() => foldersAndTags(inView), [inView]);
  const visible = useMemo(() => {
    const list = filterProjects(inView, { query, folder, tags });
    return sort === 'name' ? [...list].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })) : list;
  }, [inView, query, folder, tags, sort]);

  // A folder or tag filter that no longer exists (emptied, removed) lets go, checked as each fresh
  // list arrives (not before: a folder just renamed isn't in the list being replaced).
  const [checkedList, setCheckedList] = useState(projects);
  if (projects !== checkedList) {
    setCheckedList(projects);
    if (projects !== null) {
      if (folder !== null && folder !== NO_FOLDER && !folders.some((f) => f.name === folder)) setFolder(null);
      const kept = tags.filter((t) => allTags.some((a) => a.toLowerCase() === t.toLowerCase()));
      if (kept.length !== tags.length) setTags(kept);
    }
  }
  // Selection follows what is shown.
  const shownIds = useMemo(() => new Set(visible.map((p) => p.id)), [visible]);
  const chosen = selected.filter((id) => shownIds.has(id));

  const changeView = (v: View) => {
    setView(v);
    setSelected([]);
  };
  const toggle = useCallback(
    (id: string, range: boolean) => {
      const order = visible.map((p) => p.id);
      setSelected((current) => {
        const on = !current.includes(id);
        if (range && anchor.current && order.includes(anchor.current)) {
          const [a, b] = [order.indexOf(anchor.current), order.indexOf(id)].sort((x, y) => x - y);
          const span = order.slice(a, b + 1);
          return on ? [...new Set([...current, ...span])] : current.filter((x) => !span.includes(x));
        }
        anchor.current = id;
        return on ? [...current, id] : current.filter((x) => x !== id);
      });
    },
    [visible],
  );

  // Escape clears the selection; Ctrl/Cmd+A selects every project shown (outside text fields).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return;
      if (e.key === 'Escape' && chosen.length) setSelected([]);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && visible.length) {
        e.preventDefault();
        setSelected(visible.map((p) => p.id));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chosen.length, visible]);

  const run = async (what: string, fn: () => Promise<string>) => {
    setBusy(true);
    try {
      toast(await fn(), 'success');
      setSelected([]);
    } catch {
      failed(what);
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const allArchived = chosen.length > 0 && chosen.every((id) => inView.find((p) => p.id === id)?.archivedAt);

  const empty = query || folder !== null || tags.length
    ? { title: query ? `Nothing matches “${query}”` : 'No projects here', body: 'Clear the search or the filters to see more.' }
    : view === 'archived'
      ? { title: 'No archived projects', body: 'Archive a project from its menu to put it away without deleting it.' }
      : view === 'deleted'
        ? { title: 'Nothing in Recently deleted', body: `Deleted projects wait here for ${TRASH_DAYS} days, so you can restore them.` }
        : { title: 'No projects yet', body: 'New projects appear here as soon as you create them.' };

  const chip = 'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium aria-pressed:border-[var(--accent)] aria-pressed:bg-selected aria-pressed:text-fg border-line text-fg-2 hover:border-line-strong';
  const filing = view !== 'deleted' ? { onFile: (ids: string[]) => setSheet({ kind: 'move', ids }), onTag: (ids: string[]) => setSheet({ kind: 'tags', ids }) } : {};

  return (
    <>
      <PageHeader title="Projects" action={<NewProjectButton />} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
          <input className="field h-10 pl-9 text-sm" placeholder="Search names, folders and tags" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" />
        </label>
        <select className="field h-10 w-auto text-sm" value={sort} onChange={(e) => setSort(e.target.value as 'updated' | 'name')} aria-label="Sort by">
          <option value="updated">Last edited</option>
          <option value="name">Name</option>
        </select>
        <div className="seg" role="group" aria-label="Show projects">
          {VIEWS.map((v) => (
            <button key={v.id} aria-pressed={view === v.id} onClick={() => changeView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {folders.length || allTags.length ? (
        <div className="mb-5 space-y-2">
          {folders.length ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Folders">
              <button className={chip} aria-pressed={folder === null} onClick={() => setFolder(null)}>
                All
              </button>
              {folders.map((f) => (
                <button key={f.name} className={chip} aria-pressed={folder === f.name} onClick={() => setFolder(folder === f.name ? null : f.name)}>
                  <Folder size={13} aria-hidden /> {f.name} <span className="num text-fg-3">{f.count}</span>
                </button>
              ))}
              <button className={chip} aria-pressed={folder === NO_FOLDER} onClick={() => setFolder(folder === NO_FOLDER ? null : NO_FOLDER)}>
                Not in a folder
              </button>
              {folder !== null && folder !== NO_FOLDER ? (
                <span className="ml-1 inline-flex gap-1">
                  <button
                    className="btn btn-ghost min-h-8 px-2 text-xs"
                    onClick={async () => {
                      const to = prompt('Folder name', folder)?.trim();
                      if (!to || to === folder) return;
                      try {
                        await renameFolder(folder, to);
                        setFolder(cleanLabel(to, MAX_FOLDER_CHARS));
                        toast(`Renamed the folder to ${cleanLabel(to, MAX_FOLDER_CHARS)}.`, 'success');
                      } catch {
                        failed('Renaming the folder');
                      }
                      refresh();
                    }}
                  >
                    <Pencil size={13} /> Rename folder
                  </button>
                  <button className="btn btn-ghost min-h-8 px-2 text-xs" onClick={() => setConfirm('remove-folder')}>
                    <FolderMinus size={13} /> Remove folder
                  </button>
                </span>
              ) : null}
            </div>
          ) : null}
          {allTags.length ? (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tags">
              {allTags.map((t) => {
                const on = tags.some((x) => x.toLowerCase() === t.toLowerCase());
                return (
                  <button key={t} className={chip} aria-pressed={on} onClick={() => setTags(on ? tags.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...tags, t])}>
                    <Tag size={12} aria-hidden /> {t}
                  </button>
                );
              })}
              {tags.length ? (
                <button className="btn btn-ghost min-h-8 px-2 text-xs" onClick={() => setTags([])}>
                  Clear tags
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {view === 'deleted' && visible.length ? (
        <p className="mb-4 text-sm text-fg-2">Deleted projects stay here for {TRASH_DAYS} days, then go for good. Restore one from its menu.</p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-danger/40 p-4 text-sm">
          {error}
        </p>
      ) : projects === null ? (
        <p className="text-sm text-fg-2">Loading projects…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <p className="font-semibold">{empty.title}</p>
          <p className="mt-1 text-sm text-fg-2">{empty.body}</p>
        </div>
      ) : (
        // Room below for the selection bar, which wraps to two rows on phones.
        <div className={`grid grid-cols-2 gap-4 lg:grid-cols-4 ${chosen.length ? 'pb-36 sm:pb-24' : ''}`}>
          {visible.map((p) => (
            <ProjectCard key={p.id} meta={p} onChanged={refresh} selected={chosen.includes(p.id)} selecting={chosen.length > 0} onSelect={(range) => toggle(p.id, range)} {...filing} />
          ))}
        </div>
      )}

      {chosen.length ? (
        <div
          className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-max max-w-[calc(100%-1rem)] flex-wrap items-center justify-center gap-1 rounded-2xl border border-line bg-floating/95 p-1.5 pl-3 text-sm shadow-xl backdrop-blur"
          role="toolbar"
          aria-label="Selected projects"
        >
          <span className="mr-1 font-semibold">{chosen.length} selected</span>
          {chosen.length < visible.length ? (
            <button className="btn btn-ghost min-h-9 px-2 text-xs" onClick={() => setSelected(visible.map((p) => p.id))}>
              Select all {visible.length}
            </button>
          ) : null}
          {view === 'deleted' ? (
            <>
              <button className="btn btn-outline min-h-9 px-2.5 text-xs" disabled={busy} onClick={() => void run('Restoring', async () => `Restored ${plural(await restoreProjects(chosen), 'project')}.`)}>
                <RotateCcw size={14} /> Restore
              </button>
              <button className="btn btn-outline min-h-9 px-2.5 text-xs text-danger" disabled={busy} onClick={() => setConfirm('forever')}>
                <Trash2 size={14} /> Delete forever…
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-outline min-h-9 px-2.5 text-xs" disabled={busy} onClick={() => setSheet({ kind: 'move', ids: chosen })}>
                <FolderInput size={14} /> Move to…
              </button>
              <button className="btn btn-outline min-h-9 px-2.5 text-xs" disabled={busy} onClick={() => setSheet({ kind: 'tags', ids: chosen })}>
                <Tag size={14} /> Tags…
              </button>
              <button
                className="btn btn-outline min-h-9 px-2.5 text-xs"
                disabled={busy}
                onClick={() =>
                  void run('Duplicating', async () => {
                    let made = 0;
                    for (const id of chosen) if (await duplicateProject(id)) made++;
                    return `Made ${plural(made, 'copy', 'copies')}.`;
                  })
                }
              >
                <Copy size={14} /> Duplicate
              </button>
              <button
                className="btn btn-outline min-h-9 px-2.5 text-xs"
                disabled={busy}
                onClick={() => void run(allArchived ? 'Restoring' : 'Archiving', async () => (allArchived ? `Restored ${plural(await archiveProjects(chosen, false), 'project')}.` : `Archived ${plural(await archiveProjects(chosen, true), 'project')}. Find them under Archived.`))}
              >
                {allArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />} {allArchived ? 'Restore' : 'Archive'}
              </button>
              <button
                className="btn btn-outline min-h-9 px-2.5 text-xs text-danger"
                disabled={busy}
                onClick={() => void run('Deleting', async () => `Moved ${plural(await trashProjects(chosen), 'project')} to Recently deleted. Restore ${chosen.length === 1 ? 'it' : 'them'} there within ${TRASH_DAYS} days.`)}
              >
                <Trash2 size={14} /> Delete
              </button>
            </>
          )}
          <button className="icon-btn h-9 w-9" onClick={() => setSelected([])} aria-label="Clear the selection" title="Clear the selection (Esc)">
            <X size={16} />
          </button>
        </div>
      ) : null}

      {sheet?.kind === 'move' ? (
        <MoveSheet
          ids={sheet.ids}
          projects={inView}
          folders={folders}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSelected([]);
            refresh();
          }}
        />
      ) : null}
      {sheet?.kind === 'tags' ? <TagSheet ids={sheet.ids} projects={inView} allTags={allTags} onClose={() => setSheet(null)} onDone={refresh} /> : null}
      <ConfirmDialog
        open={confirm === 'forever'}
        title={`Delete ${plural(chosen.length, 'project')} forever?`}
        body="This removes them, their versions and their export history from this browser for good. It can't be undone."
        confirmLabel="Delete forever"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void run('Deleting', async () => {
            for (const id of chosen) await deleteProject(id);
            return `Deleted ${plural(chosen.length, 'project')} for good.`;
          });
        }}
      />
      <ConfirmDialog
        open={confirm === 'remove-folder'}
        title={`Remove the folder ${folder ?? ''}?`}
        body="Its projects stay, just not in a folder. Nothing is deleted."
        confirmLabel="Remove folder"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          if (folder === null || folder === NO_FOLDER) return;
          try {
            const n = await removeFolder(folder);
            toast(`Removed the folder; ${plural(n, 'project')} kept, not in a folder.`, 'success');
            setFolder(null);
          } catch {
            failed('Removing the folder');
          }
          refresh();
        }}
      />
    </>
  );
}
