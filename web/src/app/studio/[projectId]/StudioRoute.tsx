'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { StudioShell } from '@/components/studio/StudioShell';
import { useStudio } from '@/stores/studio-store';

export function StudioRoute({ projectId }: { projectId: string }) {
  const status = useStudio((s) => s.status);
  const errors = useStudio((s) => s.loadErrors);
  const load = useStudio((s) => s.load);
  const loadedId = useStudio((s) => s.projectId);

  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);

  if (status === 'ready' && loadedId === projectId) return <StudioShell />;

  if (status === 'missing' || status === 'invalid') {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <div className="max-w-md">
          <h1 className="heading text-2xl">{status === 'missing' ? 'This project isn’t on this device' : 'This project couldn’t be opened'}</h1>
          <p className="mt-3 text-fg-2">
            {status === 'missing'
              ? 'Projects are saved in this browser. If you made it on another device or browser, open it there, or sign in to sync your projects.'
              : 'The saved file failed validation, so nothing was changed. The details below help with support.'}
          </p>
          {errors.length ? (
            <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-panel p-3 text-xs text-fg-2">{errors.join('\n')}</pre>
          ) : null}
          <Link href="/dashboard" className="btn btn-ink mt-6">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  return <div className="grid h-dvh place-items-center text-sm text-fg-2">Opening project…</div>;
}
