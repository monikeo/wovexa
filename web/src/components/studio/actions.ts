'use client';
/** Studio actions shared by the tool rail, mobile sheets, keyboard shortcuts and drag-and-drop. */
import { alignUnits, distributeUnits, expandToGroups, selectionUnits, type AlignMode, type DistributeAxis } from '@/domain/arrange';
import * as cmd from '@/domain/commands';
import { contrastInk, createImageLayer, createShapeLayer, createTextLayer, newId } from '@/domain/factory';
import { getGarment } from '@/domain/garments';
import type { ShapeContent } from '@/domain/schema';
import { AssetError, importImageFile } from '@/lib/assets';
import { textAspect } from '@/lib/render/zone-renderer';
import { toast } from '@/components/ui/primitives';
import { useStudio } from '@/stores/studio-store';

function context() {
  const s = useStudio.getState();
  if (!s.document) return null;
  const spec = getGarment(s.document.garment.modelId).zones[s.activeZoneId];
  const colorway = s.document.colorways.find((c) => c.id === s.document!.activeColorwayId) ?? s.document.colorways[0];
  const fabric = spec.part === 'torso' ? colorway.parts.body : colorway.parts.sleeves;
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
