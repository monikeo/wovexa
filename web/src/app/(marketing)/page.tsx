import type { Metadata } from 'next';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import Link from 'next/link';
import { WovexaSymbol } from '@/components/brand/Logo';
import { TechFlat } from './TechFlat';

export const metadata: Metadata = {
  description: 'An apparel design studio in your browser: design in real millimetres, see every edit on a 3D garment, and send your printer PNG, SVG and CMYK PDF/X files that match what you approved.',
};

const MODULES = [
  {
    name: 'Wovexa Studio',
    body: 'Lay out artwork at the size it prints, on every print zone and on design areas you place anywhere on the garment.',
    points: ['A pen with editable points, and shapes you can unite, subtract or intersect', 'Text along any line you draw or round a badge', 'Lockups: design a crest once, place it everywhere, edit it once', 'Clipping, letter colours, outlines, halftones and worn-print effects'],
    status: 'Available now',
  },
  {
    name: 'Wovexa 3D',
    body: 'Every edit shows on a 3D garment as you make it. Turn it, change colourways and drag artwork on the garment itself.',
    points: ['Artwork that runs over seams and shoulders', 'Fabrics, folds and lighting looks', 'Your own garment models from Blender, Clo3D or Marvelous Designer'],
    status: 'Available now',
  },
  {
    name: 'Wovexa Render',
    body: 'Product images for the shop and for social, from the same design, in every colourway.',
    points: ['Stills from any angle on white, grey, a backdrop or transparent', 'Turntables and short videos', 'On a podium, on a hanger or laid flat'],
    status: 'Available now',
  },
  {
    name: 'Wovexa Production',
    body: 'Print checks before anything leaves the studio, then the files a print shop or factory works from.',
    points: ['True-size PNG at up to 600 dpi, rendered in the background', 'Vector SVG with live text and cut lines, and CMYK PDF/X-1a', 'Screen-print films, cut-and-sew panels and fabric markers', 'Team names and numbers from a pasted roster, a tech sheet and a client proof'],
    status: 'Available now',
  },
  {
    name: 'Wovexa AI',
    body: 'Optional help, always shown before it is applied and always reversible. Nothing trains on your artwork.',
    points: [],
    status: 'Planned',
  },
];

const STEPS = [
  { verb: 'Design.', body: 'Pick a garment and its colourway, then lay out artwork in the print areas at the size it will actually print.' },
  { verb: 'Visualize.', body: 'Watch the garment change in 3D while you work, then make product images and turntables from any angle.' },
  { verb: 'Produce.', body: 'Fix what the print checks flag, then export print files and a production package tied to the version you approved.' },
];

const DEVICES = [
  { Icon: Monitor, title: 'Desktop', body: 'Layers, a 2D and 3D split view, and an inspector for exact measurements. Every tool has a keyboard shortcut, and the command palette finds the rest.' },
  { Icon: Tablet, title: 'Tablet', body: 'Touch-sized handles, pinch to zoom, and panels that slide in when you need them and out of the way when you don’t.' },
  { Icon: Smartphone, title: 'Phone', body: 'One view at a time, a bottom action bar, and sheets for editing, so quick changes on the go never feel cramped.' },
];

export default function Home() {
  return (
    <main>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 md:grid-cols-[1.05fr_1fr] md:px-8 md:pb-24 md:pt-20">
        <div>
          <h1 className="display text-[clamp(2.75rem,7vw,5.25rem)] leading-[0.98]">From Concept to Creation.</h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-fg-2">
            WOVEXA is an apparel design studio in your browser. Design in real millimetres, see every edit on a 3D garment, and send your printer files that match what you approved.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="/dashboard" className="btn btn-ink btn-lg">
              Start designing
            </Link>
            <Link href="/pricing" className="text-sm font-semibold underline underline-offset-4">
              See plans
            </Link>
          </div>
          <p className="mt-5 text-sm text-fg-3">No account needed. Projects save on this device.</p>
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
                <span className="num text-sm font-semibold text-fg-3" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="display mt-2 text-3xl">{s.verb}</h3>
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
          <p className="mt-4 text-fg-2">They share one project, so the design you place in Studio is the design you render and send to production. No re-exporting between tools.</p>
        </div>
        <ul className="mt-12 border-t border-fg">
          {MODULES.map((m) => (
            <li key={m.name} className="grid gap-3 border-b border-line py-7 md:grid-cols-[260px_1fr_150px] md:gap-8">
              <h3 className="flex items-center gap-3 text-xl font-semibold" style={{ fontStretch: '112%' }}>
                <WovexaSymbol className="h-[18px] w-auto flex-none" />
                {m.name}
              </h3>
              <div className="max-w-xl">
                <p className="text-fg-2">{m.body}</p>
                {m.points.length ? (
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {m.points.map((p) => (
                      <li key={p} className="flex gap-2.5">
                        <span className="mt-[0.6em] h-px w-3 flex-none bg-fg" aria-hidden />
                        {p}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
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
          {DEVICES.map(({ Icon, title, body }) => (
            <div key={title} className="border-t border-fg pt-5">
              <Icon size={22} aria-hidden />
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-fg-2">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-ink text-paper" aria-labelledby="start">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 md:flex-row md:items-center md:justify-between md:px-8">
          <h2 id="start" className="display max-w-xl text-4xl">
            Your next collection starts on a blank tee.
          </h2>
          <Link href="/dashboard" className="btn btn-lg bg-paper text-ink hover:opacity-90">
            Open the studio
          </Link>
        </div>
      </section>
    </main>
  );
}
