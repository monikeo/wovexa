/**
 * Built-in starter templates (spec BRD-03, ACC-03 first-run). Text and shapes only, so they
 * work offline with no uploaded assets. Text boxes carry approximate heights; the app fits
 * each box to its font's real proportions when the template is used.
 */
import { createDocument, newId } from './factory';
import { getGarment, TEE_CLASSIC, type GarmentModel } from './garments';
import type { ArtworkLayer, DesignDocument, ShapeContent, TextContent, ZoneId } from './schema';

type TextOpts = Partial<Omit<TextContent, 'kind' | 'value'>> & {
  x: number;
  y: number;
  width: number;
  aspect?: number;
  rotation?: number;
  name?: string;
};

function text(value: string, o: TextOpts): ArtworkLayer {
  const { x, y, width, aspect = 4, rotation = 0, name, ...content } = o;
  return {
    id: newId(),
    name: name ?? value.replace(/\n/g, ' ').slice(0, 40),
    visible: true,
    locked: false,
    transform: { centerXmm: x, centerYmm: y, widthMm: width, heightMm: width / aspect, rotationDeg: rotation, flipX: false, flipY: false },
    style: { opacity: 1, blendMode: 'normal', finish: 'flat_ink' },
    content: {
      kind: 'text',
      value,
      fontFamily: 'Archivo',
      fontWeight: 700,
      italic: false,
      fill: '#111111',
      align: 'center',
      letterSpacingEm: 0,
      lineHeight: 1.1,
      curveDeg: 0,
      ...content,
    },
  };
}

function shape(kind: ShapeContent['shape'], o: { x: number; y: number; w: number; h: number; fill: string; radius?: number; name?: string }): ArtworkLayer {
  return {
    id: newId(),
    name: o.name ?? (kind === 'rect' ? 'Rectangle' : kind === 'ellipse' ? 'Ellipse' : 'Triangle'),
    visible: true,
    locked: false,
    transform: { centerXmm: o.x, centerYmm: o.y, widthMm: o.w, heightMm: o.h, rotationDeg: 0, flipX: false, flipY: false },
    style: { opacity: 1, blendMode: 'normal', finish: 'flat_ink' },
    content: { kind: 'shape', shape: kind, fill: o.fill, cornerRadiusMm: o.radius ?? 0 },
  };
}

function grouped(layers: ArtworkLayer[]): ArtworkLayer[] {
  const groupId = `g-${layers[0].id}`;
  return layers.map((l) => ({ ...l, groupId }));
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  /** Index into COLORWAY_PRESETS for the starting colourway. */
  colorwayIndex: number;
  build: (model: GarmentModel) => Partial<Record<ZoneId, ArtworkLayer[]>>;
}

export const BUILT_IN_TEMPLATES: TemplateDef[] = [
  {
    id: 'left-chest-mark',
    name: 'Left chest mark',
    description: 'A small wordmark on the wearer’s left chest. The classic brand tee.',
    colorwayIndex: 0,
    build: (m) => {
      const W = m.zones.front.printableWidthMm;
      return {
        front: grouped([
          text('STUDIO', { x: W * 0.74, y: 48, width: 76, fontWeight: 800, letterSpacingEm: 0.12, aspect: 5.2 }),
          shape('rect', { x: W * 0.74, y: 64, w: 76, h: 2.5, fill: '#111111', name: 'Underline' }),
        ]),
      };
    },
  },
  {
    id: 'arched-college',
    name: 'Arched college',
    description: 'An arched wordmark over a founding year, set in heavy capitals.',
    colorwayIndex: 2,
    build: (m) => {
      const W = m.zones.front.printableWidthMm;
      return {
        front: [
          text('WOVEXA', { x: W / 2, y: 92, width: 250, fontWeight: 900, curveDeg: 50, letterSpacingEm: 0.04, fill: '#1C2740', aspect: 2.6 }),
          text('EST. 2026', { x: W / 2, y: 168, width: 120, fontWeight: 700, letterSpacingEm: 0.3, fill: '#1C2740', aspect: 7 }),
        ],
      };
    },
  },
  {
    id: 'big-back-print',
    name: 'Big back print',
    description: 'A sunrise and slogan across the back, with a small hit on the chest.',
    colorwayIndex: 1,
    build: (m) => {
      const W = m.zones.back.printableWidthMm;
      return {
        front: [text('26', { x: m.zones.front.printableWidthMm * 0.74, y: 50, width: 36, fontFamily: 'Anton', fontWeight: 400, fill: '#F2A541', aspect: 0.9 })],
        back: [
          shape('ellipse', { x: W / 2, y: 150, w: 210, h: 210, fill: '#F2A541', name: 'Sun' }),
          shape('rect', { x: W / 2, y: 196, w: 226, h: 9, fill: '#16161A', name: 'Stripe 1' }),
          shape('rect', { x: W / 2, y: 218, w: 226, h: 7, fill: '#16161A', name: 'Stripe 2' }),
          shape('rect', { x: W / 2, y: 236, w: 226, h: 5, fill: '#16161A', name: 'Stripe 3' }),
          text('GOLDEN HOUR', { x: W / 2, y: 300, width: 270, fontFamily: 'Bebas Neue', fontWeight: 400, letterSpacingEm: 0.04, fill: '#FFFFFF', aspect: 5 }),
          text('EST. 2026', { x: W / 2, y: 342, width: 96, fontWeight: 700, letterSpacingEm: 0.3, fill: '#F2A541', aspect: 7 }),
        ],
      };
    },
  },
  {
    id: 'team-jersey',
    name: 'Team jersey',
    description: 'Club name on the front; player name and number on the back. Edit them per player.',
    colorwayIndex: 3,
    build: (m) => {
      const F = m.zones.front.printableWidthMm;
      const B = m.zones.back.printableWidthMm;
      return {
        front: [
          text('CLUB', { x: F / 2, y: 60, width: 190, fontFamily: 'Oswald', fontWeight: 700, letterSpacingEm: 0.08, fill: '#FFFFFF', aspect: 3 }),
          text('10', { x: F / 2, y: 150, width: 64, fontFamily: 'Anton', fontWeight: 400, fill: '#FFFFFF', aspect: 0.85 }),
        ],
        back: grouped([
          text('PLAYER', { x: B / 2, y: 50, width: 210, fontFamily: 'Oswald', fontWeight: 700, letterSpacingEm: 0.1, curveDeg: 18, fill: '#FFFFFF', aspect: 4.2, name: 'Player name' }),
          text('10', { x: B / 2, y: 190, width: 170, fontFamily: 'Anton', fontWeight: 400, fill: '#FFFFFF', aspect: 0.85, name: 'Number' }),
        ]),
        left_sleeve: [text('C', { x: 45, y: 45, width: 34, fontFamily: 'Oswald', fontWeight: 700, fill: '#FFFFFF', aspect: 0.6, name: 'Captain mark' })],
      };
    },
  },
  {
    id: 'sleeve-hit',
    name: 'Chest and sleeve',
    description: 'A centred chest wordmark with a matching mark on the left sleeve.',
    colorwayIndex: 0,
    build: (m) => ({
      front: [text('WOVEXA', { x: m.zones.front.printableWidthMm / 2, y: 70, width: 200, fontWeight: 800, letterSpacingEm: 0.18, aspect: 7 })],
      left_sleeve: [text('W', { x: 45, y: 45, width: 40, fontWeight: 900, aspect: 1.1 })],
    }),
  },
  {
    id: 'retro-sunset',
    name: 'Retro sunset',
    description: 'A striped sun and a bold title, the look of a 70s souvenir tee.',
    colorwayIndex: 0,
    build: (m) => {
      const W = m.zones.front.printableWidthMm;
      return {
        front: [
          shape('ellipse', { x: W / 2, y: 130, w: 190, h: 190, fill: '#F2A541', name: 'Sun' }),
          shape('rect', { x: W / 2, y: 168, w: 206, h: 8, fill: '#F4F4F1', name: 'Stripe 1' }),
          shape('rect', { x: W / 2, y: 188, w: 206, h: 7, fill: '#F4F4F1', name: 'Stripe 2' }),
          shape('rect', { x: W / 2, y: 206, w: 206, h: 5, fill: '#F4F4F1', name: 'Stripe 3' }),
          text('SUNSET CLUB', { x: W / 2, y: 265, width: 250, fontFamily: 'Bebas Neue', fontWeight: 400, letterSpacingEm: 0.03, fill: '#E8336D', aspect: 5 }),
        ],
      };
    },
  },
];

export function getTemplate(id: string) {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}

/** A new project document from a built-in template. */
export function instantiateTemplate(def: TemplateDef, projectId: string, title = def.name): DesignDocument {
  const doc = createDocument({ projectId, title, colorwayIndex: def.colorwayIndex, modelId: TEE_CLASSIC.id });
  const zones = def.build(getGarment(doc.garment.modelId));
  for (const [zoneId, layers] of Object.entries(zones) as [ZoneId, ArtworkLayer[]][]) {
    const zone = doc.zones[zoneId];
    for (const layer of layers) {
      zone.layers[layer.id] = layer;
      zone.orderedLayerIds.push(layer.id);
    }
  }
  return doc;
}

/** A new project from a saved document (user template or version), with fresh identity. */
export function documentFromSnapshot(snapshot: DesignDocument, projectId: string, title: string): DesignDocument {
  const copy = structuredClone(snapshot);
  return { ...copy, id: newId(), projectId, title, revision: 0 };
}
