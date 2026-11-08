import type { Metadata } from 'next';
import { Planned } from '@/components/workspace/Planned';

export const metadata: Metadata = { title: 'Exports' };

export default function Page() {
  return (
    <Planned
      title="Exports"
      summary="A history of every file you've generated, tied to the exact version it came from. Today, exports download directly from the studio."
      items={[
        'Queued, running, finished and failed exports with retry',
        'Download links that expire on schedule',
        'Batch renders for every colourway, handled by a render worker',
      ]}
      release="the Professional release (P1)"
      specRef="§15 EXP-07, §31"
    />
  );
}
