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
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 2 as const;

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
  /** The untouched upload when this image is a derived copy (e.g. background removed). */
  originalAssetId: id.optional(),
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
  /** Arc the text bends through, in degrees. 0 is straight, positive arches upward. Single-line text only. */
  curveDeg: finite.min(-300).max(300),
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
  /** Layers sharing a groupId move, scale and select together. Members stay adjacent in the stack. */
  groupId: id.optional(),
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
  brandKitId: id.optional(),
  production: productionSchema,
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

const MIGRATIONS: Record<number, (doc: Json) => Json> = { 1: migrateV1toV2 };

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
