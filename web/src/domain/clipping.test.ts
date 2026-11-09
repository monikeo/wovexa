import { describe, expect, it } from 'vitest';
import { clipBases, clipRuns } from './clipping';
import { updateLayer } from './commands';
import { createDocument } from './factory';
import type { ArtworkLayer } from './schema';

const stack = (layers: [string, boolean][]) => ({
  orderedLayerIds: layers.map(([id]) => id),
  layers: Object.fromEntries(layers.map(([id, clip]) => [id, clip ? { clip: true } : {}])),
});

describe('clipping to the layer below', () => {
  it('clips a layer to the one under it', () => {
    // Bottom first: lettering, then a photo clipped into it, then a tagline on top.
    const s = stack([
      ['text', false],
      ['photo', true],
      ['tagline', false],
    ]);
    expect(clipRuns(s)).toEqual([
      { id: 'text', clipped: ['photo'] },
      { id: 'tagline', clipped: [] },
    ]);
    expect(clipBases(s)).toEqual({ photo: 'text' });
  });

  it('clips stacked clipped layers to the first unclipped layer below them', () => {
    const s = stack([
      ['shape', false],
      ['texture', true],
      ['shading', true],
    ]);
    expect(clipBases(s)).toEqual({ texture: 'shape', shading: 'shape' });
  });

  it('draws a clipped layer with nothing under it as usual', () => {
    const s = stack([
      ['photo', true],
      ['text', false],
    ]);
    expect(clipBases(s)).toEqual({});
    expect(clipRuns(s).map((r) => r.id)).toEqual(['photo', 'text']);
  });

  it('is set and released by the layer command, leaving no trace when released', () => {
    const doc = createDocument({ projectId: 'p', title: 'Clip' });
    const layer: ArtworkLayer = {
      id: 'photo',
      name: 'Photo',
      visible: true,
      locked: false,
      transform: { centerXmm: 100, centerYmm: 100, widthMm: 80, heightMm: 60, rotationDeg: 0, flipX: false, flipY: false },
      style: { opacity: 1, blendMode: 'normal', finish: 'flat_ink' },
      content: { kind: 'shape', shape: 'rect', fill: '#FF0000', cornerRadiusMm: 0 },
    };
    doc.zones.front.layers.photo = layer;
    doc.zones.front.orderedLayerIds.push('photo');
    updateLayer('front', 'photo', { clip: true }).recipe(doc);
    expect(doc.zones.front.layers.photo.clip).toBe(true);
    updateLayer('front', 'photo', { name: 'Renamed' }).recipe(doc);
    expect(doc.zones.front.layers.photo.clip).toBe(true);
    updateLayer('front', 'photo', { clip: false }).recipe(doc);
    expect('clip' in doc.zones.front.layers.photo).toBe(false);
  });
});
