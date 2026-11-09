'use client';
/**
 * Every export made on this device (spec EXP-07): what was made, from which project and design
 * version, how many files and how big, and whether the design has changed since. The files went
 * to the person's downloads; this is the record of them.
 */
import { Archive, ArrowUpRight, FileText, Image as ImageIcon, Printer, Search, Trash2, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatBytes } from '@/lib/assets';
import { deleteExportRecord, listAllExports, listProjects, type ExportKind, type ExportRecord, type ProjectMeta } from '@/lib/local-db';
import { ConfirmDialog, toast } from '@/components/ui/primitives';
import { relativeTime } from '@/components/workspace/projects';
import { PageHeader } from '@/components/workspace/WorkspaceShell';

const KINDS: { id: ExportKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'package', label: 'Packages' },
  { id: 'print', label: 'Print files' },
  { id: 'proof', label: 'Proofs' },
  { id: 'team', label: 'Team files' },
  { id: 'mockups', label: 'Images' },
];

const ICON: Record<ExportKind, typeof Archive> = { package: Archive, print: Printer, proof: FileText, team: Users, manifest: FileText, mockups: ImageIcon };

/** "Today", "Yesterday" or the date, for grouping. */
function dayLabel(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function ExportHistory() {
  const [records, setRecords] = useState<ExportRecord[] | null>(null);
  const [projects, setProjects] = useState<Map<string, ProjectMeta>>(new Map());
  const [kind, setKind] = useState<ExportKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<ExportRecord | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([listAllExports().catch(() => []), listProjects({ includeArchived: true, deleted: 'include' }).catch(() => [])]).then(([list, metas]) => {
      if (!alive) return;
      setRecords(list);
      setProjects(new Map(metas.map((m) => [m.id, m])));
    });
    return () => {
      alive = false;
    };
  }, [version]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (records ?? []).filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false;
      if (!q) return true;
      const title = projects.get(r.projectId)?.title ?? '';
      return [title, r.label, r.fileName, r.revisionLabel ?? ''].some((s) => s.toLowerCase().includes(q));
    });
  }, [records, projects, kind, query]);

  const groups = useMemo(() => {
    const out: { day: string; items: ExportRecord[] }[] = [];
    for (const r of shown) {
      const day = dayLabel(r.createdAt);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(r);
      else out.push({ day, items: [r] });
    }
    return out;
  }, [shown]);

  const totals = useMemo(() => ({ count: shown.length, files: shown.reduce((n, r) => n + r.fileCount, 0), bytes: shown.reduce((n, r) => n + r.bytes, 0) }), [shown]);

  return (
    <>
      <PageHeader title="Exports" description="Everything exported on this device, with the design version it came from. The files went to your downloads; this is the record of what was made and when." />
      {records === null ? (
        <p className="text-sm text-fg-2">Loading exports…</p>
      ) : records.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <p className="font-semibold">No exports yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-fg-2">Open a project and press Export: print files, the production package, proofs and team files are listed here as you make them, with the version they came from.</p>
          <Link href="/projects" className="btn btn-primary mt-4">
            Open a project
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Show exports of kind">
              {KINDS.map((k) => (
                <button key={k.id} className={`btn min-h-8 px-3 text-xs ${kind === k.id ? 'btn-ink' : 'btn-outline'}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
            <label className="relative ml-auto w-full sm:w-64">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
              <input className="field pl-8 pr-8" placeholder="Search project or file" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search exports" />
              {query ? (
                <button className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-fg-3 hover:text-fg" onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={14} />
                </button>
              ) : null}
            </label>
          </div>
          <p className="num text-xs text-fg-2">
            {totals.count} {totals.count === 1 ? 'export' : 'exports'}, {totals.files} {totals.files === 1 ? 'file' : 'files'}, {formatBytes(totals.bytes)}
          </p>
          {groups.length === 0 ? <p className="text-sm text-fg-2">Nothing matches. Try another kind or search.</p> : null}
          {groups.map((g) => (
            <section key={g.day} aria-label={g.day}>
              <h2 className="mb-2 text-xs font-semibold text-fg-2">{g.day}</h2>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
                {g.items.map((r) => {
                  const project = projects.get(r.projectId);
                  const Icon = ICON[r.kind] ?? FileText;
                  // Made from an earlier state of the design than the project has now.
                  const changed = !!project?.contentHash && project.contentHash !== r.contentHash;
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-hover text-fg-2" aria-hidden>
                        <Icon size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {r.label}
                          <span className="font-normal text-fg-2"> · {project ? `${project.title}${project.deletedAt ? ' (in Recently deleted)' : ''}` : 'Deleted project'}</span>
                        </p>
                        <p className="num truncate text-xs text-fg-2" title={r.fileName}>
                          {r.fileName}
                        </p>
                        <p className="num mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-fg-3">
                          <span>{relativeTime(r.createdAt)}</span>
                          <span>{r.revisionLabel ?? `revision ${r.revision}`}</span>
                          <span>
                            {r.fileCount} {r.fileCount === 1 ? 'file' : 'files'}, {formatBytes(r.bytes)}
                          </span>
                          {changed ? <span className="rounded bg-warning/15 px-1.5 py-px font-medium text-warning">Design changed since</span> : null}
                        </p>
                      </div>
                      {project && !project.archivedAt && !project.deletedAt ? (
                        <Link href={`/studio/${r.projectId}`} className="btn btn-outline min-h-8 flex-none px-2.5 text-xs" title={changed ? 'Open the project to export the current design' : 'Open the project'}>
                          Open <ArrowUpRight size={13} />
                        </Link>
                      ) : null}
                      <button className="icon-btn flex-none" onClick={() => setPending(r)} aria-label={`Remove ${r.fileName} from the history`} title="Remove from the history">
                        <Trash2 size={15} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!pending}
        title="Remove this export from the history?"
        body="Only the record goes. Files you downloaded stay where they are."
        confirmLabel="Remove"
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          await deleteExportRecord(pending.id);
          setPending(null);
          toast('Removed from the export history.');
          setVersion((v) => v + 1);
        }}
      />
    </>
  );
}
