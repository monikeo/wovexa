'use client';
/**
 * Colourway ideas (spec AI-04): harmonious colourways worked out on this device around the
 * garment's colour, or the artwork's main ink on a white, black or grey garment, each marked with
 * how well the artwork reads on it. Point at one to see it on the 3D garment; pick it to add it as
 * a colourway (Undo takes it back).
 */
import { ChevronDown, Image as ImageIcon, Shuffle, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { colourName, designInks, harmonyAnchor, HARMONY_LABELS, isNeutral, readability, suggestColorways, type ColorwayIdea } from '@/domain/color-harmony';
import { extractPalette } from '@/lib/image-ops';
import * as cmd from '@/domain/commands';
import { createColorway } from '@/domain/factory';
import type { GarmentModel } from '@/domain/garments';
import type { Colorway, DesignDocument } from '@/domain/schema';
import { toast } from '@/components/ui/primitives';
import { useLive, useStudio } from '@/stores/studio-store';
import { useBrandKit } from './brand-context';
import { GarmentGlyph } from './GarmentGlyph';

// Open or closed for the visit, so the ideas stay as they were left when the panel opens again.
let shown = false;
const listeners = new Set<() => void>();
function setShown(value: boolean) {
  shown = value;
  listeners.forEach((l) => l());
}
function useShown() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => shown,
    () => false,
  );
}

/** Open the ideas (from the command palette) and bring them into view. */
export function showColorwayIdeas() {
  setShown(true);
  setTimeout(() => document.getElementById('colourway-ideas')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150);
}

/** Show a colourway on the 3D garment without adding it, or stop (null). */
const preview = (colorway: Colorway | null) => useLive.getState().setColorwayPreview(colorway);
const asColorway = (idea: ColorwayIdea): Colorway => ({ id: 'idea', name: idea.name, parts: idea.parts });

const TONE = { good: 'text-success', fair: 'text-warning', poor: 'text-danger' } as const;

function mostCommon(names: string[]) {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function Readability({ idea }: { idea: ColorwayIdea }) {
  if (!idea.weakest) return null;
  const { ink, ratio } = idea.weakest;
  const r = readability(ratio);
  return (
    <span className={`flex max-w-full items-center gap-1 text-[10.5px] ${TONE[r]}`} title={`Weakest ink: ${ink.name}, ${ratio.toFixed(1)}:1 contrast on the ${ink.part}`}>
      <span className="h-1.5 w-1.5 flex-none rounded-full bg-current" aria-hidden />
      <span className="truncate">{r === 'good' ? 'Artwork reads well' : r === 'fair' ? `${ink.name} is faint` : `${ink.name} fades`}</span>
    </span>
  );
}

export function ColorwayIdeas({ doc, colorway, model }: { doc: DesignDocument; colorway: Colorway; model: GarmentModel }) {
  const open = useShown();
  const [variant, setVariant] = useState(0);
  // A photo to match (a mood board, a team photo, a logo): only its colours are kept, on this device.
  const [reference, setReference] = useState<{ name: string; colours: string[] } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const kit = useBrandKit();
  const dispatch = useStudio((s) => s.dispatch);
  const brand = useMemo(() => kit?.colors.map((c) => c.hex) ?? [], [kit]);
  const inks = useMemo(() => (open ? designInks(doc) : []), [open, doc]);
  const ideas = useMemo(
    () => (open ? suggestColorways(colorway.parts, inks, { brand, variant, reference: reference?.colours }) : []),
    [open, colorway.parts, inks, brand, variant, reference],
  );
  const anchor = harmonyAnchor(colorway.parts.body, inks.map((i) => i.hex), brand, reference?.colours);

  const readPhoto = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const colours = extractPalette(img, 6)
        .filter((c) => c.share >= 0.02)
        .map((c) => c.hex);
      preview(null);
      setVariant(0);
      setReference({ name: file.name.replace(/\.[^.]+$/, '') || 'your photo', colours });
      if (!colours.some((c) => !isNeutral(c))) toast('That photo is all black, white and grey, so the ideas stay around your garment and artwork.');
    } catch {
      toast('That image couldn’t be read. Try a JPG, PNG or WebP.', 'error');
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // Whatever was being looked at goes when the panel closes.
  useEffect(() => () => preview(null), []);

  const add = (idea: ColorwayIdea) => {
    preview(null);
    const taken = new Set(doc.colorways.map((c) => c.name));
    let name = idea.name;
    for (let n = 2; taken.has(name); n++) name = `${idea.name} ${n}`;
    dispatch(cmd.addColorway(createColorway({ name, parts: idea.parts })));
    toast(`Added ${name}. Undo takes it back.`);
  };

  // When no idea suits every ink, the layer that fades most often is the one to fix.
  const faint = ideas.length > 0 && ideas.every((i) => i.weakest && readability(i.weakest.ratio) !== 'good') ? mostCommon(ideas.map((i) => i.weakest!.ink.name)) : null;

  const source =
    anchor.from === 'reference'
      ? `Around the ${colourName(anchor.hex)} in ${reference?.name ?? 'your photo'}.`
      : anchor.from === 'garment'
      ? `Around this ${colourName(anchor.hex)}.`
      : anchor.from === 'artwork'
        ? `Around the ${colourName(anchor.hex)} in your artwork.`
        : anchor.from === 'brand'
          ? `Around your brand’s ${colourName(anchor.hex)}.`
          : 'Around a classic blue. Colour in the artwork or a brand kit steers them.';

  return (
    <div id="colourway-ideas" className="mt-4 rounded-xl border border-line">
      <button
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-hover"
        aria-expanded={open}
        onClick={() => {
          preview(null);
          setShown(!open);
        }}
      >
        <Sparkles size={15} className="text-accent" aria-hidden />
        <span className="flex-1 text-[13px] font-semibold">Colourway ideas</span>
        <ChevronDown size={15} className={`text-fg-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? (
        <div className="space-y-2.5 border-t border-line p-3">
          <p className="text-xs text-fg-2">{source}</p>
          <div className="flex gap-1.5">
            <button
              className="btn btn-outline min-h-8 flex-1 gap-1.5 px-2 text-xs"
              onClick={() => photoInput.current?.click()}
              title="Build ideas from a photo's colours: a mood board, a team photo, a logo. The photo stays on this device and isn't added to the design."
            >
              <ImageIcon size={13} /> Match a photo
            </button>
            <button
              className="btn btn-outline min-h-8 flex-1 gap-1.5 px-2 text-xs"
              onClick={() => {
                preview(null);
                setVariant((v) => v + 1);
              }}
              title="Turn the colour wheel for new ideas"
            >
              <Shuffle size={13} /> More ideas
            </button>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void readPhoto(file);
                e.target.value = '';
              }}
            />
          </div>
          {reference ? (
            <div className="flex items-center gap-2 rounded-lg bg-hover py-1 pl-2 pr-1">
              <span className="flex flex-none -space-x-1" aria-hidden>
                {reference.colours.map((c) => (
                  <span key={c} className="h-4 w-4 rounded-full border-2 border-[var(--surface-hover)]" style={{ background: c }} />
                ))}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-fg-2" title="Only the photo's colours are used; the photo stays on this device.">
                Matching {reference.name}
              </span>
              <button
                className="icon-btn h-7 w-7 flex-none"
                onClick={() => {
                  preview(null);
                  setReference(null);
                }}
                aria-label="Stop matching the photo"
              >
                <X size={13} />
              </button>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5" role="list" aria-label="Colourway ideas">
            {ideas.map((idea) => (
              <button
                key={`${idea.kind}-${idea.parts.body}`}
                role="listitem"
                className="touch-hit flex min-w-0 flex-col items-center gap-1 rounded-xl border border-line px-1.5 pb-2 pt-2 text-fg-3 transition-colors hover:border-line-strong hover:bg-hover focus-visible:border-[var(--accent)]"
                // Only a mouse that really moves previews: a card that slides under a still pointer
                // (the ideas change after one is added) leaves the garment showing what was added.
                onPointerMove={(e) => {
                  if (e.pointerType === 'mouse' && (e.movementX || e.movementY) && useLive.getState().colorwayPreview?.name !== idea.name) preview(asColorway(idea));
                }}
                onPointerLeave={(e) => {
                  if (e.pointerType === 'mouse') preview(null);
                }}
                onFocus={() => preview(asColorway(idea))}
                onBlur={() => preview(null)}
                onClick={() => add(idea)}
                aria-label={`Add colourway ${idea.name}${idea.weakest ? `, ${readability(idea.weakest.ratio) === 'good' ? 'artwork reads well' : `${idea.weakest.ink.name} has low contrast`}` : ''}`}
              >
                <GarmentGlyph model={model} colors={idea.parts} className="h-14 w-14" />
                <span className="w-full truncate text-center text-[12px] font-medium text-fg">{idea.colours.charAt(0).toUpperCase() + idea.colours.slice(1)}</span>
                <span className="text-[10.5px] text-fg-3">{HARMONY_LABELS[idea.kind]}</span>
                <Readability idea={idea} />
              </button>
            ))}
          </div>
          {faint ? (
            <p className="rounded-lg bg-hover px-2.5 py-2 text-[11px] text-fg-2">
              Your artwork has light and dark inks, so something fades on any one colour. A bold outline on {faint} lets it read on every colourway.
            </p>
          ) : null}
          <p className="text-[11px] text-fg-3">
            <span className="[@media(hover:none)]:hidden">Point at an idea to see it on the 3D garment; click to add it as a colourway.</span>
            <span className="hidden [@media(hover:none)]:inline">Tap an idea to add it as a colourway; Undo takes it back.</span>
            {inks.length ? ' The dot is how your artwork’s inks read on it.' : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
