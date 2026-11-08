/**
 * Paints projected (cross-seam) layers into garment part textures. Each layer's artwork is drawn
 * once at the texture's density; its projector selects the triangles of every part under it, a
 * depth map seen from the projector decides which cloth it reaches first, and each part's share
 * is mapped into that part's texture. The same code paints the 3D view and the cut-and-sew
 * panels, so what prints is what the garment shows.
 *
 * Textures only: the garment's shape, baked shading, lining and motion attributes are untouched.
 */
import type { PartId } from '@/domain/garments';
import { projectedAsArtwork } from '@/domain/projected';
import type { DesignDocument, ProjectedLayer, ProjectedTransform, ProjectorSpec } from '@/domain/schema';
import { drawLayerContent, layerBleedMm } from '@/lib/render/zone-renderer';
import type { GarmentGeometry } from './garment-geometry';
import {
  buildDepthMap,
  decalFrame,
  keepTriangles,
  paintTriangles,
  reachesBounds,
  selectTriangles,
  settle,
  type DecalFrame,
  type DecalImage,
  type DecalPlacement,
  type DepthMap,
  type ProjectedPart,
  type ProjectionMesh,
  type Vec3,
} from './projection';
import { paintMesh, restFromGeometry, type RestShape } from './rest-shape';

/** A projected layer mid-gesture: where it is being dragged to, or its new size and turn. */
export interface ProjectionEdit {
  id: string;
  projector?: ProjectorSpec;
  transform?: Partial<ProjectedTransform>;
}

/** What projected layers are painted onto: the garment at rest (where art lands) and as displayed (its texture layout). */
export interface ProjectionScene {
  doc: DesignDocument;
  rest: RestShape;
  geo: GarmentGeometry;
  live?: ProjectionEdit | null;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
export function idOf(o: object | null | undefined) {
  if (!o) return 0;
  let v = ids.get(o);
  if (!v) {
    v = nextId++;
    ids.set(o, v);
  }
  return v;
}

const restOfGeometry = new WeakMap<GarmentGeometry, RestShape>();
/** The rest shape to project onto: the one given, else the displayed garment itself (built pressed flat). */
export function sceneRest(geo: GarmentGeometry, rest?: RestShape): RestShape {
  if (rest) return rest;
  let r = restOfGeometry.get(geo);
  if (!r) {
    r = restFromGeometry(geo);
    restOfGeometry.set(geo, r);
  }
  return r;
}

const edited = new WeakMap<ProjectionEdit, ProjectedLayer>();
/** A layer with any in-progress edit applied; the same object for the same edit, so caches hold. */
export function effectiveLayer(layer: ProjectedLayer, live?: ProjectionEdit | null): ProjectedLayer {
  if (!live || live.id !== layer.id) return layer;
  const hit = edited.get(live);
  if (hit && hit.id === layer.id) return hit;
  const out = { ...layer, projector: live.projector ?? layer.projector, transform: live.transform ? { ...layer.transform, ...live.transform } : layer.transform };
  edited.set(live, out);
  return out;
}

const placements = new WeakMap<ProjectedLayer, DecalPlacement>();
export function placementOf(layer: ProjectedLayer): DecalPlacement {
  let p = placements.get(layer);
  if (!p) {
    const t = layer.transform;
    p = {
      projector: layer.projector,
      widthMm: t.widthMm,
      heightMm: t.heightMm,
      rotationDeg: t.rotationDeg,
      flipX: t.flipX,
      flipY: t.flipY,
      bleedMm: layerBleedMm(projectedAsArtwork(layer)),
    };
    placements.set(layer, p);
  }
  return p;
}

/** Margin for the quick reach test: the projector may settle onto cloth a little off its stored point. */
const REACH_MARGIN_MM = 80;

/** Visible projected layers that can touch `part`, bottom first, with any live edit applied. */
export function layersOnPart(scene: ProjectionScene, part: PartId): ProjectedLayer[] {
  const restPart = scene.rest.parts.find((p) => p.id === part);
  const p = scene.doc.projections;
  if (!restPart || !p?.orderedLayerIds.length) return [];
  const m = REACH_MARGIN_MM;
  const min: Vec3 = [restPart.min[0] - m, restPart.min[1] - m, restPart.min[2] - m];
  const max: Vec3 = [restPart.max[0] + m, restPart.max[1] + m, restPart.max[2] + m];
  const out: ProjectedLayer[] = [];
  for (const id of p.orderedLayerIds) {
    const layer = p.layers[id];
    if (!layer?.visible) continue;
    const l = effectiveLayer(layer, scene.live);
    if (reachesBounds(decalFrame(placementOf(l)), min, max)) out.push(l);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Where a layer lands: its frame, every part's selected triangles, the depth map
// ---------------------------------------------------------------------------

export interface Projection {
  frame: DecalFrame;
  parts: Map<PartId, { mesh: ProjectionMesh; projected: ProjectedPart }>;
  depth: DepthMap | null;
}

const projections = new WeakMap<ProjectedLayer, Map<string, Projection>>();

/** Project one layer onto the whole garment (cached per layer, rest shape and displayed garment). */
export function projectLayer(layer: ProjectedLayer, scene: ProjectionScene): Projection {
  const key = `${idOf(scene.rest)}:${idOf(scene.geo)}`;
  let byScene = projections.get(layer);
  const hit = byScene?.get(key);
  if (hit) return hit;
  const meshes = scene.rest.parts.map((r) => paintMesh(r, scene.geo.parts.find((p) => p.id === r.id)?.geometry));
  // The centre sits on the cloth along the projector's axis, wherever this size or drape puts it.
  const frame = decalFrame(placementOf(layer), settle(meshes, layer.projector));
  const parts = new Map<PartId, { mesh: ProjectionMesh; projected: ProjectedPart }>();
  scene.rest.parts.forEach((r, i) => {
    if (!reachesBounds(frame, r.min, r.max)) return;
    const projected = selectTriangles(meshes[i], frame);
    if (projected.triangles.length) parts.set(r.id, { mesh: meshes[i], projected });
  });
  const result: Projection = { frame, parts, depth: parts.size ? buildDepthMap([...parts.values()], frame) : null };
  if (!byScene) {
    byScene = new Map();
    projections.set(layer, byScene);
  }
  byScene.set(key, result);
  if (byScene.size > 4) byScene.delete(byScene.keys().next().value!);
  return result;
}

// ---------------------------------------------------------------------------
// The artwork as pixels
// ---------------------------------------------------------------------------

/** Longest side of a rendered artwork bitmap; larger artwork is drawn a little softer. */
const MAX_ART_SIDE = 3072;
const artCache = new Map<string, DecalImage>();

function canvasOf(width: number, height: number) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/**
 * The layer's artwork at `pxPerMm`, its effects and bleed included, unrotated and unmirrored
 * (the projection turns and mirrors it). Opacity and blending apply when it is composited.
 * Null while an image is still loading.
 */
export function renderArtwork(layer: ProjectedLayer, pxPerMm: number, outline?: string): DecalImage | null {
  const art = projectedAsArtwork(layer);
  const t = layer.transform;
  const bleedMm = layerBleedMm(art);
  const ppm = Math.min(pxPerMm, MAX_ART_SIDE / (Math.max(t.widthMm, t.heightMm) + 2 * bleedMm));
  const key = JSON.stringify([layer.id, layer.content, layer.style.finish, layer.style.distress ?? null, t.widthMm, t.heightMm, Math.round(ppm * 1000), outline ?? null]);
  const hit = artCache.get(key);
  if (hit) {
    artCache.delete(key);
    artCache.set(key, hit);
    return hit;
  }
  const bleedPx = Math.ceil(bleedMm * ppm) + 1;
  const wPx = t.widthMm * ppm;
  const hPx = t.heightMm * ppm;
  const canvas = canvasOf(Math.max(1, Math.ceil(wPx + 2 * bleedPx)), Math.max(1, Math.ceil(hPx + 2 * bleedPx)));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (outline) {
    // A selection guide: the artwork's box, nothing else.
    ctx.strokeStyle = outline;
    ctx.lineWidth = Math.max(2, 1.6 * ppm);
    ctx.strokeRect(bleedPx, bleedPx, wPx, hPx);
  } else {
    ctx.translate(bleedPx + wPx / 2, bleedPx + hPx / 2);
    if (!drawLayerContent(ctx, art, wPx, hPx, ppm, { simulateFinish: false })) return null;
  }
  const image: DecalImage = { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, pxPerMm: ppm, originMm: -bleedPx / ppm };
  canvas.width = canvas.height = 0;
  artCache.set(key, image);
  while (artCache.size > 8) artCache.delete(artCache.keys().next().value!);
  return image;
}

// ---------------------------------------------------------------------------
// Painting a part
// ---------------------------------------------------------------------------

const BLEND: Record<ProjectedLayer['style']['blendMode'], GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
};

let scratch: HTMLCanvasElement | null = null;

function composite(ctx: CanvasRenderingContext2D, patches: ReturnType<typeof paintTriangles>, opacity: number, blend: GlobalCompositeOperation) {
  for (const p of patches) {
    if (!scratch) scratch = canvasOf(1, 1);
    if (scratch.width < p.width || scratch.height < p.height) {
      scratch.width = Math.max(scratch.width, p.width);
      scratch.height = Math.max(scratch.height, p.height);
    }
    scratch.getContext('2d')!.putImageData(new ImageData(p.data, p.width, p.height), 0, 0);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = blend;
    ctx.drawImage(scratch, 0, 0, p.width, p.height, p.x, p.y, p.width, p.height);
    ctx.restore();
  }
}

/** Pixels past each triangle edge the artwork continues: seams are island edges, and filtering there must not mix in bare fabric. */
const PAD_PX = 3;

/**
 * Paint the projected layers that reach `part` into its texture (`ctx`, `pxPerMm` texture density),
 * bottom first. Returns false while an image is still loading.
 */
export function drawProjections(ctx: CanvasRenderingContext2D, part: PartId, scene: ProjectionScene, pxPerMm: number): boolean {
  let complete = true;
  const target = { width: ctx.canvas.width, height: ctx.canvas.height };
  for (const layer of layersOnPart(scene, part)) {
    const projection = projectLayer(layer, scene);
    const onPart = projection.parts.get(part);
    if (!onPart) continue;
    const art = renderArtwork(layer, pxPerMm);
    if (!art) {
      complete = false;
      continue;
    }
    const patches = paintTriangles(onPart.mesh, onPart.projected, art, target, { depth: projection.depth ?? undefined, padPx: PAD_PX });
    composite(ctx, patches, layer.style.opacity, BLEND[layer.style.blendMode]);
  }
  return complete;
}

/**
 * A cut-and-sew panel's bleed: the projected artwork of one pattern piece (`keep` picks its
 * triangles) carried `bleedPx` past the piece's edges, as patches in texture pixels that may run
 * off the texture. The panel shows these only outside its cut line, so a slightly wide cut
 * still lands on print rather than bare fabric. Null while an image is still loading.
 */
export function projectionBleed(scene: ProjectionScene, part: PartId, pxPerMm: number, size: { width: number; height: number }, keep: (triangle: number) => boolean, bleedPx: number) {
  const out: { patches: ReturnType<typeof paintTriangles>; opacity: number; blend: GlobalCompositeOperation }[] = [];
  for (const layer of layersOnPart(scene, part)) {
    const projection = projectLayer(layer, scene);
    const onPart = projection.parts.get(part);
    if (!onPart) continue;
    const art = renderArtwork(layer, pxPerMm);
    if (!art) return null;
    const piece = keepTriangles(onPart.projected, keep);
    if (!piece.triangles.length) continue;
    const patches = paintTriangles(onPart.mesh, piece, art, size, { depth: projection.depth ?? undefined, padPx: bleedPx, unbounded: true });
    out.push({ patches, opacity: layer.style.opacity, blend: BLEND[layer.style.blendMode] });
  }
  return out;
}

/** Draw texture patches onto a canvas whose origin sits at texture pixel (`x0`, `y0`). */
export function drawPatches(ctx: CanvasRenderingContext2D, patches: ReturnType<typeof paintTriangles>, x0: number, y0: number, opacity: number, blend: GlobalCompositeOperation) {
  composite(ctx, patches.map((p) => ({ ...p, x: p.x - x0, y: p.y - y0 })), opacity, blend);
}

/** The selected projected layer's box traced on the cloth: an on-garment guide, never printed. */
export function drawProjectionOutline(ctx: CanvasRenderingContext2D, part: PartId, scene: ProjectionScene, layerId: string, pxPerMm: number, color: string) {
  const layer = layersOnPart(scene, part).find((l) => l.id === layerId);
  if (!layer) return;
  const projection = projectLayer(layer, scene);
  const onPart = projection.parts.get(part);
  const outline = onPart ? renderArtwork(layer, pxPerMm, color) : null;
  if (!onPart || !outline) return;
  composite(ctx, paintTriangles(onPart.mesh, onPart.projected, outline, { width: ctx.canvas.width, height: ctx.canvas.height }, { depth: projection.depth ?? undefined, padPx: 1 }), 1, 'source-over');
}

/** What a part's projected artwork depends on, for its texture's change key. */
export function projectionKey(scene: ProjectionScene, part: PartId, outlineId?: string | null) {
  const layers = layersOnPart(scene, part);
  if (!layers.length) return '-';
  const outlined = outlineId && layers.some((l) => l.id === outlineId) ? outlineId : '';
  return `${layers.map(idOf).join('.')}:${idOf(scene.rest)}:${outlined}`;
}
