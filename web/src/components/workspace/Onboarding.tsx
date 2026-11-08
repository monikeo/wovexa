'use client';
/**
 * First-run onboarding (spec ACC-03): three short choices (what you are making, the garment
 * colour, sample artwork or a blank) that end in a real project. Dismissible at any step, never
 * shown again once finished or skipped, and nothing is created until the last click.
 */
import { ArrowLeft, ArrowRight, Loader2, Sparkles, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { COLORWAY_PRESETS, TEE_CLASSIC } from '@/domain/garments';
import { BUILT_IN_TEMPLATES } from '@/domain/templates';
import { createProject } from '@/lib/local-db';
import { projectFromTemplate } from '@/lib/templates-apply';
import { toast } from '@/components/ui/primitives';
import { TeeGlyph } from './projects';

const KEY = 'wovexa.onboarded';
const listeners = new Set<() => void>();

function useOnboarded() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => {
      try {
        return localStorage.getItem(KEY) === '1';
      } catch {
        return true;
      }
    },
    () => true,
  );
}

function finish() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {}
  listeners.forEach((l) => l());
}

const USES = [
  { id: 'brand', label: 'Brand merch', hint: 'A logo on the chest, clean and repeatable.', template: 'left-chest-mark' },
  { id: 'team', label: 'Team or club kit', hint: 'Names, numbers and a crest.', template: 'team-jersey' },
  { id: 'event', label: 'Event or campaign', hint: 'A big graphic on the back.', template: 'big-back-print' },
  { id: 'street', label: 'Streetwear graphic', hint: 'Bold artwork with a retro feel.', template: 'retro-sunset' },
  { id: 'explore', label: 'Just exploring', hint: 'Start blank and try things out.', template: null },
] as const;

export function Onboarding() {
  const done = useOnboarded();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [use, setUse] = useState<(typeof USES)[number]>(USES[0]);
  const [colorway, setColorway] = useState(0);
  const [withSample, setWithSample] = useState(true);
  const [busy, setBusy] = useState(false);
  if (done) return null;

  const template = use.template ? BUILT_IN_TEMPLATES.find((t) => t.id === use.template) : undefined;
  const create = async () => {
    setBusy(true);
    try {
      const meta = template && withSample ? await projectFromTemplate({ ...template, colorwayIndex: colorway }) : await createProject(`${COLORWAY_PRESETS[colorway].name} tee`, colorway);
      finish();
      router.push(`/studio/${meta.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The project could not be created.', 'error');
      setBusy(false);
    }
  };

  const steps = ['What are you making?', 'Pick the garment', 'How do you want to start?'];
  return (
    <section aria-labelledby="onboarding-title" className="mb-10 rounded-2xl border border-line bg-panel p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-accent">
            <Sparkles size={14} aria-hidden /> Welcome to WOVEXA · Step {step + 1} of 3
          </p>
          <h2 id="onboarding-title" className="heading mt-1 text-lg">
            {steps[step]}
          </h2>
        </div>
        <button className="btn btn-ghost min-h-8 px-2 text-xs text-fg-2" onClick={finish}>
          <X size={14} /> Skip
        </button>
      </div>

      {step === 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5" role="radiogroup" aria-label="What are you making?">
          {USES.map((u) => (
            <button
              key={u.id}
              role="radio"
              aria-checked={use.id === u.id}
              className="touch-hit rounded-xl border border-line p-3 text-left hover:border-line-strong aria-checked:border-[var(--accent)] aria-checked:bg-selected"
              onClick={() => setUse(u)}
            >
              <span className="block text-sm font-semibold">{u.label}</span>
              <span className="mt-0.5 block text-xs text-fg-2">{u.hint}</span>
            </button>
          ))}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-fg-2">
            {TEE_CLASSIC.name}, front, back and both sleeves. More garments are on the way. You can add colourways later.
          </p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Garment colour">
            {COLORWAY_PRESETS.map((p, i) => (
              <button
                key={p.name}
                role="radio"
                aria-checked={colorway === i}
                className="touch-hit flex items-center gap-2 rounded-xl border border-line py-2 pl-2 pr-3 text-sm hover:border-line-strong aria-checked:border-[var(--accent)] aria-checked:bg-selected"
                onClick={() => setColorway(i)}
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--surface-hover)]">
                  <TeeGlyph color={p.parts.body} />
                </span>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How do you want to start?">
          {template ? (
            <button
              role="radio"
              aria-checked={withSample}
              className="touch-hit rounded-xl border border-line p-3 text-left hover:border-line-strong aria-checked:border-[var(--accent)] aria-checked:bg-selected"
              onClick={() => setWithSample(true)}
            >
              <span className="block text-sm font-semibold">With sample artwork: {template.name}</span>
              <span className="mt-0.5 block text-xs text-fg-2">{template.description} Replace the text and images with yours.</span>
            </button>
          ) : null}
          <button
            role="radio"
            aria-checked={!template || !withSample}
            className="touch-hit rounded-xl border border-line p-3 text-left hover:border-line-strong aria-checked:border-[var(--accent)] aria-checked:bg-selected"
            onClick={() => setWithSample(false)}
          >
            <span className="block text-sm font-semibold">Blank garment</span>
            <span className="mt-0.5 block text-xs text-fg-2">Add text, shapes and images yourself. Everything saves on this device as you work.</span>
          </button>
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-2">
        <button className="btn btn-ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0 || busy}>
          <ArrowLeft size={15} /> Back
        </button>
        {step < 2 ? (
          <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>
            Next <ArrowRight size={15} />
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void create()} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : null} Open the studio
          </button>
        )}
      </div>
    </section>
  );
}
