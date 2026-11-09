'use client';
/**
 * Studio actions for design areas: print areas the person adds anywhere on the 3D garment (a
 * hood, a side panel, across a seam), designed in 2D like any zone. Every edit is one command.
 */
import { createArea, designAreas, MAX_AREAS, newAreaId, nextAreaName } from '@/domain/areas';
import * as cmd from '@/domain/commands';
import { newId } from '@/domain/factory';
import { getGarment, getSize, zoneSpecOrFirst } from '@/domain/garments';
import { isAreaId, type AreaId, type ProjectorSpec } from '@/domain/schema';
import { toast } from '@/components/ui/primitives';
import { useStudio } from '@/stores/studio-store';
import { projectorAtZonePoint, showOnGarment } from './projection-actions';
import { slideProjector, steadyProjector, type ProjectionMesh, type Projector } from './viewer3d/projection';
import { restShape } from './viewer3d/rest-shape';
import { viewerApi } from './viewer3d/stage';

/** The front's chest, for a new area when the 3D view isn't open to say where the person is looking. */
function chestAnchor(): ProjectorSpec | null {
  const doc = useStudio.getState().document;
  if (!doc) return null;
  const model = getGarment(doc.garment.modelId);
  const spec = zoneSpecOrFirst(model, 'front');
  return projectorAtZonePoint(doc, 'front', spec.printableWidthMm / 2, spec.printableHeightMm * 0.3);
}

/** Add a design area where the 3D view is looking (or on the chest), make it the one being designed on. */
export function addDesignArea() {
  const s = useStudio.getState();
  const doc = s.document;
  if (!doc) return;
  if (designAreas(doc).length >= MAX_AREAS) {
    toast(`A design can hold ${MAX_AREAS} design areas.`, 'error');
    return;
  }
  const projector = viewerApi.areaAnchor?.() ?? chestAnchor();
  if (!projector) {
    toast('Turn the 3D view toward the garment, then add the area.', 'error');
    return;
  }
  const area = createArea({ id: newAreaId(), name: nextAreaName(doc), projector });
  s.dispatch(cmd.addArea(area));
  s.setActiveZone(area.id as AreaId);
  showOnGarment();
  toast(`${area.name} added where you were looking. Design in it like any print area; in Place mode, drag it anywhere on the garment.`, 'success');
}

/**
 * The cloth at rest that design areas lie on: the garment the 3D view shows, else the style's own
 * shape. A fitted GLB shell is only known while the 3D view shows it, so without it, null.
 */
function restCloth(): readonly ProjectionMesh[] | null {
  const shown = viewerApi.restCloth?.();
  if (shown) return shown;
  const doc = useStudio.getState().document;
  if (!doc || doc.garment.shape?.kind === 'shell') return null;
  const model = getGarment(doc.garment.modelId);
  return restShape(model, getSize(model, doc.garment.sizeCode), 'high').parts.map((p) => p.mesh);
}

const specOf = (p: Projector): ProjectorSpec => ({ point: [...p.point], normal: [...p.normal], up: [...p.up] });

/** A copy of a design area beside it (right, left, below or above, wherever there is cloth), with its artwork. */
export function duplicateDesignArea(areaId: string) {
  const s = useStudio.getState();
  const doc = s.document;
  const area = doc?.areas?.items[areaId];
  if (!doc || !area) return;
  if (designAreas(doc).length >= MAX_AREAS) {
    toast(`A design can hold ${MAX_AREAS} design areas.`, 'error');
    return;
  }
  const cloth = restCloth();
  const w = area.widthMm * 1.1;
  const h = area.heightMm * 1.1;
  const tries: [number, number][] = [
    [w, 0],
    [-w, 0],
    [0, -h],
    [0, h],
    [w / 2, 0],
    [-w / 2, 0],
    [0, -h / 2],
    [0, h / 2],
  ];
  let beside: Projector | null = null;
  for (const [dx, dy] of cloth ? tries : []) {
    beside = slideProjector(cloth!, area.projector, dx, dy);
    if (beside) {
      beside = steadyProjector(cloth!, beside, Math.max(area.widthMm, area.heightMm));
      break;
    }
  }
  const copyId = newAreaId();
  const name = `${area.name} copy`.slice(0, 60);
  const layerIds = Object.fromEntries(area.orderedLayerIds.map((id) => [id, newId()]));
  s.dispatch(cmd.duplicateArea(areaId, copyId, layerIds, beside ? specOf(beside) : area.projector, name));
  s.setActiveZone(copyId);
  if (!beside) toast(`${name} is on top of ${area.name}. Drag it in 3D Place mode to where it goes.`);
}

/**
 * Put a design area on the cloth in the middle of the 3D view: for an area somewhere hard to
 * reach, or one left off the garment after changing to a different model.
 */
export function bringAreaToView(areaId: string) {
  const s = useStudio.getState();
  const area = s.document?.areas?.items[areaId];
  if (!area) return;
  const anchor = viewerApi.areaAnchor?.();
  if (!anchor) {
    toast('Open the 3D view and turn the garment to where the area goes, then try again.', 'error');
    return;
  }
  const cloth = restCloth();
  const projector = cloth ? specOf(steadyProjector(cloth, anchor, Math.max(area.widthMm, area.heightMm))) : anchor;
  s.dispatch(cmd.updateArea(areaId, { projector }, `Bring ${area.name} to view`));
}

/** Delete a design area and its artwork (one undo step brings it back). */
export function deleteDesignArea(areaId: string) {
  const s = useStudio.getState();
  const area = s.document?.areas?.items[areaId];
  if (!area) return;
  s.dispatch(cmd.removeArea(areaId, area.name));
  toast(`${area.name} deleted. Undo brings it back.`);
}

/** Slide the active design area across the cloth by millimetres in its own plane (arrow keys). */
export function nudgeArea(areaId: string, dxMm: number, dyMm: number) {
  const s = useStudio.getState();
  const doc = s.document;
  const area = doc?.areas?.items[areaId];
  const cloth = restCloth();
  if (!doc || !area || area.locked || !cloth) return;
  const moved = slideProjector(cloth, area.projector, dxMm, -dyMm);
  if (!moved) return;
  const steady = steadyProjector(cloth, moved, Math.max(area.widthMm, area.heightMm));
  s.dispatch(cmd.coalescing(cmd.updateArea(areaId, { projector: specOf(steady) }, 'Nudge area'), `nudge-area:${areaId}`));
}

/** The active design area when nothing in it is selected: the area itself is what arrow keys, the wheel and pinch move. */
export function activeBareArea() {
  const s = useStudio.getState();
  const id = s.activeZoneId;
  if (!isAreaId(id) || s.selectedLayerIds.length || s.selectedProjectionId) return null;
  return s.document?.areas?.items[id] ?? null;
}
