/**
 * Built-in starter templates (spec BRD-03, ACC-03 first-run), for several garment styles.
 * Text, shapes and built-in graphics only, so they work offline with no uploaded assets. Text
 * boxes carry approximate heights; the app fits each box to its font when the template is used.
 */
import { createDocument, newId } from './factory';
import { DOBOK, getGarment, HOODIE, JERSEY, POLO, TEE_CLASSIC, TEE_LONG, type GarmentModel } from './garments';
import { getGraphic } from './graphics';
import type { ArtworkLayer, DesignDocument, ShapeContent, TextContent, ZoneId } from './schema';

type TextOpts = Partial<Omit<TextContent, 'kind' | 'value'>> & {
  x: number;
  y: number;
  width: number;
  aspect?: number;
  rotation?: number;
  name?: string;
  finish?: ArtworkLayer['style']['finish'];
};

function text(value: string, o: TextOpts): ArtworkLayer {
  const { x, y, width, aspect = 4, rotation = 0, name, finish = 'flat_ink', ...content } = o;
  return {
    id: newId(),
    name: name ?? value.replace(/\n/g, ' ').slice(0, 40),
    visible: true,
    locked: false,
    transform: { centerXmm: x, centerYmm: y, widthMm: width, heightMm: width / aspect, rotationDeg: rotation, flipX: false, flipY: false },
    style: { opacity: 1, blendMode: 'normal', finish },
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

function shape(kind: ShapeContent['shape'], o: { x: number; y: number; w: number; h: number; fill: string; radius?: number; name?: string; stroke?: string; strokeMm?: number; graphic?: string }): ArtworkLayer {
  const g = o.graphic ? getGraphic(o.graphic) : undefined;
  return {
    id: newId(),
    name: o.name ?? g?.name ?? (kind === 'rect' ? 'Rectangle' : kind === 'ellipse' ? 'Ellipse' : 'Shape'),
    visible: true,
    locked: false,
    transform: { centerXmm: o.x, centerYmm: o.y, widthMm: o.w, heightMm: o.h, rotationDeg: 0, flipX: false, flipY: false },
    style: { opacity: 1, blendMode: 'normal', finish: 'flat_ink' },
    content: {
      kind: 'shape',
      shape: g ? 'path' : kind,
      fill: o.fill,
      cornerRadiusMm: o.radius ?? 0,
      ...(o.stroke ? { strokeColor: o.stroke, strokeWidthMm: o.strokeMm ?? 1.5 } : {}),
      ...(g ? { path: g.path, graphicId: g.id } : {}),
    },
  };
}

function grouped(layers: ArtworkLayer[]): ArtworkLayer[] {
  const groupId = `g-${layers[0].id}`;
  return layers.map((l) => ({ ...l, groupId }));
}

/** Print-area width of a zone the template's garment is known to have. */
const wOf = (m: GarmentModel, zone: ZoneId) => m.zones[zone]!.printableWidthMm;
const hOf = (m: GarmentModel, zone: ZoneId) => m.zones[zone]!.printableHeightMm;

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  /** Garment style; the classic tee when absent. */
  modelId?: string;
  /** Index into the garment's colourway presets for the starting colourway. */
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
      const W = wOf(m, 'front');
      return {
        front: grouped([
          text('STUDIO', { x: W * 0.74, y: 48, width: 76, fontWeight: 800, letterSpacingEm: 0.12, aspect: 5.2 }),
          shape('rect', { x: W * 0.74, y: 64, w: 76, h: 2.5, fill: '#111111', name: 'Underline' }),
        ]),
      };
    },
  },
  {
    id: 'dojang-uniform',
    name: 'Dojang uniform',
    description: 'Taekwondo dobok: club name in Hangul and English across the back, an emblem on the chest, text down the leg.',
    modelId: DOBOK.id,
    colorwayIndex: 0,
    build: (m) => {
      const F = wOf(m, 'front');
      const B = wOf(m, 'back');
      const L = wOf(m, 'left_leg');
      return {
        back: grouped([
          text('태권도', { x: B / 2, y: 70, width: 250, fontFamily: 'Black Han Sans', fontWeight: 400, fill: '#16161A', aspect: 2.9, name: 'Taekwondo (Hangul)', finish: 'embroidery' }),
          text('PHNOM PENH TAEKWONDO', { x: B / 2, y: 150, width: 300, fontFamily: 'Oswald', fontWeight: 700, letterSpacingEm: 0.08, fill: '#16161A', aspect: 12, name: 'Club name', finish: 'embroidery' }),
        ]),
        front: [
          ...grouped([
            shape('ellipse', { x: F * 0.76, y: 44, w: 70, h: 70, fill: '#F7F7F4', stroke: '#16161A', strokeMm: 2.5, name: 'Emblem' }),
            text('TKD', { x: F * 0.76, y: 44, width: 44, fontFamily: 'Oswald', fontWeight: 700, fill: '#B3122E', aspect: 2.4, name: 'Emblem letters', finish: 'embroidery' }),
          ]),
          text('태권도', { x: F * 0.24, y: 40, width: 70, fontFamily: 'Black Han Sans', fontWeight: 400, fill: '#16161A', aspect: 2.9, name: 'Chest Hangul', finish: 'embroidery' }),
        ],
        left_leg: [text('TAEKWONDO', { x: L / 2, y: 220, width: 380, fontFamily: 'Oswald', fontWeight: 700, letterSpacingEm: 0.14, fill: '#16161A', aspect: 7.6, rotation: 90, name: 'Leg text' })],
      };
    },
  },
  {
    id: 'club-hoodie',
    name: 'Club hoodie',
    description: 'Arched club name on the chest, a year on the back and a word running down the sleeve.',
    modelId: HOODIE.id,
    colorwayIndex: 3,
    build: (m) => {
      const F = wOf(m, 'front');
      const B = wOf(m, 'back');
      return {
        front: [text('NORTHSIDE', { x: F / 2, y: 80, width: 250, fontFamily: 'Graduate', fontWeight: 400, curveDeg: 34, letterSpacingEm: 0.06, fill: '#F4F4F1', aspect: 3.4 })],
        back: [text('EST. 2026', { x: B / 2, y: 40, width: 120, fontFamily: 'Oswald', fontWeight: 600, letterSpacingEm: 0.3, fill: '#F4F4F1', aspect: 8 })],
        left_sleeve: [text('NORTHSIDE', { x: wOf(m, 'left_sleeve') / 2, y: hOf(m, 'left_sleeve') / 2, width: 300, fontFamily: 'Oswald', fontWeight: 700, letterSpacingEm: 0.2, fill: '#F4F4F1', aspect: 7, rotation: 90 })],
      };
    },
  },
  {
    id: 'polo-crest',
    name: 'Polo crest',
    description: 'An embroidered shield and club name on the left chest.',
    modelId: POLO.id,
    colorwayIndex: 3,
    build: (m) => {
      const F = wOf(m, 'front');
      return {
        front: grouped([
          shape('path', { x: F * 0.74, y: 46, w: 54, h: 60, fill: '#F2C12E', graphic: 'shield', name: 'Shield' }),
          text('ROYAL', { x: F * 0.74, y: 42, width: 36, fontFamily: 'Oswald', fontWeight: 700, fill: '#1C2740', aspect: 3, finish: 'embroidery' }),
          text('ROYAL CLUB', { x: F * 0.74, y: 92, width: 72, fontFamily: 'Oswald', fontWeight: 600, letterSpacingEm: 0.14, fill: '#F2C12E', aspect: 7, finish: 'embroidery' }),
        ]),
      };
    },
  },
  {
    id: 'jersey-name-number',
    name: 'Jersey name and number',
    description: 'Team crest on the chest, player name and a big number on the back of a mesh jersey.',
    modelId: JERSEY.id,
    colorwayIndex: 7,
    build: (m) => {
      const F = wOf(m, 'front');
      const B = wOf(m, 'back');
      return {
        front: [
          text('UNITED', { x: F / 2, y: 60, width: 210, fontFamily: 'Teko', fontWeight: 700, letterSpacingEm: 0.04, fill: '#FFFFFF', aspect: 3.6 }),
          text('9', { x: F / 2, y: 160, width: 70, fontFamily: 'Teko', fontWeight: 700, fill: '#FFFFFF', aspect: 0.62 }),
        ],
        back: grouped([
          text('SOKHA', { x: B / 2, y: 50, width: 190, fontFamily: 'Teko', fontWeight: 600, letterSpacingEm: 0.12, curveDeg: 14, fill: '#FFFFFF', aspect: 4.4, name: 'Player name' }),
          text('9', { x: B / 2, y: 200, width: 150, fontFamily: 'Teko', fontWeight: 700, fill: '#FFFFFF', aspect: 0.62, name: 'Number', strokeColor: '#16161A', strokeWidthMm: 2 }),
        ]),
      };
    },
  },
  {
    id: 'long-sleeve-script',
    name: 'Long-sleeve script',
    description: 'A script word on the chest and a line of type running down the left sleeve.',
    modelId: TEE_LONG.id,
    colorwayIndex: 1,
    build: (m) => ({
      front: [text('Saturday', { x: wOf(m, 'front') / 2, y: 80, width: 220, fontFamily: 'Yellowtail', fontWeight: 400, fill: '#F4F4F1', aspect: 3.4 })],
      left_sleeve: [text('SATURDAY CLUB', { x: wOf(m, 'left_sleeve') / 2, y: hOf(m, 'left_sleeve') / 2, width: 320, fontFamily: 'Oswald', fontWeight: 600, letterSpacingEm: 0.22, fill: '#F4F4F1', aspect: 9, rotation: 90 })],
    }),
  },
  {
    id: 'arched-college',
    name: 'Arched college',
    description: 'An arched wordmark over a founding year, set in heavy capitals.',
    colorwayIndex: 2,
    build: (m) => {
      const W = wOf(m, 'front');
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
      const W = wOf(m, 'back');
      return {
        front: [text('26', { x: wOf(m, 'front') * 0.74, y: 50, width: 36, fontFamily: 'Anton', fontWeight: 400, fill: '#F2A541', aspect: 0.9 })],
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
    name: 'Team tee',
    description: 'Club name on the front; player name and number on the back. Edit them per player.',
    colorwayIndex: 3,
    build: (m) => {
      const F = wOf(m, 'front');
      const B = wOf(m, 'back');
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
      front: [text('WOVEXA', { x: wOf(m, 'front') / 2, y: 70, width: 200, fontWeight: 800, letterSpacingEm: 0.18, aspect: 7 })],
      left_sleeve: [text('W', { x: 45, y: 45, width: 40, fontWeight: 900, aspect: 1.1 })],
    }),
  },
  {
    id: 'retro-sunset',
    name: 'Retro sunset',
    description: 'A striped sun and a bold title, the look of a 70s souvenir tee.',
    colorwayIndex: 0,
    build: (m) => {
      const W = wOf(m, 'front');
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
  const doc = createDocument({ projectId, title, colorwayIndex: def.colorwayIndex, modelId: def.modelId ?? TEE_CLASSIC.id });
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
