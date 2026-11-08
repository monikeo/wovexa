import { colorwayPresetsFor, getGarment, TEE_CLASSIC, type ColorwayPreset } from './garments';
import {
  defaultProduction,
  SCHEMA_VERSION,
  ZONE_IDS,
  type ArtworkLayer,
  type Colorway,
  type DesignDocument,
  type ImageContent,
  type ShapeContent,
  type TextContent,
  type ZoneDesign,
  type ZoneId,
} from './schema';

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Ink that reads on a given fabric colour: white on dark garments, near-black on light ones. */
export function contrastInk(fabricHex: string): string {
  const n = parseInt(fabricHex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return luminance < 0.18 ? '#FFFFFF' : '#111111';
}

export function createColorway(preset: { name: string; parts: Colorway['parts']; surfaces?: Colorway['surfaces'] }): Colorway {
  const colorway: Colorway = { id: newId(), name: preset.name, parts: { ...preset.parts } };
  if (preset.surfaces) colorway.surfaces = structuredClone(preset.surfaces);
  return colorway;
}

function emptyZone(zoneId: ZoneId): ZoneDesign {
  return { zoneId, printMethod: 'DTG', orderedLayerIds: [], layers: {} };
}

export function createDocument(opts: { projectId: string; title: string; modelId?: string; colorwayIndex?: number }): DesignDocument {
  const model = getGarment(opts.modelId ?? TEE_CLASSIC.id);
  const presets = colorwayPresetsFor(model);
  // The garment's three core presets, plus the requested one when it is not among them.
  const core: readonly ColorwayPreset[] = presets.slice(0, 3);
  const wanted = presets[opts.colorwayIndex ?? 0] ?? presets[0];
  const list = core.includes(wanted) ? core : [wanted, ...core];
  const colorways = list.map(createColorway);
  const active = colorways[list.indexOf(wanted)];
  const zones = Object.fromEntries(ZONE_IDS.map((z) => [z, emptyZone(z)])) as DesignDocument['zones'];
  // Each zone starts on a method the garment offers there (a dobok has no direct-to-garment).
  for (const z of ZONE_IDS) {
    const methods = model.zones[z]?.methods;
    if (methods?.length && !methods.includes(zones[z].printMethod)) zones[z].printMethod = methods[0];
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    projectId: opts.projectId,
    title: opts.title,
    revision: 0,
    garment: {
      modelId: model.id,
      assetVersion: model.assetVersion,
      sizeCode: model.defaultSize,
      fabricPresetId: model.fabricPresets[0].id,
    },
    activeColorwayId: active.id,
    colorways,
    zones,
    production: defaultProduction(() => newId()),
  };
}

const baseStyle = { opacity: 1, blendMode: 'normal', finish: 'flat_ink' } as const;

/** Text layer centred in the zone. Box size is a first estimate; the renderer fits the text to it. */
export function createTextLayer(zone: { printableWidthMm: number; printableHeightMm: number }, value = 'Your text'): ArtworkLayer {
  const content: TextContent = {
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
  };
  const widthMm = Math.min(zone.printableWidthMm * 0.7, 200);
  const heightMm = widthMm * 0.22;
  return {
    id: newId(),
    name: value.slice(0, 40) || 'Text',
    visible: true,
    locked: false,
    transform: {
      centerXmm: zone.printableWidthMm / 2,
      centerYmm: Math.min(zone.printableHeightMm / 3, zone.printableHeightMm / 2),
      widthMm,
      heightMm,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
    },
    style: { ...baseStyle },
    content,
  };
}

export const SHAPE_NAMES: Record<ShapeContent['shape'], string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  star: 'Star',
  polygon: 'Hexagon',
  heart: 'Heart',
  line: 'Line',
  path: 'Graphic',
};

/** A library graphic (SVG path in a 0–100 box) as an editable shape layer, centred in the zone. */
export function createGraphicLayer(
  zone: { printableWidthMm: number; printableHeightMm: number },
  graphic: { id: string; name: string; path: string; aspect: number },
  fill = '#111111',
): ArtworkLayer {
  const size = Math.min(zone.printableWidthMm, zone.printableHeightMm) * 0.45;
  const widthMm = graphic.aspect >= 1 ? size : size * graphic.aspect;
  return {
    id: newId(),
    name: graphic.name,
    visible: true,
    locked: false,
    transform: {
      centerXmm: zone.printableWidthMm / 2,
      centerYmm: zone.printableHeightMm / 2,
      widthMm,
      heightMm: widthMm / graphic.aspect,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
    },
    style: { ...baseStyle },
    content: { kind: 'shape', shape: 'path', fill, cornerRadiusMm: 0, path: graphic.path, graphicId: graphic.id },
  };
}

export function createShapeLayer(zone: { printableWidthMm: number; printableHeightMm: number }, shape: ShapeContent['shape']): ArtworkLayer {
  const size = Math.min(zone.printableWidthMm, zone.printableHeightMm) * 0.4;
  // A line is a bar: as long as most of the zone, as thick as a bold stroke, with round ends.
  const line = shape === 'line';
  const content: ShapeContent = { kind: 'shape', shape, fill: '#2B59FF', cornerRadiusMm: line ? 2 : 0 };
  if (shape === 'star') Object.assign(content, { points: 5, innerRatio: 0.45 });
  if (shape === 'polygon') content.points = 6;
  return {
    id: newId(),
    name: SHAPE_NAMES[shape],
    visible: true,
    locked: false,
    transform: {
      centerXmm: zone.printableWidthMm / 2,
      centerYmm: zone.printableHeightMm / 2,
      widthMm: line ? Math.min(zone.printableWidthMm * 0.7, 240) : size,
      heightMm: line ? 4 : shape === 'heart' ? size * 0.9 : size,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
    },
    style: { ...baseStyle },
    content,
  };
}

/** Image layer fitted inside 60% of the zone, preserving the source aspect ratio. */
export function createImageLayer(
  zone: { printableWidthMm: number; printableHeightMm: number },
  asset: { id: string; width: number; height: number; mime: string; name: string },
): ArtworkLayer {
  const maxW = zone.printableWidthMm * 0.6;
  const maxH = zone.printableHeightMm * 0.6;
  const aspect = asset.width / asset.height;
  let widthMm = maxW;
  let heightMm = widthMm / aspect;
  if (heightMm > maxH) {
    heightMm = maxH;
    widthMm = heightMm * aspect;
  }
  const content: ImageContent = {
    kind: 'image',
    assetId: asset.id,
    naturalWidthPx: asset.width,
    naturalHeightPx: asset.height,
    mime: asset.mime,
  };
  return {
    id: newId(),
    name: asset.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'Image',
    visible: true,
    locked: false,
    transform: {
      centerXmm: zone.printableWidthMm / 2,
      centerYmm: Math.max(heightMm / 2 + 10, zone.printableHeightMm * 0.35),
      widthMm,
      heightMm,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
    },
    style: { ...baseStyle },
    content,
  };
}
