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

/**
 * Fill: a flat colour, a two-colour gradient at an angle, or a repeating pattern (spec ED2-09/11, TYP-03).
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
      <ColorField label={kind === 'gradient' ? 'From' : kind === 'pattern' ? 'Colour 1' : 'Colour'} value={fill} onChange={(v) => onChange({ fill: v }, 'Fill colour')} swatches={swatches} />
      {fillStyle?.kind === 'gradient' ? (
        <>
          <ColorField label="To" value={fillStyle.to} onChange={(to) => onChange({ fillStyle: { ...fillStyle, to } }, 'Gradient colour')} swatches={swatches} />
          <RangeField label="Angle" value={fillStyle.angleDeg} min={-180} max={180} step={5} format={(v) => `${v}°`} onChange={(angleDeg) => onChange({ fillStyle: { ...fillStyle, angleDeg } }, 'Gradient angle', 'gradient-angle')} />
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
