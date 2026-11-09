'use client';
/** Small inspector controls shared by text, shape, image and appearance sections. */
import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';
import { LETTER_PALETTES } from '@/domain/letter-colors';
import type { FillStyle } from '@/domain/schema';
import { ColorField } from '@/components/ui/primitives';

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[52px_1fr_44px] items-center gap-2">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 accent-[var(--accent)] disabled:opacity-40"
        aria-valuetext={format(value)}
      />
      <span className="num text-right text-xs text-fg-2">{format(value)}</span>
    </div>
  );
}

const PATTERNS: { id: Extract<FillStyle, { kind: 'pattern' }>['pattern']; label: string }[] = [
  { id: 'stripes', label: 'Stripes' },
  { id: 'dots', label: 'Dots' },
  { id: 'checks', label: 'Checks' },
  { id: 'grid', label: 'Grid' },
  { id: 'zigzag', label: 'Zigzag' },
  { id: 'waves', label: 'Waves' },
  { id: 'diamonds', label: 'Diamonds' },
  { id: 'camo', label: 'Camo' },
];

type Gradient = Extract<FillStyle, { kind: 'gradient' }>;

/** Ready-made gradients: a starting point for each look, every colour still editable. */
const GRADIENTS: { name: string; from: string; style: Gradient }[] = [
  { name: 'Sunset', from: '#F83600', style: { kind: 'gradient', via: '#FE8C00', to: '#F9D423', angleDeg: 90 } },
  { name: 'Ocean', from: '#00C6FF', style: { kind: 'gradient', to: '#0047AB', angleDeg: 90 } },
  { name: 'Neon', from: '#F72585', style: { kind: 'gradient', via: '#7209B7', to: '#4CC9F0', angleDeg: 0 } },
  { name: 'Chrome', from: '#F5F7FA', style: { kind: 'gradient', via: '#8E9EAB', to: '#EEF2F3', angleDeg: 90 } },
  { name: 'Fire', from: '#FFE600', style: { kind: 'gradient', via: '#FF7A00', to: '#D00000', angleDeg: 90 } },
  { name: 'Gold', from: '#FCEABB', style: { kind: 'gradient', via: '#D4A017', to: '#8C6A14', angleDeg: 90 } },
  { name: 'Forest', from: '#134E5E', style: { kind: 'gradient', to: '#71B280', angleDeg: 45 } },
  { name: 'Spotlight', from: '#FFFFFF', style: { kind: 'gradient', to: '#2B59FF', angleDeg: 0, radial: true } },
];

const css = (from: string, g: Gradient) =>
  g.radial ? `radial-gradient(circle, ${from}, ${g.via ? `${g.via}, ` : ''}${g.to})` : `linear-gradient(${g.angleDeg + 90}deg, ${from}, ${g.via ? `${g.via}, ` : ''}${g.to})`;

/** Halfway between two colours, for a middle stop that starts in tune with its ends. */
function mixHex(a: string, b: string) {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round((ch(a, i) + ch(b, i)) / 2).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** The gradient without one optional field (so it isn't stored as undefined). */
function without(g: Gradient, key: 'via' | 'radial'): Gradient {
  const copy = { ...g };
  delete copy[key];
  return copy;
}

type FillPatch = { fill?: string; fillStyle?: FillStyle | undefined; letterColors?: string[] | undefined };

/** The colours that run across the letters: edit, add or remove one, or start from a ready-made run. */
function LetterColors({ colors, swatches, onChange }: { colors: string[]; swatches?: { name: string; hex: string }[]; onChange: (colors: string[], label: string) => void }) {
  const palettes = swatches && swatches.length > 1 ? [{ name: 'Brand', colors: swatches.map((s) => s.hex.toUpperCase()) }, ...LETTER_PALETTES] : LETTER_PALETTES;
  const chip = (list: string[]) => `linear-gradient(90deg, ${list.map((c, i) => `${c} ${(i / list.length) * 100}% ${((i + 1) / list.length) * 100}%`).join(', ')})`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Letter colour sets">
        {palettes.map((p) => (
          <button key={p.name} className="h-6 w-6 rounded-full border border-line shadow-sm transition-transform hover:scale-110" style={{ background: chip(p.colors) }} title={p.name} aria-label={`${p.name} letter colours`} onClick={() => onChange(p.colors.slice(0, 40), `Letter colours: ${p.name.toLowerCase()}`)} />
        ))}
      </div>
      <div className="grid grid-cols-[52px_1fr] items-center gap-2">
        <span className="label">Letters</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {colors.map((c, i) => (
            <input
              key={i}
              type="color"
              className="h-7 w-7 cursor-pointer rounded-md border border-line bg-transparent p-0.5"
              value={c.toLowerCase()}
              aria-label={`Letter colour ${i + 1} of ${colors.length}`}
              title={`Colour ${i + 1}: letters ${i + 1}, ${i + 1 + colors.length}, ${i + 1 + 2 * colors.length}…`}
              onChange={(e) => onChange(colors.map((x, k) => (k === i ? e.target.value.toUpperCase() : x)), 'Letter colour')}
            />
          ))}
          <button className="icon-btn h-7 w-7 border border-line" disabled={colors.length >= 12} onClick={() => onChange([...colors, colors[colors.length % 2 ? 0 : 1] ?? '#FFFFFF'], 'Add letter colour')} aria-label="Add a letter colour">
            <Plus size={13} />
          </button>
          <button className="icon-btn h-7 w-7 border border-line" disabled={colors.length <= 2} onClick={() => onChange(colors.slice(0, -1), 'Remove letter colour')} aria-label="Remove the last letter colour">
            <Minus size={13} />
          </button>
        </div>
      </div>
      <p className="text-[11px] text-fg-3">The colours run across the letters in turn and repeat; spaces are skipped.</p>
    </div>
  );
}

/**
 * Fill: a flat colour, a gradient (two or three colours, across at an angle or out from the centre),
 * a repeating pattern (spec ED2-09/11, TYP-03), or for text, a colour for each letter.
 * `onChange` receives the content fields to patch; `gesture` names slider drags so they merge into one undo step.
 */
export function FillControls({
  fill,
  fillStyle,
  letterColors,
  allowLetters = false,
  swatches,
  onChange,
}: {
  fill: string;
  fillStyle?: FillStyle;
  /** Text only: each letter in its own colour. */
  letterColors?: string[];
  allowLetters?: boolean;
  swatches?: { name: string; hex: string }[];
  onChange: (patch: FillPatch, label: string, gesture?: string) => void;
}) {
  const kind = allowLetters && letterColors?.length ? 'letters' : (fillStyle?.kind ?? 'solid');
  // Switching away from letter colours drops them.
  const noLetters: FillPatch = allowLetters && letterColors ? { letterColors: undefined } : {};
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[52px_1fr] items-center gap-2">
        <span className="label">Fill</span>
        {/* Four choices share the row evenly so the panel never scrolls sideways. */}
        <div className={`seg w-full min-w-0 [&>button]:flex-1 ${allowLetters ? '[&>button]:px-1' : ''}`} role="group" aria-label="Fill type">
          <button aria-pressed={kind === 'solid'} onClick={() => kind !== 'solid' && onChange({ fillStyle: undefined, ...noLetters }, 'Solid fill')}>
            Solid
          </button>
          <button aria-pressed={kind === 'gradient'} onClick={() => kind !== 'gradient' && onChange({ fillStyle: { kind: 'gradient', to: '#2B59FF', angleDeg: 90 }, ...noLetters }, 'Gradient fill')}>
            Gradient
          </button>
          <button
            aria-pressed={kind === 'pattern'}
            onClick={() => kind !== 'pattern' && onChange({ fillStyle: { kind: 'pattern', pattern: 'stripes', color2: '#FFFFFF', scaleMm: 8, angleDeg: 45 }, ...noLetters }, 'Pattern fill')}
          >
            Pattern
          </button>
          {allowLetters ? (
            <button aria-pressed={kind === 'letters'} title="A colour for each letter" onClick={() => kind !== 'letters' && onChange({ fillStyle: undefined, letterColors: [fill.toUpperCase(), '#FFD100', '#2B59FF'] }, 'Letter colours')}>
              Letters
            </button>
          ) : null}
        </div>
      </div>
      {kind === 'letters' && letterColors ? <LetterColors colors={letterColors} swatches={swatches} onChange={(colors, label) => onChange({ letterColors: colors, fill: colors[0] }, label)} /> : null}
      {fillStyle?.kind === 'gradient' ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Gradient presets">
          {GRADIENTS.map((g) => (
            <button
              key={g.name}
              className="h-6 w-6 rounded-full border border-line shadow-sm transition-transform hover:scale-110"
              style={{ background: css(g.from, g.style) }}
              title={g.name}
              aria-label={`${g.name} gradient`}
              onClick={() => onChange({ fill: g.from, fillStyle: g.style }, `Gradient: ${g.name.toLowerCase()}`)}
            />
          ))}
        </div>
      ) : null}
      {kind === 'letters' ? null : <ColorField label={kind === 'gradient' ? 'From' : kind === 'pattern' ? 'Colour 1' : 'Colour'} value={fill} onChange={(v) => onChange({ fill: v }, 'Fill colour')} swatches={swatches} />}
      {fillStyle?.kind === 'gradient' ? (
        <>
          {fillStyle.via ? <ColorField label="Middle" value={fillStyle.via} onChange={(via) => onChange({ fillStyle: { ...fillStyle, via } }, 'Gradient middle colour')} swatches={swatches} /> : null}
          <ColorField label="To" value={fillStyle.to} onChange={(to) => onChange({ fillStyle: { ...fillStyle, to } }, 'Gradient colour')} swatches={swatches} />
          <div className="grid grid-cols-[52px_1fr] items-center gap-2">
            <span className="label">Shape</span>
            <div className="seg w-fit" role="group" aria-label="Gradient shape">
              <button aria-pressed={!fillStyle.radial} onClick={() => fillStyle.radial && onChange({ fillStyle: without(fillStyle, 'radial') }, 'Gradient across')}>
                Across
              </button>
              <button aria-pressed={!!fillStyle.radial} onClick={() => !fillStyle.radial && onChange({ fillStyle: { ...fillStyle, radial: true } }, 'Gradient from the centre')}>
                From centre
              </button>
            </div>
          </div>
          {fillStyle.radial ? null : (
            <RangeField label="Angle" value={fillStyle.angleDeg} min={-180} max={180} step={5} format={(v) => `${v}°`} onChange={(angleDeg) => onChange({ fillStyle: { ...fillStyle, angleDeg } }, 'Gradient angle', 'gradient-angle')} />
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={!!fillStyle.via}
              onChange={(e) => onChange({ fillStyle: e.target.checked ? { ...fillStyle, via: mixHex(fill, fillStyle.to) } : without(fillStyle, 'via') }, e.target.checked ? 'Gradient middle colour' : 'Remove middle colour')}
            />
            Middle colour
          </label>
        </>
      ) : null}
      {fillStyle?.kind === 'pattern' ? (
        <>
          <ColorField label="Colour 2" value={fillStyle.color2} onChange={(color2) => onChange({ fillStyle: { ...fillStyle, color2 } }, 'Pattern colour')} swatches={swatches} />
          <label className="grid grid-cols-[52px_1fr] items-center gap-2">
            <span className="label">Pattern</span>
            <select className="field" value={fillStyle.pattern} onChange={(e) => onChange({ fillStyle: { ...fillStyle, pattern: e.target.value as typeof fillStyle.pattern } }, 'Pattern')}>
              {PATTERNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <RangeField label="Scale" value={fillStyle.scaleMm} min={2} max={60} step={1} format={(v) => `${v} mm`} onChange={(scaleMm) => onChange({ fillStyle: { ...fillStyle, scaleMm } }, 'Pattern scale', 'pattern-scale')} />
          <RangeField label="Angle" value={fillStyle.angleDeg} min={-180} max={180} step={5} format={(v) => `${v}°`} onChange={(angleDeg) => onChange({ fillStyle: { ...fillStyle, angleDeg } }, 'Pattern angle', 'pattern-angle')} />
        </>
      ) : null}
    </div>
  );
}
