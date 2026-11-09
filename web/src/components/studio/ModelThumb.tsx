'use client';
/**
 * A 3D library model shown in 2D: its front or back view (a flat drawn from the model itself, or
 * the one saved beside it in the folder), or its style's glyph while that is drawn.
 */
import { getGarment } from '@/domain/garments';
import type { LibraryModel } from '@/domain/model-library';
import { useModelView, type ViewSide } from '@/lib/model-views';
import { GarmentGlyph } from './GarmentGlyph';

export function ModelThumb({ model, side = 'front', className }: { model: LibraryModel; side?: ViewSide; className?: string }) {
  const url = useModelView(model, side);
  // eslint-disable-next-line @next/next/no-img-element -- a local or generated picture, already the right size
  return url ? <img src={url} alt="" className={`object-contain ${className ?? ''}`} draggable={false} /> : <GarmentGlyph model={getGarment(model.styleId)} className={className} />;
}
