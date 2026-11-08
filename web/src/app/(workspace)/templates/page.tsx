import type { Metadata } from 'next';
import { BuiltInTemplates, UserTemplates } from '@/components/workspace/templates';
import { PageHeader } from '@/components/workspace/WorkspaceShell';

export const metadata: Metadata = { title: 'Templates' };

export default function TemplatesPage() {
  return (
    <>
      <PageHeader title="Templates" description="Start a project from a ready-made layout. Every template opens as an independent copy you can change freely." />
      <section aria-labelledby="mine" className="mb-12">
        <h2 id="mine" className="mb-3 text-sm font-semibold">
          Your templates
        </h2>
        <UserTemplates />
      </section>
      <section aria-labelledby="starters">
        <h2 id="starters" className="mb-3 text-sm font-semibold">
          Starter templates
        </h2>
        <BuiltInTemplates />
      </section>
    </>
  );
}
