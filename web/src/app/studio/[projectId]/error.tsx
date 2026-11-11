'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { parseDesignDocument } from '@/domain/schema';
import { useStudio } from '@/stores/studio-store';

/**
 * The studio failed to render. The design itself lives in the store, untouched by the failure, so
 * edits still waiting to be written are saved first, then the studio can be opened again as it was.
 */
export default function StudioError({ error, retry }: { error: unknown; retry: () => void }) {
  const [saved, setSaved] = useState<'saving' | 'saved' | 'failed'>('saving');
  useEffect(() => {
    console.error(error);
    let live = true;
    const { document, saveState, saveNow } = useStudio.getState();
    const done = (state: 'saved' | 'failed') => live && setSaved(state);
    if (!document || saveState === 'saved') done('saved');
    // A design that no longer validates is never written over the last good copy.
    else if (!parseDesignDocument(document).ok) done('failed');
    else
      saveNow().then(
        () => done(useStudio.getState().saveState === 'error' ? 'failed' : 'saved'),
        () => done('failed'),
      );
    return () => {
      live = false;
    };
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-16">
      <h1 className="display text-4xl leading-tight">The studio hit a problem.</h1>
      <p className="text-fg-2" role="status">
        {saved === 'saving' ? 'Saving your latest edits on this device…' : saved === 'saved' ? 'Your design is saved on this device, up to your last edit.' : 'Your last few seconds of edits couldn’t be saved. Everything before them is on this device.'}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button className="btn btn-ink" disabled={saved === 'saving'} onClick={() => retry()}>
          Open the studio again
        </button>
        <Link href="/dashboard" className="text-sm font-semibold underline underline-offset-4">
          Go to your projects
        </Link>
      </div>
    </main>
  );
}
