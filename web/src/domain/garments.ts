/**
 * Garment catalogue (spec §7, §28, GAR-01…07). Each model carries its pattern measurements,
 * the print zones it really has (the zones.json equivalent), colour parts, fabrics and sizes.
 * The 3D geometry is procedural from these measurements; a calibrated GLB from a 3D artist can
 * replace it later without changing the zone contracts.
 */
import type { Colorway, GarmentPart, PrintMethod, ZoneId } from './schema';

export type PartId = 'torso' | 'sleeveLeft' | 'sleeveRight' | 'legLeft' | 'legRight';
export type GarmentCategory = 'tee' | 'longsleeve' | 'polo' | 'tank' | 'hoodie' | 'jersey' | 'uniform';
export type Neckline = 'crew' | 'v' | 'scoop' | 'polo' | 'hood' | 'dobok';
/** Surface the fabric shows in 3D (normal map and sheen), not a print property. */
export type FabricSurface = 'jersey' | 'pique' | 'fleece' | 'mesh' | 'rib' | 'diamond';

export interface ZoneSpec {
  id: ZoneId;
  label: string;
  shortLabel: string;
  /** Which garment surface carries the zone. */
  part: PartId;
  printableWidthMm: number;
  printableHeightMm: number;
  /** Inner margin that should stay clear of artwork edges. */
  safeInsetMm: number;
  /** Torso zones: distance from the high point of shoulder to the top of the printable area. */
  topFromHpsMm?: number;
  /** Sleeve zones: distance from the shoulder seam to the zone centre, along the sleeve. */
  centerFromShoulderMm?: number;
  /** Leg zones: distance from the waistband to the top of the printable area, down the outer leg. */
  topFromWaistMm?: number;
  methods: PrintMethod[];
}

export interface GarmentSize {
  code: string;
  /** Uniform grading factor applied to the base pattern. Print zones stay in true millimetres. */
  scale: number;
  chestFlatMm: number;
  bodyLengthMm: number;
}

export interface SleeveSpec {
  lengthMm: number;
  /** Below horizontal; long sleeves hang lower. */
  angleDeg: number;
  rootRadiusMm: number;
  cuffRadiusMm: number;
  cuff: 'hem' | 'rib' | 'open';
}

export interface PantsSpec {
  waistHalfWidthMm: number;
  waistHalfDepthMm: number;
  hipHalfWidthMm: number;
  /** Waist to crotch, and crotch to hem. */
  riseMm: number;
  inseamMm: number;
  thighRadiusMm: number;
  hemRadiusMm: number;
  /** Where the waistband sits, measured down from the top's high point of shoulder. */
  waistFromHpsMm: number;
}

export interface FabricPreset {
  id: string;
  label: string;
  gsm: number;
  surface: FabricSurface;
}

export interface ColorwayPreset {
  name: string;
  parts: Colorway['parts'];
}

export interface GarmentModel {
  id: string;
  assetVersion: string;
  name: string;
  /** One or two words for chips and cards. */
  shortName: string;
  description: string;
  category: GarmentCategory;
  calibrated: boolean;
  /** Base pattern measurements, size M (or 170 cm for uniforms). */
  bodyLengthMm: number;
  chestHalfWidthMm: number;
  bodyHalfDepthMm: number;
  shoulderHalfWidthMm: number;
  neckRadiusMm: number;
  frontNeckDropMm: number;
  backNeckDropMm: number;
  shoulderSlope: number;
  neckline: Neckline;
  sleeve: SleeveSpec | null;
  hem: 'hem' | 'rib' | 'slits';
  /** Sleeveless tops: how far below the shoulder line the armhole reaches. */
  armholeDropMm?: number;
  /** Width of a printed-looking trim band along the neckline (V-necks, uniforms). */
  trimWidthMm?: number;
  extras: { placketButtons?: number; pocket?: 'kangaroo'; hood?: boolean; drawcords?: boolean };
  pants?: PantsSpec;
  belt?: { widthMm: number };
  zones: Partial<Record<ZoneId, ZoneSpec>>;
  /** Supported zones in tab order. */
  zoneOrder: ZoneId[];
  /** Colour parts the colourway editor shows, with garment-specific names. */
  colorParts: { part: GarmentPart; label: string }[];
  colorwayPresets?: ColorwayPreset[];
  sizes: GarmentSize[];
  defaultSize: string;
  fabricPresets: FabricPreset[];
}

const ALL_FLAT: PrintMethod[] = ['DTG', 'DTF', 'SCREEN_PRINT', 'HEAT_TRANSFER', 'PUFF_PRINT', 'EMBROIDERY'];
const SLEEVE_METHODS: PrintMethod[] = ['DTG', 'DTF', 'SCREEN_PRINT', 'HEAT_TRANSFER', 'EMBROIDERY'];

const TOP_PARTS: GarmentModel['colorParts'] = [
  { part: 'body', label: 'Body' },
  { part: 'sleeves', label: 'Sleeves' },
  { part: 'collar', label: 'Collar' },
  { part: 'stitching', label: 'Stitch' },
];

/** S to 2XL from a base chest flat and body length (size M), graded 6% per size. */
function adultSizes(chestFlatMm: number, bodyLengthMm: number): GarmentSize[] {
  return [
    ['S', 0.94],
    ['M', 1],
    ['L', 1.06],
    ['XL', 1.12],
    ['2XL', 1.18],
  ].map(([code, scale]) => ({ code: code as string, scale: scale as number, chestFlatMm: Math.round(chestFlatMm * (scale as number)), bodyLengthMm: Math.round(bodyLengthMm * (scale as number)) }));
}

function torsoZone(id: 'front' | 'back', w: number, h: number, top: number, methods: PrintMethod[] = [...ALL_FLAT, 'SUBLIMATION']): ZoneSpec {
  return { id, label: id === 'front' ? 'Front' : 'Back', shortLabel: id === 'front' ? 'Front' : 'Back', part: 'torso', printableWidthMm: w, printableHeightMm: h, safeInsetMm: 10, topFromHpsMm: top, methods };
}

function sleeveZones(w: number, h: number, center: number): Pick<Record<ZoneId, ZoneSpec>, 'left_sleeve' | 'right_sleeve'> {
  return {
    left_sleeve: { id: 'left_sleeve', label: 'Left sleeve', shortLabel: 'L sleeve', part: 'sleeveLeft', printableWidthMm: w, printableHeightMm: h, safeInsetMm: 6, centerFromShoulderMm: center, methods: SLEEVE_METHODS },
    right_sleeve: { id: 'right_sleeve', label: 'Right sleeve', shortLabel: 'R sleeve', part: 'sleeveRight', printableWidthMm: w, printableHeightMm: h, safeInsetMm: 6, centerFromShoulderMm: center, methods: SLEEVE_METHODS },
  };
}

const TEE_FABRICS: FabricPreset[] = [
  { id: 'jersey-180', label: 'Cotton jersey, 180 gsm', gsm: 180, surface: 'jersey' },
  { id: 'heavy-240', label: 'Heavyweight cotton, 240 gsm', gsm: 240, surface: 'jersey' },
  { id: 'poly-140', label: 'Performance polyester, 140 gsm', gsm: 140, surface: 'jersey' },
];

const FOUR_ZONES: ZoneId[] = ['front', 'back', 'left_sleeve', 'right_sleeve'];

export const TEE_CLASSIC: GarmentModel = {
  id: 'tee-classic',
  assetVersion: '0.2.0-procedural',
  name: 'Classic crew tee',
  shortName: 'Crew tee',
  description: 'Regular fit, short sleeves, rib crew neck.',
  category: 'tee',
  calibrated: false,
  bodyLengthMm: 720,
  chestHalfWidthMm: 262,
  bodyHalfDepthMm: 112,
  shoulderHalfWidthMm: 228,
  neckRadiusMm: 92,
  frontNeckDropMm: 88,
  backNeckDropMm: 22,
  shoulderSlope: 0.3,
  neckline: 'crew',
  sleeve: { lengthMm: 215, angleDeg: 30, rootRadiusMm: 104, cuffRadiusMm: 80, cuff: 'hem' },
  hem: 'hem',
  extras: {},
  zones: { front: torsoZone('front', 300, 400, 170), back: torsoZone('back', 300, 420, 110), ...sleeveZones(90, 90, 95) },
  zoneOrder: FOUR_ZONES,
  colorParts: TOP_PARTS,
  sizes: adultSizes(524, 720),
  defaultSize: 'M',
  fabricPresets: TEE_FABRICS,
};

export const TEE_LONG: GarmentModel = {
  ...TEE_CLASSIC,
  id: 'tee-long',
  name: 'Long-sleeve tee',
  shortName: 'Long sleeve',
  description: 'Regular fit with long sleeves and rib cuffs. Room for a print down each sleeve.',
  category: 'longsleeve',
  sleeve: { lengthMm: 600, angleDeg: 52, rootRadiusMm: 102, cuffRadiusMm: 46, cuff: 'rib' },
  zones: { front: torsoZone('front', 300, 400, 170), back: torsoZone('back', 300, 420, 110), ...sleeveZones(90, 380, 260) },
};

export const TEE_OVERSIZED: GarmentModel = {
  ...TEE_CLASSIC,
  id: 'tee-oversized',
  name: 'Oversized tee',
  shortName: 'Oversized',
  description: 'Boxy streetwear cut: dropped shoulders, wide body, elbow-length sleeves.',
  category: 'tee',
  bodyLengthMm: 750,
  chestHalfWidthMm: 300,
  bodyHalfDepthMm: 126,
  shoulderHalfWidthMm: 292,
  neckRadiusMm: 96,
  shoulderSlope: 0.18,
  sleeve: { lengthMm: 270, angleDeg: 40, rootRadiusMm: 128, cuffRadiusMm: 112, cuff: 'hem' },
  zones: { front: torsoZone('front', 340, 440, 175), back: torsoZone('back', 350, 470, 115), ...sleeveZones(100, 110, 110) },
  sizes: adultSizes(600, 750),
  fabricPresets: [{ id: 'heavy-260', label: 'Heavyweight cotton, 260 gsm', gsm: 260, surface: 'jersey' }, ...TEE_FABRICS],
};

export const POLO: GarmentModel = {
  ...TEE_CLASSIC,
  id: 'polo-classic',
  name: 'Piqué polo',
  shortName: 'Polo',
  description: 'Knitted collar, three-button placket and rib cuffs. Left chest is the classic spot.',
  category: 'polo',
  bodyLengthMm: 710,
  neckline: 'polo',
  frontNeckDropMm: 60,
  sleeve: { lengthMm: 225, angleDeg: 31, rootRadiusMm: 104, cuffRadiusMm: 78, cuff: 'rib' },
  extras: { placketButtons: 3 },
  zones: {
    front: torsoZone('front', 290, 330, 205, ALL_FLAT),
    back: torsoZone('back', 300, 400, 120, ALL_FLAT),
    ...sleeveZones(80, 70, 90),
  },
  colorParts: [
    { part: 'body', label: 'Body' },
    { part: 'sleeves', label: 'Sleeves' },
    { part: 'collar', label: 'Collar and cuffs' },
    { part: 'stitching', label: 'Stitch' },
  ],
  sizes: adultSizes(530, 710),
  fabricPresets: [
    { id: 'pique-210', label: 'Cotton piqué, 210 gsm', gsm: 210, surface: 'pique' },
    { id: 'poly-pique-170', label: 'Performance piqué, 170 gsm', gsm: 170, surface: 'pique' },
  ],
};

export const TANK: GarmentModel = {
  ...TEE_CLASSIC,
  id: 'tank-top',
  name: 'Tank top',
  shortName: 'Tank',
  description: 'Sleeveless with a scoop neck and bound armholes. Front and back prints.',
  category: 'tank',
  bodyLengthMm: 720,
  chestHalfWidthMm: 255,
  shoulderHalfWidthMm: 150,
  neckRadiusMm: 100,
  frontNeckDropMm: 150,
  backNeckDropMm: 70,
  shoulderSlope: 0.12,
  neckline: 'scoop',
  sleeve: null,
  armholeDropMm: 245,
  trimWidthMm: 12,
  zones: { front: torsoZone('front', 280, 380, 200), back: torsoZone('back', 290, 400, 150) },
  zoneOrder: ['front', 'back'],
  colorParts: [
    { part: 'body', label: 'Body' },
    { part: 'collar', label: 'Binding' },
    { part: 'stitching', label: 'Stitch' },
  ],
  sizes: adultSizes(510, 720),
  fabricPresets: [
    { id: 'jersey-160', label: 'Cotton jersey, 160 gsm', gsm: 160, surface: 'jersey' },
    { id: 'mesh-130', label: 'Athletic mesh, 130 gsm', gsm: 130, surface: 'mesh' },
  ],
};

export const HOODIE: GarmentModel = {
  ...TEE_CLASSIC,
  id: 'hoodie-pullover',
  name: 'Pullover hoodie',
  shortName: 'Hoodie',
  description: 'Lined hood with drawcords, kangaroo pocket, rib cuffs and hem.',
  category: 'hoodie',
  bodyLengthMm: 700,
  chestHalfWidthMm: 292,
  bodyHalfDepthMm: 132,
  shoulderHalfWidthMm: 250,
  neckRadiusMm: 100,
  frontNeckDropMm: 70,
  backNeckDropMm: 30,
  shoulderSlope: 0.24,
  neckline: 'hood',
  sleeve: { lengthMm: 590, angleDeg: 50, rootRadiusMm: 120, cuffRadiusMm: 50, cuff: 'rib' },
  hem: 'rib',
  extras: { pocket: 'kangaroo', hood: true, drawcords: true },
  zones: {
    front: torsoZone('front', 300, 250, 175, ALL_FLAT),
    back: torsoZone('back', 330, 420, 150, ALL_FLAT),
    ...sleeveZones(90, 360, 250),
  },
  colorParts: [
    { part: 'body', label: 'Body' },
    { part: 'sleeves', label: 'Sleeves' },
    { part: 'collar', label: 'Rib and cords' },
    { part: 'stitching', label: 'Stitch' },
  ],
  sizes: adultSizes(584, 700),
  fabricPresets: [
    { id: 'fleece-320', label: 'Brushed fleece, 320 gsm', gsm: 320, surface: 'fleece' },
    { id: 'terry-280', label: 'French terry, 280 gsm', gsm: 280, surface: 'fleece' },
  ],
};

export const JERSEY: GarmentModel = {
  ...TEE_CLASSIC,
  id: 'jersey-v',
  name: 'V-neck sports jersey',
  shortName: 'Jersey',
  description: 'Athletic mesh with a V-neck trim. Built for names, numbers and sublimated all-over prints.',
  category: 'jersey',
  bodyLengthMm: 730,
  chestHalfWidthMm: 276,
  bodyHalfDepthMm: 116,
  shoulderHalfWidthMm: 236,
  neckRadiusMm: 96,
  frontNeckDropMm: 150,
  backNeckDropMm: 24,
  neckline: 'v',
  trimWidthMm: 22,
  sleeve: { lengthMm: 235, angleDeg: 32, rootRadiusMm: 108, cuffRadiusMm: 86, cuff: 'hem' },
  zones: {
    front: torsoZone('front', 300, 380, 200),
    back: torsoZone('back', 320, 450, 100),
    ...sleeveZones(100, 100, 100),
  },
  colorParts: [
    { part: 'body', label: 'Body' },
    { part: 'sleeves', label: 'Sleeves' },
    { part: 'collar', label: 'Neck trim' },
    { part: 'stitching', label: 'Stitch' },
  ],
  sizes: adultSizes(552, 730),
  fabricPresets: [
    { id: 'mesh-140', label: 'Performance mesh, 140 gsm', gsm: 140, surface: 'mesh' },
    { id: 'poly-150', label: 'Smooth polyester, 150 gsm', gsm: 150, surface: 'jersey' },
  ],
};

/** Taekwondo belt colours by rank, for the uniform's belt swatches. */
export const BELT_COLOURS = [
  { name: 'White', hex: '#F4F4F1' },
  { name: 'Yellow', hex: '#F2C12E' },
  { name: 'Green', hex: '#2E8B57' },
  { name: 'Blue', hex: '#1F5FBF' },
  { name: 'Red', hex: '#C8102E' },
  { name: 'Black', hex: '#16161A' },
] as const;

export const DOBOK: GarmentModel = {
  ...TEE_CLASSIC,
  id: 'taekwondo-dobok',
  name: 'Taekwondo uniform (dobok)',
  shortName: 'Taekwondo',
  description: 'V-neck dobok top with collar trim, wide pants and a rank belt. Club name across the back, flag and name on the chest, text down the leg.',
  category: 'uniform',
  bodyLengthMm: 740,
  chestHalfWidthMm: 300,
  bodyHalfDepthMm: 128,
  shoulderHalfWidthMm: 262,
  neckRadiusMm: 104,
  frontNeckDropMm: 270,
  backNeckDropMm: 26,
  shoulderSlope: 0.2,
  neckline: 'dobok',
  trimWidthMm: 44,
  sleeve: { lengthMm: 560, angleDeg: 48, rootRadiusMm: 126, cuffRadiusMm: 96, cuff: 'open' },
  hem: 'slits',
  extras: {},
  pants: { waistHalfWidthMm: 232, waistHalfDepthMm: 128, hipHalfWidthMm: 296, riseMm: 330, inseamMm: 740, thighRadiusMm: 140, hemRadiusMm: 118, waistFromHpsMm: 470 },
  belt: { widthMm: 45 },
  zones: {
    front: torsoZone('front', 300, 260, 300, ['EMBROIDERY', 'SCREEN_PRINT', 'HEAT_TRANSFER', 'DTF']),
    back: torsoZone('back', 360, 420, 70, ['EMBROIDERY', 'SCREEN_PRINT', 'HEAT_TRANSFER', 'DTF', 'SUBLIMATION']),
    ...sleeveZones(100, 300, 200),
    left_leg: { id: 'left_leg', label: 'Left leg', shortLabel: 'L leg', part: 'legLeft', printableWidthMm: 120, printableHeightMm: 620, safeInsetMm: 8, topFromWaistMm: 110, methods: ['EMBROIDERY', 'SCREEN_PRINT', 'HEAT_TRANSFER', 'DTF'] },
    right_leg: { id: 'right_leg', label: 'Right leg', shortLabel: 'R leg', part: 'legRight', printableWidthMm: 120, printableHeightMm: 620, safeInsetMm: 8, topFromWaistMm: 110, methods: ['EMBROIDERY', 'SCREEN_PRINT', 'HEAT_TRANSFER', 'DTF'] },
  },
  zoneOrder: ['front', 'back', 'left_sleeve', 'right_sleeve', 'left_leg', 'right_leg'],
  colorParts: [
    { part: 'body', label: 'Top' },
    { part: 'sleeves', label: 'Sleeves' },
    { part: 'collar', label: 'Collar trim' },
    { part: 'pants', label: 'Pants' },
    { part: 'belt', label: 'Belt' },
    { part: 'stitching', label: 'Stitch' },
  ],
  colorwayPresets: [
    { name: 'Dan, black collar', parts: { body: '#F7F7F4', sleeves: '#F7F7F4', collar: '#16161A', stitching: '#E2E2DD', pants: '#F7F7F4', belt: '#16161A' } },
    { name: 'Gup, white collar', parts: { body: '#F7F7F4', sleeves: '#F7F7F4', collar: '#F7F7F4', stitching: '#E2E2DD', pants: '#F7F7F4', belt: '#F2C12E' } },
    { name: 'Poom, red collar', parts: { body: '#F7F7F4', sleeves: '#F7F7F4', collar: '#B3122E', stitching: '#E2E2DD', pants: '#F7F7F4', belt: '#C8102E' } },
    { name: 'Demo team black', parts: { body: '#16161A', sleeves: '#16161A', collar: '#F7F7F4', stitching: '#2A2A30', pants: '#16161A', belt: '#16161A' } },
  ],
  sizes: [
    ['130', 0.78],
    ['150', 0.89],
    ['170', 1],
    ['180', 1.05],
    ['190', 1.1],
  ].map(([code, scale]) => ({ code: code as string, scale: scale as number, chestFlatMm: Math.round(600 * (scale as number)), bodyLengthMm: Math.round(740 * (scale as number)) })),
  defaultSize: '170',
  fabricPresets: [
    { id: 'diamond-300', label: 'Poly-cotton, diamond weave, 300 gsm', gsm: 300, surface: 'diamond' },
    { id: 'rib-260', label: 'Ribbed weave, 260 gsm', gsm: 260, surface: 'rib' },
    { id: 'light-220', label: 'Lightweight cotton, 220 gsm', gsm: 220, surface: 'jersey' },
  ],
};

export const GARMENT_LIST: GarmentModel[] = [TEE_CLASSIC, TEE_OVERSIZED, TEE_LONG, POLO, TANK, HOODIE, JERSEY, DOBOK];
export const GARMENTS: Record<string, GarmentModel> = Object.fromEntries(GARMENT_LIST.map((g) => [g.id, g]));

export function getGarment(modelId: string): GarmentModel {
  return GARMENTS[modelId] ?? TEE_CLASSIC;
}

export function getSize(model: GarmentModel, code: string): GarmentSize {
  return model.sizes.find((s) => s.code === code) ?? model.sizes.find((s) => s.code === model.defaultSize)!;
}

/** The spec of a zone this garment has, or undefined (a tank has no sleeves). */
export function zoneSpecOf(model: GarmentModel, zoneId: ZoneId): ZoneSpec | undefined {
  return model.zones[zoneId];
}

/** The zone spec, falling back to the garment's first zone so callers always get a real one. */
export function zoneSpecOrFirst(model: GarmentModel, zoneId: ZoneId): ZoneSpec {
  return model.zones[zoneId] ?? model.zones[model.zoneOrder[0]]!;
}

export function hasZone(model: GarmentModel, zoneId: ZoneId) {
  return !!model.zones[zoneId];
}

/** A colourway's colour for a part, with sensible defaults for parts older colourways lack. */
export function partColor(colorway: Colorway, part: GarmentPart): string {
  if (part === 'pants') return colorway.parts.pants ?? colorway.parts.body;
  if (part === 'belt') return colorway.parts.belt ?? '#16161A';
  return colorway.parts[part];
}

export function colorwayPresetsFor(model: GarmentModel): readonly ColorwayPreset[] {
  return model.colorwayPresets ?? COLORWAY_PRESETS;
}

export const PRINT_METHOD_LABELS: Record<PrintMethod, string> = {
  DTG: 'Direct to garment',
  DTF: 'Direct to film',
  SCREEN_PRINT: 'Screen print',
  EMBROIDERY: 'Embroidery',
  PUFF_PRINT: 'Puff print',
  SUBLIMATION: 'Sublimation',
  HEAT_TRANSFER: 'Heat transfer',
};

export const COLORWAY_PRESETS: readonly ColorwayPreset[] = [
  { name: 'Optic white', parts: { body: '#F4F4F1', sleeves: '#F4F4F1', collar: '#F4F4F1', stitching: '#E2E2DD' } },
  { name: 'Jet black', parts: { body: '#16161A', sleeves: '#16161A', collar: '#16161A', stitching: '#2A2A30' } },
  { name: 'Heather grey', parts: { body: '#A9AAAD', sleeves: '#A9AAAD', collar: '#9A9B9F', stitching: '#8E8F93' } },
  { name: 'Deep navy', parts: { body: '#1C2740', sleeves: '#1C2740', collar: '#1C2740', stitching: '#2A3654' } },
  { name: 'Forest', parts: { body: '#2F4A3A', sleeves: '#2F4A3A', collar: '#2F4A3A', stitching: '#3B5A48' } },
  { name: 'Sand', parts: { body: '#D8C7A8', sleeves: '#D8C7A8', collar: '#D8C7A8', stitching: '#C6B392' } },
  { name: 'Varsity red', parts: { body: '#B3122E', sleeves: '#B3122E', collar: '#B3122E', stitching: '#8F0E25' } },
  { name: 'Royal blue', parts: { body: '#1F4FB8', sleeves: '#1F4FB8', collar: '#1F4FB8', stitching: '#183F94' } },
  { name: 'Bone and black', parts: { body: '#EDE8DD', sleeves: '#16161A', collar: '#16161A', stitching: '#D8D2C4' } },
];
