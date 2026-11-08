/**
 * Canonical WOVEXA design document (spec §26).
 * This JSON is the single source of truth. Fabric (2D) and Three (3D) are adapters that
 * read it and emit commands; neither stores design state of its own.
 * No React or engine imports belong in src/domain.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

export const ZONE_IDS = ['front', 'back', 'left_sleeve', 'right_sleeve'] as const;
export const zoneIdSchema = z.enum(ZONE_IDS);
export type ZoneId = z.infer<typeof zoneIdSchema>;

export const PRINT_METHODS = ['DTG', 'DTF', 'SCREEN_PRINT', 'EMBROIDERY', 'PUFF_PRINT', 'SUBLIMATION', 'HEAT_TRANSFER'] as const;
export const printMethodSchema = z.enum(PRINT_METHODS);
export type PrintMethod = z.infer<typeof printMethodSchema>;

export const GARMENT_PARTS = ['body', 'sleeves', 'collar', 'stitching'] as const;
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

export const finishSchema = z.enum(['flat_ink', 'puff', 'embroidery', 'metallic', 'distressed']);

export const layerStyleSchema = z.object({
  opacity: finite.min(0).max(1),
  blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay']),
  finish: finishSchema,
});
export type LayerStyle = z.infer<typeof layerStyleSchema>;

export const imageContentSchema = z.object({
  kind: z.literal('image'),
  assetId: id,
  naturalWidthPx: z.number().int().positive().max(20000),
  naturalHeightPx: z.number().int().positive().max(20000),
  mime: z.string().max(64),
});

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
  strokeColor: hex.optional(),
  strokeWidthMm: finite.min(0).max(20).optional(),
});

export const shapeContentSchema = z.object({
  kind: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse', 'triangle']),
  fill: hex,
  cornerRadiusMm: finite.min(0).max(500),
  strokeColor: hex.optional(),
  strokeWidthMm: finite.min(0).max(50).optional(),
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
  transform: transformSchema,
  style: layerStyleSchema,
  content: layerContentSchema,
});
export type ArtworkLayer = z.infer<typeof artworkLayerSchema>;

export const zoneDesignSchema = z.object({
  zoneId: zoneIdSchema,
  printMethod: printMethodSchema,
  orderedLayerIds: z.array(id).max(200),
  layers: z.record(id, artworkLayerSchema),
});
export type ZoneDesign = z.infer<typeof zoneDesignSchema>;

export const colorwaySchema = z.object({
  id,
  name: z.string().min(1).max(60),
  parts: z.object({ body: hex, sleeves: hex, collar: hex, stitching: hex }),
});
export type Colorway = z.infer<typeof colorwaySchema>;

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
  }),
  activeColorwayId: id,
  colorways: z.array(colorwaySchema).min(1).max(24),
  zones: z.object({
    front: zoneDesignSchema,
    back: zoneDesignSchema,
    left_sleeve: zoneDesignSchema,
    right_sleeve: zoneDesignSchema,
  }),
  notes: z.string().max(4000).optional(),
});
export type DesignDocument = z.infer<typeof designDocumentSchema>;

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
  return problems;
}

export type ParseResult = { ok: true; document: DesignDocument } | { ok: false; errors: string[] };

/** Validate untrusted input (IndexedDB, network, imports). */
export function parseDesignDocument(input: unknown): ParseResult {
  const parsed = designDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const problems = checkDocumentInvariants(parsed.data);
  return problems.length ? { ok: false, errors: problems } : { ok: true, document: parsed.data };
}

/** Upgrade older stored documents. Only v1 exists today; future versions add steps here. */
export function migrateDesignDocument(input: unknown): ParseResult {
  if (typeof input === 'object' && input !== null && 'schemaVersion' in input) {
    const version = (input as { schemaVersion: unknown }).schemaVersion;
    if (version !== SCHEMA_VERSION) {
      return { ok: false, errors: [`Unsupported schema version ${String(version)}`] };
    }
  }
  return parseDesignDocument(input);
}
