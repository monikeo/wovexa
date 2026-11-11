'use client';
/**
 * Studio actions for artwork across seams: lift zone artwork onto the 3D garment where it sits
 * (so it can be dragged over a shoulder or round a side seam), put it back on a print zone,
 * and select, duplicate, delete or scale projected layers. Every edit is one domain command.
 */
import * as cmd from '@/domain/commands';
import { newId } from '@/domain/factory';
import { getGarment, getSize, hasZone, zoneSpecOrFirst } from '@/domain/garments';
import { clamp, normalizeDeg } from '@/domain/geometry';
import { gradePoint, ungradePoint, zoneGrade } from '@/domain/grading';
import { artworkAsProjected, projectedAsArtwork } from '@/domain/projected';
import { isAreaId, isLockupId, type DesignDocument, type ProjectedLayer, type ProjectorSpec, type ZoneId } from '@/domain/schema';
import { toast } from '@/components/ui/primitives';
import { useStudio } from '@/stores/studio-store';
import { angleAbout, slideProjector, surfaceAlong, surfaceAtUv, textureAxes } from './viewer3d/projection';
import { restShape } from './viewer3d/rest-shape';
import { partForZone, uvToZone, zoneToUv } from './viewer3d/uv-mapping';

function garmentAtRest(doc: DesignDocument) {
  const model = getGarment(doc.garment.modelId);
  return { model, rest: restShape(model, getSize(model, doc.garment.sizeCode), 'high') };
}

/** A projector at a print-zone point: on the cloth there, its up along the zone's up. */
export function projectorAtZonePoint(doc: DesignDocument, zoneId: ZoneId, xMm: number, yMm: number): ProjectorSpec | null {
  const { model, rest } = garmentAtRest(doc);
  const part = rest.parts.find((p) => p.id === partForZone(zoneId));
  if (!part || !model.zones[zoneId]) return null;
  const { u, v } = zoneToUv(model, rest.layout, zoneId, xMm, yMm);
  const hit = surfaceAtUv(part.mesh, u, v);
  if (!hit) return null;
  return { point: [...hit.point], normal: [...hit.normal], up: [...hit.textureUp] };
}

/** Show the 3D garment, where projected artwork lives, and hand the pointer to placing it. */
export function showOnGarment() {
  const s = useStudio.getState();
  if (s.viewMode === '2d') s.setViewMode(typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches ? 'split' : '3d');
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wovexa:place-on-garment'));
}

/** Lift the selected zone layers onto the garment where they are, ready to drag across seams. One undo step. */
export function wrapSelectionAcrossSeams() {
  const s = useStudio.getState();
  const doc = s.document;
  if (!doc) return;
  const zoneId = s.activeZoneId;
  if (isAreaId(zoneId)) {
    toast('Artwork in a design area already sits on the garment: move the whole area anywhere in Place mode.');
    return;
  }
  if (isLockupId(zoneId)) {
    toast('A lockup’s own board isn’t on the garment: wrap one of its placements instead.');
    return;
  }
  const zone = doc.zones[zoneId];
  const layers = s.selectedLayerIds.map((id) => zone.layers[id]).filter(Boolean);
  if (!layers.length) return;
  if (doc.projections.orderedLayerIds.length + layers.length > 50) {
    toast('A design can hold 50 layers across seams.', 'error');
    return;
  }
  const projected: ProjectedLayer[] = [];
  // Artwork graded by size lifts off where, and at the size, it shows on the size on show.
  const spec = getGarment(doc.garment.modelId).zones[zoneId];
  const factor = spec ? zoneGrade(doc, zoneId, doc.garment.sizeCode) : 1;
  for (const layer of layers) {
    const at = spec ? gradePoint(spec, factor, layer.transform.centerXmm, layer.transform.centerYmm) : { xMm: layer.transform.centerXmm, yMm: layer.transform.centerYmm };
    const projector = projectorAtZonePoint(doc, zoneId, at.xMm, at.yMm);
    if (!projector) {
      toast(`${layer.name} isn’t on this garment’s surface, so it can’t be wrapped.`, 'error');
      return;
    }
    const lifted = artworkAsProjected(layer, projector);
    lifted.transform.widthMm *= factor;
    lifted.transform.heightMm *= factor;
    projected.push(lifted);
  }
  const commands = projected.map((p) => cmd.wrapAcrossSeams(zoneId, p.id, p));
  s.dispatch(commands.length === 1 ? commands[0] : cmd.batch('Wrap across seams', commands));
  s.selectProjection(projected[projected.length - 1].id);
  showOnGarment();
  toast('Now on the garment: drag it over a seam in Place mode. It prints by sublimation or cut-and-sew.');
}

/**
 * Put projected artwork back on the print zone under its centre, turned to match how it sits on
 * the garment, e.g. to print it by DTG or screen. Falls back to the active zone off the zones.
 */
export function returnProjectionToZone(layerId: string) {
  const s = useStudio.getState();
  const doc = s.document;
  const layer = doc?.projections.layers[layerId];
  if (!doc || !layer) return;
  const { model, rest } = garmentAtRest(doc);
  let zoneId: ZoneId = !isAreaId(s.activeZoneId) && !isLockupId(s.activeZoneId) && hasZone(model, s.activeZoneId) ? s.activeZoneId : model.zoneOrder[0];
  let at: { xMm: number; yMm: number } | null = null;
  let turn = 0;
  const hit = surfaceAlong(
    rest.parts.map((p) => p.mesh),
    layer.projector.point,
    layer.projector.normal,
    150,
  );
  if (hit) {
    const part = rest.parts[hit.mesh];
    const z = uvToZone(model, rest.layout, part.id, hit.uv[0], hit.uv[1]);
    if (z) {
      zoneId = z.zoneId;
      at = { xMm: z.xMm, yMm: z.yMm };
      turn = angleAbout(textureAxes(part.mesh, hit.triangle).up, layer.projector.up, hit.normal);
    }
  }
  const spec = zoneSpecOrFirst(model, zoneId);
  // On a size where the zone's artwork shows graded, the point and size on the garment are that
  // size's: back in the zone they are the design's own, ungraded.
  const factor = zoneGrade(doc, spec.id, doc.garment.sizeCode);
  const designed = at ? ungradePoint(spec, factor, at.xMm, at.yMm) : null;
  const center = designed ? { xMm: clamp(designed.xMm, 0, spec.printableWidthMm), yMm: clamp(designed.yMm, 0, spec.printableHeightMm) } : { xMm: spec.printableWidthMm / 2, yMm: spec.printableHeightMm / 2 };
  const art = projectedAsArtwork(layer, center);
  art.transform.widthMm = Math.max(0.5, art.transform.widthMm / factor);
  art.transform.heightMm = Math.max(0.5, art.transform.heightMm / factor);
  art.transform.rotationDeg = normalizeDeg(art.transform.rotationDeg + turn);
  s.dispatch(cmd.returnToZone(layerId, spec.id, art));
  s.setActiveZone(spec.id);
  s.select([art.id]);
  toast(`Back on the ${spec.label.toLowerCase()} print zone.`);
}

export function selectProjection(layerId: string) {
  useStudio.getState().selectProjection(layerId);
  showOnGarment();
}

export function deleteProjection(layerId: string) {
  const s = useStudio.getState();
  s.dispatch(cmd.removeProjectedLayers([layerId]));
  s.selectProjection(null);
}

export function duplicateProjection(layerId: string) {
  const s = useStudio.getState();
  const id = newId();
  if (s.dispatch(cmd.duplicateProjectedLayer(layerId, id))) s.selectProjection(id);
}

/** Move a projected layer one step up (+1) or down (−1) the stack. */
export function moveProjectionBy(layerId: string, delta: 1 | -1) {
  const s = useStudio.getState();
  const order = s.document?.projections.orderedLayerIds ?? [];
  const at = order.indexOf(layerId);
  if (at < 0) return;
  s.dispatch(cmd.reorderProjectedLayer(layerId, at + delta));
}

/** Nudge a projected layer across the cloth, in mm (x right, y down as seen from outside), like a zone nudge. */
export function nudgeProjection(layerId: string, dxMm: number, dyMm: number) {
  const s = useStudio.getState();
  const doc = s.document;
  const layer = doc?.projections.layers[layerId];
  if (!doc || !layer || layer.locked) return;
  const { rest } = garmentAtRest(doc);
  const moved = slideProjector(
    rest.parts.map((p) => p.mesh),
    layer.projector,
    dxMm,
    -dyMm,
  );
  if (!moved) return;
  const projector: ProjectorSpec = { point: [...moved.point], normal: [...moved.normal], up: [...moved.up] };
  s.dispatch(cmd.coalescing(cmd.updateProjectedLayer(layerId, { projector }, 'Nudge'), `nudge-projection:${layerId}`));
}

/** Scale and/or turn the selected projected layer about its centre: a mergeable undo step. */
export function transformProjection(layerId: string, scale: number, rotateDeg: number, label: string) {
  const s = useStudio.getState();
  const layer = s.document?.projections.layers[layerId];
  if (!layer || layer.locked) return false;
  const t = layer.transform;
  const k = clamp(scale, 2 / Math.min(t.widthMm, t.heightMm), 3000 / Math.max(t.widthMm, t.heightMm));
  const patch = { widthMm: t.widthMm * k, heightMm: t.heightMm * k, rotationDeg: normalizeDeg(t.rotationDeg + rotateDeg) };
  s.dispatch(cmd.coalescing(cmd.updateProjectedLayer(layerId, { transform: patch }, label), `3d:${label}:${layerId}`));
  return true;
}
