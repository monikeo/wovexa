'use client';
import { FolderOpen, Home, Images, LayoutTemplate, Palette, Settings, Share2, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { WovexaLockup, WovexaSymbol } from '@/components/brand/Logo';
import { Toaster } from '@/components/ui/primitives';

const NAV = [
  { href: '/dashboard', label: 'Home', Icon: Home, primary: true },
  { href: '/projects', label: 'Projects', Icon: FolderOpen, primary: true },
  { href: '/assets', label: 'Assets', Icon: Images, primary: true },
  { href: '/templates', label: 'Templates', Icon: LayoutTemplate },
  { href: '/brands', label: 'Brand kits', Icon: Palette },
  { href: '/exports', label: 'Exports', Icon: Share2 },
  { href: '/team', label: 'Team', Icon: Users },
  { href: '/settings', label: 'Settings', Icon: Settings, primary: true },
] as const;

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return (
    <div className="min-h-dvh bg-canvas md:grid md:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-panel px-3 py-4 md:flex" aria-label="Workspace">
        <Link href="/" className="mb-6 block px-2" aria-label="WOVEXA home">
          <WovexaLockup className="h-6 w-auto" />
        </Link>
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? 'page' : undefined}
              className="flex min-h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-fg-2 hover:bg-hover hover:text-fg aria-[current=page]:bg-selected aria-[current=page]:text-accent"
            >
              <Icon size={17} aria-hidden /> {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-xl border border-line p-3 text-xs text-fg-2">
          <p className="font-semibold text-fg">Local mode</p>
          <p className="mt-1">Projects are saved in this browser. Sync across devices arrives with accounts.</p>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-20 flex h-14 items-center border-b border-line bg-panel/95 px-4 backdrop-blur md:hidden">
          <Link href="/" aria-label="WOVEXA home">
            <WovexaSymbol className="h-5 w-auto" />
          </Link>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-10">{children}</main>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-panel md:hidden" aria-label="Workspace">
        {NAV.filter((n) => 'primary' in n && n.primary).map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? 'page' : undefined}
            className="flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-fg-2 aria-[current=page]:text-accent"
          >
            <Icon size={20} aria-hidden /> {label}
          </Link>
        ))}
      </nav>
      <Toaster />
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="heading text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-xl text-fg-2">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
