import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Pricing' };

const TIERS = [
  {
    name: 'Starter',
    who: 'For trying ideas and one-off shirts',
    items: ['Wovexa Studio and Wovexa 3D', 'Front, back and sleeve print zones', 'Mockup stills and true-size print files', 'Projects saved in your browser'],
    available: true,
  },
  {
    name: 'Creator',
    who: 'For independent designers selling online',
    items: ['Everything in Starter', 'Cloud sync across devices', 'More colourways, templates and versions', 'Higher-resolution renders'],
    available: false,
  },
  {
    name: 'Studio',
    who: 'For brands and print shops',
    items: ['Everything in Creator', 'Team workspace with roles', 'Client review and approval', 'Wovexa Production tech packs'],
    available: false,
  },
  {
    name: 'Enterprise',
    who: 'For manufacturers and large teams',
    items: ['Everything in Studio', 'Single sign-on', 'Custom data retention', 'Dedicated render capacity'],
    available: false,
  },
];

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-24">
      <h1 className="display text-5xl">Plans</h1>
      <p className="mt-4 max-w-xl text-lg text-fg-2">Prices will be announced when accounts launch. Starter is open now, in your browser, with no sign-up.</p>
      <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4">
        {TIERS.map((t) => (
          <section key={t.name} className="flex flex-col bg-[var(--surface-panel)] p-6">
            <h2 className="heading text-2xl">{t.name}</h2>
            <p className="mt-2 min-h-12 text-sm text-fg-2">{t.who}</p>
            <ul className="mt-6 flex-1 space-y-2.5 text-sm">
              {t.items.map((i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-[0.55em] h-px w-3 flex-none bg-fg" aria-hidden />
                  {i}
                </li>
              ))}
            </ul>
            {t.available ? (
              <Link href="/dashboard" className="btn btn-ink mt-8">
                Start designing
              </Link>
            ) : (
              <p className="mt-8 text-sm font-medium text-fg-3">Available when accounts launch</p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
