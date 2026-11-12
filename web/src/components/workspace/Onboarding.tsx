'use client';
/**
 * First-run onboarding (spec ACC-03): three short choices (what you are making, the garment and
 * its colour, sample artwork or a blank) that end in a real project. Dismissible at any step,
 * never shown again once finished or skipped, and nothing is created until the last click.
 */
import { ArrowLeft, ArrowRight, Loader2, Sparkles, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { colorwayPresetsFor, GARMENT_LIST, garmentNoun, getGarment, JERSEY, TEE_CLASSIC, TEE_OVERSIZED } from '@/domain/garments';
import { BUILT_IN_TEMPLATES, templateFits } from '@/domain/templates';
import { createProject } from '@/lib/local-db';
import { projectFromTemplate } from '@/lib/templates-apply';
import { toast } from '@/components/ui/primitives';
import { GarmentGlyph } from '@/components/studio/GarmentGlyph';

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

/** Each use starts on the garment it is most often made on; any other can be picked in the next step. */
const USES = [
  { id: 'brand', label: 'Brand merch', hint: 'A logo on the chest, clean and repeatable.', template: 'left-chest-mark', garment: TEE_CLASSIC.id },
  { id: 'team', label: 'Team or club kit', hint: 'Names, numbers and a crest.', template: 'team-jersey', garment: JERSEY.id },
  { id: 'event', label: 'Event or campaign', hint: 'A big graphic on the back.', template: 'big-back-print', garment: TEE_CLASSIC.id },
  { id: 'street', label: 'Streetwear graphic', hint: 'Bold artwork with a retro feel.', template: 'retro-sunset', garment: TEE_OVERSIZED.id },
  { id: 'explore', label: 'Just exploring', hint: 'Start blank and try things out.', template: null, garment: TEE_CLASSIC.id },
] as const;

export function Onboarding() {
  const done = useOnboarded();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [use, setUse] = useState<(typeof USES)[number]>(USES[0]);
  const [modelId, setModelId] = useState<string>(USES[0].garment);
  const [colorName, setColorName] = useState<string | null>(null);
  const [withSample, setWithSample] = useState(true);
  const [busy, setBusy] = useState(false);
  if (done) return null;

  const model = getGarment(modelId);
  // The colours this garment comes in; a colour picked on another garment carries over by name.
  const presets = colorwayPresetsFor(model);
  const colorway = Math.max(0, presets.findIndex((p) => p.name === colorName));
  const template = use.template ? BUILT_IN_TEMPLATES.find((t) => t.id === use.template) : undefined;
  const sampleFits = !!template && templateFits(template, model);
  const sample = sampleFits && withSample;
  const chooseUse = (u: (typeof USES)[number]) => {
    setUse(u);
    setModelId(u.garment);
  };
  const create = async () => {
    setBusy(true);
    try {
      const meta = template && sample ? await projectFromTemplate({ ...template, modelId: model.id, colorwayIndex: colorway }) : await createProject(`${presets[colorway].name} ${garmentNoun(model)}`, colorway, model.id);
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
              onClick={() => chooseUse(u)}
            >
              <span className="block text-sm font-semibold">{u.label}</span>
              <span className="mt-0.5 block text-xs text-fg-2">{u.hint}</span>
            </button>
          ))}
        </div>
      ) : null}

      {step === 1 ? (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="radiogroup" aria-label="Garment">
            {GARMENT_LIST.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={model.id === m.id}
                className="touch-hit flex items-center gap-2 rounded-xl border border-line p-2 text-left text-sm hover:border-line-strong aria-checked:border-[var(--accent)] aria-checked:bg-selected"
                onClick={() => setModelId(m.id)}
              >
                <GarmentGlyph model={m} className="h-9 w-9 flex-none text-fg-2" />
                <span className="min-w-0 leading-tight">{m.shortName}</span>
              </button>
            ))}
          </div>
          <p className="text-sm text-fg-2">
            {model.name}: {model.description} You can change the garment and add colourways later.
          </p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Garment colour">
            {presets.map((p, i) => (
              <button
                key={p.name}
                role="radio"
                aria-checked={colorway === i}
                className="touch-hit flex items-center gap-2 rounded-xl border border-line py-2 pl-2 pr-3 text-sm hover:border-line-strong aria-checked:border-[var(--accent)] aria-checked:bg-selected"
                onClick={() => setColorName(p.name)}
              >
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--surface-hover)] text-fg-3">
                  <GarmentGlyph model={model} colors={p.parts} className="h-8 w-8" />
                </span>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How do you want to start?">
            {template && sampleFits ? (
              <button
                role="radio"
                aria-checked={sample}
                className="touch-hit rounded-xl border border-line p-3 text-left hover:border-line-strong aria-checked:border-[var(--accent)] aria-checked:bg-selected"
                onClick={() => setWithSample(true)}
              >
                <span className="block text-sm font-semibold">With sample artwork: {template.name}</span>
                <span className="mt-0.5 block text-xs text-fg-2">{template.description} Replace the text and images with yours.</span>
              </button>
            ) : null}
            <button
              role="radio"
              aria-checked={!sample}
              className="touch-hit rounded-xl border border-line p-3 text-left hover:border-line-strong aria-checked:border-[var(--accent)] aria-checked:bg-selected"
              onClick={() => setWithSample(false)}
            >
              <span className="block text-sm font-semibold">Blank {garmentNoun(model)}</span>
              <span className="mt-0.5 block text-xs text-fg-2">Add text, shapes and images yourself. Everything saves on this device as you work.</span>
            </button>
          </div>
          {template && !sampleFits ? (
            <p className="mt-2 text-xs text-fg-2">
              The {template.name} sample uses a print area the {garmentNoun(model)} doesn’t have, so this one starts blank. Pick another garment to start from the sample.
            </p>
          ) : null}
        </>
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
