'use client';
import Link from 'next/link';
import { useEffect } from 'react';

/** A page that failed to render: say so plainly and offer the way forward, never a blank screen. */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-16">
      <h1 className="display text-4xl leading-tight">This page didn’t load.</h1>
      <p className="text-fg-2">Something went wrong while showing it. Your projects are saved on this device and aren’t affected.</p>
      <div className="flex flex-wrap items-center gap-4">
        <button className="btn btn-ink" onClick={() => retry()}>
          Try again
        </button>
        <Link href="/dashboard" className="text-sm font-semibold underline underline-offset-4">
          Go to your projects
        </Link>
      </div>
    </main>
  );
}
