/**
 * Garment catalogue (spec §7, §28). Each model carries physical measurements and its
 * print-zone metadata (the zones.json equivalent). The 3D geometry is procedural for now;
 * a calibrated GLB from a 3D artist replaces it later without changing these zone contracts.
 */
import type { PrintMethod, ZoneId } from './schema';

export interface ZoneSpec {
  id: ZoneId;
  label: string;
  shortLabel: string;
  /** Which garment surface carries the zone. */
  part: 'torso' | 'sleeveLeft' | 'sleeveRight';
  printableWidthMm: number;
  printableHeightMm: number;
  /** Inner margin that should stay clear of artwork edges. */
  safeInsetMm: number;
  /** Torso zones: distance from the high point of shoulder to the top of the printable area. */
  topFromHpsMm?: number;
  /** Sleeve zones: distance from the shoulder seam to the zone centre, along the sleeve. */
  centerFromShoulderMm?: number;
  methods: PrintMethod[];
}

export interface GarmentSize {
  code: string;
  /** Uniform grading factor applied to the base pattern. Print zones stay in true millimetres. */
  scale: number;
  chestFlatMm: number;
  bodyLengthMm: number;
}

export interface GarmentModel {
  id: string;
  assetVersion: string;
  name: string;
  category: 'tee';
  calibrated: boolean;
  /** Base pattern measurements, size M. */
  bodyLengthMm: number;
  chestHalfWidthMm: number;
  bodyHalfDepthMm: number;
  shoulderHalfWidthMm: number;
  neckRadiusMm: number;
  frontNeckDropMm: number;
  backNeckDropMm: number;
  shoulderSlope: number;
  sleeveLengthMm: number;
  sleeveAngleDeg: number;
  zones: Record<ZoneId, ZoneSpec>;
  sizes: GarmentSize[];
  defaultSize: string;
  fabricPresets: { id: string; label: string; gsm: number }[];
}

const ALL_FLAT: PrintMethod[] = ['DTG', 'DTF', 'SCREEN_PRINT', 'HEAT_TRANSFER', 'PUFF_PRINT', 'EMBROIDERY'];

export const TEE_CLASSIC: GarmentModel = {
  id: 'tee-classic',
  assetVersion: '0.1.0-procedural',
  name: 'Classic crew tee',
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
  sleeveLengthMm: 215,
  sleeveAngleDeg: 30,
  zones: {
    front: {
      id: 'front', label: 'Front', shortLabel: 'Front', part: 'torso',
      printableWidthMm: 300, printableHeightMm: 400, safeInsetMm: 10, topFromHpsMm: 170,
      methods: [...ALL_FLAT, 'SUBLIMATION'],
    },
    back: {
      id: 'back', label: 'Back', shortLabel: 'Back', part: 'torso',
      printableWidthMm: 300, printableHeightMm: 420, safeInsetMm: 10, topFromHpsMm: 110,
      methods: [...ALL_FLAT, 'SUBLIMATION'],
    },
    left_sleeve: {
      id: 'left_sleeve', label: 'Left sleeve', shortLabel: 'L sleeve', part: 'sleeveLeft',
      printableWidthMm: 90, printableHeightMm: 90, safeInsetMm: 6, centerFromShoulderMm: 95,
      methods: ['DTG', 'DTF', 'SCREEN_PRINT', 'HEAT_TRANSFER', 'EMBROIDERY'],
    },
    right_sleeve: {
      id: 'right_sleeve', label: 'Right sleeve', shortLabel: 'R sleeve', part: 'sleeveRight',
      printableWidthMm: 90, printableHeightMm: 90, safeInsetMm: 6, centerFromShoulderMm: 95,
      methods: ['DTG', 'DTF', 'SCREEN_PRINT', 'HEAT_TRANSFER', 'EMBROIDERY'],
    },
  },
  sizes: [
    { code: 'S', scale: 0.94, chestFlatMm: 492, bodyLengthMm: 690 },
    { code: 'M', scale: 1, chestFlatMm: 524, bodyLengthMm: 720 },
    { code: 'L', scale: 1.06, chestFlatMm: 556, bodyLengthMm: 750 },
    { code: 'XL', scale: 1.12, chestFlatMm: 588, bodyLengthMm: 780 },
    { code: '2XL', scale: 1.18, chestFlatMm: 620, bodyLengthMm: 810 },
  ],
  defaultSize: 'M',
  fabricPresets: [
    { id: 'jersey-180', label: 'Cotton jersey, 180 gsm', gsm: 180 },
    { id: 'heavy-240', label: 'Heavyweight cotton, 240 gsm', gsm: 240 },
    { id: 'poly-140', label: 'Performance polyester, 140 gsm', gsm: 140 },
  ],
};

export const GARMENTS: Record<string, GarmentModel> = { [TEE_CLASSIC.id]: TEE_CLASSIC };

export function getGarment(modelId: string): GarmentModel {
  return GARMENTS[modelId] ?? TEE_CLASSIC;
}

export function getSize(model: GarmentModel, code: string): GarmentSize {
  return model.sizes.find((s) => s.code === code) ?? model.sizes.find((s) => s.code === model.defaultSize)!;
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

export const COLORWAY_PRESETS = [
  { name: 'Optic white', parts: { body: '#F4F4F1', sleeves: '#F4F4F1', collar: '#F4F4F1', stitching: '#E2E2DD' } },
  { name: 'Jet black', parts: { body: '#16161A', sleeves: '#16161A', collar: '#16161A', stitching: '#2A2A30' } },
  { name: 'Heather grey', parts: { body: '#A9AAAD', sleeves: '#A9AAAD', collar: '#9A9B9F', stitching: '#8E8F93' } },
  { name: 'Deep navy', parts: { body: '#1C2740', sleeves: '#1C2740', collar: '#1C2740', stitching: '#2A3654' } },
  { name: 'Forest', parts: { body: '#2F4A3A', sleeves: '#2F4A3A', collar: '#2F4A3A', stitching: '#3B5A48' } },
  { name: 'Sand', parts: { body: '#D8C7A8', sleeves: '#D8C7A8', collar: '#D8C7A8', stitching: '#C6B392' } },
] as const;
