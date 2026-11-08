import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ARTWORK_FONTS_HREF } from '@/lib/fonts';
import { StudioRoute } from './StudioRoute';

export const metadata: Metadata = { title: 'Studio' };

export default function StudioPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <>
      {/* Artwork fonts, hoisted into <head> by React. */}
      <link rel="stylesheet" href={ARTWORK_FONTS_HREF} precedence="default" />
      <Suspense fallback={<div className="grid h-dvh place-items-center text-sm text-fg-2">Opening project…</div>}>
        {params.then(({ projectId }) => (
          <StudioRoute projectId={projectId} />
        ))}
      </Suspense>
    </>
  );
}
