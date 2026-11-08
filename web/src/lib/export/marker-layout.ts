/**
 * What goes on a fabric marker and how it is laid, with no canvas code, so the export and the
 * roll-width comparison worker share it. One set of pattern pieces per garment in the order, each
 * in its ordered size. The outlines come from the 3D garment's own fabric layout, so they are the
 * same pieces the cut-and-sew panels print.
 */
import { buildGarment, partSizeMm, type GarmentGeometry, type GarmentIsland } from '@/components/studio/viewer3d/garment-geometry';
import { findSize, getSize, type GarmentModel, type GarmentSize } from '@/domain/garments';
import { nest, polygonArea, type NestOptions, type NestPiece, type NestResult, type Point } from './nesting';
import type { Roster } from './roster';

/** Printed bleed past every cut line, on cut-and-sew panels and markers alike. */
export const BLEED_MM = 10;

export interface MarkerSettings {
  /** Fabric roll width in centimetres. */
  rollWidthCm: number;
  /** Clear fabric between neighbouring pieces' bleed. */
  gapMm: number;
  /** Clear fabric along both selvedges and at the ends of each roll length. */
  marginMm: number;
  /** Pieces may turn 180°, never 90°, so the grain stays straight. Off for napped or one-way fabric. */
  allowTurn: boolean;
  /** Longest roll length per file, in metres. */
  lengthPerFileM: number;
  format: 'png' | 'pdf';
}

export const ROLL_WIDTHS_CM = [110, 150, 160, 180] as const;
export const FILE_LENGTHS_M = [1, 2, 3, 5] as const;
export const DEFAULT_MARKER: MarkerSettings = { rollWidthCm: 160, gapMm: 5, marginMm: 15, allowTurn: true, lengthPerFileM: 3, format: 'png' };
/** The largest page PDF readers accept: 200 inches. */
const PDF_MAX_MM = 5080;

const clamp = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

export function markerNestOptions(s: MarkerSettings): NestOptions {
  return {
    rollWidthMm: clamp(s.rollWidthCm, 30, 500, DEFAULT_MARKER.rollWidthCm) * 10,
    gapMm: clamp(s.gapMm, 0, 50, DEFAULT_MARKER.gapMm),
    marginMm: clamp(s.marginMm, 0, 100, DEFAULT_MARKER.marginMm),
    bleedMm: BLEED_MM,
    allowTurn: s.allowTurn,
    maxLengthMm: Math.min(clamp(s.lengthPerFileM, 0.5, 100, DEFAULT_MARKER.lengthPerFileM) * 1000, s.format === 'pdf' ? PDF_MAX_MM : Infinity),
  };
}

export interface MarkerSet {
  /** Position in the order: the roster row, when there is a roster. */
  index: number;
  size: GarmentSize;
  /** The roster row this garment is for, which personalises its print. */
  row?: Record<string, string>;
  /** "#3 Sokha 7", or "#3" without a name or number. */
  label: string;
}

/** One garment per roster row, in its size; without a roster, one garment in the sample size. */
export function orderSets(model: GarmentModel, sampleSize: string, roster: Roster | null): { sets: MarkerSet[]; unknownSizes: string[] } {
  const sample = getSize(model, sampleSize);
  if (!roster?.rows.length) return { sets: [{ index: 0, size: sample, label: '#1' }], unknownSizes: [] };
  const unknown = new Set<string>();
  const sets = roster.rows.map((row, index) => {
    const asked = (row.size ?? '').trim();
    const size = asked ? findSize(model, asked) : undefined;
    if (asked && !size) unknown.add(asked);
    const who = [row.name, row.number].filter(Boolean).join(' ');
    return { index, size: size ?? sample, row, label: `#${index + 1}${who ? ` ${who}` : ''}` };
  });
  return { sets, unknownSizes: [...unknown] };
}

/** One pattern piece in one size. */
export interface MarkerShape {
  key: string;
  size: GarmentSize;
  island: GarmentIsland;
  /** The island's part texture in millimetres: outline x = u·w, y = (1 − v)·h. */
  partMm: { w: number; h: number };
  outline: Point[];
  areaMm2: number;
}

export interface MarkerPiece extends NestPiece {
  set: MarkerSet;
  info: MarkerShape;
}

/**
 * Every piece of every set, with its outline in millimetres. Garments are built flat (no drape)
 * once per size; their meshes are dropped and the layout, edges and outlines kept for printing.
 */
export function markerPieces(model: GarmentModel, sets: MarkerSet[], detail: 'low' | 'high' = 'high') {
  const geos = new Map<string, GarmentGeometry>();
  const shapes = new Map<string, MarkerShape>();
  const pieces: MarkerPiece[] = [];
  for (const set of sets) {
    let geo = geos.get(set.size.code);
    if (!geo) {
      const built = buildGarment(model, set.size, detail, 0);
      for (const p of built.parts) p.geometry.dispose();
      for (const t of built.trims) t.geometry.dispose();
      geo = { ...built, parts: [], trims: [] };
      geos.set(set.size.code, geo);
    }
    for (const island of geo.islands) {
      const key = `${set.size.code}/${island.id}`;
      let info = shapes.get(key);
      if (!info) {
        const mm = partSizeMm(geo, island.part);
        const outline = island.uv.map(([u, v]) => [u * mm.w, (1 - v) * mm.h] as Point);
        info = { key, size: set.size, island, partMm: mm, outline, areaMm2: polygonArea(outline) };
        shapes.set(key, info);
      }
      pieces.push({ id: `${set.index + 1}/${island.id}`, shape: key, outline: info.outline, group: set.index, set, info });
    }
  }
  return { pieces, shapes, geos };
}

export interface RollEstimate {
  rollWidthCm: number;
  lengthMm: number;
  utilisation: number;
  lengths: number;
  unplaced: number;
}

/** Fabric needed for the order on each roll width, for choosing the roll. */
export function compareRollWidths(model: GarmentModel, sampleSize: string, roster: Roster | null, settings: MarkerSettings, widthsCm: readonly number[]): RollEstimate[] {
  const { sets } = orderSets(model, sampleSize, roster);
  const { pieces } = markerPieces(model, sets, 'high');
  return widthsCm.map((rollWidthCm) => {
    const r: NestResult = nest(pieces, markerNestOptions({ ...settings, rollWidthCm }));
    return { rollWidthCm, lengthMm: r.lengthMm, utilisation: r.utilisation, lengths: r.sections.length, unplaced: r.unplaced.length };
  });
}
