'use client';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NewProjectButton, ProjectCard, useProjects } from '@/components/workspace/projects';
import { PageHeader } from '@/components/workspace/WorkspaceShell';

export function ProjectsList() {
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'name'>('updated');
  const { projects, error, refresh } = useProjects(showArchived);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (projects ?? []).filter((p) => (showArchived ? !!p.archivedAt : true) && (!q || p.title.toLowerCase().includes(q)));
    return sort === 'name' ? [...list].sort((a, b) => a.title.localeCompare(b.title)) : list;
  }, [projects, query, sort, showArchived]);

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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          Show archived
        </label>
      </div>
      {error ? (
        <p role="alert" className="rounded-xl border border-danger/40 p-4 text-sm">
          {error}
        </p>
      ) : projects === null ? (
        <p className="text-sm text-fg-2">Loading projects…</p>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <p className="font-semibold">{query ? `Nothing matches “${query}”` : showArchived ? 'No archived projects' : 'No projects yet'}</p>
          <p className="mt-1 text-sm text-fg-2">{query ? 'Try a shorter search.' : 'New projects appear here as soon as you create them.'}</p>
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
