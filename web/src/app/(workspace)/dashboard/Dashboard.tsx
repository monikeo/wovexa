'use client';
import Link from 'next/link';
import { NewProjectButton, ProjectCard, QuickStart, useProjects } from '@/components/workspace/projects';
import { PageHeader } from '@/components/workspace/WorkspaceShell';

export function Dashboard() {
  const { projects, error, refresh } = useProjects();
  const recent = projects?.slice(0, 8) ?? [];

  return (
    <>
      <PageHeader title="Your studio" description="Pick up where you left off, or start a new garment." action={<NewProjectButton />} />

      <section aria-labelledby="start">
        <h2 id="start" className="mb-3 text-sm font-semibold">
          Start from a blank
        </h2>
        <QuickStart />
      </section>

      <section aria-labelledby="recent" className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent" className="text-sm font-semibold">
            Recent projects
          </h2>
          {projects && projects.length > 8 ? (
            <Link href="/projects" className="text-sm font-medium text-accent underline-offset-4 hover:underline">
              All projects
            </Link>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="rounded-xl border border-danger/40 p-4 text-sm">
            {error} Private browsing and blocked site data stop WOVEXA from saving projects.
          </p>
        ) : projects === null ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="aspect-[4/3.9] animate-pulse rounded-xl bg-[var(--surface-hover)]" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line p-8 text-center">
            <p className="font-semibold">No projects yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-fg-2">Choose a blank above or create a project. Everything saves automatically in this browser.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {recent.map((p) => (
              <ProjectCard key={p.id} meta={p} onChanged={refresh} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
