'use client';
/** Studio actions shared by the tool rail, mobile sheets, keyboard shortcuts and drag-and-drop. */
import { alignUnits, arrangeCopies, distributeUnits, expandToGroups, selectionUnits, type AlignMode, type CopyPlan, type DistributeAxis } from '@/domain/arrange';
import * as cmd from '@/domain/commands';
import { contrastInk, createGraphicLayer, createImageLayer, createShapeLayer, createTextLayer, newId } from '@/domain/factory';
import { artboardOf, artboardSpec, designAreas, hasArtboard } from '@/domain/areas';
import { getGarment, partColor } from '@/domain/garments';
import { normalizeDeg } from '@/domain/geometry';
import type { Graphic } from '@/domain/graphics';
import { LIMITS } from '@/domain/limits';
import { boardFit, detachedLayers, isPlacement, lockupContent, lockupFromContent, lockupFromLayers, lockupsOf, MAX_LOCKUP_LAYERS, MAX_LOCKUPS, newLockupId, newPlacement, nextLockupName, placementsOf } from '@/domain/lockups';
import { isAreaId, isLockupId, type AreaId, type ArtboardId, type ArtworkLayer, type LayerShadow, type LayerStyle, type LockupId, type ShapeContent } from '@/domain/schema';
import { mapSubpaths, parsePath } from '@/domain/path-edit';
import { penPathData, type PenPoint } from '@/domain/pen';
import { shapePathData } from '@/domain/shape-path';
import { AssetError, importImageFile } from '@/lib/assets';
import type { CombineOp } from '@/lib/combine';
import { placeOnPath, textPathFrom } from '@/lib/path-text';
import { textAspect } from '@/lib/render/zone-renderer';
import { toast } from '@/components/ui/primitives';
import { useStudio } from '@/stores/studio-store';

function context() {
  const s = useStudio.getState();
  if (!s.document) return null;
  const spec = artboardSpec(getGarment(s.document.garment.modelId), s.document, s.activeZoneId);
  const colorway = s.document.colorways.find((c) => c.id === s.document!.activeColorwayId) ?? s.document.colorways[0];
  const fabric = partColor(colorway, spec.part === 'torso' ? 'body' : spec.part === 'legLeft' || spec.part === 'legRight' ? 'pants' : 'sleeves');
  return { s, spec, zoneId: s.activeZoneId, ink: contrastInk(fabric) };
}

export function addText(value = 'Your text') {
  const c = context();
  if (!c) return;
  const layer = createTextLayer(c.spec, value);
  if (layer.content.kind === 'text') {
    layer.content.fill = c.ink;
    // Size the box to the text's natural proportions so it starts undistorted.
    layer.transform.heightMm = layer.transform.widthMm / textAspect(layer.content);
  }
  c.s.dispatch(cmd.addLayer(c.zoneId, layer));
  c.s.select([layer.id]);
  // Wait for the inspector to render the new layer's text field before focusing it.
  setTimeout(() => window.dispatchEvent(new CustomEvent('wovexa:edit-layer', { detail: { layerId: layer.id } })), 60);
}

export function addShape(shape: ShapeContent['shape']) {
  const c = context();
  if (!c) return;
  const layer = createShapeLayer(c.spec, shape);
  c.s.dispatch(cmd.addLayer(c.zoneId, layer));
  c.s.select([layer.id]);
}

/** A library graphic, in an ink that reads on the garment colour. */
export function addGraphic(graphic: Graphic) {
  const c = context();
  if (!c) return;
  const layer = createGraphicLayer(c.spec, graphic, c.ink);
  c.s.dispatch(cmd.addLayer(c.zoneId, layer));
  c.s.select([layer.id]);
}

/**
 * Start the pen on the 2D artboard. With only the 3D view open, the artboard is shown first and
 * the pen starts once it is there.
 */
export function startPen() {
  onArtboard(() => window.dispatchEvent(new CustomEvent('wovexa:pen', { detail: 'on' })));
}

/** The text layer the line being drawn is for; none for a new text. */
let pathTarget: string | null = null;

/**
 * Draw the line a text will run along (spec TYP-02): `layerId`'s text, or a new one when it is
 * left out.
 */
export function startTextOnPath(layerId?: string) {
  pathTarget = layerId ?? null;
  onArtboard(() => window.dispatchEvent(new CustomEvent('wovexa:pen', { detail: 'path' })));
}

/**
 * Text along a line just drawn with the pen (artboard millimetres): the text the line was started
 * for, or a new one ready to type into.
 */
export function addTextOnPath(points: PenPoint[]) {
  const c = context();
  const target = pathTarget;
  pathTarget = null;
  if (!c?.s.document || points.length < 2) return;
  const line = parsePath(penPathData(points, false))[0];
  if (!line) return;
  const existing = target ? artboardOf(c.s.document, c.zoneId)?.layers[target] : undefined;
  if (existing?.content.kind === 'text' && !existing.locked) {
    if (existing.content.value.includes('\n')) return void toast('Text on a path is one line: join the lines first.');
    const { onPath, box } = textPathFrom(line);
    const content = { ...existing.content, onPath, curveDeg: 0, wave: undefined };
    c.s.dispatch(cmd.updateLayer(c.zoneId, existing.id, { content: { onPath, curveDeg: 0, wave: undefined }, transform: placeOnPath(content, box) }, 'Put text on a path'));
    c.s.select([existing.id]);
    return;
  }
  const layer = createTextLayer(c.spec, 'Your words along the line');
  if (layer.content.kind !== 'text') return;
  layer.content.fill = c.ink;
  const { onPath, box } = textPathFrom(line);
  layer.content = { ...layer.content, onPath, curveDeg: 0 };
  Object.assign(layer.transform, placeOnPath(layer.content, box));
  layer.name = 'Text on a path';
  c.s.dispatch(cmd.addLayer(c.zoneId, layer));
  c.s.select([layer.id]);
  setTimeout(() => window.dispatchEvent(new CustomEvent('wovexa:edit-layer', { detail: { layerId: layer.id } })), 60);
}

/**
 * The selected text run along the selected shape's outline (round a circle badge, along a
 * banner's edge). The shape stays as it is; the text starts centred at its top.
 */
export function putTextOnShape() {
  const c = context();
  if (!c?.s.document) return;
  const zone = artboardOf(c.s.document, c.zoneId);
  if (!zone) return;
  const picked = c.s.selectedLayerIds.map((id) => zone.layers[id]).filter(Boolean);
  const text = picked.find((l) => l.content.kind === 'text');
  const shape = picked.find((l) => l.content.kind === 'shape');
  if (!text || !shape || text.content.kind !== 'text' || shape.content.kind !== 'shape') return void toast('Select one text and one shape to put the text on the shape.');
  if (text.content.value.includes('\n')) return void toast('Text on a path is one line: join the lines first.');
  const t = shape.transform;
  const a = (t.rotationDeg * Math.PI) / 180;
  const outline = parsePath(shapePathData(shape.content, t.widthMm, t.heightMm))[0];
  if (!outline) return;
  // The outline on the artboard, turned and mirrored as the shape is.
  const [drawn] = mapSubpaths([outline], (x, y) => {
    const lx = t.flipX ? -x : x;
    const ly = t.flipY ? -y : y;
    return [t.centerXmm + lx * Math.cos(a) - ly * Math.sin(a), t.centerYmm + lx * Math.sin(a) + ly * Math.cos(a)];
  });
  const { onPath, box } = textPathFrom(drawn);
  if (onPath.d.length > LIMITS.textPathChars) return void toast('That outline is too detailed for text to follow. Use a simpler shape, or draw the line with the pen.', 'error');
  const content = { ...text.content, onPath, curveDeg: 0, wave: undefined };
  c.s.dispatch(cmd.updateLayer(c.zoneId, text.id, { content: { onPath, curveDeg: 0, wave: undefined }, transform: placeOnPath(content, box) }, 'Put text on the outline'));
  c.s.select([text.id]);
}

// ---- Reusable lockups (spec ED2-12) ----

/** Where to go back to when a lockup's own board is closed. */
let lockupReturn: ArtboardId | null = null;

// Leaving a lockup's board any way (Done, another tab, a shortcut) fits the board round its
// artwork, with every placement's box changed to match so nothing on the garment moves.
if (typeof window !== 'undefined') {
  useStudio.subscribe((s, prev) => {
    if (prev.activeZoneId === s.activeZoneId || !isLockupId(prev.activeZoneId) || s.document !== prev.document) return;
    const lockup = s.document?.lockups?.items[prev.activeZoneId];
    if (lockup && boardFit(lockup)) s.dispatch(cmd.fitLockupBoard(prev.activeZoneId));
  });
}

/**
 * Make a lockup of the selected layers (whole groups): they move onto the lockup's own board and
 * one placement of it takes their place, so nothing on the garment changes.
 */
export function makeLockupFromSelection() {
  const c = context();
  const doc = c?.s.document;
  if (!c || !doc) return;
  if (isLockupId(c.zoneId)) return void toast('A lockup can’t hold another lockup: this is already a lockup’s board.');
  const zone = artboardOf(doc, c.zoneId);
  if (!zone) return;
  const ids = expandToGroups(zone, c.s.selectedLayerIds);
  const layers = zone.orderedLayerIds.filter((id) => ids.includes(id) && zone.layers[id]).map((id) => zone.layers[id]);
  if (!layers.length) return;
  if (layers.some((l) => l.locked)) return void toast('Unlock the layers to make a lockup of them.');
  if (layers.some((l) => l.content.kind === 'lockup')) return void toast('A lockup can’t hold another lockup: detach that placement first.');
  if (layers.length > MAX_LOCKUP_LAYERS) return void toast(`A lockup holds up to ${MAX_LOCKUP_LAYERS} layers.`, 'error');
  if (lockupsOf(doc).length >= MAX_LOCKUPS) return void toast(`A design can hold ${MAX_LOCKUPS} lockups.`, 'error');
  const name = layers.length === 1 ? layers[0].name.slice(0, 60) : nextLockupName(doc);
  const made = lockupFromLayers(layers, { id: newLockupId(), name, placementId: newId() });
  if (!made) return;
  c.s.dispatch(cmd.makeLockup(c.zoneId, layers.map((l) => l.id), made.lockup, made.placement));
  c.s.select([made.placement.id]);
  toast(`${made.lockup.name} is a lockup now. Place it on any zone or area; edit it once and every placement follows.`);
}

/** Put another placement of a lockup on the active zone or design area: centred, shrunk to fit if it is bigger. */
export function placeLockup(lockupId: string) {
  const c = context();
  const lockup = c?.s.document?.lockups?.items[lockupId as LockupId];
  if (!c || !lockup) return;
  if (isLockupId(c.zoneId)) return void toast('A lockup can’t hold another lockup: place it on a zone or design area.');
  const W = c.spec.printableWidthMm;
  const H = c.spec.printableHeightMm;
  const placement = newPlacement(lockup, newId(), { cx: W / 2, cy: H / 2, maxW: W * 0.9, maxH: H * 0.9 });
  c.s.dispatch(cmd.addLayer(c.zoneId, placement));
  c.s.select([placement.id]);
}

/**
 * Open a lockup's own board, to edit it with every tool while each placement follows. A placement
 * whose lockup isn't in this design (pasted from another) brings it back from its own copy.
 */
export function editLockup(lockupId: string) {
  const s = useStudio.getState();
  const doc = s.document;
  if (!doc) return;
  const id = lockupId as LockupId;
  if (!doc.lockups?.items[id]) {
    const zone = artboardOf(doc, s.activeZoneId);
    const copy = Object.values(zone?.layers ?? {}).find((l) => l.content.kind === 'lockup' && l.content.lockupId === id);
    if (copy?.content.kind !== 'lockup') return;
    s.dispatch(cmd.addLockup(lockupFromContent(copy.content)));
  }
  if (!isLockupId(s.activeZoneId)) lockupReturn = s.activeZoneId;
  onArtboard(() => useStudio.getState().setActiveZone(id));
}

/** Close a lockup's board: its board fits round its artwork (placements stay where they are), and back to where you were. */
export function finishLockupEdit() {
  const s = useStudio.getState();
  const doc = s.document;
  const id = s.activeZoneId;
  if (!doc || !isLockupId(id)) return;
  const lockup = doc.lockups?.items[id];
  if (lockup && !lockup.orderedLayerIds.length && placementsOf(doc, id).length) toast(`${lockup.name} is empty, so its placements show nothing.`);
  const model = getGarment(doc.garment.modelId);
  const back = lockupReturn && hasArtboard(model, useStudio.getState().document, lockupReturn) ? lockupReturn : model.zoneOrder[0];
  lockupReturn = null;
  s.setActiveZone(back);
}

/** Swap the selected placement for its lockup's layers, as ordinary layers (one group) where it was. */
export function detachLockup() {
  const { document, selectedLayerIds, activeZoneId, dispatch, select } = useStudio.getState();
  const zone = document ? artboardOf(document, activeZoneId) : undefined;
  const layer = selectedLayerIds.length === 1 ? zone?.layers[selectedLayerIds[0]] : undefined;
  if (!isPlacement(layer) || layer.locked) return;
  const layers = detachedLayers(layer, newId, `g-${newId()}`);
  dispatch(cmd.detachPlacement(activeZoneId, layer.id, layers));
  select(layers.map((l) => l.id));
  const s = layer.style;
  if (s.shadow || s.outline || s.halftone || s.distress || s.finish !== 'flat_ink' || s.blendMode !== 'normal') toast('Detached. Effects on the lockup as a whole stay off its separate layers: add them to the group if you want them.');
}

export function renameLockupTo(lockupId: string, name: string) {
  if (name.trim()) useStudio.getState().dispatch(cmd.renameLockup(lockupId as LockupId, name));
}

/** Delete a lockup that is placed nowhere. */
export function deleteLockup(lockupId: string) {
  const s = useStudio.getState();
  const lockup = s.document?.lockups?.items[lockupId as LockupId];
  if (!s.document || !lockup) return;
  const count = placementsOf(s.document, lockupId).length;
  if (count) return void toast(`${lockup.name} is placed ${count === 1 ? 'once' : `${count} times`}: delete or detach ${count === 1 ? 'that placement' : 'those placements'} first.`);
  if (s.activeZoneId === lockupId) finishLockupEdit();
  s.dispatch(cmd.removeLockup(lockup.id as LockupId, lockup.name));
}

/** Run `fn` with the 2D artboard on screen: at once, or once it is shown when only the 3D view is open. */
function onArtboard(fn: () => void) {
  const s = useStudio.getState();
  if (s.viewMode !== '3d') return fn();
  s.setViewMode('2d');
  let tries = 0;
  const wait = () => {
    if (document.querySelector('[data-testid="editor-2d"]')) setTimeout(fn, 50);
    else if (++tries < 60) setTimeout(wait, 100);
  };
  wait();
}

/** Edit the selected shape's points on the 2D artboard (spec ED2-09). */
export function editPoints() {
  const { document, selectedLayerIds, activeZoneId } = useStudio.getState();
  const zone = document ? artboardOf(document, activeZoneId) : undefined;
  const layer = selectedLayerIds.length === 1 ? zone?.layers[selectedLayerIds[0]] : undefined;
  if (layer?.content.kind !== 'shape' || layer.locked) return;
  onArtboard(() => window.dispatchEvent(new CustomEvent('wovexa:edit-points', { detail: { layerId: layer.id } })));
}

/** A shape drawn with the pen (path in a 0–100 box, over `box` in mm) on the active zone or design area. */
export function addDrawnShape(path: string, box: { x: number; y: number; w: number; h: number }) {
  const c = context();
  if (!c) return;
  const layer = createGraphicLayer(c.spec, { id: 'pen', name: 'Drawn shape', path, aspect: box.w / box.h }, c.ink);
  if (layer.content.kind === 'shape') delete layer.content.graphicId;
  Object.assign(layer.transform, { centerXmm: box.x + box.w / 2, centerYmm: box.y + box.h / 2, widthMm: box.w, heightMm: box.h });
  c.s.dispatch(cmd.addLayer(c.zoneId, layer));
  c.s.select([layer.id]);
}

/** Standard print placements for the active zone, as targets for the selected layer. */
export interface Placement {
  id: string;
  label: string;
  /** Target box in the zone, mm: centre and the largest width and height the artwork may take. */
  cx: number;
  cy: number;
  maxW: number;
  maxH: number;
}

export function placementsFor(spec: { id: string; part: string; printableWidthMm: number; printableHeightMm: number; topFromHpsMm?: number; lockupId?: string }): Placement[] {
  // A lockup's own board is not on the garment: its placements are put in place where they go.
  if (spec.lockupId) return [];
  const W = spec.printableWidthMm;
  const H = spec.printableHeightMm;
  if (spec.part === 'torso' && spec.id === 'front') {
    // Left chest sits on the wearer's left, which is the viewer's right on the flat.
    const chest = Math.min(95, W * 0.32);
    return [
      { id: 'left-chest', label: 'Left chest', cx: W * 0.75, cy: Math.min(H * 0.22, chest * 0.55 + 12), maxW: chest, maxH: chest },
      { id: 'right-chest', label: 'Right chest', cx: W * 0.25, cy: Math.min(H * 0.22, chest * 0.55 + 12), maxW: chest, maxH: chest },
      { id: 'centre-chest', label: 'Centre chest', cx: W / 2, cy: Math.min(H * 0.3, 70), maxW: W * 0.62, maxH: H * 0.34 },
      { id: 'full-front', label: 'Full front', cx: W / 2, cy: H / 2, maxW: W * 0.94, maxH: H * 0.94 },
      { id: 'lower-front', label: 'Lower front', cx: W / 2, cy: H * 0.82, maxW: W * 0.7, maxH: H * 0.28 },
    ];
  }
  if (spec.part === 'torso') {
    return [
      { id: 'nape', label: 'Below collar', cx: W / 2, cy: Math.min(40, H * 0.1), maxW: Math.min(90, W * 0.32), maxH: Math.min(50, H * 0.14) },
      { id: 'upper-back', label: 'Upper back', cx: W / 2, cy: H * 0.2, maxW: W * 0.88, maxH: H * 0.28 },
      { id: 'full-back', label: 'Full back', cx: W / 2, cy: H / 2, maxW: W * 0.94, maxH: H * 0.94 },
      { id: 'lower-back', label: 'Lower back', cx: W / 2, cy: H * 0.82, maxW: W * 0.7, maxH: H * 0.28 },
    ];
  }
  if (spec.part === 'legLeft' || spec.part === 'legRight') {
    return [
      { id: 'leg-top', label: 'Hip', cx: W / 2, cy: Math.min(H * 0.12, 70), maxW: W * 0.9, maxH: H * 0.2 },
      { id: 'leg-full', label: 'Down the leg', cx: W / 2, cy: H / 2, maxW: W * 0.92, maxH: H * 0.94 },
      { id: 'leg-low', label: 'Above hem', cx: W / 2, cy: H * 0.86, maxW: W * 0.9, maxH: H * 0.2 },
    ];
  }
  return [
    { id: 'sleeve-centre', label: 'Centred', cx: W / 2, cy: H / 2, maxW: W * 0.86, maxH: H * 0.86 },
    { id: 'sleeve-top', label: 'Upper sleeve', cx: W / 2, cy: H * 0.3, maxW: W * 0.86, maxH: H * 0.4 },
  ];
}

/** Move and fit the selection (as one unit, proportions kept) into a standard placement. */
export function placeSelection(placement: Placement) {
  const c = context();
  if (!c || !c.s.document) return;
  const zone = artboardOf(c.s.document, c.zoneId);
  if (!zone) return;
  const layers = selectionUnits(zone, c.s.selectedLayerIds)
    .flat()
    .filter((l) => !l.locked);
  if (!layers.length) return;
  const xs = layers.flatMap((l) => [l.transform.centerXmm - l.transform.widthMm / 2, l.transform.centerXmm + l.transform.widthMm / 2]);
  const ys = layers.flatMap((l) => [l.transform.centerYmm - l.transform.heightMm / 2, l.transform.centerYmm + l.transform.heightMm / 2]);
  const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const bw = Math.max(0.1, box.x1 - box.x0);
  const bh = Math.max(0.1, box.y1 - box.y0);
  const k = Math.min(placement.maxW / bw, placement.maxH / bh);
  const ox = (box.x0 + box.x1) / 2;
  const oy = (box.y0 + box.y1) / 2;
  const changes = Object.fromEntries(
    layers.map((l) => [
      l.id,
      {
        centerXmm: placement.cx + (l.transform.centerXmm - ox) * k,
        centerYmm: placement.cy + (l.transform.centerYmm - oy) * k,
        widthMm: l.transform.widthMm * k,
        heightMm: l.transform.heightMm * k,
      },
    ]),
  );
  c.s.dispatch(cmd.updateTransforms(c.zoneId, changes, `Place: ${placement.label.toLowerCase()}`));
}

export async function addImages(files: FileList | File[]) {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|svg)$/i.test(f.name));
  if (!list.length) {
    toast('Choose a PNG, JPEG, WebP or SVG image.', 'error');
    return;
  }
  const added: string[] = [];
  for (const file of list) {
    try {
      const asset = await importImageFile(file);
      const c = context();
      if (!c) return;
      const layer = createImageLayer(c.spec, { id: asset.id, width: asset.width, height: asset.height, mime: asset.mime, name: asset.name });
      c.s.dispatch(cmd.addLayer(c.zoneId, layer));
      added.push(layer.id);
    } catch (error) {
      toast(error instanceof AssetError ? error.message : `${file.name} couldn't be added.`, 'error');
    }
  }
  if (added.length) useStudio.getState().select(added);
}

export function deleteSelection() {
  const { selectedLayerIds, activeZoneId, dispatch, select } = useStudio.getState();
  if (!selectedLayerIds.length) return;
  dispatch(cmd.removeLayers(activeZoneId, selectedLayerIds));
  select([]);
}

export function duplicateSelection() {
  const { selectedLayerIds, activeZoneId, dispatch, select } = useStudio.getState();
  if (!selectedLayerIds.length) return;
  const ids = Object.fromEntries(selectedLayerIds.map((id) => [id, newId()]));
  dispatch(cmd.duplicateLayers(activeZoneId, ids));
  select(Object.values(ids));
}

export function nudgeSelection(dxMm: number, dyMm: number) {
  const { document, selectedLayerIds, activeZoneId, dispatch } = useStudio.getState();
  if (!document || !selectedLayerIds.length) return;
  const zone = artboardOf(document, activeZoneId);
  if (!zone) return;
  const changes = Object.fromEntries(
    selectedLayerIds
      .filter((id) => zone.layers[id] && !zone.layers[id].locked)
      .map((id) => {
        const t = zone.layers[id].transform;
        return [id, { centerXmm: t.centerXmm + dxMm, centerYmm: t.centerYmm + dyMm }];
      }),
  );
  dispatch(cmd.coalescing(cmd.updateTransforms(activeZoneId, changes, 'Nudge'), `nudge:${Object.keys(changes).join()}`));
}

const ALIGN_LABELS: Record<AlignMode, string> = {
  left: 'Align left',
  hcenter: 'Centre horizontally',
  right: 'Align right',
  top: 'Align top',
  vcenter: 'Centre vertically',
  bottom: 'Align bottom',
};

/** Align the selection: to the print area for one item, to the selection bounds for several. */
export function alignSelection(mode: AlignMode) {
  const c = context();
  if (!c || !c.s.document) return;
  const zone = artboardOf(c.s.document, c.zoneId);
  if (!zone) return;
  const units = selectionUnits(zone, c.s.selectedLayerIds);
  const changes = alignUnits(units, mode, { x: 0, y: 0, width: c.spec.printableWidthMm, height: c.spec.printableHeightMm });
  c.s.dispatch(cmd.updateTransforms(c.zoneId, changes, ALIGN_LABELS[mode]));
}

export function distributeSelection(axis: DistributeAxis) {
  const c = context();
  if (!c || !c.s.document) return;
  const zone = artboardOf(c.s.document, c.zoneId);
  if (!zone) return;
  const units = selectionUnits(zone, c.s.selectedLayerIds);
  c.s.dispatch(cmd.updateTransforms(c.zoneId, distributeUnits(units, axis), axis === 'horizontal' ? 'Distribute horizontally' : 'Distribute vertically'));
}

export function groupSelection() {
  const { selectedLayerIds, activeZoneId, dispatch, select } = useStudio.getState();
  if (selectedLayerIds.length < 2) return;
  dispatch(cmd.groupLayers(activeZoneId, selectedLayerIds, `g-${newId()}`));
  select([...selectedLayerIds]);
}

export function ungroupSelection() {
  const { selectedLayerIds, activeZoneId, dispatch, select } = useStudio.getState();
  if (!selectedLayerIds.length) return;
  dispatch(cmd.ungroupLayers(activeZoneId, selectedLayerIds));
  select([...selectedLayerIds]);
}

export type { CombineOp };
export const COMBINE_LABELS: Record<CombineOp, string> = { union: 'Unite shapes', subtract: 'Subtract front shapes', intersect: 'Keep the overlap', exclude: 'Exclude the overlap' };

/**
 * Combine the selected layers into one vector shape (spec ED2-09): unite, subtract (the bottom one
 * minus everything in front), keep the overlap, or exclude it. Text and images take part by their
 * own outline. The result has the bottom layer's colour and look, sits where it did, and is one undo step.
 */
export async function combineSelection(op: CombineOp) {
  const c = context();
  if (!c?.s.document) return;
  const zone = artboardOf(c.s.document, c.zoneId);
  if (!zone) return;
  const ids = zone.orderedLayerIds.filter((id) => c.s.selectedLayerIds.includes(id) && zone.layers[id]?.visible);
  if (ids.length < 2) return void toast('Select two or more layers to combine them.');
  const layers = ids.map((id) => zone.layers[id]);
  if (layers.some((l) => l.locked)) return void toast('Unlock the layers to combine them.');
  const { combineLayers } = await import('@/lib/combine');
  let result: Awaited<ReturnType<typeof combineLayers>>;
  try {
    result = await combineLayers(op, layers);
  } catch {
    return void toast('These layers could not be combined.', 'error');
  }
  if (!result) return void toast(op === 'intersect' ? 'These layers don’t overlap, so nothing is left.' : 'Nothing is left once they are combined.');
  if (result.path.length > LIMITS.pathChars) return void toast('The combined shape would be too detailed to keep. Combine fewer or simpler layers.', 'error');
  const bottom = layers[0];
  const b = bottom.content;
  const stroke = b.kind === 'shape' ? { strokeColor: b.strokeColor, strokeWidthMm: b.strokeWidthMm, hollow: b.hollow } : {};
  const fillStyle = b.kind === 'shape' || (b.kind === 'text' && !b.letterColors) ? b.fillStyle : undefined;
  const content: ShapeContent = { kind: 'shape', shape: 'path', fill: b.kind === 'text' || b.kind === 'shape' ? b.fill : c.ink, cornerRadiusMm: 0, path: result.path };
  for (const [k, v] of Object.entries({ ...stroke, fillStyle })) if (v !== undefined) (content as Record<string, unknown>)[k] = v;
  const { box } = result;
  const layer: ArtworkLayer = {
    id: newId(),
    name: op === 'subtract' ? `${bottom.name} cut-out` : 'Combined shape',
    visible: true,
    locked: false,
    transform: { centerXmm: box.x + box.w / 2, centerYmm: box.y + box.h / 2, widthMm: box.w, heightMm: box.h, rotationDeg: 0, flipX: false, flipY: false },
    style: { ...bottom.style },
    content,
  };
  const at = zone.orderedLayerIds.indexOf(ids[0]);
  c.s.dispatch(cmd.batch(COMBINE_LABELS[op], [cmd.removeLayers(c.zoneId, ids), cmd.addLayer(c.zoneId, layer, at)]));
  c.s.select([layer.id]);
}

/** Open the crop, or the photo's frame, for the one selected image (showing the inspector first on small screens). */
export function openCrop(mode: 'crop' | 'frame') {
  const { document, selectedLayerIds, activeZoneId } = useStudio.getState();
  const zone = document ? artboardOf(document, activeZoneId) : undefined;
  const layer = selectedLayerIds.length === 1 ? zone?.layers[selectedLayerIds[0]] : undefined;
  if (layer?.content.kind !== 'image') return;
  window.dispatchEvent(new CustomEvent('wovexa:edit-layer', { detail: { layerId: layer.id } }));
  setTimeout(() => window.dispatchEvent(new CustomEvent('wovexa:crop', { detail: { layerId: layer.id, mode } })), 150);
}

/**
 * Clip to the layer below, like a photo inside lettering, or release the clip (toggles unless told).
 * One selected layer clips to the layer under it. With several, the lowest is the shape and the
 * rest clip to it, moving down to sit right above it when other layers are in the way.
 */
export function clipSelection(on?: boolean) {
  const c = context();
  if (!c?.s.document) return;
  const zone = artboardOf(c.s.document, c.zoneId);
  if (!zone) return;
  const order = zone.orderedLayerIds;
  const ids = order.filter((id) => c.s.selectedLayerIds.includes(id) && zone.layers[id]);
  if (!ids.length) return;
  const targets = ids.length > 1 ? ids.slice(1) : ids;
  if (ids.length === 1 && order.indexOf(ids[0]) === 0) {
    toast('Nothing is under this layer to clip it to. Put it above the text or shape it should fill.');
    return;
  }
  const clip = on ?? !targets.every((id) => zone.layers[id].clip);
  const steps: cmd.Command[] = [];
  // Grouped layers keep their place: moving one would split its group.
  if (clip && ids.length > 1 && !ids.some((id) => zone.layers[id].groupId)) {
    const at = order.indexOf(ids[0]);
    targets.forEach((id, k) => steps.push(cmd.reorderLayer(c.zoneId, id, at + 1 + k)));
  }
  for (const id of targets) steps.push(cmd.updateLayer(c.zoneId, id, { clip }));
  const label = clip ? (targets.length > 1 ? `Clip ${targets.length} layers` : 'Clip to layer below') : 'Release clipping';
  c.s.dispatch(cmd.batch(label, steps));
}

/** Select every visible, unlocked layer in the active zone (Ctrl+A). */
export function selectAll() {
  const { document, activeZoneId, select } = useStudio.getState();
  if (!document) return;
  const zone = artboardOf(document, activeZoneId);
  if (!zone) return;
  select(zone.orderedLayerIds.filter((id) => zone.layers[id]?.visible && !zone.layers[id]?.locked));
}

/** Select layers from a list click, expanding to whole groups. */
export function selectLayers(ids: string[]) {
  const { document, activeZoneId, select } = useStudio.getState();
  if (!document) return;
  const zone = artboardOf(document, activeZoneId);
  if (zone) select(expandToGroups(zone, ids));
}

export function moveSelectionInStack(direction: 1 | -1) {
  const { selectedLayerIds, activeZoneId, dispatch } = useStudio.getState();
  if (!selectedLayerIds.length) return;
  dispatch(cmd.moveLayerBy(activeZoneId, selectedLayerIds[0], direction));
}

export function zoomToSelection() {
  window.dispatchEvent(new CustomEvent('wovexa:zoom-to-selection'));
}

// ---- Clipboard: copy, cut and paste layers between any zones and design areas ----

/** Layers copied or cut, with the print area they came from. `text` is what was put on the system clipboard. */
let clipboard: { layers: ArtworkLayer[]; from: { zoneId: string; widthMm: number; heightMm: number }; text: string } | null = null;

/**
 * Copy (or cut) the selected layers, whole groups included. Returns the text to put on the system
 * clipboard (the text layers' words, else the layers' names), which also marks it as WOVEXA's own.
 */
export function copySelection(cut = false): string | null {
  const c = context();
  if (!c?.s.document) return null;
  const zone = artboardOf(c.s.document, c.zoneId);
  if (!zone || !c.s.selectedLayerIds.length) return null;
  const ids = expandToGroups(zone, c.s.selectedLayerIds);
  const layers = zone.orderedLayerIds.filter((id) => ids.includes(id) && zone.layers[id]).map((id) => JSON.parse(JSON.stringify(zone.layers[id])) as ArtworkLayer);
  if (!layers.length) return null;
  const words = layers.flatMap((l) => (l.content.kind === 'text' ? [l.content.value] : []));
  const text = (words.length ? words : layers.map((l) => l.name)).join('\n') || 'WOVEXA layers';
  clipboard = { layers, from: { zoneId: c.zoneId, widthMm: c.spec.printableWidthMm, heightMm: c.spec.printableHeightMm }, text };
  if (cut) {
    c.s.dispatch(cmd.removeLayers(c.zoneId, ids));
    c.s.select([]);
  }
  return text;
}

/** Whether the system clipboard's text is what WOVEXA last copied (so a paste brings its layers back). */
export const isOwnClipboard = (text: string) => !!clipboard && text.replace(/\r\n/g, '\n') === clipboard.text;

/** How many layers are waiting to be pasted (0 when nothing was copied this visit). */
export const copiedLayerCount = () => clipboard?.layers.length ?? 0;

/**
 * Paste the copied layers into the active zone or design area, on top and selected. Into the same
 * print area they sit a little offset; into another, at the same place relative to it, shrunk if
 * they no longer fit.
 */
export function pasteLayers(): boolean {
  const c = context();
  if (!c || !clipboard) return false;
  const from = clipboard.from;
  const same = from.zoneId === c.zoneId;
  const sx = c.spec.printableWidthMm / from.widthMm;
  const sy = c.spec.printableHeightMm / from.heightMm;
  const fit = same ? 1 : Math.min(1, sx, sy);
  const groups = new Map<string, string>();
  // A lockup can't hold another lockup: its placements stay out of a lockup's own board.
  const into = isLockupId(c.zoneId) ? clipboard.layers.filter((l) => l.content.kind !== 'lockup') : clipboard.layers;
  if (!into.length) return void toast('A lockup can’t hold another lockup: paste it on a zone or design area.'), false;
  const layers = into.map((l) => {
    const copy = JSON.parse(JSON.stringify(l)) as ArtworkLayer;
    copy.id = newId();
    copy.locked = false;
    // A placement takes the lockup as it is now in this design (it may have changed since the copy).
    const lockup = copy.content.kind === 'lockup' ? c.s.document?.lockups?.items[copy.content.lockupId as LockupId] : undefined;
    if (lockup) copy.content = lockupContent(lockup);
    if (copy.groupId) {
      const g = groups.get(copy.groupId) ?? `g-${newId()}`;
      groups.set(copy.groupId, g);
      copy.groupId = g;
    }
    const t = copy.transform;
    if (same) {
      t.centerXmm += 6;
      t.centerYmm += 6;
    } else {
      t.centerXmm *= sx;
      t.centerYmm *= sy;
      t.widthMm *= fit;
      t.heightMm *= fit;
    }
    return copy;
  });
  c.s.dispatch(cmd.addLayers(c.zoneId, layers, layers.length === 1 ? `Paste ${layers[0].name}` : `Paste ${layers.length} layers`));
  c.s.select(layers.map((l) => l.id));
  return true;
}

// ---- Keyboard selection and transforms ----

/**
 * Select the next (or previous) layer of the active zone or design area, top of the stack first.
 * Returns false past either end, so Tab can move on out of the canvas.
 */
export function selectNextLayer(direction: 1 | -1): boolean {
  const { document, activeZoneId, selectedLayerIds, select } = useStudio.getState();
  const zone = document ? artboardOf(document, activeZoneId) : undefined;
  if (!zone) return false;
  const ids = zone.orderedLayerIds.filter((id) => zone.layers[id]?.visible && !zone.layers[id]?.locked).reverse();
  if (!ids.length) return false;
  const current = selectedLayerIds.length ? ids.indexOf(selectedLayerIds[selectedLayerIds.length - 1]) : -1;
  const next = current === -1 ? (direction === 1 ? 0 : ids.length - 1) : current + direction;
  if (next < 0 || next >= ids.length) return false;
  select([ids[next]]);
  return true;
}

/** Turn the selected layers (each round its own centre) or, with nothing selected, the active design area. */
export function rotateSelection(deg: number) {
  const { document, selectedLayerIds, activeZoneId, dispatch } = useStudio.getState();
  if (!document) return;
  const zone = artboardOf(document, activeZoneId);
  if (!zone) return;
  if (!selectedLayerIds.length && isAreaId(activeZoneId)) {
    const area = document.areas?.items[activeZoneId];
    if (area && !area.locked) dispatch(cmd.coalescing(cmd.updateArea(area.id, { rotationDeg: normalizeDeg(area.rotationDeg + deg) }, 'Turn area'), `turn-area:${area.id}`));
    return;
  }
  const changes = Object.fromEntries(
    selectedLayerIds.filter((id) => zone.layers[id] && !zone.layers[id].locked).map((id) => [id, { rotationDeg: normalizeDeg(zone.layers[id].transform.rotationDeg + deg) }]),
  );
  if (Object.keys(changes).length) dispatch(cmd.coalescing(cmd.updateTransforms(activeZoneId, changes, 'Rotate'), `rotate:${Object.keys(changes).join()}`));
}

/**
 * Step and repeat the selected layer: copies in a row, a grid or round a circle, arranged round
 * where it was and grouped with it, so the set moves as one. One undo step.
 */
export function repeatSelection(plan: CopyPlan) {
  const { document, selectedLayerIds, activeZoneId, dispatch, select } = useStudio.getState();
  const zone = document ? artboardOf(document, activeZoneId) : undefined;
  const layer = zone?.layers[selectedLayerIds[0]];
  if (!zone || !layer || selectedLayerIds.length !== 1 || layer.locked) return;
  const places = arrangeCopies(layer.transform, plan);
  if (zone.orderedLayerIds.length + places.length - 1 > 200) {
    toast('A print area holds up to 200 layers. Make fewer copies.', 'error');
    return;
  }
  const copies = places.slice(1).map((p, i): ArtworkLayer => {
    const copy = JSON.parse(JSON.stringify(layer)) as ArtworkLayer;
    copy.id = newId();
    copy.name = `${layer.name} ${i + 2}`;
    delete copy.groupId;
    Object.assign(copy.transform, p);
    return copy;
  });
  const label = `${places.length} × ${layer.name} ${plan.mode === 'circle' ? 'round a circle' : plan.mode === 'grid' ? 'in a grid' : 'in a row'}`;
  dispatch(
    cmd.batch(label, [
      cmd.updateTransforms(activeZoneId, { [layer.id]: places[0] }, label),
      cmd.addLayers(activeZoneId, copies, label),
      cmd.groupLayers(activeZoneId, [layer.id, ...copies.map((c) => c.id)], `g-${newId()}`),
    ]),
  );
  select(expandToGroups(artboardOf(useStudio.getState().document!, activeZoneId)!, [layer.id]));
}

/** Mirror each selected layer across its own centre, left to right (x) or top to bottom (y). */
export function flipSelection(axis: 'x' | 'y') {
  const { document, selectedLayerIds, activeZoneId, dispatch } = useStudio.getState();
  const zone = document ? artboardOf(document, activeZoneId) : undefined;
  if (!zone) return;
  const key = axis === 'x' ? 'flipX' : 'flipY';
  const changes = Object.fromEntries(selectedLayerIds.filter((id) => zone.layers[id] && !zone.layers[id].locked).map((id) => [id, { [key]: !zone.layers[id].transform[key] }]));
  if (Object.keys(changes).length) dispatch(cmd.updateTransforms(activeZoneId, changes, 'Flip'));
}

/** The selected layers that can be edited, with where they live. */
function editableSelection() {
  const { document, selectedLayerIds, activeZoneId, dispatch } = useStudio.getState();
  const zone = document ? artboardOf(document, activeZoneId) : undefined;
  const layers = zone ? selectedLayerIds.map((id) => zone.layers[id]).filter((l) => l && !l.locked) : [];
  return { layers, zoneId: activeZoneId, dispatch };
}

/** Give the selected layers an effect (or take it off with undefined): sticker outline, halftone. One undo step. */
export function styleSelection(style: Partial<LayerStyle>, label: string) {
  const { layers, zoneId, dispatch } = editableSelection();
  if (layers.length) dispatch(cmd.batch(label, layers.map((l) => cmd.updateLayer(zoneId, l.id, { style }, label))));
}

/** A drop shadow or glow on the selected layers (text keeps its shadow in its content), or none. */
export function shadowSelection(shadow: LayerShadow | undefined, label: string) {
  const { layers, zoneId, dispatch } = editableSelection();
  if (!layers.length) return;
  dispatch(cmd.batch(label, layers.map((l) => cmd.updateLayer(zoneId, l.id, l.content.kind === 'text' ? { content: { shadow } } : { style: { shadow } }, label))));
}

/** Take every effect off the selected layers (shadow or glow, sticker outline, halftone). One undo step. */
export function clearEffects() {
  const { layers, zoneId, dispatch } = editableSelection();
  const label = 'Remove effects';
  if (!layers.length) return;
  dispatch(
    cmd.batch(
      label,
      layers.map((l) => cmd.updateLayer(zoneId, l.id, { style: { shadow: undefined, outline: undefined, halftone: undefined }, ...(l.content.kind === 'text' ? { content: { shadow: undefined } } : {}) }, label)),
    ),
  );
}

/** Draw the selected text and shapes as lines only (or filled again). */
export function outlineOnlySelection(on: boolean) {
  const { layers, zoneId, dispatch } = editableSelection();
  const lined = layers.filter((l) => l.content.kind === 'text' || l.content.kind === 'shape');
  const label = on ? 'Outline only' : 'Filled';
  if (lined.length) dispatch(cmd.batch(label, lined.map((l) => cmd.updateLayer(zoneId, l.id, { content: on ? { hollow: true, strokeWidthMm: (l.content as { strokeWidthMm?: number }).strokeWidthMm || 1.5 } : { hollow: undefined } }, label))));
}

/** Lock or hide the selected layers (or show and unlock them again), as one undo step. */
export function setSelectionFlag(flag: 'locked' | 'visible', value: boolean) {
  const { document, selectedLayerIds, activeZoneId, dispatch, select } = useStudio.getState();
  const zone = document ? artboardOf(document, activeZoneId) : undefined;
  if (!zone) return;
  const ids = selectedLayerIds.filter((id) => zone.layers[id] && zone.layers[id][flag] !== value);
  if (!ids.length) return;
  const label = flag === 'locked' ? (value ? 'Lock' : 'Unlock') : value ? 'Show' : 'Hide';
  dispatch(cmd.batch(label, ids.map((id) => cmd.updateLayer(activeZoneId, id, { [flag]: value }, label))));
  // Hidden or locked layers can't be worked on the canvas, so they leave the selection.
  if ((flag === 'locked' && value) || (flag === 'visible' && !value)) select([]);
}

/** Design on the next (or previous) print zone or design area, in tab order. */
export function switchArtboard(direction: 1 | -1) {
  const s = useStudio.getState();
  if (!s.document) return;
  const order: ArtboardId[] = [...getGarment(s.document.garment.modelId).zoneOrder, ...designAreas(s.document).map((a) => a.id as AreaId)];
  const i = order.indexOf(s.activeZoneId);
  s.setActiveZone(order[(i + direction + order.length) % order.length]);
}
