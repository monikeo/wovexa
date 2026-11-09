'use client';
/**
 * A garment's technical flat as line art, generated from the same pattern data as the 2D sketch
 * and the 3D model, so pickers show exactly the silhouette you will design on.
 */
import { useMemo } from 'react';
import { sketchBounds, sketchForZone } from '@/components/studio/editor2d/flat-sketch';
import type { GarmentModel } from '@/domain/garments';
import type { Colorway } from '@/domain/schema';

const toPath = (pts: [number, number][], close = true) => `${pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')}${close ? ' Z' : ''}`;

/** Line art, or with `colors` the garment filled in a colourway's colours (body, sleeves, rib, pants, belt). */
export function GarmentGlyph({ model, className, fill = 'var(--surface-panel)', accent, colors }: { model: GarmentModel; className?: string; fill?: string; accent?: string; colors?: Colorway['parts'] }) {
  const art = useMemo(() => {
    const front = model.zones.front!;
    const sketch = sketchForZone(model, front, 1);
    const b = sketchBounds(sketch);
    const pad = 14;
    return {
      viewBox: `${(b.minX - pad).toFixed(1)} ${(b.minY - pad).toFixed(1)} ${(b.maxX - b.minX + pad * 2).toFixed(1)} ${(b.maxY - b.minY + pad * 2).toFixed(1)}`,
      shapes: [...sketch.shapes, ...(sketch.top ?? [])].filter((s) => s.part !== 'stitching').map((s) => ({ d: toPath(s.points), part: s.part })),
      bands: sketch.bands.map((band) => ({ d: toPath(band.points, false), width: band.width })),
      seams: [...sketch.seams, ...(sketch.lines ?? [])].map((seam) => toPath(seam, false)),
      area: { x: 0, y: 0, w: front.printableWidthMm, h: front.printableHeightMm },
    };
  }, [model]);
  const fillOf = (part: string) => {
    if (!colors) return part === 'belt' ? 'currentColor' : fill;
    if (part === 'sleeves' || part === 'collar') return colors[part];
    if (part === 'pants') return colors.pants ?? colors.body;
    if (part === 'belt') return colors.belt ?? 'currentColor';
    return colors.body;
  };
  return (
    <svg viewBox={art.viewBox} className={className} aria-hidden fill="none" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round">
      {art.shapes.map((s, i) => (
        <path key={i} d={s.d} fill={fillOf(s.part)} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      ))}
      {/* Rib and binding bands, in the collar colour, under their outline. */}
      {colors ? art.bands.map((b, i) => <path key={`c${i}`} d={b.d} stroke={colors.collar} strokeWidth={b.width} strokeLinecap="butt" />) : null}
      {art.bands.map((b, i) => (
        <path key={`b${i}`} d={b.d} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      ))}
      {art.seams.map((d, i) => (
        <path key={`s${i}`} d={d} strokeWidth={0.8} strokeDasharray="3 2.5" opacity={0.55} vectorEffect="non-scaling-stroke" />
      ))}
      {accent ? <rect x={art.area.x} y={art.area.y} width={art.area.w} height={art.area.h} stroke={accent} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}
