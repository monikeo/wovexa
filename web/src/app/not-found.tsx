import type { Metadata } from 'next';
import Link from 'next/link';
import { WovexaLockup } from '@/components/brand/Logo';

export const metadata: Metadata = { title: 'Page not found' };

/** Any address the app doesn't have: a way back to the projects and the home page. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-16">
      <Link href="/" aria-label="WOVEXA home" className="w-fit">
        <WovexaLockup className="h-[22px] w-auto" />
      </Link>
      <h1 className="display text-4xl leading-tight">This page doesn’t exist.</h1>
      <p className="text-fg-2">The address may be mistyped, or the page has moved. Your projects are where you left them.</p>
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/dashboard" className="btn btn-ink">
          Go to your projects
        </Link>
        <Link href="/" className="text-sm font-semibold underline underline-offset-4">
          Home page
        </Link>
      </div>
    </main>
  );
}
