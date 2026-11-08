'use client';
/** Studio actions shared by the tool rail, mobile sheets, keyboard shortcuts and drag-and-drop. */
import { alignUnits, distributeUnits, expandToGroups, selectionUnits, type AlignMode, type DistributeAxis } from '@/domain/arrange';
import * as cmd from '@/domain/commands';
import { contrastInk, createGraphicLayer, createImageLayer, createShapeLayer, createTextLayer, newId } from '@/domain/factory';
import { getGarment, partColor, zoneSpecOrFirst } from '@/domain/garments';
import type { Graphic } from '@/domain/graphics';
import type { ShapeContent } from '@/domain/schema';
import { AssetError, importImageFile } from '@/lib/assets';
import { textAspect } from '@/lib/render/zone-renderer';
import { toast } from '@/components/ui/primitives';
import { useStudio } from '@/stores/studio-store';

function context() {
  const s = useStudio.getState();
  if (!s.document) return null;
  const spec = zoneSpecOrFirst(getGarment(s.document.garment.modelId), s.activeZoneId);
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

export function placementsFor(spec: { id: string; part: string; printableWidthMm: number; printableHeightMm: number; topFromHpsMm?: number }): Placement[] {
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
  const zone = c.s.document.zones[c.zoneId];
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
  const zone = document.zones[activeZoneId];
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
  const zone = c.s.document.zones[c.zoneId];
  const units = selectionUnits(zone, c.s.selectedLayerIds);
  const changes = alignUnits(units, mode, { x: 0, y: 0, width: c.spec.printableWidthMm, height: c.spec.printableHeightMm });
  c.s.dispatch(cmd.updateTransforms(c.zoneId, changes, ALIGN_LABELS[mode]));
}

export function distributeSelection(axis: DistributeAxis) {
  const c = context();
  if (!c || !c.s.document) return;
  const units = selectionUnits(c.s.document.zones[c.zoneId], c.s.selectedLayerIds);
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

/** Select every visible, unlocked layer in the active zone (Ctrl+A). */
export function selectAll() {
  const { document, activeZoneId, select } = useStudio.getState();
  if (!document) return;
  const zone = document.zones[activeZoneId];
  select(zone.orderedLayerIds.filter((id) => zone.layers[id]?.visible && !zone.layers[id]?.locked));
}

/** Select layers from a list click, expanding to whole groups. */
export function selectLayers(ids: string[]) {
  const { document, activeZoneId, select } = useStudio.getState();
  if (!document) return;
  select(expandToGroups(document.zones[activeZoneId], ids));
}

export function moveSelectionInStack(direction: 1 | -1) {
  const { selectedLayerIds, activeZoneId, dispatch } = useStudio.getState();
  if (!selectedLayerIds.length) return;
  dispatch(cmd.moveLayerBy(activeZoneId, selectedLayerIds[0], direction));
}

export function zoomToSelection() {
  window.dispatchEvent(new CustomEvent('wovexa:zoom-to-selection'));
}
