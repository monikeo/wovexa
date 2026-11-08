import type { Metadata } from 'next';
import { Planned } from '@/components/workspace/Planned';

export const metadata: Metadata = { title: 'Brand kits' };

export default function Page() {
  return (
    <Planned
      title="Brand kits"
      summary="Keep logos, colours and fonts consistent across every garment."
      items={[
        'Approved logo variants and safe-area guides',
        'Brand palettes that colourways can link to',
        'Preferred fonts, with licence confirmation',
        'Locked logos that designers can place but not alter',
      ]}
      release="the Professional release (P1)"
      specRef="§18 BRD-01, BRD-02, BRD-05"
    />
  );
}
