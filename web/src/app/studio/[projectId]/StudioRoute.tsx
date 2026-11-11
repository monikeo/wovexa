'use client';
import Link from 'next/link';
import { useEffect, useSyncExternalStore } from 'react';
import { EditLockNotice } from '@/components/studio/EditLockNotice';
import { StudioShell } from '@/components/studio/StudioShell';
import { useStudio } from '@/stores/studio-store';

const noSubscribe = () => () => {};

/** The project in the address bar. Offline, the service worker may answer with another project's cached studio page. */
function projectInUrl(fallback: string) {
  const match = /^\/studio\/([^/?#]+)/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : fallback;
}

export function StudioRoute({ projectId: routed }: { projectId: string }) {
  // The server knows the project it rendered; the browser knows the one asked for. They differ only offline.
  const projectId = useSyncExternalStore(noSubscribe, () => projectInUrl(routed), () => routed);
  const status = useStudio((s) => s.status);
  const errors = useStudio((s) => s.loadErrors);
  const load = useStudio((s) => s.load);
  const loadedId = useStudio((s) => s.projectId);

  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);

  // Edit the project in this tab only while no other tab does; let go on leaving the studio.
  const opened = status === 'ready' && loadedId === projectId;
  useEffect(() => {
    if (!opened) return;
    void useStudio.getState().claimEditing();
    return () => useStudio.getState().releaseEditing();
  }, [opened, projectId]);

  if (opened) {
    return (
      <>
        <StudioShell />
        <EditLockNotice />
      </>
    );
  }

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
