'use client';
import { useEffect } from 'react';
import './globals.css';

/**
 * The app's own layout failed: this replaces it, so it brings its own document and styles. The
 * colours follow the device's light or dark setting.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <title>Something went wrong · WOVEXA</title>
        <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-16">
          <h1 className="text-4xl font-bold leading-tight">WOVEXA didn’t load.</h1>
          <p className="text-fg-2">Something went wrong while starting the app. Your projects are saved on this device and aren’t affected.</p>
          <div className="flex flex-wrap items-center gap-4">
            <button className="btn btn-ink" onClick={() => retry()}>
              Try again
            </button>
            <a href="/dashboard" className="text-sm font-semibold underline underline-offset-4">
              Go to your projects
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
