import type { Metadata } from 'next';
import { Planned } from '@/components/workspace/Planned';

export const metadata: Metadata = { title: 'Team' };

export default function Page() {
  return (
    <Planned
      title="Team"
      summary="Invite people and decide what each of them can do."
      items={[
        'Roles: owner, admin, designer, reviewer, production manager and guest',
        'Email invitations with expiry',
        'Review links for clients, with comments and approval',
        'An activity log of who changed what',
      ]}
      release="the Professional release (P1), after accounts"
      specRef="§19 COL-01 to COL-06"
    />
  );
}
