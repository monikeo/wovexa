import type { Metadata } from 'next';
import { Planned } from '@/components/workspace/Planned';

export const metadata: Metadata = { title: 'Templates' };

export default function Page() {
  return (
    <Planned
      title="Templates"
      summary="Save a garment and its layers as a starting point your team can reuse."
      items={[
        'Save any project as a template with locked and editable layers',
        'Filter by garment, use case and licence',
        'Templates stay private to your workspace unless you publish them',
      ]}
      release="the Professional release (P1)"
      specRef="§18 BRD-03, BRD-04"
    />
  );
}
