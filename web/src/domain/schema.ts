/**
 * Canonical WOVEXA design document (spec §26).
 * This JSON is the single source of truth. Fabric (2D) and Three (3D) are adapters that
 * read it and emit commands; neither stores design state of its own.
 * No React or engine imports belong in src/domain.
 *
 * Version history (spec §26.4: every persisted document carries schemaVersion):
 *   1  First release: zones, layers, colourways.
 *   2  Curved text, layer groups, original-asset links, brand kit link, production data
 *      (bill of materials, construction notes, factory contact, sample QA checklist).
 *      Optional, additive fields within version 2: studio scene and camera bookmarks, text
 *      wave/shadow, gradient and pattern fills, star/polygon/heart/line shapes, image
 *      adjustments and repeat patterns, distress, uploaded fonts. Documents without them
 *      render exactly as before.
 *   3  Leg print zones (uniform pants), pants and belt colours, all-over fabric prints per
 *      garment part, graphic (path) shapes and image masks. Upgrading adds empty leg zones.
 *   4  Projected layers: artwork placed straight onto the 3D garment that runs across seams
 *      (over the shoulder, round the side seams), printed by sublimation or cut-and-sew.
 *      Upgrading adds an empty list. Optional, additive fields within version 4: design areas
 *      (print areas the person places anywhere on the 3D garment) and 3D shapes from the app's
 *      model library.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 4 as const;

export const ZONE_IDS = ['front', 'back', 'left_sleeve', 'right_sleeve', 'left_leg', 'right_leg'] as const;
export const zoneIdSchema = z.enum(ZONE_IDS);
export type ZoneId = z.infer<typeof zoneIdSchema>;
/** Zones added in format 3. While empty they are left out of content hashes, so upgrading never voids an approval. */
export const V3_ZONES: readonly ZoneId[] = ['left_leg', 'right_leg'];

export const PRINT_METHODS = ['DTG', 'DTF', 'SCREEN_PRINT', 'EMBROIDERY', 'PUFF_PRINT', 'SUBLIMATION', 'HEAT_TRANSFER'] as const;
export const printMethodSchema = z.enum(PRINT_METHODS);
export type PrintMethod = z.infer<typeof printMethodSchema>;

export const GARMENT_PARTS = ['body', 'sleeves', 'collar', 'stitching', 'pants', 'belt'] as const;
export const garmentPartSchema = z.enum(GARMENT_PARTS);
export type GarmentPart = z.infer<typeof garmentPartSchema>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #RRGGBB colour');
const id = z.string().min(1).max(64);
const finite = z.number().finite();

/** Physical transform. Coordinates are millimetres from the top-left of the zone's printable area. */
export const transformSchema = z.object({
  centerXmm: finite.min(-2000).max(2000),
  centerYmm: finite.min(-2000).max(2000),
  widthMm: finite.min(0.5).max(3000),
  heightMm: finite.min(0.5).max(3000),
  rotationDeg: finite.min(-360).max(360),
  flipX: z.boolean(),
  flipY: z.boolean(),
});
export type LayerTransform = z.infer<typeof transformSchema>;

export const finishSchema = z.enum(['flat_ink', 'puff', 'embroidery', 'metallic', 'distressed', 'cracked']);

export const layerStyleSchema = z.object({
  opacity: finite.min(0).max(1),
  blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay']),
  finish: finishSchema,
  /**
   * Worn-print effect (spec TYP-08): a seeded abrasion mask at a physical scale, so it regenerates
   * identically in the editor, on the garment and in print files. It removes ink, so it prints.
   */
  distress: z.object({ amount: finite.min(0).max(1), scaleMm: finite.min(0.5).max(50), seed: z.number().int().min(0).max(2 ** 31) }).optional(),
  /** A drop shadow, or with no offset a glow, behind the whole layer. Text keeps its own in its content. It prints. */
  shadow: z.object({ color: hex, offsetXmm: finite.min(-50).max(50), offsetYmm: finite.min(-50).max(50), blurMm: finite.min(0).max(30) }).optional(),
  /** A band of ink around the layer's silhouette: the sticker or die-cut border, or a second outline round text. */
  outline: z.object({ color: hex, widthMm: finite.min(0.2).max(30) }).optional(),
  /**
   * Printed as a halftone screen: dots, squares or lines on a grid at an angle, each sized by the
   * artwork's tone (photos) or by its opacity (fades). One ink colour, or each dot in its own colour.
   */
  halftone: z
    .object({
      cellMm: finite.min(0.4).max(20),
      angleDeg: finite.min(-90).max(90),
      shape: z.enum(['dot', 'square', 'line']),
      by: z.enum(['tone', 'fade']),
      color: hex.optional(),
    })
    .optional(),
});
export type LayerStyle = z.infer<typeof layerStyleSchema>;
export type LayerShadow = NonNullable<LayerStyle['shadow']>;
export type LayerHalftone = NonNullable<LayerStyle['halftone']>;

export const PATTERNS = ['stripes', 'dots', 'checks', 'grid', 'zigzag', 'waves', 'diamonds', 'camo'] as const;

const gradientFill = z.object({
  kind: z.literal('gradient'),
  to: hex,
  angleDeg: finite.min(-360).max(360),
  /** A third colour halfway: sunsets, chrome, rainbows. */
  via: hex.optional(),
  /** From the centre outward instead of across (the angle is then unused). */
  radial: z.boolean().optional(),
});
const patternFill = z.object({
  kind: z.literal('pattern'),
  pattern: z.enum(PATTERNS),
  color2: hex,
  scaleMm: finite.min(1).max(400),
  angleDeg: finite.min(-360).max(360),
});

/** Beyond a flat colour: a linear gradient from `fill` to `to`, or a repeating pattern (spec ED2-11, TYP-05). */
export const fillStyleSchema = z.discriminatedUnion('kind', [gradientFill, patternFill]);
export type FillStyle = z.infer<typeof fillStyleSchema>;

/**
 * An all-over print on a garment part (sublimated or printed fabric): a gradient or pattern
 * over the part colour, or a tiled image. Absent means the solid part colour.
 */
/** Garment-dye looks generated on the fabric itself: tie-dyes, washes, heather, dip-dye, marble. */
export const FABRIC_EFFECTS = ['spiral', 'crumple', 'acid-wash', 'heather', 'dip-dye', 'marble'] as const;

export const surfaceSchema = z.discriminatedUnion('kind', [
  gradientFill,
  patternFill,
  z.object({
    kind: z.literal('image'),
    assetId: id,
    naturalWidthPx: z.number().int().positive().max(20000),
    naturalHeightPx: z.number().int().positive().max(20000),
    tileWidthMm: finite.min(10).max(2000),
    angleDeg: finite.min(-360).max(360),
  }),
  z.object({
    kind: z.literal('effect'),
    effect: z.enum(FABRIC_EFFECTS),
    color2: hex,
    color3: hex.optional(),
    /** Size of the dye's features: spiral twist, blotch size, dip height, marble veins. */
    scaleMm: finite.min(5).max(1200),
    /** How strongly the effect shows over the base colour, 0–1. */
    intensity: finite.min(0).max(1),
    seed: z.number().int().min(0).max(2147483647),
  }),
]);
export type Surface = z.infer<typeof surfaceSchema>;
export type FabricEffect = (typeof FABRIC_EFFECTS)[number];

/** Non-destructive image adjustments (spec ED2-10, AST-05), in CSS filter units. */
export const imageAdjustSchema = z.object({
  brightness: finite.min(0).max(300),
  contrast: finite.min(0).max(300),
  saturation: finite.min(0).max(300),
  hue: finite.min(-180).max(180),
  grayscale: z.boolean(),
  invert: z.boolean(),
  /** One-colour separation: pixels darker than this luminance turn black, the rest white. 0 is off. */
  threshold: finite.min(0).max(255).optional(),
});
export type ImageAdjust = z.infer<typeof imageAdjustSchema>;

/** Tile the image across the layer box as a repeat pattern, clipped to the box (spec ED2-11, TYP-05). */
export const imageRepeatSchema = z.object({
  mode: z.enum(['grid', 'half-drop', 'brick', 'mirror']),
  tileWidthMm: finite.min(5).max(1000),
  spacingMm: finite.min(0).max(200),
  rotationDeg: finite.min(-360).max(360),
  offsetXmm: finite.min(-1000).max(1000),
  offsetYmm: finite.min(-1000).max(1000),
});
export type ImageRepeat = z.infer<typeof imageRepeatSchema>;

export const imageContentSchema = z.object({
  kind: z.literal('image'),
  assetId: id,
  naturalWidthPx: z.number().int().positive().max(20000),
  naturalHeightPx: z.number().int().positive().max(20000),
  mime: z.string().max(64),
  /** The untouched upload when this image is a derived copy (e.g. background removed). */
  originalAssetId: id.optional(),
  adjust: imageAdjustSchema.optional(),
  repeat: imageRepeatSchema.optional(),
  /** Crop the image to a shape (spec ED2-10 mask). */
  mask: z.enum(['circle', 'rounded', 'star', 'heart', 'hexagon', 'shield']).optional(),
  /** Free crop (spec ED2-10): the part of the image shown, as fractions of its width and height. Absent shows all of it. */
  crop: z
    .object({ x: finite.min(0).max(1), y: finite.min(0).max(1), w: finite.min(0.005).max(1), h: finite.min(0.005).max(1) })
    .refine((k) => k.x + k.w <= 1.0001 && k.y + k.h <= 1.0001, 'Expected a crop inside the image')
    .optional(),
});
export type ImageCrop = NonNullable<z.infer<typeof imageContentSchema>['crop']>;

export const textContentSchema = z.object({
  kind: z.literal('text'),
  value: z.string().max(500),
  fontFamily: z.string().max(80),
  fontWeight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  fill: hex,
  align: z.enum(['left', 'center', 'right']),
  letterSpacingEm: finite.min(-0.5).max(2),
  lineHeight: finite.min(0.6).max(3),
  /** Arc the text bends through, in degrees. 0 is straight, positive arches upward. Single-line text only. */
  curveDeg: finite.min(-300).max(300),
  strokeColor: hex.optional(),
  strokeWidthMm: finite.min(0).max(20).optional(),
  /** Wave warp height as a percentage of the letter height (straight single-line text). */
  wave: finite.min(-100).max(100).optional(),
  shadow: z.object({ color: hex, offsetXmm: finite.min(-50).max(50), offsetYmm: finite.min(-50).max(50), blurMm: finite.min(0).max(30) }).optional(),
  fillStyle: fillStyleSchema.optional(),
  /** A font uploaded to this device's font library (spec AST-07), when not a built-in family. */
  fontAssetId: id.optional(),
  /** Outline only: the letters drawn as lines (the outline colour and width, else the fill colour at 1 mm), no fill. */
  hollow: z.boolean().optional(),
  /**
   * Each letter in its own colour: these run across the letters in turn and repeat, spaces skipped.
   * They take the place of the fill colour and any gradient or pattern.
   */
  letterColors: z.array(hex).min(1).max(40).optional(),
});

export const SHAPES = ['rect', 'ellipse', 'triangle', 'star', 'polygon', 'heart', 'line', 'path'] as const;

export const shapeContentSchema = z.object({
  kind: z.literal('shape'),
  shape: z.enum(SHAPES),
  fill: hex,
  cornerRadiusMm: finite.min(0).max(500),
  strokeColor: hex.optional(),
  strokeWidthMm: finite.min(0).max(50).optional(),
  /** Star points or polygon sides. */
  points: z.number().int().min(3).max(24).optional(),
  /** Star inner radius as a share of the outer radius. */
  innerRatio: finite.min(0.1).max(0.95).optional(),
  fillStyle: fillStyleSchema.optional(),
  /** Graphic shapes: SVG path data in a 0–100 box, drawn with the even-odd rule. Path commands and numbers only. */
  path: z.string().max(8000).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-]*$/, 'Expected SVG path data').optional(),
  /** The graphic library item this came from, for naming. */
  graphicId: z.string().max(40).optional(),
  /** Outline only: rings, frames and line art (the outline colour and width, else the fill colour at 1 mm), no fill. */
  hollow: z.boolean().optional(),
});

export const layerContentSchema = z.discriminatedUnion('kind', [imageContentSchema, textContentSchema, shapeContentSchema]);
export type ImageContent = z.infer<typeof imageContentSchema>;
export type TextContent = z.infer<typeof textContentSchema>;
export type ShapeContent = z.infer<typeof shapeContentSchema>;
export type LayerContent = z.infer<typeof layerContentSchema>;

export const artworkLayerSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  visible: z.boolean(),
  locked: z.boolean(),
  /** Layers sharing a groupId move, scale and select together. Members stay adjacent in the stack. */
  groupId: id.optional(),
  /**
   * Clipped to the layer below (spec ED2-05): shown only where that layer has ink, like a photo
   * inside lettering. Clipped layers stacked together all clip to the first unclipped layer under them.
   */
  clip: z.boolean().optional(),
  transform: transformSchema,
  style: layerStyleSchema,
  content: layerContentSchema,
});
export type ArtworkLayer = z.infer<typeof artworkLayerSchema>;

/** Ruler guides on a print area (spec ED2-08): vertical lines at these x, horizontal ones at these y, in mm. */
export const guidesSchema = z.object({ x: z.array(finite.min(-2000).max(2000)).max(40), y: z.array(finite.min(-2000).max(2000)).max(40) });
export type Guides = z.infer<typeof guidesSchema>;

export const zoneDesignSchema = z.object({
  zoneId: zoneIdSchema,
  printMethod: printMethodSchema,
  orderedLayerIds: z.array(id).max(200),
  layers: z.record(id, artworkLayerSchema),
  guides: guidesSchema.optional(),
});
export type ZoneDesign = z.infer<typeof zoneDesignSchema>;

const coordinate = finite.min(-5000).max(5000);
const vec3 = z.tuple([coordinate, coordinate, coordinate]);
const direction = vec3.refine((v) => Math.hypot(v[0], v[1], v[2]) > 1e-6, 'Expected a direction');

/**
 * Where projected artwork sits on the 3D garment, in garment millimetres with the cloth at rest
 * (+y up, +z toward the front, the wearer's left at +x, torso hem at y = 0): a point on the
 * surface, the surface's outward normal there (the artwork is projected along it), and the
 * direction its top edge points.
 */
export const projectorSchema = z.object({
  point: vec3,
  normal: direction,
  up: direction,
});
export type ProjectorSpec = z.infer<typeof projectorSchema>;

/** Size, rotation and mirroring of projected artwork, in millimetres on the cloth at its centre. */
export const projectedTransformSchema = transformSchema.omit({ centerXmm: true, centerYmm: true });
export type ProjectedTransform = z.infer<typeof projectedTransformSchema>;

/**
 * Artwork projected onto the garment across its seams (format 4). Zone print files can't carry
 * it: it is printed on the fabric before sewing, by sublimation or as cut-and-sew panels.
 */
export const projectedLayerSchema = z.object({
  id,
  name: z.string().min(1).max(120),
  visible: z.boolean(),
  locked: z.boolean(),
  projector: projectorSchema,
  transform: projectedTransformSchema,
  style: layerStyleSchema,
  content: layerContentSchema,
});
export type ProjectedLayer = z.infer<typeof projectedLayerSchema>;

/** Projected layers in stacking order, bottom first. */
export const projectionsSchema = z.object({
  orderedLayerIds: z.array(id).max(50),
  layers: z.record(id, projectedLayerSchema),
});
export type Projections = z.infer<typeof projectionsSchema>;

/** Design area ids start with `area_`, so they never collide with a zone's name. */
export const AREA_ID_PREFIX = 'area_';
export const areaIdSchema = z.string().regex(/^area_[A-Za-z0-9_-]{1,48}$/, 'Expected a design area id');
export type AreaId = `area_${string}`;
/** Where artwork is designed: one of the garment's print zones, or a design area the person placed. */
export type ArtboardId = ZoneId | AreaId;

export function isAreaId(id: string | null | undefined): id is AreaId {
  return typeof id === 'string' && id.startsWith(AREA_ID_PREFIX);
}

/**
 * A design area: a print area the person makes, of any size, placed anywhere on the 3D garment
 * (a hood, a side panel, across a seam). Its artwork is designed in 2D like a zone's, with every
 * tool, and projected onto the garment from the area's projector, so the whole area moves, turns
 * and resizes as one. Optional and additive within format 4.
 */
export const designAreaSchema = z.object({
  id: areaIdSchema,
  name: z.string().min(1).max(60),
  visible: z.boolean(),
  locked: z.boolean(),
  projector: projectorSchema,
  widthMm: finite.min(10).max(1500),
  heightMm: finite.min(10).max(1500),
  /** Clockwise as seen from outside, like a layer's rotation. */
  rotationDeg: finite.min(-360).max(360),
  printMethod: printMethodSchema,
  orderedLayerIds: z.array(id).max(200),
  layers: z.record(id, artworkLayerSchema),
  guides: guidesSchema.optional(),
});
export type DesignArea = z.infer<typeof designAreaSchema>;

/** Design areas in tab order. */
export const designAreasSchema = z.object({
  orderedIds: z.array(areaIdSchema).max(24),
  items: z.record(areaIdSchema, designAreaSchema),
});
export type DesignAreas = z.infer<typeof designAreasSchema>;

/** What a zone and a design area share: layers in stacking order, bottom first. */
export type LayerStack = Pick<ZoneDesign, 'orderedLayerIds' | 'layers' | 'guides'>;

export const colorwaySchema = z.object({
  id,
  name: z.string().min(1).max(60),
  /** Pants and belt exist on uniforms; colourways without them use the body colour and black. */
  parts: z.object({ body: hex, sleeves: hex, collar: hex, stitching: hex, pants: hex.optional(), belt: hex.optional() }),
  /** All-over prints on fabric parts, over their colour. */
  surfaces: z.object({ body: surfaceSchema.optional(), sleeves: surfaceSchema.optional(), pants: surfaceSchema.optional() }).optional(),
});
export type Colorway = z.infer<typeof colorwaySchema>;

/** One bill-of-materials row (spec FAC-04). Unconfirmed rows print as needing manual confirmation. */
export const bomItemSchema = z.object({
  id,
  component: z.string().max(80),
  description: z.string().max(200),
  supplierRef: z.string().max(80),
  colour: z.string().max(60),
  quantity: z.string().max(40),
  confirmed: z.boolean(),
});
export type BomItem = z.infer<typeof bomItemSchema>;

export const qaItemSchema = z.object({ id, label: z.string().min(1).max(120), checked: z.boolean() });
export type QaItem = z.infer<typeof qaItemSchema>;

export const productionSchema = z.object({
  constructionNotes: z.string().max(4000),
  factoryContact: z.string().max(200),
  bom: z.array(bomItemSchema).max(40),
  qa: z.array(qaItemSchema).max(30),
});
export type ProductionData = z.infer<typeof productionSchema>;

/** A saved camera position (spec ED3-06 camera bookmarks, MED-03). Units: metres in the 3D scene. */
export const cameraBookmarkSchema = z.object({
  id,
  name: z.string().min(1).max(40),
  position: z.tuple([finite, finite, finite]),
  target: z.tuple([finite, finite, finite]),
  fovDeg: finite.min(10).max(80),
});
export type CameraBookmark = z.infer<typeof cameraBookmarkSchema>;

/** Studio scene for previews and renders (spec ED3-09, ED3-10, MED-02, MED-04). Optional: absent means defaults. */
export const sceneSchema = z.object({
  presetId: z.string().max(32),
  exposure: finite.min(0.2).max(3),
  envRotationDeg: finite.min(-180).max(180),
  shadows: z.boolean(),
  /** An image backdrop covers the frame; its colour shows while the image loads. */
  backdrop: z.object({ kind: z.enum(['transparent', 'solid', 'gradient', 'image']), color: hex, color2: hex, assetId: id.optional() }),
  fovDeg: finite.min(10).max(80),
  cameras: z.array(cameraBookmarkSchema).max(12),
  /** Garment motion in the live view and video: wind through the fabric, a float, or a knit reveal. */
  motion: z.object({ kind: z.enum(['still', 'wind', 'float', 'knit', 'walk', 'hanger']), speed: finite.min(0.1).max(3) }).optional(),
  /** How light turns into screen colour: true colour (default), filmic (AgX) or cinematic (ACES). */
  tone: z.enum(['neutral', 'agx', 'aces']).optional(),
  /** How the cloth falls in 3D: pressed flat, natural folds (default) or relaxed. */
  drape: z.enum(['pressed', 'natural', 'relaxed']).optional(),
  /** What the garment is shown on: nothing (default), a display form over a podium, or a table for a flat lay. */
  stage: z.enum(['none', 'podium', 'table']).optional(),
});
export type Scene = z.infer<typeof sceneSchema>;

export const designDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  projectId: id,
  title: z.string().min(1).max(120),
  /** Optimistic concurrency counter, bumped by the server on an accepted save. */
  revision: z.number().int().min(0),
  garment: z.object({
    modelId: z.string().max(64),
    assetVersion: z.string().max(32),
    sizeCode: z.string().max(8),
    fabricPresetId: z.string().max(32),
    /**
     * A 3D shape used instead of the built-in one. A template shape was made from this style's
     * template GLB in Blender, Clo3D or Marvelous Designer and keeps its print layout; a shell is
     * any garment GLB, fitted over the style's pattern (prints wrap onto it; production files
     * still come from the pattern). Documents from before shells have no `kind`: templates.
     */
    shape: z
      .object({
        /** An uploaded file kept on this device. */
        assetId: id.optional(),
        /** Or a model from the app's 3D model library, by file name (any device has it). */
        library: z.string().min(5).max(372).optional(),
        name: z.string().min(1).max(120),
        modelId: z.string().max(64),
        sizeCode: z.string().max(8),
        kind: z.enum(['template', 'shell']).optional(),
        /** Shells: turned round from the way WOVEXA read the file's front. */
        turn: z.boolean().optional(),
        /** Shells: the model's own credit, shown wherever it is used (CC BY and similar licences require it). */
        credit: z.object({ title: z.string().max(200).optional(), author: z.string().max(200).optional(), license: z.string().max(200).optional(), source: z.string().max(500).optional() }).optional(),
      })
      .optional(),
  }),
  activeColorwayId: id,
  colorways: z.array(colorwaySchema).min(1).max(24),
  zones: z.object({
    front: zoneDesignSchema,
    back: zoneDesignSchema,
    left_sleeve: zoneDesignSchema,
    right_sleeve: zoneDesignSchema,
    left_leg: zoneDesignSchema,
    right_leg: zoneDesignSchema,
  }),
  brandKitId: id.optional(),
  production: productionSchema,
  scene: sceneSchema.optional(),
  /** Artwork placed on the 3D garment across seams (format 4). */
  projections: projectionsSchema,
  /** Design areas the person placed anywhere on the 3D garment, beyond the style's zones (optional in format 4). */
  areas: designAreasSchema.optional(),
});
export type DesignDocument = z.infer<typeof designDocumentSchema>;

/** An empty set of projected layers, as new documents and upgraded ones start. */
export function emptyProjections(): Projections {
  return { orderedLayerIds: [], layers: {} };
}

/** Cross-field invariants Zod can't express structurally. Returns problems, empty when valid. */
export function checkDocumentInvariants(doc: DesignDocument): string[] {
  const problems: string[] = [];
  if (!doc.colorways.some((c) => c.id === doc.activeColorwayId)) {
    problems.push('activeColorwayId does not match any colourway');
  }
  for (const zoneId of ZONE_IDS) {
    const zone = doc.zones[zoneId];
    if (zone.zoneId !== zoneId) problems.push(`zone ${zoneId} has mismatched zoneId ${zone.zoneId}`);
    const listed = new Set(zone.orderedLayerIds);
    if (listed.size !== zone.orderedLayerIds.length) problems.push(`zone ${zoneId} lists a layer twice`);
    for (const layerId of zone.orderedLayerIds) {
      if (!zone.layers[layerId]) problems.push(`zone ${zoneId} orders missing layer ${layerId}`);
    }
    for (const layerId of Object.keys(zone.layers)) {
      if (!listed.has(layerId)) problems.push(`zone ${zoneId} has unordered layer ${layerId}`);
    }
  }
  const projected = doc.projections;
  const listed = new Set(projected.orderedLayerIds);
  if (listed.size !== projected.orderedLayerIds.length) problems.push('projections list a layer twice');
  for (const layerId of projected.orderedLayerIds) {
    if (!projected.layers[layerId]) problems.push(`projections order missing layer ${layerId}`);
  }
  for (const [layerId, layer] of Object.entries(projected.layers)) {
    if (!listed.has(layerId)) problems.push(`projections have unordered layer ${layerId}`);
    if (layer.id !== layerId) problems.push(`projected layer ${layerId} has mismatched id ${layer.id}`);
  }
  const shape = doc.garment.shape;
  if (shape && !shape.assetId && !shape.library) problems.push('3D shape names no file');
  const areas = doc.areas;
  if (areas) {
    const ids = new Set(areas.orderedIds);
    if (ids.size !== areas.orderedIds.length) problems.push('design areas list an area twice');
    for (const areaId of areas.orderedIds) if (!areas.items[areaId]) problems.push(`design areas order missing area ${areaId}`);
    for (const [areaId, area] of Object.entries(areas.items)) {
      if (!ids.has(areaId)) problems.push(`design areas have unordered area ${areaId}`);
      if (area.id !== areaId) problems.push(`design area ${areaId} has mismatched id ${area.id}`);
      const layers = new Set(area.orderedLayerIds);
      if (layers.size !== area.orderedLayerIds.length) problems.push(`design area ${areaId} lists a layer twice`);
      for (const layerId of area.orderedLayerIds) if (!area.layers[layerId]) problems.push(`design area ${areaId} orders missing layer ${layerId}`);
      for (const layerId of Object.keys(area.layers)) if (!layers.has(layerId)) problems.push(`design area ${areaId} has unordered layer ${layerId}`);
    }
  }
  return problems;
}

export type ParseResult = { ok: true; document: DesignDocument; migratedFrom?: number } | { ok: false; errors: string[] };

/** Validate untrusted input (IndexedDB, network, imports) against the current version only. */
export function parseDesignDocument(input: unknown): ParseResult {
  const parsed = designDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const problems = checkDocumentInvariants(parsed.data);
  return problems.length ? { ok: false, errors: problems } : { ok: true, document: parsed.data };
}

// ---------------------------------------------------------------------------
// Migrations. Deterministic and repeatable; each step takes the previous version's JSON.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const DEFAULT_QA = [
  'Construction and seams match the sample brief',
  'Print placement within tolerance of the tech pack',
  'Print and fabric colour match the approved swatches',
  'Garment measurements within size-chart tolerance',
  'Print hand feel and wash test acceptable',
  'Care and size labels correct',
];

/** Production defaults: rows that need confirming, never invented facts (spec FAC AC). */
export function defaultProduction(stableId: (n: number) => string = (n) => `p${n}`): ProductionData {
  const row = (n: number, component: string, description = ''): BomItem => ({
    id: stableId(n),
    component,
    description,
    supplierRef: '',
    colour: '',
    quantity: '',
    confirmed: false,
  });
  return {
    constructionNotes: '',
    factoryContact: '',
    bom: [row(1, 'Body fabric'), row(2, 'Collar rib', '1×1 rib'), row(3, 'Sewing thread'), row(4, 'Neck label'), row(5, 'Care label'), row(6, 'Packaging', 'Polybag')],
    qa: DEFAULT_QA.map((label, i) => ({ id: stableId(100 + i), label, checked: false })),
  };
}

export function migrateV1toV2(v1: Json): Json {
  const doc = structuredClone(v1);
  const zones = (doc.zones ?? {}) as Record<string, { layers?: Record<string, { content?: Json }> }>;
  for (const zone of Object.values(zones)) {
    for (const layer of Object.values(zone.layers ?? {})) {
      if (layer.content?.kind === 'text' && layer.content.curveDeg === undefined) layer.content.curveDeg = 0;
    }
  }
  const production = defaultProduction();
  if (typeof doc.notes === 'string') production.constructionNotes = doc.notes.slice(0, 4000);
  delete doc.notes;
  doc.production = production;
  doc.schemaVersion = 2;
  return doc;
}

/** Format 3 adds the uniform's leg zones, empty. Nothing else changes. */
export function migrateV2toV3(v2: Json): Json {
  const doc = structuredClone(v2);
  const zones = (doc.zones ?? {}) as Record<string, unknown>;
  for (const zoneId of V3_ZONES) {
    zones[zoneId] ??= { zoneId, printMethod: 'DTG', orderedLayerIds: [], layers: {} };
  }
  doc.zones = zones;
  doc.schemaVersion = 3;
  return doc;
}

/** Format 4 adds projected (cross-seam) layers, none yet. Nothing else changes. */
export function migrateV3toV4(v3: Json): Json {
  const doc = structuredClone(v3);
  doc.projections ??= emptyProjections();
  doc.schemaVersion = 4;
  return doc;
}

const MIGRATIONS: Record<number, (doc: Json) => Json> = { 1: migrateV1toV2, 2: migrateV2toV3, 3: migrateV3toV4 };

/** Upgrade a stored document of any known version to the current one, then validate it. */
export function migrateDesignDocument(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['Not a design document'] };
  let doc = input as Json;
  const from = doc.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) return { ok: false, errors: ['Missing schema version'] };
  if (from > SCHEMA_VERSION) {
    return { ok: false, errors: [`This design was saved by a newer version of WOVEXA (format ${from}). Update the app to open it.`] };
  }
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { ok: false, errors: [`No upgrade path from format ${v}`] };
    doc = step(doc);
  }
  const parsed = parseDesignDocument(doc);
  return parsed.ok && from !== SCHEMA_VERSION ? { ...parsed, migratedFrom: from } : parsed;
}
