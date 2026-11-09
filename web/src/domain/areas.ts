/**
 * Design areas: print areas the person adds and places anywhere on the 3D garment, next to the
 * style's own zones. A zone and an area are both artboards (layers in stacking order), so the
 * editor, layer commands, checks and exports take either through these helpers.
 * Pure, no engine imports.
 */
import { newId } from './factory';
import { zoneSpecOrFirst, type GarmentModel, type ZoneSpec } from './garments';
import { isAreaId, PRINT_METHODS, type AreaId, type ArtboardId, type DesignArea, type DesignDocument, type LayerStack, type PrintMethod, type ProjectorSpec, type ZoneId } from './schema';

type WithAreas = Pick<DesignDocument, 'zones' | 'areas'>;

/** At most this many design areas per design: plenty of room, and every one is a print file. */
export const MAX_AREAS = 24;
/** A new area's size, mm: a generous badge or chest print. */
export const NEW_AREA_MM = 120;
/** Areas print by DTF unless chosen otherwise: it presses onto any fabric, anywhere on a finished garment. */
export const AREA_METHOD: PrintMethod = 'DTF';

/** Design areas in tab order. */
export function designAreas(doc: Pick<DesignDocument, 'areas'>): DesignArea[] {
  const a = doc.areas;
  return a ? a.orderedIds.map((id) => a.items[id]).filter(Boolean) : [];
}

/** The layers of a zone or design area (both keep their layers in stacking order with a print method). */
export function artboardOf(doc: WithAreas, id: ArtboardId): (LayerStack & { printMethod: PrintMethod }) | undefined {
  return isAreaId(id) ? doc.areas?.items[id] : doc.zones[id];
}

/** A design area as the print-zone description the editor, checks and exports work from. */
export function areaSpec(area: DesignArea): ZoneSpec {
  return {
    id: 'front',
    areaId: area.id,
    label: area.name,
    shortLabel: area.name,
    part: 'torso',
    printableWidthMm: area.widthMm,
    printableHeightMm: area.heightMm,
    safeInsetMm: Math.min(4, area.widthMm / 10, area.heightMm / 10),
    methods: [...PRINT_METHODS],
  };
}

/** The print-zone description of a zone, or of a design area (by its own size and name). */
export function artboardSpec(model: GarmentModel, doc: Pick<DesignDocument, 'areas'> | null | undefined, id: ArtboardId): ZoneSpec {
  if (isAreaId(id)) {
    const area = doc?.areas?.items[id];
    return area ? areaSpec(area) : zoneSpecOrFirst(model, model.zoneOrder[0]);
  }
  return zoneSpecOrFirst(model, id);
}

/** Whether `id` names something to design on: one of the style's zones, or one of this design's areas. */
export function hasArtboard(model: GarmentModel, doc: Pick<DesignDocument, 'areas'> | null | undefined, id: ArtboardId): boolean {
  return isAreaId(id) ? !!doc?.areas?.items[id] : !!model.zones[id as ZoneId];
}

/** A fresh area id. */
export function newAreaId(): AreaId {
  return `area_${newId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}`;
}

/** The first free "Area n" name. */
export function nextAreaName(doc: Pick<DesignDocument, 'areas'>): string {
  const taken = new Set(designAreas(doc).map((a) => a.name));
  for (let n = 1; ; n++) if (!taken.has(`Area ${n}`)) return `Area ${n}`;
}

/** A new, empty design area at `projector`. */
export function createArea(opts: { id: AreaId; name: string; projector: ProjectorSpec; widthMm?: number; heightMm?: number }): DesignArea {
  return {
    id: opts.id,
    name: opts.name,
    visible: true,
    locked: false,
    projector: opts.projector,
    widthMm: opts.widthMm ?? NEW_AREA_MM,
    heightMm: opts.heightMm ?? NEW_AREA_MM,
    rotationDeg: 0,
    printMethod: AREA_METHOD,
    orderedLayerIds: [],
    layers: {},
  };
}

/**
 * Where a design area sits, in words a factory can follow: the side of the garment it faces, its
 * centre's height above the hem and distance from the centre line, and its turn.
 */
export function describeAreaPlacement(area: DesignArea): string {
  const [x, y] = area.projector.point;
  const [nx, ny, nz] = area.projector.normal;
  const side =
    ny > 0.7 ? 'on top (shoulders or hood)' : ny < -0.7 ? 'underneath' : Math.abs(nz) >= Math.abs(nx) ? (nz >= 0 ? 'on the front' : 'on the back') : nx > 0 ? "on the wearer's left side" : "on the wearer's right side";
  const across = Math.abs(x) < 5 ? 'centred' : `${Math.round(Math.abs(x))} mm to the wearer's ${x > 0 ? 'left' : 'right'} of centre`;
  const turn = Math.round(area.rotationDeg) ? `, turned ${Math.round(area.rotationDeg)}°` : '';
  return `${Math.round(area.widthMm)} × ${Math.round(area.heightMm)} mm ${side}, centre ${Math.round(y)} mm above the hem, ${across}${turn}`;
}

/** Every zone and area that holds artwork, for code that gathers what a design uses (fonts, images). */
export function allStacks(doc: WithAreas): LayerStack[] {
  return [...Object.values(doc.zones), ...designAreas(doc)];
}
