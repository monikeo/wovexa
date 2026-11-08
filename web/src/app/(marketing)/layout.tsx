import Link from 'next/link';
import { WovexaLockup } from '@/components/brand/Logo';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--surface-panel)] text-fg">
      <header className="sticky top-0 z-30 border-b border-line bg-[var(--surface-panel)]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 md:px-8">
          <Link href="/" aria-label="WOVEXA home" className="flex-none">
            <WovexaLockup className="h-[22px] w-auto" />
          </Link>
          <nav className="ml-auto hidden items-center gap-6 text-sm font-medium text-fg-2 sm:flex" aria-label="Main">
            <Link href="/#modules" className="hover:text-fg">
              Modules
            </Link>
            <Link href="/pricing" className="hover:text-fg">
              Pricing
            </Link>
            <Link href="/sign-in" className="hover:text-fg">
              Sign in
            </Link>
          </nav>
          <Link href="/dashboard" className="btn btn-ink ml-auto sm:ml-0">
            Open the studio
          </Link>
        </div>
      </header>
      {children}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6 px-4 py-10 md:px-8">
          <div>
            <WovexaLockup className="h-6 w-auto" />
            <p className="mt-3 text-sm text-fg-2">Apparel Design Studio. From Concept to Creation.</p>
          </div>
          <nav className="flex flex-wrap gap-5 text-sm text-fg-2" aria-label="Footer">
            <Link href="/pricing" className="hover:text-fg">
              Pricing
            </Link>
            <Link href="/dashboard" className="hover:text-fg">
              Studio
            </Link>
            <Link href="/settings" className="hover:text-fg">
              Settings
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
