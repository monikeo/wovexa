import type { Metadata } from 'next';
import Link from 'next/link';
import { WovexaLockup } from '@/components/brand/Logo';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        <Link href="/" aria-label="WOVEXA home">
          <WovexaLockup className="h-7 w-auto" />
        </Link>
        <div className="mt-8 rounded-2xl border border-line bg-panel p-6">
          <SignInForm />
        </div>
      </div>
    </main>
  );
}
