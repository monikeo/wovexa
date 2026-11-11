/**
 * Reusable lockups (spec ED2-12): a crest, a sponsor block or a name-and-number set designed once
 * on its own board and placed on any zone or design area as one layer, at any size and turn. Each
 * placement carries a copy of the lockup's layers, so it draws, exports and prints on its own;
 * after every edit `syncPlacements` brings the copies in step with the lockup, in the same undo
 * step. Pure, no engine imports.
 */
import { newId } from './factory';
import { rotatedBounds } from './geometry';
import { canonicalJson } from './hash';
import type { ArtboardId, ArtworkLayer, DesignDocument, LayerStack, LayerTransform, Lockup, LockupContent, LockupId, PlainLayer, ProjectedLayer } from './schema';

/** At most this many lockups per design. */
export const MAX_LOCKUPS = 40;
/** At most this many layers in one lockup. */
export const MAX_LOCKUP_LAYERS = 60;

export type Placement = ArtworkLayer & { content: LockupContent };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The design's lockups, in the order they were made. */
export function lockupsOf(doc: Pick<DesignDocument, 'lockups'>): Lockup[] {
  const l = doc.lockups;
  return l ? l.orderedIds.map((id) => l.items[id]).filter(Boolean) : [];
}

/** A fresh lockup id. */
export function newLockupId(): LockupId {
  return `lockup_${newId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}`;
}

/** The first free "Lockup n" name. */
export function nextLockupName(doc: Pick<DesignDocument, 'lockups'>): string {
  const taken = new Set(lockupsOf(doc).map((l) => l.name));
  for (let n = 1; ; n++) if (!taken.has(`Lockup ${n}`)) return `Lockup ${n}`;
}

/** Whether a layer can go inside a lockup: anything but another lockup's placement. */
export function isPlainLayer(layer: ArtworkLayer): layer is PlainLayer {
  return layer.content.kind !== 'lockup';
}

export function isPlacement(layer: ArtworkLayer | undefined): layer is Placement {
  return layer?.content.kind === 'lockup';
}

/** The lockup's layers a placement carries, bottom first (a placement inside a lockup is left out). */
function plainOrder(lockup: Pick<Lockup, 'orderedLayerIds' | 'layers'>): string[] {
  return lockup.orderedLayerIds.filter((id) => lockup.layers[id] && isPlainLayer(lockup.layers[id]));
}

/** The copy of a lockup's artwork that a placement carries. */
export function lockupContent(lockup: Lockup): LockupContent {
  const order = plainOrder(lockup);
  return {
    kind: 'lockup',
    lockupId: lockup.id,
    name: lockup.name,
    widthMm: lockup.widthMm,
    heightMm: lockup.heightMm,
    orderedLayerIds: order,
    layers: Object.fromEntries(order.map((id) => [id, clone(lockup.layers[id]) as PlainLayer])),
  };
}

/** A lockup rebuilt from a placement's copy of it: for a placement whose lockup is not in this design (pasted from another). */
export function lockupFromContent(c: LockupContent): Lockup {
  return { id: c.lockupId as LockupId, name: c.name, widthMm: c.widthMm, heightMm: c.heightMm, orderedLayerIds: [...c.orderedLayerIds], layers: clone(c.layers) };
}

/** A stack's layers with the layers inside its lockup placements: for gathering fonts, images and words. */
export function deepLayers(stack: Pick<LayerStack, 'layers'>): ArtworkLayer[] {
  const out: ArtworkLayer[] = [];
  for (const layer of Object.values(stack.layers)) {
    out.push(layer);
    if (layer.content.kind === 'lockup') out.push(...Object.values(layer.content.layers));
  }
  return out;
}

/** Image assets a layer draws, its own or those inside a lockup placement. */
export function layerAssetIds(layer: ArtworkLayer): string[] {
  const c = layer.content;
  if (c.kind === 'image') return [c.assetId];
  if (c.kind === 'lockup') return Object.values(c.layers).flatMap((l) => (l.content.kind === 'image' ? [l.content.assetId] : []));
  return [];
}

/** Where a layer lives: a zone or design area (by artboard id), or across seams. */
export type PlacementSite = { artboard: ArtboardId; layerId: string } | { artboard: null; layerId: string };

/** Every layer that places a lockup (`lockupId`, or any), in zones, design areas and across seams. */
export function placementsOf(doc: Pick<DesignDocument, 'zones' | 'areas' | 'projections'>, lockupId?: string): PlacementSite[] {
  const out: PlacementSite[] = [];
  const wanted = (layer: ArtworkLayer | ProjectedLayer) => layer.content.kind === 'lockup' && (!lockupId || layer.content.lockupId === lockupId);
  for (const [zoneId, zone] of Object.entries(doc.zones)) for (const id of zone.orderedLayerIds) if (zone.layers[id] && wanted(zone.layers[id])) out.push({ artboard: zoneId as ArtboardId, layerId: id });
  for (const area of Object.values(doc.areas?.items ?? {})) for (const id of area.orderedLayerIds) if (area.layers[id] && wanted(area.layers[id])) out.push({ artboard: area.id as ArtboardId, layerId: id });
  for (const id of doc.projections.orderedLayerIds) if (doc.projections.layers[id] && wanted(doc.projections.layers[id])) out.push({ artboard: null, layerId: id });
  return out;
}

function layerAt(doc: Pick<DesignDocument, 'zones' | 'areas' | 'projections'>, site: PlacementSite): ArtworkLayer | ProjectedLayer | undefined {
  if (site.artboard === null) return doc.projections.layers[site.layerId];
  if (site.artboard.startsWith('area_')) return doc.areas?.items[site.artboard as `area_${string}`]?.layers[site.layerId];
  return doc.zones[site.artboard as keyof DesignDocument['zones']]?.layers[site.layerId];
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Bring every placement of each lockup that changed from `before` to `after` in step with it. Runs
 * on `draft`, a draft of `after`, so the copies change in the same undo step as the lockup.
 * Unchanged layers are left alone, so a drag inside a lockup only rewrites the layer dragged.
 */
export function syncPlacements(draft: DesignDocument, before: DesignDocument, after: DesignDocument): void {
  const changed = lockupsOf(after).filter((l) => before.lockups?.items[l.id] !== l);
  for (const lockup of changed) {
    const prev = before.lockups?.items[lockup.id];
    const order = plainOrder(lockup);
    for (const site of placementsOf(after, lockup.id)) {
      const layer = layerAt(draft, site);
      if (layer?.content.kind !== 'lockup') continue;
      const c = layer.content;
      // A placement still named after the lockup follows its new name.
      if (prev && prev.name !== lockup.name && layer.name === prev.name) layer.name = lockup.name;
      if (c.name !== lockup.name) c.name = lockup.name;
      if (c.widthMm !== lockup.widthMm) c.widthMm = lockup.widthMm;
      if (c.heightMm !== lockup.heightMm) c.heightMm = lockup.heightMm;
      if (!sameIds(c.orderedLayerIds, order)) c.orderedLayerIds = [...order];
      for (const id of order) {
        if (!c.layers[id] || !prev || prev.layers[id] !== lockup.layers[id]) c.layers[id] = clone(lockup.layers[id]) as PlainLayer;
      }
      for (const id of Object.keys(c.layers)) if (!order.includes(id)) delete c.layers[id];
    }
  }
}

/**
 * Give every placement in a document (a plain one, not a draft) a fresh copy of its lockup: for
 * code that changes lockups outside the commands, such as fitting a template's text boxes.
 */
export function refreshPlacements(doc: DesignDocument): void {
  for (const site of placementsOf(doc)) {
    const layer = layerAt(doc, site);
    const lockup = layer?.content.kind === 'lockup' ? doc.lockups?.items[layer.content.lockupId as LockupId] : undefined;
    if (layer && lockup) layer.content = lockupContent(lockup);
  }
}

/** The layers' footprint on their artboard: the box round their turned boxes, mm. */
export function layersBounds(layers: Pick<ArtworkLayer, 'transform'>[]): { x: number; y: number; w: number; h: number } | null {
  if (!layers.length) return null;
  const boxes = layers.map((l) => rotatedBounds(l.transform));
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, w: Math.max(0.5, x1 - x0), h: Math.max(0.5, y1 - y0) };
}

/**
 * A lockup made of `layers` (in stacking order, bottom first), its board fitted round them, and
 * the placement that takes their place where they were.
 */
export function lockupFromLayers(layers: ArtworkLayer[], opts: { id: LockupId; name: string; placementId: string }): { lockup: Lockup; placement: Placement } | null {
  const plain = layers.filter(isPlainLayer);
  const box = layersBounds(plain);
  if (!box) return null;
  const inner = plain.slice(0, MAX_LOCKUP_LAYERS).map((l) => {
    const copy = clone(l);
    copy.transform.centerXmm -= box.x;
    copy.transform.centerYmm -= box.y;
    copy.locked = false;
    return copy;
  });
  // The bottom layer has nothing under it to clip to on the lockup's own board.
  if (inner[0]) delete inner[0].clip;
  const lockup: Lockup = {
    id: opts.id,
    name: opts.name.slice(0, 60) || 'Lockup',
    widthMm: box.w,
    heightMm: box.h,
    orderedLayerIds: inner.map((l) => l.id),
    layers: Object.fromEntries(inner.map((l) => [l.id, l])),
  };
  const placement: Placement = {
    id: opts.placementId,
    name: lockup.name,
    visible: true,
    locked: false,
    transform: { centerXmm: box.x + box.w / 2, centerYmm: box.y + box.h / 2, widthMm: box.w, heightMm: box.h, rotationDeg: 0, flipX: false, flipY: false },
    style: { opacity: 1, blendMode: 'normal', finish: 'flat_ink' },
    content: lockupContent(lockup),
  };
  return { lockup, placement };
}

/**
 * A new placement of `lockup` centred at (`cx`, `cy`) on an artboard: at the lockup's own size,
 * shrunk to fit `maxW` × `maxH` when it is bigger.
 */
export function newPlacement(lockup: Lockup, id: string, at: { cx: number; cy: number; maxW: number; maxH: number }): Placement {
  const k = Math.min(1, at.maxW / lockup.widthMm, at.maxH / lockup.heightMm);
  return {
    id,
    name: lockup.name,
    visible: true,
    locked: false,
    transform: { centerXmm: at.cx, centerYmm: at.cy, widthMm: Math.max(0.5, lockup.widthMm * k), heightMm: Math.max(0.5, lockup.heightMm * k), rotationDeg: 0, flipX: false, flipY: false },
    style: { opacity: 1, blendMode: 'normal', finish: 'flat_ink' },
    content: lockupContent(lockup),
  };
}

/**
 * A placement's layers as ordinary layers where it is: moved, scaled, turned and mirrored with it,
 * kept together as one group, each with its own new id (`ids` makes them). Exact when the
 * placement is scaled evenly; a turned layer in a placement stretched one way gets the box nearest
 * its stretched shape.
 */
export function detachedLayers(placement: Placement, ids: (layer: PlainLayer) => string, groupId: string): ArtworkLayer[] {
  const t = placement.transform;
  const c = placement.content;
  const sx = t.widthMm / c.widthMm;
  const sy = t.heightMm / c.heightMm;
  const a = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const mirrored = t.flipX !== t.flipY;
  const out: ArtworkLayer[] = [];
  for (const id of c.orderedLayerIds) {
    const layer = c.layers[id];
    if (!layer) continue;
    const lt = layer.transform;
    let dx = (lt.centerXmm - c.widthMm / 2) * sx;
    let dy = (lt.centerYmm - c.heightMm / 2) * sy;
    if (t.flipX) dx = -dx;
    if (t.flipY) dy = -dy;
    const r = (lt.rotationDeg * Math.PI) / 180;
    // Where the layer's own across direction points once stretched by the placement.
    let turn = (Math.atan2(sy * Math.sin(r), sx * Math.cos(r)) * 180) / Math.PI;
    if (mirrored) turn = -turn;
    const transform: LayerTransform = {
      centerXmm: t.centerXmm + dx * cos - dy * sin,
      centerYmm: t.centerYmm + dx * sin + dy * cos,
      widthMm: Math.max(0.5, lt.widthMm * Math.hypot(sx * Math.cos(r), sy * Math.sin(r))),
      heightMm: Math.max(0.5, lt.heightMm * Math.hypot(sx * Math.sin(r), sy * Math.cos(r))),
      rotationDeg: ((((turn + t.rotationDeg + 180) % 360) + 360) % 360) - 180,
      flipX: lt.flipX !== t.flipX,
      flipY: lt.flipY !== t.flipY,
    };
    const copy = clone(layer) as ArtworkLayer;
    copy.id = ids(layer);
    copy.transform = transform;
    copy.style.opacity = Math.max(0, Math.min(1, copy.style.opacity * placement.style.opacity));
    if (groupId) copy.groupId = groupId;
    else delete copy.groupId;
    copy.locked = false;
    out.push(copy);
  }
  // Clipping inside the lockup stays inside it: the bottom layers have nothing of theirs under them.
  for (const layer of out) {
    if (!layer.clip) break;
    delete layer.clip;
  }
  if (out.length === 1) delete out[0].groupId;
  return out;
}

// ---- Lockups kept in brand kits ----

/** What two versions of a lockup compare on: its artwork and name, not where it came from or its board guides. */
function lockupBody(lockup: Lockup) {
  const body: Partial<Lockup> = { ...lockup };
  delete body.kit;
  delete body.guides;
  return body;
}

/** Whether two versions of a lockup look and read the same. */
export function sameLockup(a: Lockup, b: Lockup) {
  return canonicalJson(lockupBody(a)) === canonicalJson(lockupBody(b));
}

/** A brand kit's saved lockup: the lockup as saved and when. */
export interface KitLockupVersion {
  lockup: Lockup;
  savedAt: number;
}

/**
 * How this design's copy of a kit lockup compares with the kit's: not in the design, the same, the
 * kit has a newer version (saved after the one the design has), or changed here since.
 */
export type KitLockupStatus = 'absent' | 'same' | 'kit-newer' | 'changed-here';

export function kitLockupStatus(doc: Pick<DesignDocument, 'lockups'>, entry: KitLockupVersion): KitLockupStatus {
  const mine = doc.lockups?.items[entry.lockup.id as LockupId];
  if (!mine) return 'absent';
  if (sameLockup(mine, entry.lockup)) return 'same';
  return (mine.kit?.savedAt ?? 0) < entry.savedAt ? 'kit-newer' : 'changed-here';
}

/** A kit's lockup as this design's: the same id, marked with the kit version it came from. */
export function lockupFromKit(entry: KitLockupVersion, kitId: string): Lockup {
  return { ...clone(entry.lockup), kit: { kitId, savedAt: entry.savedAt } };
}

/** This design's lockup as a brand kit keeps it: without the design's own note of where it came from. */
export function lockupForKit(lockup: Lockup): Lockup {
  const copy = clone(lockup);
  delete copy.kit;
  return copy;
}

/**
 * The lockup's board refitted round its artwork after editing: where the old board's corner moves
 * to and the new size (mm), and the same as fractions of the old board, which keeps every
 * placement's artwork exactly where it was. Null when the board already fits.
 */
export function boardFit(lockup: Lockup): { x: number; y: number; w: number; h: number; crop: { x: number; y: number; w: number; h: number } } | null {
  const layers = plainOrder(lockup).map((id) => lockup.layers[id]);
  const box = layersBounds(layers);
  if (!box) return null;
  const close = (a: number, b: number) => Math.abs(a - b) < 0.05;
  if (close(box.x, 0) && close(box.y, 0) && close(box.w, lockup.widthMm) && close(box.h, lockup.heightMm)) return null;
  return { ...box, crop: { x: box.x / lockup.widthMm, y: box.y / lockup.heightMm, w: box.w / lockup.widthMm, h: box.h / lockup.heightMm } };
}
