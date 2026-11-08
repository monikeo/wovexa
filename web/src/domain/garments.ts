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
  /** Overall grading factor for small details (neck, trims). Print zones stay in true millimetres. */
  scale: number;
  /** Chest measured flat, armpit to armpit (half the chest round). */
  chestFlatMm: number;
  /** Body length from the high point of shoulder (jacket length for uniforms). */
  bodyLengthMm: number;
  /** Sleeve from the shoulder seam to the cuff, when the size chart gives one. */
  sleeveLengthMm?: number;
  /** Uniform pants: relaxed waist measured flat, and outside length. */
  waistFlatMm?: number;
  pantsLengthMm?: number;
  /** Letter size for a height-coded size, such as L for 170. */
  alias?: string;
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
  /** Relaxed waist measured flat at the base size, for grading by a size chart. */
  waistFlatMm?: number;
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

/** A size chart row in centimetres, measured flat: chest (armpit to armpit), length from the high point of shoulder, sleeve from the shoulder seam. */
type ChartRow = readonly [code: string, chest: number, length: number, sleeve?: number];

/** Adult sportswear shirts, XS to 8XL. Chest steps 3 cm (2 cm at 3XL), length 2 cm; the sleeve is a long sleeve. */
const ADULT_SHIRTS: ChartRow[] = [
  ['XS', 48, 67, 56], ['S', 51, 70, 58], ['M', 54, 72, 60], ['L', 57, 74, 62], ['XL', 60, 76, 64], ['2XL', 63, 78, 66],
  ['3XL', 65, 80, 68], ['4XL', 68, 82, 70], ['5XL', 71, 84, 72], ['6XL', 74, 86, 74], ['7XL', 77, 88, 76], ['8XL', 80, 90, 78],
];
const KIDS_SHIRTS: ChartRow[] = [['K2', 34, 45], ['K4', 36, 48], ['K6', 38, 50], ['K8', 40, 54], ['K10', 42, 58], ['K12', 44, 62], ['K14', 46, 65]];
const ADULT_SINGLETS: ChartRow[] = [
  ['XS', 49, 67.5], ['S', 51.5, 70], ['M', 54, 72.5], ['L', 56.5, 75], ['XL', 59, 77.5], ['2XL', 61.5, 80],
  ['3XL', 64, 82.5], ['4XL', 67, 84], ['5XL', 70, 86], ['6XL', 72, 88], ['7XL', 75, 90], ['8XL', 78, 92],
];
const KIDS_SINGLETS: ChartRow[] = [['K2', 35, 48], ['K4', 37, 50], ['K6', 39, 53], ['K8', 41, 56], ['K10', 43, 59], ['K12', 45, 62], ['K14', 47, 65]];

/**
 * Sizes graded by a size chart's real steps from its M. Each style keeps its own cut at M (a
 * boxy tee stays boxy) and moves by the chart's increments, which are not one percentage: chest
 * grows faster than length. Sleeves step in proportion to their length, so a short sleeve grows
 * less than a long one. Kids rows grade from the same adult M.
 */
function gradedSizes(base: { chestFlatMm: number; bodyLengthMm: number; sleeveMm?: number }, rows: ChartRow[], ref: ChartRow = ADULT_SHIRTS[2]): GarmentSize[] {
  const [, refChest, refLength, refSleeve] = ref;
  return rows.map(([code, chest, length, sleeve]) => {
    const chestFlatMm = Math.round(base.chestFlatMm + (chest - refChest) * 10);
    const bodyLengthMm = Math.round(base.bodyLengthMm + (length - refLength) * 10);
    const sleeveLengthMm = base.sleeveMm && sleeve !== undefined && refSleeve ? Math.round(base.sleeveMm * (1 + (sleeve - refSleeve) / refSleeve)) : undefined;
    return { code, scale: Math.sqrt((chestFlatMm / base.chestFlatMm) * (bodyLengthMm / base.bodyLengthMm)), chestFlatMm, bodyLengthMm, sleeveLengthMm };
  });
}

/** Taekwondo dobok by height (cm): jacket length, chest flat, sleeve, relaxed waist flat, pants length. */
const DOBOK_CHART: readonly [code: string, alias: string, jacket: number, chest: number, sleeve: number, waist: number, pants: number][] = [
  ['100', '5XS', 51, 42.5, 34, 25, 65], ['110', '4XS', 56, 45.5, 37, 25, 70], ['120', '3XS', 61, 48.5, 40, 26, 74], ['130', '2XS', 66, 51.5, 42, 27, 84],
  ['140', 'XS', 71, 54.5, 44.5, 29, 90], ['150', 'S', 77, 56, 49, 30, 94.5], ['160', 'M', 80, 59, 50, 32, 100], ['170', 'L', 83, 61, 54, 34, 105],
  ['180', 'XL', 86, 64, 56.5, 36, 110], ['190', '2XL', 89, 66.5, 60.5, 38, 114], ['200', '3XL', 92, 69, 62, 40, 119], ['210', '4XL', 95, 71.5, 64, 41, 123],
];

/** How a size reads in pickers and specs: "170 cm (L)", "K8 (kids 8)", "XL". */
export function sizeLabel(model: GarmentModel, size: GarmentSize): string {
  if (model.category === 'uniform') return `${size.code} cm${size.alias ? ` (${size.alias})` : ''}`;
  return size.code.startsWith('K') ? `${size.code} (kids ${size.code.slice(1)})` : size.code;
}

/** Sleeve length from the shoulder seam for a size: from its chart, or graded with the size. */
export function sleeveLengthOf(model: GarmentModel, size: GarmentSize): number | undefined {
  return model.sleeve ? (size.sleeveLengthMm ?? Math.round(model.sleeve.lengthMm * size.scale)) : undefined;
}

/** Points of measure for every size, in millimetres, for the size guide and the tech sheet. */
export function sizeChart(model: GarmentModel) {
  const columns: { key: 'chest' | 'length' | 'sleeve' | 'waist' | 'pants'; label: string; hint: string }[] = [
    { key: 'chest', label: 'Chest', hint: 'Flat, armpit to armpit' },
    { key: 'length', label: model.category === 'uniform' ? 'Jacket' : 'Length', hint: 'From the high point of the shoulder' },
  ];
  if (model.sleeve) columns.push({ key: 'sleeve', label: 'Sleeve', hint: 'From the shoulder seam' });
  if (model.pants) columns.push({ key: 'waist', label: 'Waist', hint: 'Flat, relaxed' }, { key: 'pants', label: 'Pants', hint: 'Outside length' });
  const rows = model.sizes.map((s) => ({
    code: s.code,
    label: sizeLabel(model, s),
    values: { chest: s.chestFlatMm, length: s.bodyLengthMm, sleeve: sleeveLengthOf(model, s), waist: s.waistFlatMm, pants: s.pantsLengthMm } as Record<string, number | undefined>,
  }));
  return { columns, rows };
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
  sizes: gradedSizes({ chestFlatMm: 524, bodyLengthMm: 720, sleeveMm: 215 }, [...KIDS_SHIRTS, ...ADULT_SHIRTS]),
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
  sizes: gradedSizes({ chestFlatMm: 524, bodyLengthMm: 720, sleeveMm: 600 }, [...KIDS_SHIRTS, ...ADULT_SHIRTS]),
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
  sizes: gradedSizes({ chestFlatMm: 600, bodyLengthMm: 750, sleeveMm: 270 }, ADULT_SHIRTS),
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
  sizes: gradedSizes({ chestFlatMm: 524, bodyLengthMm: 710, sleeveMm: 225 }, ADULT_SHIRTS),
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
  sizes: gradedSizes({ chestFlatMm: 510, bodyLengthMm: 720 }, [...KIDS_SINGLETS, ...ADULT_SINGLETS], ADULT_SINGLETS[2]),
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
  sizes: gradedSizes({ chestFlatMm: 584, bodyLengthMm: 700, sleeveMm: 590 }, ADULT_SHIRTS),
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
  sizes: gradedSizes({ chestFlatMm: 552, bodyLengthMm: 730, sleeveMm: 235 }, [...KIDS_SHIRTS, ...ADULT_SHIRTS]),
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
  // Base pattern is size 170 (L) of the dobok size chart below.
  bodyLengthMm: 830,
  chestHalfWidthMm: 305,
  bodyHalfDepthMm: 128,
  shoulderHalfWidthMm: 262,
  neckRadiusMm: 104,
  frontNeckDropMm: 270,
  backNeckDropMm: 26,
  shoulderSlope: 0.2,
  neckline: 'dobok',
  trimWidthMm: 44,
  sleeve: { lengthMm: 540, angleDeg: 48, rootRadiusMm: 126, cuffRadiusMm: 96, cuff: 'open' },
  hem: 'slits',
  extras: {},
  pants: { waistHalfWidthMm: 232, waistHalfDepthMm: 128, hipHalfWidthMm: 296, riseMm: 330, inseamMm: 720, thighRadiusMm: 140, hemRadiusMm: 118, waistFromHpsMm: 470, waistFlatMm: 340 },
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
  sizes: DOBOK_CHART.map(([code, alias, jacket, chest, sleeve, waist, pants]) => ({
    code,
    alias,
    scale: Math.sqrt((chest / 61) * (jacket / 83)),
    chestFlatMm: chest * 10,
    bodyLengthMm: jacket * 10,
    sleeveLengthMm: sleeve * 10,
    waistFlatMm: waist * 10,
    pantsLengthMm: pants * 10,
  })),
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

/**
 * The size an order or roster names, as people write it: the code ("M", "170", "K8"), "170 cm",
 * the letter of a height size ("L" for a 170 dobok), "XXL" for 2XL or "kids 8". Undefined when the
 * garment has no such size.
 */
export function findSize(model: GarmentModel, label: string): GarmentSize | undefined {
  const norm = (s: string) =>
    s
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/CM$/, '')
      .replace(/^KIDS?(?=\d)/, 'K')
      .replace(/^(X{2,})([SL])$/, (_, xs: string, end: string) => `${xs.length}X${end}`);
  const want = norm(label);
  if (!want) return undefined;
  return model.sizes.find((s) => norm(s.code) === want) ?? model.sizes.find((s) => s.alias && norm(s.alias) === want);
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
