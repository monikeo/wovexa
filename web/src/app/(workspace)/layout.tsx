import { ARTWORK_FONTS_HREF } from '@/lib/fonts';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Artwork fonts, so template and project previews render with their real typefaces. */}
      <link rel="stylesheet" href={ARTWORK_FONTS_HREF} precedence="default" />
      <WorkspaceShell>{children}</WorkspaceShell>
    </>
  );
}
