import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ARTWORK_FONTS_HREF } from '@/lib/fonts';
import { TechPack } from './TechPack';

export const metadata: Metadata = { title: 'Tech pack' };

export default function ProductionPage({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <>
      <link rel="stylesheet" href={ARTWORK_FONTS_HREF} precedence="default" />
      <Suspense fallback={<p className="p-8 text-sm text-fg-2">Loading tech pack…</p>}>{params.then(({ projectId }) => <TechPack projectId={projectId} />)}</Suspense>
    </>
  );
}
