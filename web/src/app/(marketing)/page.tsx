import { Monitor, Smartphone, Tablet } from 'lucide-react';
import Link from 'next/link';
import { WovexaSymbol } from '@/components/brand/Logo';
import { TechFlat } from './TechFlat';

const MODULES = [
  {
    name: 'Wovexa Studio',
    body: 'Place text, artwork and shapes in real millimetres on the front, back and both sleeves, with print areas and safe margins always in view.',
    status: 'Available now',
  },
  {
    name: 'Wovexa 3D',
    body: 'Every edit appears on a 3D garment as you make it. Rotate it, switch colourways, and drag artwork while the shirt follows along.',
    status: 'Available now',
  },
  {
    name: 'Wovexa Render',
    body: 'Front, back, side and three-quarter product images on white, grey or transparent backgrounds. Turntables and batch renders come next.',
    status: 'Stills now, video next',
  },
  {
    name: 'Wovexa Production',
    body: 'Checks for resolution, placement and print method before anything leaves the studio, then true-size print files with a manifest.',
    status: 'Checks and print files now',
  },
  {
    name: 'Wovexa AI',
    body: 'Optional help such as background removal, always previewed first and always reversible. Nothing trains on your artwork.',
    status: 'Planned',
  },
];

const STEPS = [
  { verb: 'Design.', body: 'Pick a blank, choose its colourway, and lay out artwork in the print zones at the size it will actually print.' },
  { verb: 'Visualize.', body: 'Watch the garment update in 3D while you work, then capture product images from any angle.' },
  { verb: 'Produce.', body: 'Fix what the print checks flag, then export transparent print files and a manifest tied to the saved version.' },
];

export default function Home() {
  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 md:grid-cols-[1.05fr_1fr] md:px-8 md:pb-24 md:pt-20">
        <div>
          <h1 className="display text-[clamp(2.75rem,7vw,5.25rem)] leading-[0.98]">From Concept to Creation.</h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-fg-2">
            WOVEXA is an apparel design studio in your browser. Design in real millimetres, see every edit on a 3D garment, and hand your printer files that match what you approved.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/dashboard" className="btn btn-ink btn-lg">
              Start designing
            </Link>
            <Link href="/pricing" className="text-sm font-semibold underline underline-offset-4">
              See plans
            </Link>
          </div>
          <p className="mt-5 text-sm text-fg-3">No account needed. Projects save in your browser.</p>
        </div>
        <div className="mx-auto w-full max-w-[520px] text-fg">
          <TechFlat />
        </div>
      </section>

      <section className="border-y border-line bg-canvas" aria-labelledby="how">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
          <h2 id="how" className="sr-only">
            How it works
          </h2>
          <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((s, i) => (
              <li key={s.verb}>
                <span className="num text-sm font-semibold text-fg-3">{i + 1}</span>
                <p className="display mt-2 text-3xl">{s.verb}</p>
                <p className="mt-3 max-w-sm text-fg-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="modules" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:px-8 md:py-24" aria-labelledby="modules-title">
        <div className="max-w-2xl">
          <h2 id="modules-title" className="heading text-4xl">
            One studio, five modules
          </h2>
          <p className="mt-4 text-fg-2">They share one project, so the design you place in Studio is the same design you render and send to production. No re-exporting between tools.</p>
        </div>
        <ul className="mt-12 border-t border-fg">
          {MODULES.map((m) => (
            <li key={m.name} className="grid gap-3 border-b border-line py-6 md:grid-cols-[300px_1fr_200px] md:items-center md:gap-8">
              <p className="flex items-center gap-3 text-xl font-semibold" style={{ fontStretch: '112%' }}>
                <WovexaSymbol className="h-[18px] w-auto flex-none" />
                {m.name}
              </p>
              <p className="max-w-xl text-fg-2">{m.body}</p>
              <p className={`text-sm font-semibold md:text-right ${m.status === 'Planned' ? 'text-fg-3' : ''}`}>{m.status}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 md:px-8 md:pb-24" aria-labelledby="devices">
        <h2 id="devices" className="heading text-4xl">
          Built for the screen you have
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            { Icon: Monitor, title: 'Desktop', body: 'Layers, a 2D and 3D split view, and an inspector for exact measurements. Every tool has a keyboard shortcut.' },
            { Icon: Tablet, title: 'Tablet', body: 'Touch-sized handles, pinch to zoom, and panels that slide in when you need them and get out of the way when you don’t.' },
            { Icon: Smartphone, title: 'Phone', body: 'One view at a time, a bottom action bar, and sheets for editing, so quick changes on the go never feel cramped.' },
          ].map(({ Icon, title, body }) => (
            <div key={title} className="border-t border-fg pt-5">
              <Icon size={22} aria-hidden />
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-fg-2">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-ink text-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 md:flex-row md:items-center md:justify-between md:px-8">
          <p className="display max-w-xl text-4xl">Your next collection starts on a blank tee.</p>
          <Link href="/dashboard" className="btn btn-lg bg-paper text-ink hover:opacity-90">
            Open the studio
          </Link>
        </div>
      </section>
    </main>
  );
}
