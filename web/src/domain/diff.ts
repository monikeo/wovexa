/**
 * Structured comparison of two versions of a design (spec COL-05, PRJ-08): what moved,
 * what changed, what was added or removed, in words a reviewer can act on.
 */
import { getGarment, PRINT_METHOD_LABELS } from './garments';
import { roundMm } from './geometry';
import { projectedAsArtwork } from './projected';
import { ZONE_IDS, type ArtworkLayer, type DesignDocument, type LayerStack } from './schema';

export interface Change {
  area: string;
  kind: 'added' | 'removed' | 'changed';
  text: string;
}

const EPS = 0.05;
const mm = (n: number) => `${roundMm(Math.abs(n)).toFixed(1)} mm`;

function describeLayerChange(a: ArtworkLayer, b: ArtworkLayer): string[] {
  const out: string[] = [];
  const ta = a.transform;
  const tb = b.transform;
  const dx = tb.centerXmm - ta.centerXmm;
  const dy = tb.centerYmm - ta.centerYmm;
  const moves: string[] = [];
  if (Math.abs(dx) > EPS) moves.push(`${mm(dx)} ${dx > 0 ? 'right' : 'left'}`);
  if (Math.abs(dy) > EPS) moves.push(`${mm(dy)} ${dy > 0 ? 'down' : 'up'}`);
  if (moves.length) out.push(`moved ${moves.join(', ')}`);
  if (Math.abs(tb.widthMm - ta.widthMm) > EPS || Math.abs(tb.heightMm - ta.heightMm) > EPS) {
    out.push(`resized from ${roundMm(ta.widthMm)} × ${roundMm(ta.heightMm)} to ${roundMm(tb.widthMm)} × ${roundMm(tb.heightMm)} mm`);
  }
  if (Math.abs(tb.rotationDeg - ta.rotationDeg) > 0.05) out.push(`rotated to ${Math.round(tb.rotationDeg)}°`);
  if (ta.flipX !== tb.flipX || ta.flipY !== tb.flipY) out.push('flipped');
  if (a.visible !== b.visible) out.push(b.visible ? 'shown' : 'hidden');
  if (a.locked !== b.locked) out.push(b.locked ? 'locked' : 'unlocked');
  if (!!a.clip !== !!b.clip) out.push(b.clip ? 'clipped to the layer below' : 'released from clipping');
  if (a.style.opacity !== b.style.opacity) out.push(`opacity ${Math.round(b.style.opacity * 100)}%`);
  if (a.style.blendMode !== b.style.blendMode) out.push(`blend ${b.style.blendMode}`);
  if (a.style.finish !== b.style.finish) out.push(`finish ${b.style.finish.replace('_', ' ')}`);
  const effects = (s: ArtworkLayer['style']) => JSON.stringify([s.shadow ?? null, s.outline ?? null, s.halftone ?? null, s.distress ?? null]);
  if (effects(a.style) !== effects(b.style)) out.push('effects changed');
  const ca = a.content;
  const cb = b.content;
  if (ca.kind === 'text' && cb.kind === 'text') {
    if (ca.value !== cb.value) out.push(`text changed to “${cb.value.slice(0, 40)}”`);
    if (ca.fontFamily !== cb.fontFamily || ca.fontWeight !== cb.fontWeight || ca.italic !== cb.italic) out.push(`font ${cb.fontFamily} ${cb.fontWeight}${cb.italic ? ' italic' : ''}`);
    if (ca.fill !== cb.fill && !cb.letterColors) out.push(`colour ${cb.fill}`);
    if (JSON.stringify(ca.letterColors ?? null) !== JSON.stringify(cb.letterColors ?? null)) out.push(cb.letterColors ? `letter colours ${cb.letterColors.join(', ')}` : 'one colour for every letter');
    if (ca.curveDeg !== cb.curveDeg) out.push(cb.curveDeg ? `curved ${Math.round(cb.curveDeg)}°` : 'straightened');
    if (ca.strokeColor !== cb.strokeColor || ca.strokeWidthMm !== cb.strokeWidthMm) out.push('outline changed');
    if (!!ca.hollow !== !!cb.hollow) out.push(cb.hollow ? 'outline only' : 'filled');
    if (ca.letterSpacingEm !== cb.letterSpacingEm || ca.lineHeight !== cb.lineHeight || ca.align !== cb.align) out.push('spacing or alignment changed');
    if (JSON.stringify(ca.onPath ?? null) !== JSON.stringify(cb.onPath ?? null)) out.push(!cb.onPath ? 'taken off its path' : ca.onPath ? 'moved along its path' : 'put on a path');
  } else if (ca.kind === 'shape' && cb.kind === 'shape') {
    if (ca.fill !== cb.fill) out.push(`fill ${cb.fill}`);
    if (ca.cornerRadiusMm !== cb.cornerRadiusMm || ca.strokeColor !== cb.strokeColor || ca.strokeWidthMm !== cb.strokeWidthMm) out.push('shape style changed');
    if (ca.shape !== cb.shape || ca.path !== cb.path || ca.points !== cb.points || ca.innerRatio !== cb.innerRatio) out.push('shape reshaped');
    if (!!ca.hollow !== !!cb.hollow) out.push(cb.hollow ? 'outline only' : 'filled');
  } else if (ca.kind === 'image' && cb.kind === 'image') {
    if (ca.assetId !== cb.assetId) out.push('image replaced');
  } else if (ca.kind === 'lockup' && cb.kind === 'lockup') {
    if (JSON.stringify([ca.orderedLayerIds, ca.layers, ca.widthMm, ca.heightMm]) !== JSON.stringify([cb.orderedLayerIds, cb.layers, cb.widthMm, cb.heightMm])) out.push(`lockup ${cb.name} edited`);
  }
  if ((a.groupId ?? null) !== (b.groupId ?? null)) out.push(b.groupId ? 'grouped' : 'ungrouped');
  return out;
}

/** Layers added, removed, edited or restacked between two versions of one zone or design area. */
function stackChanges(area: string, za: LayerStack, zb: LayerStack, changes: Change[]) {
  for (const id of zb.orderedLayerIds) {
    const a = za.layers[id];
    const b = zb.layers[id];
    if (!a) changes.push({ area, kind: 'added', text: `Added ${b.name}` });
    else {
      const what = describeLayerChange(a, b);
      if (what.length) changes.push({ area, kind: 'changed', text: `${b.name}: ${what.join('; ')}` });
    }
  }
  for (const id of za.orderedLayerIds) if (!zb.layers[id]) changes.push({ area, kind: 'removed', text: `Removed ${za.layers[id].name}` });
  const common = zb.orderedLayerIds.filter((id) => za.layers[id]);
  const commonBefore = za.orderedLayerIds.filter((id) => zb.layers[id]);
  if (common.join() !== commonBefore.join()) changes.push({ area, kind: 'changed', text: 'Layer order changed' });
}

export function diffDocuments(before: DesignDocument, after: DesignDocument): Change[] {
  const changes: Change[] = [];
  const model = getGarment(after.garment.modelId);
  if (before.title !== after.title) changes.push({ area: 'Project', kind: 'changed', text: `Renamed to “${after.title}”` });

  if (before.garment.modelId !== after.garment.modelId) changes.push({ area: 'Garment', kind: 'changed', text: `Style ${getGarment(before.garment.modelId).name} → ${model.name}` });
  if (before.garment.sizeCode !== after.garment.sizeCode) changes.push({ area: 'Garment', kind: 'changed', text: `Size ${before.garment.sizeCode} → ${after.garment.sizeCode}` });
  if (before.garment.fabricPresetId !== after.garment.fabricPresetId) {
    const label = model.fabricPresets.find((f) => f.id === after.garment.fabricPresetId)?.label ?? after.garment.fabricPresetId;
    changes.push({ area: 'Garment', kind: 'changed', text: `Fabric changed to ${label}` });
  }

  const beforeCw = new Map(before.colorways.map((c) => [c.id, c]));
  const afterCw = new Map(after.colorways.map((c) => [c.id, c]));
  for (const c of after.colorways) {
    const old = beforeCw.get(c.id);
    if (!old) changes.push({ area: 'Colourways', kind: 'added', text: `Added ${c.name}` });
    else {
      const parts = (Object.keys(c.parts) as (keyof typeof c.parts)[]).filter((p) => c.parts[p] !== old.parts[p]);
      if (parts.length) changes.push({ area: 'Colourways', kind: 'changed', text: `${c.name}: ${parts.join(', ')} colour changed` });
      if (old.name !== c.name) changes.push({ area: 'Colourways', kind: 'changed', text: `${old.name} renamed to ${c.name}` });
    }
  }
  for (const c of before.colorways) if (!afterCw.has(c.id)) changes.push({ area: 'Colourways', kind: 'removed', text: `Removed ${c.name}` });
  if (before.activeColorwayId !== after.activeColorwayId) {
    changes.push({ area: 'Colourways', kind: 'changed', text: `Main colourway is now ${afterCw.get(after.activeColorwayId)?.name ?? 'another colourway'}` });
  }

  for (const zoneId of ZONE_IDS) {
    const za = before.zones[zoneId];
    const zb = after.zones[zoneId];
    if (!za || !zb) continue;
    const area = model.zones[zoneId]?.label ?? zoneId.replace('_', ' ');
    if (za.printMethod !== zb.printMethod) changes.push({ area, kind: 'changed', text: `Print method changed to ${PRINT_METHOD_LABELS[zb.printMethod]}` });
    stackChanges(area, za, zb, changes);
  }

  // Design areas: added, removed, moved on the garment, resized or turned, and their artwork.
  const areasBefore = before.areas?.items ?? {};
  const areasAfter = after.areas?.items ?? {};
  for (const id of after.areas?.orderedIds ?? []) {
    const a = areasBefore[id];
    const b = areasAfter[id];
    if (!b) continue;
    if (!a) {
      changes.push({ area: b.name, kind: 'added', text: `Added design area ${b.name}, ${Math.round(b.widthMm)} × ${Math.round(b.heightMm)} mm` });
      stackChanges(b.name, { orderedLayerIds: [], layers: {} }, b, changes);
      continue;
    }
    const what: string[] = [];
    if (a.name !== b.name) what.push(`renamed from ${a.name}`);
    if (JSON.stringify(a.projector) !== JSON.stringify(b.projector)) what.push('moved on the garment');
    if (Math.abs(a.widthMm - b.widthMm) > EPS || Math.abs(a.heightMm - b.heightMm) > EPS) what.push(`resized to ${roundMm(b.widthMm)} × ${roundMm(b.heightMm)} mm`);
    if (Math.abs(a.rotationDeg - b.rotationDeg) > 0.05) what.push(`turned to ${Math.round(b.rotationDeg)}°`);
    if (a.visible !== b.visible) what.push(b.visible ? 'shown' : 'hidden');
    if (a.locked !== b.locked) what.push(b.locked ? 'locked' : 'unlocked');
    if (a.printMethod !== b.printMethod) what.push(`print method ${PRINT_METHOD_LABELS[b.printMethod]}`);
    if (what.length) changes.push({ area: b.name, kind: 'changed', text: `Design area ${what.join('; ')}` });
    stackChanges(b.name, a, b, changes);
  }
  for (const id of before.areas?.orderedIds ?? []) if (!areasAfter[id] && areasBefore[id]) changes.push({ area: areasBefore[id].name, kind: 'removed', text: `Removed design area ${areasBefore[id].name}` });

  // Artwork across seams: added, removed, moved on the garment, or edited like any layer.
  const seams = 'Across seams';
  const pjA = before.projections?.layers ?? {};
  const pjB = after.projections?.layers ?? {};
  for (const id of after.projections?.orderedLayerIds ?? []) {
    const a = pjA[id];
    const b = pjB[id];
    if (!b) continue;
    if (!a) {
      changes.push({ area: seams, kind: 'added', text: `Added ${b.name}` });
      continue;
    }
    const what = describeLayerChange(projectedAsArtwork(a), projectedAsArtwork(b));
    if (JSON.stringify(a.projector) !== JSON.stringify(b.projector)) what.unshift('moved on the garment');
    if (what.length) changes.push({ area: seams, kind: 'changed', text: `${b.name}: ${what.join('; ')}` });
  }
  for (const id of before.projections?.orderedLayerIds ?? []) if (!pjB[id] && pjA[id]) changes.push({ area: seams, kind: 'removed', text: `Removed ${pjA[id].name}` });

  const pa = before.production;
  const pb = after.production;
  if (pa.constructionNotes !== pb.constructionNotes) changes.push({ area: 'Production', kind: 'changed', text: 'Construction notes edited' });
  if (pa.factoryContact !== pb.factoryContact) changes.push({ area: 'Production', kind: 'changed', text: 'Factory contact changed' });
  if (JSON.stringify(pa.bom) !== JSON.stringify(pb.bom)) changes.push({ area: 'Production', kind: 'changed', text: `Bill of materials updated (${pb.bom.length} rows, ${pb.bom.filter((r) => r.confirmed).length} confirmed)` });
  if (JSON.stringify(pa.qa) !== JSON.stringify(pb.qa)) changes.push({ area: 'Production', kind: 'changed', text: `QA checklist: ${pb.qa.filter((q) => q.checked).length} of ${pb.qa.length} checked` });
  return changes;
}
