/**
 * Composes garment textures from the canonical document (spec §27.1 "mark zone dirty →
 * redraw"): fabric colour and any all-over print, construction trims (neck bands, bindings,
 * rib cuffs and hems, stitching), and each zone's artwork at its true physical position.
 * Zone placement comes from uv-mapping, the same mapping 3D picking uses, so they always agree.
 * Each part has a change key, so only parts whose content changed are repainted and re-uploaded.
 */
import { partColor, type GarmentModel, type PartId } from '@/domain/garments';
import { gradeAnchor, zoneGrade } from '@/domain/grading';
import { isAreaId, type ArtboardId, type Colorway, type DesignDocument, type LayerTransform, type Surface, type ZoneId } from '@/domain/schema';
import { drawZone, drawZoneSurface, paintFabric } from '@/lib/render/zone-renderer';
import { partSizeMm, type EdgePoint, type GarmentGeometry } from './garment-geometry';
import { areasKey, drawAreaOutlines, drawAreas, drawAreaSurfaces, drawProjectionOutline, drawProjections, projectionKey, sceneRest, type ProjectionEdit, type ProjectionScene } from './projected-paint';
import type { RestShape } from './rest-shape';
import { zoneOrigin } from './uv-mapping';

export { partSizeMm };

/**
 * Live profiles (spec §24.2–24.3, MOB-11), plus `ultra`, used only while rendering stills and
 * video, and `print`, for cut-and-sew panels (never uploaded to the GPU).
 */
export type Quality = 'low' | 'medium' | 'high' | 'ultra' | 'print';

/** Texture density per quality profile. Print is 120 dpi, the usual resolution for all-over sublimation. */
export const PX_PER_MM: Record<Quality, number> = { low: 0.8, medium: 1.25, high: 1.7, ultra: 2.6, print: 120 / 25.4 };
const MAX_TEXTURE: Record<Quality, number> = { low: 2048, medium: 2048, high: 2048, ultra: 4096, print: 8192 };
let gpuMaxTexture = 4096;

/** The renderer reports the GPU's texture limit once it knows it. */
export function setGpuMaxTexture(size: number) {
  gpuMaxTexture = size;
}

type Overrides = Record<string, Partial<LayerTransform>> | undefined;

export interface LiveState {
  zoneId: ArtboardId | null;
  overrides: Overrides;
  /** A projected layer or design area being dragged, resized or turned on the garment. */
  projection?: ProjectionEdit | null;
}

/** On-garment position aids (spec ED3-11). Never drawn into renders or exports. */
export interface Guides {
  zones: boolean;
  selection: { zoneId: ArtboardId; ids: string[] } | null;
  /** The selected projected layer, outlined where it lies on the cloth. */
  projection?: string | null;
  /** The zone or design area being designed on: a design area's outline is drawn solid. */
  active?: ArtboardId | null;
  accent: string;
}

export interface PaintContext {
  doc: DesignDocument;
  model: GarmentModel;
  geo: GarmentGeometry;
  /**
   * The garment pressed flat, matching `geo`'s mesh detail, that projected layers land on. Omit
   * when `geo` was itself built without drape (as the cut-and-sew export builds it).
   */
  rest?: RestShape;
  colorway: Colorway;
  quality: Quality;
  live?: LiveState;
  guides?: Guides;
  /** Fabric for printing: no simulated stitching, which is sewn rather than printed. */
  production?: boolean;
  /**
   * Shade puff, embroidery and foil into the colour. Off when a surface map carries them as real
   * relief, gloss and metal (see drawPartSurface).
   */
  simulateFinish?: boolean;
}

export function zonesOnPart(model: GarmentModel, part: PartId): ZoneId[] {
  return model.zoneOrder.filter((z) => model.zones[z]?.part === part);
}

function sized(canvas: HTMLCanvasElement, wMm: number, hMm: number, quality: Quality) {
  const cap = quality === 'print' ? MAX_TEXTURE.print : Math.min(MAX_TEXTURE[quality], gpuMaxTexture);
  const ppm = Math.min(PX_PER_MM[quality], cap / Math.max(wMm, hMm));
  const w = Math.max(1, Math.round(wMm * ppm));
  const h = Math.max(1, Math.round(hMm * ppm));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return ppm;
}

function stitchLine(ctx: CanvasRenderingContext2D, y: number, x0: number, x1: number, color: string, ppm: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, 0.7 * ppm);
  ctx.setLineDash([3 * ppm, 1.6 * ppm]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

/** A rib band: the trim colour with fine vertical ribs, as on cuffs, hems and hood edges. */
function ribBand(ctx: CanvasRenderingContext2D, y: number, h: number, width: number, color: string, ppm: number) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(0, y, width, h);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#000000';
  const step = Math.max(2, 2.2 * ppm);
  for (let x = 0; x < width; x += step * 2) ctx.fillRect(x, y, step, h);
  ctx.restore();
}

/** A band of `width` px on the body side of an edge polyline (the neck opening or an armhole). */
function edgeBand(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], width: number, color: string) {
  if (pts.length < 2) return;
  // Normals from a few points either side, so the band's outer edge runs smooth.
  const out = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 3)];
    const b = pts[Math.min(pts.length - 1, i + 3)];
    let nx = -(b.y - a.y);
    let ny = b.x - a.x;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    // The body lies below the opening in texture space.
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { x: p.x + nx * width, y: p.y + ny * width };
  });
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  for (let i = out.length - 1; i >= 0; i--) ctx.lineTo(out[i].x, out[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Contiguous runs of edge points of one kind, in canvas pixels. */
function runs(edge: EdgePoint[], kind: EdgePoint['kind'], W: number, H: number) {
  const out: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (const p of edge) {
    if (p.kind === kind) cur.push({ x: p.u * W, y: (1 - p.v) * H });
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Scale the context about a zone's grade anchor (the top centre of its print area, on the part)
 * when the design is graded by size and shown on another size than its base.
 */
function applyGrade(ctx: CanvasRenderingContext2D, model: GarmentModel, doc: DesignDocument, zoneId: ZoneId, origin: { x: number; y: number }, ppm: number) {
  const spec = model.zones[zoneId];
  const factor = zoneGrade(doc, zoneId, doc.garment.sizeCode);
  if (!spec || factor === 1) return;
  const a = gradeAnchor(spec);
  const ax = (origin.x + a.xMm) * ppm;
  const ay = (origin.y + a.yMm) * ppm;
  ctx.translate(ax, ay);
  ctx.scale(factor, factor);
  ctx.translate(-ax, -ay);
}

function drawGuides(ctx: CanvasRenderingContext2D, c: PaintContext, zoneId: ZoneId, origin: { x: number; y: number }, ppm: number) {
  const { guides, model, doc, live } = c;
  const spec = model.zones[zoneId];
  if (!guides || !spec) return;
  ctx.save();
  ctx.translate(origin.x * ppm, origin.y * ppm);
  if (guides.zones) {
    ctx.strokeStyle = guides.accent;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(1.5, 1.2 * ppm);
    ctx.setLineDash([6 * ppm, 4 * ppm]);
    ctx.strokeRect(0, 0, spec.printableWidthMm * ppm, spec.printableHeightMm * ppm);
  }
  if (guides.selection?.zoneId === zoneId) {
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = guides.accent;
    // Selection outlines go round the artwork as shown: graded at this size.
    ctx.translate(-origin.x * ppm, -origin.y * ppm);
    applyGrade(ctx, model, doc, zoneId, origin, ppm);
    ctx.translate(origin.x * ppm, origin.y * ppm);
    ctx.lineWidth = Math.max(2, 1.6 * ppm) / zoneGrade(doc, zoneId, doc.garment.sizeCode);
    for (const id of guides.selection.ids) {
      const layer = doc.zones[zoneId].layers[id];
      if (!layer) continue;
      const t = { ...layer.transform, ...(live?.zoneId === zoneId ? live.overrides?.[id] : undefined) };
      ctx.save();
      ctx.translate(t.centerXmm * ppm, t.centerYmm * ppm);
      ctx.rotate((t.rotationDeg * Math.PI) / 180);
      ctx.strokeRect((-t.widthMm / 2) * ppm, (-t.heightMm / 2) * ppm, t.widthMm * ppm, t.heightMm * ppm);
      ctx.restore();
    }
  }
  ctx.restore();
}

function surfaceOf(colorway: Colorway, part: PartId): Surface | undefined {
  const s = colorway.surfaces;
  if (!s) return undefined;
  return part === 'torso' ? s.body : part === 'sleeveLeft' || part === 'sleeveRight' ? s.sleeves : s.pants;
}

/** Paint one part's texture. Returns false while an image (artwork or fabric print) is still loading. */
export function drawPart(canvas: HTMLCanvasElement, part: PartId, c: PaintContext): boolean {
  const { model, geo, colorway, quality, doc, live } = c;
  const { w: wMm, h: hMm } = partSizeMm(geo, part);
  const ppm = sized(canvas, wMm, hMm, quality);
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const W = canvas.width;
  const H = canvas.height;
  const sleeve = part === 'sleeveLeft' || part === 'sleeveRight';
  const leg = part === 'legLeft' || part === 'legRight';
  const base = partColor(colorway, leg ? 'pants' : sleeve ? 'sleeves' : 'body');
  const trim = colorway.parts.collar;
  const stitch = colorway.parts.stitching;
  // Prints centre on the front centre line, the top of the sleeve, the outside of the leg.
  const anchor = { x: (part === 'torso' ? 0.75 : 0.5) * W, y: 0 };
  // The torso wraps around the body, so dye effects must join where its texture meets itself.
  let complete = paintFabric(ctx, base, surfaceOf(colorway, part), W, H, ppm, anchor, part === 'torso' ? W : undefined);
  // Artwork across seams is printed into the fabric before it is sewn: under trims, stitching and zone prints.
  const projected = projectionScene(c);
  complete = drawProjections(ctx, part, projected, ppm) && complete;

  const sewn = !c.production;
  if (part === 'torso') {
    const scale = model.bodyLengthMm ? hMm / model.bodyLengthMm : 1;
    if (model.hem === 'rib') ribBand(ctx, H - 70 * scale * ppm, 70 * scale * ppm, W, trim, ppm);
    else if (sewn) {
      stitchLine(ctx, H - 20 * ppm, 0, W, stitch, ppm);
      stitchLine(ctx, H - 26 * ppm, 0, W, stitch, ppm);
    }
    const trimW = (model.trimWidthMm ?? 0) * scale * ppm;
    if (trimW) {
      for (const edge of geo.torsoEdges) {
        const kinds: EdgePoint['kind'][] = model.neckline === 'v' || model.neckline === 'dobok' || model.neckline === 'scoop' ? ['neck'] : [];
        if (!model.sleeve) kinds.push('armhole');
        for (const kind of kinds) for (const run of runs(edge, kind, W, H)) edgeBand(ctx, run, trimW, trim);
      }
    }
    if (geo.pocket && sewn) {
      const p = geo.pocket;
      ctx.save();
      ctx.strokeStyle = stitch;
      ctx.lineWidth = Math.max(1, 0.7 * ppm);
      ctx.setLineDash([3 * ppm, 1.6 * ppm]);
      ctx.strokeRect(p.x0 * ppm + 4 * ppm, p.y0 * ppm + 4 * ppm, (p.x1 - p.x0) * ppm - 8 * ppm, (p.y1 - p.y0) * ppm - 4 * ppm);
      ctx.restore();
    }
  } else if (sleeve && model.sleeve) {
    if (model.sleeve.cuff === 'rib') ribBand(ctx, H - 60 * ppm, 60 * ppm, W, trim, ppm);
    else if (model.sleeve.cuff === 'hem' && sewn) stitchLine(ctx, H - 18 * ppm, 0, W, stitch, ppm);
  } else if (leg && sewn) {
    stitchLine(ctx, H - 26 * ppm, 0, W, stitch, ppm);
    stitchLine(ctx, H - 32 * ppm, 0, W, stitch, ppm);
  }

  for (const zoneId of zonesOnPart(model, part)) {
    const o = zoneOrigin(model, geo.layout, zoneId);
    ctx.save();
    // Artwork graded by size shows at this size's grade, grown from the top centre of its print area.
    applyGrade(ctx, model, doc, zoneId, o, ppm);
    complete =
      drawZone(ctx, doc.zones[zoneId], {
        pxPerMm: ppm,
        originX: o.x * ppm,
        originY: o.y * ppm,
        overrides: live?.zoneId === zoneId ? live.overrides : undefined,
        simulateFinish: sewn && (c.simulateFinish ?? true),
      }) && complete;
    ctx.restore();
    drawGuides(ctx, c, zoneId, o, ppm);
  }
  // Design areas go on last, like transfers pressed onto the finished garment.
  complete = drawAreas(ctx, part, projected, ppm, { live: c.live, simulateFinish: sewn && (c.simulateFinish ?? true) }) && complete;
  if (c.guides) {
    const g = c.guides;
    drawAreaOutlines(ctx, part, projected, ppm, { accent: g.accent, all: g.zones, active: g.active ?? null, selected: g.selection && isAreaId(g.selection.zoneId) ? g.selection.ids : undefined, live: c.live });
  }
  if (c.guides?.projection) drawProjectionOutline(ctx, part, projected, c.guides.projection, ppm, c.guides.accent);
  return complete;
}

/** Projected layers paint onto the garment at rest, into the displayed garment's texture layout. */
function projectionScene(c: PaintContext): ProjectionScene {
  return { doc: c.doc, rest: sceneRest(c.geo, c.rest), geo: c.geo, live: c.live?.projection };
}

/**
 * A part's print surface as a material map, the same size as its colour texture: red is ink
 * height (bump), green roughness, blue metalness. Bare fabric is flat at the fabric's own
 * roughness; each print method and finish sets how high and glossy its ink sits (see inkLook).
 */
export function drawPartSurface(canvas: HTMLCanvasElement, part: PartId, c: PaintContext, fabricRoughness: number): boolean {
  const { model, geo, quality, doc, live } = c;
  const { w: wMm, h: hMm } = partSizeMm(geo, part);
  const ppm = sized(canvas, wMm, hMm, quality);
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgb(0, ${Math.round(fabricRoughness * 255)}, 0)`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let complete = true;
  for (const zoneId of zonesOnPart(model, part)) {
    const o = zoneOrigin(model, geo.layout, zoneId);
    const zone = doc.zones[zoneId];
    ctx.save();
    applyGrade(ctx, model, doc, zoneId, o, ppm);
    complete =
      drawZoneSurface(ctx, zone, {
        pxPerMm: ppm,
        originX: o.x * ppm,
        originY: o.y * ppm,
        overrides: live?.zoneId === zoneId ? live.overrides : undefined,
        method: zone.printMethod,
      }) && complete;
    ctx.restore();
  }
  complete = drawAreaSurfaces(ctx, part, projectionScene(c), ppm, { live }) && complete;
  return complete;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
function idOf(o: object | undefined | null) {
  if (!o) return 0;
  let v = ids.get(o);
  if (!v) {
    v = nextId++;
    ids.set(o, v);
  }
  return v;
}

/**
 * What a part's pixels depend on. Documents are immutable and structurally shared, so an
 * unchanged zone keeps its identity and its part is neither repainted nor re-uploaded.
 */
export function partKey(part: PartId, c: PaintContext, generation: number) {
  const zones = zonesOnPart(c.model, part);
  const onPart = zones as ArtboardId[];
  const live = c.live?.zoneId && onPart.includes(c.live.zoneId) ? idOf(c.live.overrides) : 0;
  const g = c.guides;
  const guideKey = g ? `${g.zones ? 1 : 0}${g.selection && onPart.includes(g.selection.zoneId) ? g.selection.ids.join(',') : ''}` : '-';
  const scene = projectionScene(c);
  const projected = projectionKey(scene, part, g?.projection);
  const areaGuides = g ? `${g.zones ? 1 : 0}${g.active ?? ''}${g.selection && isAreaId(g.selection.zoneId) ? g.selection.ids.join(',') : ''}` : '-';
  const areas = areasKey(scene, part, c.live, areaGuides);
  // Graded artwork repaints when the grading changes, not only the artwork.
  const grades = zones.map((z) => zoneGrade(c.doc, z, c.doc.garment.sizeCode)).join(',');
  return [part, zones.map((z) => idOf(c.doc.zones[z])).join('.'), grades, live, projected, areas, idOf(c.colorway), c.quality, guideKey, idOf(c.geo), generation].join('|');
}
