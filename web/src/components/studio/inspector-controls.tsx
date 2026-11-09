'use client';
/** Small inspector controls shared by text, shape, image and appearance sections. */
import { useId } from 'react';
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

/**
 * Fill: a flat colour, a gradient (two or three colours, across at an angle or out from the centre)
 * or a repeating pattern (spec ED2-09/11, TYP-03).
 * `onChange` receives the content fields to patch; `gesture` names slider drags so they merge into one undo step.
 */
export function FillControls({
  fill,
  fillStyle,
  swatches,
  onChange,
}: {
  fill: string;
  fillStyle?: FillStyle;
  swatches?: { name: string; hex: string }[];
  onChange: (patch: { fill?: string; fillStyle?: FillStyle | undefined }, label: string, gesture?: string) => void;
}) {
  const kind = fillStyle?.kind ?? 'solid';
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[52px_1fr] items-center gap-2">
        <span className="label">Fill</span>
        <div className="seg w-fit" role="group" aria-label="Fill type">
          <button aria-pressed={kind === 'solid'} onClick={() => onChange({ fillStyle: undefined }, 'Solid fill')}>
            Solid
          </button>
          <button aria-pressed={kind === 'gradient'} onClick={() => kind !== 'gradient' && onChange({ fillStyle: { kind: 'gradient', to: '#2B59FF', angleDeg: 90 } }, 'Gradient fill')}>
            Gradient
          </button>
          <button
            aria-pressed={kind === 'pattern'}
            onClick={() => kind !== 'pattern' && onChange({ fillStyle: { kind: 'pattern', pattern: 'stripes', color2: '#FFFFFF', scaleMm: 8, angleDeg: 45 } }, 'Pattern fill')}
          >
            Pattern
          </button>
        </div>
      </div>
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
      <ColorField label={kind === 'gradient' ? 'From' : kind === 'pattern' ? 'Colour 1' : 'Colour'} value={fill} onChange={(v) => onChange({ fill: v }, 'Fill colour')} swatches={swatches} />
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
