'use client';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NewProjectButton, ProjectCard, useProjects } from '@/components/workspace/projects';
import { PageHeader } from '@/components/workspace/WorkspaceShell';
import { TRASH_DAYS } from '@/lib/local-db';

type View = 'active' | 'archived' | 'deleted';

const VIEWS: { id: View; label: string }[] = [
  { id: 'active', label: 'In use' },
  { id: 'archived', label: 'Archived' },
  { id: 'deleted', label: 'Recently deleted' },
];

export function ProjectsList() {
  const [view, setView] = useState<View>('active');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'name'>('updated');
  const { projects, error, refresh } = useProjects(view);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (projects ?? []).filter((p) => (view === 'archived' ? !!p.archivedAt : true) && (!q || p.title.toLowerCase().includes(q)));
    return sort === 'name' ? [...list].sort((a, b) => a.title.localeCompare(b.title)) : list;
  }, [projects, query, sort, view]);

  const empty = query
    ? { title: `Nothing matches “${query}”`, body: 'Try a shorter search.' }
    : view === 'archived'
      ? { title: 'No archived projects', body: 'Archive a project from its menu to put it away without deleting it.' }
      : view === 'deleted'
        ? { title: 'Nothing in Recently deleted', body: `Deleted projects wait here for ${TRASH_DAYS} days, so you can restore them.` }
        : { title: 'No projects yet', body: 'New projects appear here as soon as you create them.' };

  return (
    <>
      <PageHeader title="Projects" action={<NewProjectButton />} />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
          <input className="field h-10 pl-9 text-sm" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" />
        </label>
        <select className="field h-10 w-auto text-sm" value={sort} onChange={(e) => setSort(e.target.value as 'updated' | 'name')} aria-label="Sort by">
          <option value="updated">Last edited</option>
          <option value="name">Name</option>
        </select>
        <div className="seg" role="group" aria-label="Show projects">
          {VIEWS.map((v) => (
            <button key={v.id} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>
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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {visible.map((p) => (
            <ProjectCard key={p.id} meta={p} onChanged={refresh} />
          ))}
        </div>
      )}
    </>
  );
}
