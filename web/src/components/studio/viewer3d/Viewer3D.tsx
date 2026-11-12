'use client';
/**
 * Wovexa 3D: the interactive garment and render camera (spec §9, ED3-01…13, MOB-06).
 * Reads the canonical document and live drag overrides. It writes only through domain
 * commands: zone and layer selection, direct placement on the surface (Place mode), scene
 * settings and saved views. Stills and turntable frames are rendered here for Wovexa Render.
 */
import { CameraControls, CameraControlsImpl, ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Camera as CameraIcon, Clapperboard, Frame, Loader2, Move, Rotate3d, RotateCw, SlidersHorizontal, Sparkles, Ungroup } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { unionBounds } from '@/domain/arrange';
import { artboardOf, designAreas, NEW_AREA_MM } from '@/domain/areas';
import { batch, coalescing, scaleArea, updateArea, updateProjectedLayer, updateTransforms, type Command } from '@/domain/commands';
import { getGarment, getSize, partColor, zoneSpecOrFirst, type PartId } from '@/domain/garments';
import { gradePoint, ungradePoint, zoneGrade } from '@/domain/grading';
import { clamp, hitTestLayer, normalizeDeg, rotatedBounds, scaleRotateAbout } from '@/domain/geometry';
import { layerAssetIds } from '@/domain/lockups';
import { projectionsAsZone } from '@/domain/projected';
import { backdropCss, drapeAmount, motionOf, presetOf, sceneOf, stageOf, toneOf, type MotionKind, type ToneId } from '@/domain/scene';
import { emptyProjections, isAreaId, isLockupId, type AreaId, type ArtboardId, type DesignArea, type DesignDocument, type LayerTransform, type ProjectedLayer, type ProjectedTransform, type ProjectorSpec, type Scene, type ZoneId } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from '@/lib/assets';
import { getAsset } from '@/lib/local-db';
import { fetchLibraryModel } from '@/lib/model-library';
import { canvasToBlob, downloadBlob, slugify } from '@/lib/download';
import { paintBackdrop } from '@/lib/render/backdrop';
import { ensureFonts, paintFabric } from '@/lib/render/zone-renderer';
import { toast } from '@/components/ui/primitives';
import { useDisplayColorway, useLive, useStudio } from '@/stores/studio-store';
import { nudgeSelection, selectLayers } from '../actions';
import { nudgeProjection, transformProjection } from '../projection-actions';
import { activeBareArea, nudgeArea } from '../area-actions';
import { ScenePanel } from './ScenePanel';
import { BASE_FOV, frameFit, shotKey, shotLabel, VIEW_PRESETS, viewerApi, ZONE_VIEW, type RenderBackground, type ShotSpec, type ViewPreset } from './stage';
import { buildGarment, createFabricNormalMap, FABRIC_LOOK, fabricLook, type GarmentGeometry, type GarmentLayout, type TrimColor } from './garment-geometry';
import { drawPart, drawPartSurface, partKey, partSizeMm, setGpuMaxTexture, type PaintContext, type Quality } from './garment-textures';
import { newPace, paceFrame } from './adaptive-dpr';
import { bakeAmbientOcclusion, type AoTarget } from './ao-bake';
import { cachedShape, exportGarmentTemplate, ShapeError, shapedGarment, type ParsedShape } from './garment-glb';
import { shellGarment } from './garment-shell';
import { applyMotion, fabricDrape, MOTION_CACHE_KEY, motionDepthMaterial, motionState, motionUniforms, patchMotion, setLimbPivots } from './motion';
import { APART_MS, canTakeApart, easeApart } from './explode';
import { disposeDecal, disposePhotoreal, fillCard, inkDecals, insetGeometry, liveTrace, pathTrace, photorealSupport, softStudioLights } from './photoreal';
import { areaOutlineImage, effectiveArea, effectiveLayer, projectArea, projectLayer, renderAreaArtwork } from './projected-paint';
import { dragProjector, footprintNormal, insideDecal, planeOffset, pointOnTriangle, steadyProjector, surfaceAtUv, tangentUp, toDecal, type DecalFrame, type ProjectedPart, type ProjectionMesh, type Projector, type SurfacePoint } from './projection';
import { paintMesh, restCloth, restFromGeometry, restShape, SHELL_TRIM_PREFIX, type RestShape } from './rest-shape';
import { overlayGeometry, overlayTexture } from './area-overlays';
import { partForZone, uvInZone, uvToZone, zoneToUv, type GarmentPart } from './uv-mapping';
import { closeUp, distanceToFit, pathPose, type CameraKey } from '@/lib/camera-path';

export { VIEW_PRESETS, viewerApi, type ViewPreset } from './stage';

type Mode = 'orbit' | 'place';
interface ViewRequest {
  shot: ShotSpec;
  nonce: number;
}

/** Module-level handles: the live camera controls and the garment's texture painter. */
const stage: {
  controls: CameraControlsImpl | null;
  redraw: ((opts?: { quality?: Quality; guides?: boolean }) => boolean) | null;
  capturing: boolean;
  /** The rasterised floor shadow, composited under path-traced renders. */
  shadow: THREE.Object3D | null;
  /** Garment changes that only a path tracer needs; returns the undo. */
  preparePhotoreal: (() => () => void) | null;
  /** Photoreal view is refining the viewport; real-time drawing and motion are paused. */
  live: boolean;
  /** Return the viewport to real time at once. */
  stopLive: (() => void) | null;
} = { controls: null, redraw: null, capturing: false, shadow: null, preparePhotoreal: null, live: false, stopLive: null };

/** Lets the floor shadow be found for compositing (a callback ref, so it follows mounts). */
const registerShadow = (group: THREE.Group | null) => {
  stage.shadow = group;
};

/** The lining sits this far inside the shell when path traced: the fabric's thickness. */
const LINING_INSET_MM = 0.8;
/**
 * The darkest the inside of a garment gets, as a share of its colour. Knit lets light through
 * and in by the neck and hem, so a white tee is light grey inside, never near black; a dark
 * colour stays dark because the shade multiplies it.
 */
const INSIDE_FLOOR = 0.5;

/** The floor shadow alone, as the rasteriser draws it, copied into `out` (sized to the drawing buffer). */
function shadowLayer(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, out: HTMLCanvasElement) {
  const size = gl.getDrawingBufferSize(new THREE.Vector2());
  out.width = size.x;
  out.height = size.y;
  const shadow = stage.shadow;
  const garment = motionState.group;
  if (!shadow?.visible || !garment) return false;
  // Call before the scene changes for path tracing: the rasteriser must not see softbox lights.
  garment.visible = false;
  try {
    gl.setRenderTarget(null);
    gl.render(scene, camera);
  } finally {
    garment.visible = true;
  }
  out.getContext('2d')!.drawImage(gl.domElement, 0, 0);
  return true;
}

/** Put the scene in shape for path tracing: garment changes, softbox lights, no rasterised floor shadow. Returns the undo. */
function stagePhotoreal(scene: THREE.Scene): () => void {
  const undo: (() => void)[] = [stage.preparePhotoreal?.() ?? (() => {}), softStudioLights(scene)];
  const shadow = stage.shadow;
  if (shadow?.visible) {
    shadow.visible = false;
    undo.push(() => {
      shadow.visible = true;
    });
  }
  return () => {
    for (const u of undo.reverse()) u();
  };
}

export function detectQuality(): Quality {
  if (typeof window === 'undefined') return 'medium';
  try {
    const saved = localStorage.getItem('wovexa.quality');
    if (saved === 'low' || saved === 'medium' || saved === 'high') return saved;
  } catch {}
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (memory <= 3 || cores <= 4) return 'low';
  if (coarse || window.innerWidth < 900) return 'medium';
  return 'high';
}

/**
 * The last few garments built, oldest first. Opening the studio again, or going back to a size or
 * style just shown, reuses the shape instead of building it again (a tenth to a fifth of a second,
 * more on a phone). Disposing a geometry frees only its copy on the GPU, which a renderer makes
 * again when it next draws it; the baked shading is written fresh each time, never on top.
 */
const builtGarments = new Map<string, GarmentGeometry>();
const KEEP_BUILT = 3;

/** The garment's geometry for a model, size, detail level and drape. */
function buildGarmentFor(modelId: string, sizeCode: string, quality: Quality, drape: number) {
  const detail = quality === 'low' ? 'low' : 'high';
  const key = `${modelId}|${sizeCode}|${detail}|${drape}`;
  const hit = builtGarments.get(key);
  if (hit) {
    builtGarments.delete(key);
    builtGarments.set(key, hit);
    return hit;
  }
  const model = getGarment(modelId);
  const geo = buildGarment(model, getSize(model, sizeCode), detail, drape);
  builtGarments.set(key, geo);
  if (builtGarments.size > KEEP_BUILT) builtGarments.delete(builtGarments.keys().next().value!);
  return geo;
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function shade(hex: string, factor: number) {
  return new THREE.Color(hex).multiplyScalar(factor);
}

// three.js objects are mutable by design. These helpers keep that imperative work out of
// React's render analysis, which would otherwise treat hook-returned objects as frozen.
function setCursor(el: HTMLElement, cursor: string) {
  el.style.cursor = cursor;
}
function setLens(camera: THREE.PerspectiveCamera, fov: number) {
  camera.fov = fov;
  camera.updateProjectionMatrix();
}
/** Each tone curve shows mid-grey at a different brightness; these keep a look's exposure comparable across tones. */
const TONE: Record<ToneId, { mapping: THREE.ToneMapping; exposure: number }> = {
  neutral: { mapping: THREE.NeutralToneMapping, exposure: 1 },
  agx: { mapping: THREE.AgXToneMapping, exposure: 1.3 },
  aces: { mapping: THREE.ACESFilmicToneMapping, exposure: 0.8 },
};
function setTone(gl: THREE.WebGLRenderer, tone: ToneId, exposure: number) {
  gl.toneMapping = TONE[tone].mapping;
  gl.toneMappingExposure = exposure * TONE[tone].exposure;
}

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function readFlag(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {}
}

/** Unlocked selected layers of the active zone or design area with their committed transforms. */
function movableSelection() {
  const s = useStudio.getState();
  const zone = s.document ? artboardOf(s.document, s.activeZoneId) : undefined;
  if (!zone) return null;
  const ids = s.selectedLayerIds.filter((id) => zone.layers[id] && !zone.layers[id].locked);
  if (!ids.length) return null;
  return { zoneId: s.activeZoneId, ids, origin: Object.fromEntries(ids.map((id) => [id, zone.layers[id].transform])) as Record<string, LayerTransform> };
}

/** Scale and/or rotate the selection as one unit, as a mergeable undo step. */
function transformSelection(scale: number, rotateDeg: number, label: string) {
  const sel = movableSelection();
  if (!sel) return false;
  const next = scaleRotateAbout(sel.origin, scale, rotateDeg);
  useStudio.getState().dispatch(coalescing(updateTransforms(sel.zoneId, next, label), `3d:${label}:${sel.ids.join()}`));
  return true;
}

/** The selected projected (cross-seam) layer, when it is unlocked. */
function movableProjection(): ProjectedLayer | null {
  const s = useStudio.getState();
  const layer = s.selectedProjectionId ? s.document?.projections.layers[s.selectedProjectionId] : undefined;
  return layer && !layer.locked ? layer : null;
}

/** Grow or turn the active design area as a whole (when none of its layers is selected), as a mergeable undo step. */
function transformArea(scale: number, rotateDeg: number, label: string) {
  const area = activeBareArea();
  if (!area || area.locked) return false;
  const commands: Command[] = [];
  if (scale !== 1) commands.push(scaleArea(area.id, scale, label));
  if (rotateDeg) commands.push(updateArea(area.id, { rotationDeg: normalizeDeg(area.rotationDeg + rotateDeg) }, label));
  if (!commands.length) return false;
  useStudio.getState().dispatch(coalescing(commands.length === 1 ? commands[0] : batch(label, commands), `3d:${label}:${area.id}`));
  return true;
}

/** Resize or turn whatever is selected for Place mode: a projected layer, the zone or area selection, else a bare design area. */
function transformSelected(scale: number, rotateDeg: number, label: string) {
  const projection = movableProjection();
  if (projection) return transformProjection(projection.id, scale, rotateDeg, label);
  return transformSelection(scale, rotateDeg, label) || transformArea(scale, rotateDeg, label);
}

const toSpec = (p: { point: readonly number[]; normal: readonly number[]; up: readonly number[] }): ProjectorSpec => ({
  point: [p.point[0], p.point[1], p.point[2]],
  normal: [p.normal[0], p.normal[1], p.normal[2]],
  up: [p.up[0], p.up[1], p.up[2]],
});

// ---------------------------------------------------------------------------
// Garment
// ---------------------------------------------------------------------------

interface Drag {
  pointerId: number;
  zoneId: ZoneId;
  mesh: THREE.Mesh;
  start: { xMm: number; yMm: number };
  ids: string[];
  origin: Record<string, LayerTransform>;
  moved: boolean;
  last: Record<string, Partial<LayerTransform>> | null;
  cancel: () => void;
}

const PART_COLOR: Record<PartId, 'body' | 'sleeves' | 'pants'> = { torso: 'body', sleeveLeft: 'sleeves', sleeveRight: 'sleeves', legLeft: 'pants', legRight: 'pants' };

/** A texture u back in 0–1: a shell's triangles across a tube's wrap (side seam, underarm) reach just past 1. */
const wrapU = (u: number) => u - Math.floor(u);

/** What a raycast reports about the cloth it hit. */
type SurfaceHit = { object: THREE.Object3D; faceIndex?: number | null; barycoord?: THREE.Vector3 | null; uv?: THREE.Vector2 };

/**
 * The cloth at rest under a hit on the displayed garment. The built-in garment and a fitted shell
 * share their triangles with the rest shape (same triangle, same place in it); a template shape
 * has its own mesh and finds the same spot of fabric through the shared texture layout.
 */
function surfaceOnRest(rest: RestShape, restMeshes: ProjectionMesh[], hit: SurfaceHit): SurfacePoint | null {
  const i = rest.parts.findIndex((p) => p.id === hit.object.userData.part);
  if (i < 0) return null;
  if (restMeshes[i] === rest.parts[i].mesh) {
    const s = hit.uv ? surfaceAtUv(restMeshes[i], wrapU(hit.uv.x), hit.uv.y) : null;
    return s ? { ...s, mesh: i } : null;
  }
  if (hit.faceIndex == null || !hit.barycoord) return null;
  return pointOnTriangle(restMeshes, i, hit.faceIndex, [hit.barycoord.x, hit.barycoord.y, hit.barycoord.z]);
}

/**
 * The cloth under a hit on a fitted shell's plain piece (a hood, a belt). The shell is its own
 * rest shape, so the hit is the point itself, in garment millimetres. Only the side facing the
 * viewer counts: a print lies on the outside of the cloth.
 */
function surfaceOnTrim(hit: THREE.Intersection, camera: THREE.Camera): SurfacePoint | null {
  if (!hit.face) return null;
  const n = hit.face.normal;
  const toViewer = camera.getWorldPosition(new THREE.Vector3()).sub(hit.point);
  if (n.clone().transformDirection(hit.object.matrixWorld).dot(toViewer) <= 0) return null;
  const local = hit.object.worldToLocal(hit.point.clone());
  return { mesh: -1, triangle: hit.faceIndex ?? 0, bary: [1, 0, 0], point: [local.x, local.y, local.z], normal: [n.x, n.y, n.z], uv: [0, 0] };
}

const motionCacheKey = () => MOTION_CACHE_KEY;

/** Bump strength for printed relief: a puff print's full height rises clearly off the knit. */
const PRINT_RELIEF = 3;

/** Fabric shading: physical sheen on capable devices, a plain standard material on low-power ones. Both carry motion. */
function FabricMaterial({ lite, look, ...props }: { lite: boolean; look: (typeof FABRIC_LOOK)[keyof typeof FABRIC_LOOK] } & Record<string, unknown>) {
  const normalScale = useMemo(() => new THREE.Vector2(look.normal, look.normal), [look.normal]);
  if (lite) return <meshStandardMaterial roughness={look.roughness} normalScale={normalScale} onBeforeCompile={patchMotion} customProgramCacheKey={motionCacheKey} {...props} />;
  return <meshPhysicalMaterial roughness={look.roughness} sheen={look.sheen} sheenRoughness={0.75} normalScale={normalScale} onBeforeCompile={patchMotion} customProgramCacheKey={motionCacheKey} {...props} />;
}

/** A fitted shell's plain pieces wear their fabric print from one tile this many pixels a side, standing for this many millimetres. */
const TRIM_FABRIC_PX = 2048;
const TRIM_FABRIC_MM = 600;

/** Design area artwork drawn over plain pieces: this many pixels per millimetre (as the part textures, roughly). */
const OVERLAY_PX_PER_MM = { low: 2, high: 5 } as const;

/** Shows or hides each design area guide drawn over a plain piece: off for renders, like the painted guides. */
const overlayGuideToggles = new Set<(visible: boolean) => void>();

interface AreaGuide {
  accent: string;
  /** Every area's edge, or only the active one's. */
  all: boolean;
  active: string | null;
  selected?: string[];
}

/**
 * Design areas over a fitted shell's plain pieces (hood, belt, collar), which have no print
 * texture: each piece under an area gets a thin overlay mesh with the area's artwork, and its guide.
 */
function AreaTrimOverlays({ doc, rest, geo, lite, quality, guide }: { doc: DesignDocument; rest: RestShape | undefined; geo: GarmentGeometry; lite: boolean; quality: Quality; guide: AreaGuide | null }) {
  const projection = useLive((s) => s.projection);
  const liveZone = useLive((s) => s.zoneId);
  const overrides = useLive((s) => s.overrides);
  if (!rest?.trims?.length || !doc.areas?.orderedIds.length) return null;
  const scene = { doc, rest, geo, live: projection };
  const ppm = quality === 'low' ? OVERLAY_PX_PER_MM.low : OVERLAY_PX_PER_MM.high;
  const out: ReactNode[] = [];
  for (const stored of designAreas(doc)) {
    if (!stored.visible) continue;
    const area = effectiveArea(stored, projection);
    const p = projectArea(area, scene);
    for (const [key, on] of p.trims) {
      const trim = geo.trims.find((t) => t.key === key);
      if (!trim) continue;
      const active = guide?.active === area.id;
      out.push(
        <AreaOnTrim
          key={`${area.id}:${key}`}
          area={area}
          trim={trim}
          projected={on.projected}
          frame={p.frame}
          ppm={ppm}
          overrides={liveZone === area.id ? overrides : undefined}
          lite={lite}
          guide={guide && (guide.all || active) ? { accent: guide.accent, active, selected: active ? guide.selected : undefined } : null}
        />,
      );
    }
  }
  return <>{out}</>;
}

function AreaOnTrim({
  area,
  trim,
  projected,
  frame,
  ppm,
  overrides,
  lite,
  guide,
}: {
  area: DesignArea;
  trim: GarmentGeometry['trims'][number];
  projected: ProjectedPart;
  frame: DecalFrame;
  ppm: number;
  overrides: Record<string, Partial<LayerTransform>> | undefined;
  lite: boolean;
  guide: { accent: string; active: boolean; selected?: string[] } | null;
}) {
  const anisotropy = useThree((s) => Math.min(8, s.gl.capabilities.getMaxAnisotropy()));
  const guideMesh = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const toggle = (visible: boolean) => {
      if (guideMesh.current) guideMesh.current.visible = visible;
    };
    overlayGuideToggles.add(toggle);
    return () => {
      overlayGuideToggles.delete(toggle);
    };
  }, []);
  // Counts the loads it waited for (images, fonts): each one draws the artwork again.
  const [loads, setLoads] = useState(0);
  const art = useMemo(() => (loads >= 0 ? renderAreaArtwork(area, ppm, { overrides, simulateFinish: true }) : null), [area, ppm, overrides, loads]);
  // An image still loading: draw again once it is in.
  useEffect(() => {
    if (art) return;
    let alive = true;
    const ids = Object.values(area.layers).flatMap((l) => layerAssetIds(l).filter((id) => !getLoadedImage(id)));
    Promise.all([...ids.map((id) => loadAssetImage(id).catch(() => null)), ensureFonts([area])]).then(() => {
      if (alive) setLoads((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [art, area]);
  const geometry = useMemo(() => overlayGeometry(trim.geometry, projected, frame), [trim.geometry, projected, frame]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  const texture = useMemo(() => (art ? overlayTexture(art, anisotropy) : null), [art, anisotropy]);
  useEffect(() => () => texture?.dispose(), [texture]);
  const accent = guide?.accent ?? null;
  const active = !!guide?.active;
  const selected = guide?.selected;
  const guideTexture = useMemo(
    () => (accent ? overlayTexture(areaOutlineImage(area, ppm, { accent, active, selected, live: { zoneId: area.id, overrides } }), anisotropy) : null),
    [area, ppm, accent, active, selected, overrides, anisotropy],
  );
  useEffect(() => () => guideTexture?.dispose(), [guideTexture]);
  if (!geometry) return null;
  const look = FABRIC_LOOK[trim.surface === 'plastic' ? 'jersey' : trim.surface];
  const vertexColors = !!geometry.getAttribute('color');
  const noRaycast = () => null;
  const overlay = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, vertexColors };
  return (
    <>
      {texture ? (
        <mesh geometry={geometry} raycast={noRaycast} receiveShadow renderOrder={1}>
          <FabricMaterial lite={lite} look={look} map={texture} {...overlay} />
        </mesh>
      ) : null}
      {guideTexture ? (
        <mesh ref={guideMesh} geometry={geometry} raycast={noRaycast} renderOrder={2}>
          <FabricMaterial lite={lite} look={look} map={guideTexture} {...overlay} polygonOffsetUnits={-6} />
        </mesh>
      ) : null}
    </>
  );
}

/** Plays the scene's motion in the live view. Video frames set the same state from their own clock. */
function MotionDriver({
  kind,
  speed,
  groupRef,
  bottomMm,
  heightMm,
  hpsMm,
  limbPivots,
}: {
  kind: MotionKind;
  speed: number;
  groupRef: React.RefObject<THREE.Group | null>;
  bottomMm: number;
  heightMm: number;
  /** High point of shoulder, in garment millimetres: where a hanger holds it. */
  hpsMm: number;
  limbPivots: GarmentGeometry['limbPivots'];
}) {
  const invalidate = useThree((s) => s.invalidate);
  const [accent] = useState(() => cssVar('--accent', '#2b59ff'));
  useEffect(() => {
    setRevealSpan(bottomMm, heightMm, accent);
    // The garment is centred on the stage, so the neck sits this far above the centre (metres).
    motionState.neckY = (hpsMm - bottomMm - heightMm / 2) * 0.001;
    setLimbPivots(limbPivots);
    invalidate();
  }, [bottomMm, heightMm, hpsMm, limbPivots, accent, invalidate]);
  useEffect(() => {
    const group = groupRef.current;
    motionState.kind = kind;
    motionState.speed = speed;
    motionState.group = group;
    if (kind === 'still') {
      applyMotion('still', 1, 0, group);
      invalidate();
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      if (!stage.capturing && !stage.live) {
        applyMotion(kind, speed, (performance.now() - t0) / 1000, group);
        invalidate();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      applyMotion('still', 1, 0, group);
      invalidate();
    };
  }, [kind, speed, groupRef, invalidate]);
  return null;
}

/**
 * Eases the garment apart or back together (`uExplode`, motion.ts). With reduced motion it simply
 * changes. Closing the 3D view leaves the garment sewn together for next time.
 */
function ApartDriver({ apart }: { apart: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const from = motionUniforms.uExplode.value;
    const to = apart ? 1 : 0;
    if (from === to) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      motionUniforms.uExplode.value = to;
      invalidate();
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const t = (performance.now() - t0) / APART_MS;
      // A render in progress owns the frame; the move carries on after it.
      if (!stage.capturing) {
        motionUniforms.uExplode.value = from + (to - from) * easeApart(t);
        invalidate();
      }
      if (t < 1 || stage.capturing) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [apart, invalidate]);
  useEffect(
    () => () => {
      motionUniforms.uExplode.value = 0;
    },
    [],
  );
  return null;
}

/** Adaptive resolution (adaptive-dpr.ts): lower the pixel ratio while moving frames come slowly. */
function AdaptiveResolution({ onSlow, onSmooth }: { onSlow: () => void; onSmooth: () => void }) {
  const pace = useRef(newPace());
  useFrame(() => {
    const verdict = paceFrame(pace.current, performance.now());
    if (verdict === 'slow') onSlow();
    else if (verdict === 'smooth') onSmooth();
  });
  return null;
}

/** Draws a fresh frame when the kept view comes back on screen (it draws nothing while hidden). */
function WakeOnShow({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!active) return;
    // A frame later: the canvas has its size and its frame loop back by then.
    const frame = requestAnimationFrame(() => invalidate());
    return () => cancelAnimationFrame(frame);
  }, [active, invalidate]);
  return null;
}

function setRevealSpan(bottomMm: number, heightMm: number, accent: string) {
  motionUniforms.uRevealBottom.value = bottomMm;
  motionUniforms.uRevealSpan.value = heightMm;
  motionUniforms.uThread.value.set(accent);
}

/** Object URL of an image backdrop once its asset has loaded from this device. */
function useBackdropImage(assetId: string | undefined) {
  const [, setLoads] = useState(0);
  const loaded = assetId ? getLoadedImage(assetId) : undefined;
  useEffect(() => {
    if (!assetId || getLoadedImage(assetId)) return;
    let alive = true;
    loadAssetImage(assetId).then(
      () => alive && setLoads((n) => n + 1),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [assetId]);
  return loaded?.src ?? null;
}

/**
 * A wooden hanger with a chrome hook, for the Hanger motion: the bar sits under the shoulders
 * inside the garment and the hook rises out of the neck, as on a shop rail. Garment millimetres.
 */
function Hanger({ hpsMm, shoulderMm, neckMm, slope }: { hpsMm: number; shoulderMm: number; neckMm: number; slope: number }) {
  const shapes = useMemo(() => {
    const y0 = hpsMm - 30;
    const reach = shoulderMm * 0.86;
    const tipY = y0 - slope * Math.max(0, reach - neckMm) - 8;
    const bar = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-reach, tipY, 0),
      new THREE.Vector3(-neckMm * 1.2, y0 - 2, 0),
      new THREE.Vector3(0, y0 + 6, 0),
      new THREE.Vector3(neckMm * 1.2, y0 - 2, 0),
      new THREE.Vector3(reach, tipY, 0),
    ]);
    const hook = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, y0 + 6, 0),
      new THREE.Vector3(0, hpsMm + 70, 0),
      new THREE.Vector3(0, hpsMm + 116, -8),
      new THREE.Vector3(0, hpsMm + 134, -38),
      new THREE.Vector3(0, hpsMm + 118, -66),
      new THREE.Vector3(0, hpsMm + 94, -68),
    ]);
    return { bar: new THREE.TubeGeometry(bar, 72, 8.5, 14, false), hook: new THREE.TubeGeometry(hook, 56, 2.6, 10, false) };
  }, [hpsMm, shoulderMm, neckMm, slope]);
  useEffect(
    () => () => {
      shapes.bar.dispose();
      shapes.hook.dispose();
    },
    [shapes],
  );
  const noRaycast = () => null;
  return (
    <>
      <mesh geometry={shapes.bar} castShadow receiveShadow raycast={noRaycast}>
        <meshPhysicalMaterial color="#b4875a" roughness={0.45} clearcoat={0.5} clearcoatRoughness={0.28} />
      </mesh>
      <mesh geometry={shapes.hook} castShadow raycast={noRaycast}>
        <meshStandardMaterial color="#dfe3e8" metalness={1} roughness={0.2} />
      </mesh>
    </>
  );
}

function Garment({
  geo,
  ownRest,
  quality,
  mode,
  guides,
  hanger,
  apart,
  active,
  onOwnZone,
}: {
  geo: GarmentGeometry;
  ownRest: boolean;
  quality: Quality;
  mode: Mode;
  guides: boolean;
  hanger: boolean;
  /** Shown taken apart: the pieces aren't where picking finds them, so clicks pass through. */
  apart: boolean;
  /** On screen. Kept but hidden (the 2D view on its own), it paints nothing and offers nothing to the rest of the studio. */
  active: boolean;
  onOwnZone: (zone: ArtboardId) => void;
}) {
  const doc = useStudio((s) => s.document)!;
  const colorway = useDisplayColorway()!;
  const activeZone = useStudio((s) => s.activeZoneId);
  const selected = useStudio((s) => s.selectedLayerIds);
  const selectedProjection = useStudio((s) => s.selectedProjectionId);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const model = getGarment(doc.garment.modelId);
  const size = getSize(model, doc.garment.sizeCode);
  const fabricPreset = model.fabricPresets.find((f) => f.id === doc.garment.fabricPresetId) ?? model.fabricPresets[0];
  const finish = doc.garment.finish;
  // The fabric for what it is (fibre, weight, wash), not only its knit.
  const look = useMemo(() => fabricLook(fabricPreset, finish), [fabricPreset, finish]);
  // Light cloth ripples more in wind and walking, heavy cloth hangs heavier.
  useEffect(() => {
    motionUniforms.uDrape.value = fabricDrape(fabricPreset.gsm);
    invalidate();
  }, [fabricPreset.gsm, invalidate]);
  const meshes = useRef(new Map<PartId, THREE.Mesh>());
  const liningMeshes = useRef(new Map<PartId, THREE.Mesh>());
  const trimMeshes = useRef(new Map<string, THREE.Mesh>());
  const lastKeys = useRef(new Map<PartId, string>());
  const generation = useRef(0);
  const dragRef = useRef<{ cancel: () => void } | null>(null);
  const [accent] = useState(() => cssVar('--accent', '#2b59ff'));

  // Artwork across seams and design areas land on the garment pressed flat (built only once there
  // is some), then fold with the cloth: each displayed triangle has its pressed twin at the same
  // index. A fitted shell keeps its own folds, so it is its own rest shape: art lands on its cloth.
  const hasProjections = doc.projections.orderedLayerIds.length > 0 || !!doc.areas?.orderedIds.length;
  const detail = quality === 'low' ? 'low' : 'high';
  const rest = useMemo(() => (hasProjections ? (ownRest ? restFromGeometry(geo) : restShape(model, size, detail)) : undefined), [hasProjections, ownRest, geo, model, size, detail]);
  const restMeshes = useMemo(() => (rest ? rest.parts.map((r) => paintMesh(r, geo.parts.find((p) => p.id === r.id)?.geometry)) : []), [rest, geo]);
  // All the cloth prints are dragged, settled and steadied on: the parts, then a shell's plain pieces.
  const clothMeshes = useMemo(() => (rest ? restCloth(rest, restMeshes) : []), [rest, restMeshes]);

  /** What a pointer can land a design area on: the parts, and a fitted shell's plain pieces (its hood). */
  const pickTargets = () => [...meshes.current.values(), ...[...trimMeshes.current].flatMap(([key, m]) => (key.startsWith(SHELL_TRIM_PREFIX) ? [m] : []))];

  // The cloth design areas lie on, built when there is none yet (before the first area).
  const clothNow = useCallback(() => {
    if (rest) return { r: rest, meshes: restMeshes, all: clothMeshes };
    const r = ownRest ? restFromGeometry(geo) : restShape(model, size, detail);
    const parts = r.parts.map((p) => paintMesh(p, geo.parts.find((q) => q.id === p.id)?.geometry));
    return { r, meshes: parts, all: restCloth(r, parts) };
  }, [rest, restMeshes, clothMeshes, ownRest, geo, model, size, detail]);
  // A fitted shell's plain body and sleeve pieces (a hood) wear the fabric print too: the colour,
  // dye, pattern, gradient or image at true scale. Their texture coordinates run 1 to 600 mm
  // straight on from the front (see garment-shell.ts), so one tile of fabric repeats, its join
  // moved off the centre line.
  const [fabricLoads, setFabricLoads] = useState(0);
  const trimFabric = useMemo(() => {
    const out = new Map<'body' | 'sleeves', THREE.CanvasTexture>();
    let pending = false;
    if (!ownRest || fabricLoads < 0) return { out, pending };
    for (const role of ['body', 'sleeves'] as const) {
      const surface = colorway.surfaces?.[role];
      if (!surface || !geo.trims.some((t) => t.key.startsWith(SHELL_TRIM_PREFIX) && t.color === role)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = TRIM_FABRIC_PX;
      const ok = paintFabric(canvas.getContext('2d')!, partColor(colorway, role), surface, TRIM_FABRIC_PX, TRIM_FABRIC_PX, TRIM_FABRIC_PX / TRIM_FABRIC_MM, { x: TRIM_FABRIC_PX / 2, y: 0 }, TRIM_FABRIC_PX);
      pending ||= !ok;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.offset.set(0.5, 0);
      texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      out.set(role, texture);
    }
    return { out, pending };
  }, [ownRest, colorway, geo, gl, fabricLoads]);
  useEffect(() => () => trimFabric.out.forEach((t) => t.dispose()), [trimFabric]);
  // An image print still loading: paint again once it is in.
  useEffect(() => {
    if (!trimFabric.pending) return;
    let alive = true;
    const ids = (['body', 'sleeves'] as const).flatMap((r) => {
      const s = colorway.surfaces?.[r];
      return s?.kind === 'image' && !getLoadedImage(s.assetId) ? [s.assetId] : [];
    });
    Promise.all(ids.map((id) => loadAssetImage(id).catch(() => null))).then(() => alive && setFabricLoads((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [trimFabric, colorway]);

  // Where "Add area" puts a new design area: the cloth at the middle of the view, upright as seen.
  const areaAnchor = useCallback((): ProjectorSpec | null => {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const targets = [...meshes.current.values(), ...[...trimMeshes.current].flatMap(([key, m]) => (key.startsWith(SHELL_TRIM_PREFIX) ? [m] : []))];
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    const { r, meshes: rMeshes, all } = clothNow();
    const s = hit.object.userData.trim ? surfaceOnTrim(hit, camera) : surfaceOnRest(r, rMeshes, hit);
    if (!s) return null;
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const normal = footprintNormal(all, s.point, s.normal, NEW_AREA_MM / 2);
    return toSpec({ point: s.point, normal, up: tangentUp(normal, [screenUp.x, screenUp.y, screenUp.z]) });
  }, [camera, clothNow]);
  // Copies and arrow-key nudges slide over the same cloth (a fitted shell's own, when worn).
  const clothShown = useCallback(() => clothNow().all, [clothNow]);
  useEffect(() => {
    if (!active) return;
    viewerApi.areaAnchor = areaAnchor;
    viewerApi.restCloth = clothShown;
    return () => {
      if (viewerApi.areaAnchor === areaAnchor) viewerApi.areaAnchor = undefined;
      if (viewerApi.restCloth === clothShown) viewerApi.restCloth = undefined;
    };
  }, [areaAnchor, clothShown, active]);

  // One canvas and texture per textured part, made once per geometry; plus, on capable devices,
  // a print-surface map per part (ink height, roughness, metalness) for real relief and gloss.
  // Each part's texture wraps round its tube (side seam, underarm), so it repeats across: a
  // shell's triangles that straddle the wrap reach just past u = 1.
  const useSurface = quality !== 'low';
  const textures = useMemo(() => {
    const out = new Map<PartId, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();
    for (const p of geo.parts) {
      const canvas = document.createElement('canvas');
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      out.set(p.id, { canvas, texture });
    }
    return out;
  }, [geo, gl]);
  const surfaces = useMemo(() => {
    const out = new Map<PartId, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();
    if (!useSurface) return out;
    for (const p of geo.parts) {
      const canvas = document.createElement('canvas');
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      out.set(p.id, { canvas, texture });
    }
    return out;
  }, [geo, gl, useSurface]);
  useEffect(() => {
    const keys = lastKeys.current;
    keys.clear();
    return () => {
      for (const t of textures.values()) t.texture.dispose();
      for (const t of surfaces.values()) t.texture.dispose();
      keys.clear();
    };
  }, [textures, surfaces]);

  // Fabric relief at true scale: about one weave repeat per few millimetres.
  const normals = useMemo(() => {
    const fabric = createFabricNormalMap(fabricPreset.surface);
    const rib = createFabricNormalMap('rib');
    const tile = (base: THREE.Texture, w: number, h: number) => {
      const t = base.clone();
      t.repeat.set(w, h);
      t.needsUpdate = true;
      return t;
    };
    const parts = new Map<PartId, THREE.Texture>();
    for (const p of geo.parts) {
      const { w, h } = partSizeMm(geo, p.id);
      parts.set(p.id, tile(fabric, w / look.tileMm, h / look.tileMm));
    }
    return { fabric, rib, parts, trimRib: tile(rib, 90, 3), trimFabric: tile(fabric, 60, 60) };
  }, [geo, fabricPreset.surface, look.tileMm]);
  useEffect(
    () => () => {
      normals.fabric.dispose();
      normals.rib.dispose();
      normals.trimRib.dispose();
      normals.trimFabric.dispose();
      for (const t of normals.parts.values()) t.dispose();
    },
    [normals],
  );

  // The lining (inside face) shares the shell's shape but has its own shading: shaded deep inside,
  // lighter toward the neck, hem and cuffs. It starts at a middle shade and the bake below replaces it.
  const linings = useMemo(() => {
    const out = new Map<PartId, THREE.BufferGeometry>();
    for (const p of geo.parts) {
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv', 'aFree', 'aLimb', 'aExplode']) {
        const a = p.geometry.getAttribute(name);
        if (a) g.setAttribute(name, a);
      }
      g.setIndex(p.geometry.getIndex());
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.geometry.getAttribute('position').count * 3).fill(INSIDE_FLOOR + 0.12), 3));
      out.set(p.id, g);
    }
    return out;
  }, [geo]);
  useEffect(() => () => linings.forEach((g) => g.dispose()), [linings]);

  // Ambient occlusion from the garment's real shape (collar, underarms, folds, the inside),
  // baked on the GPU once per shape, a frame after it appears so the first view isn't held up.
  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      const targets: AoTarget[] = [];
      for (const p of geo.parts) {
        targets.push({ geometry: p.geometry, out: p.geometry, floor: 0.38, smooth: 2 });
        const lining = linings.get(p.id);
        if (lining) targets.push({ geometry: p.geometry, out: lining, inside: true, floor: INSIDE_FLOOR, smooth: 6 });
      }
      // A shell's plain cloth (a hood, cloth past the pattern) is shaded the same way as its printed parts.
      for (const t of geo.trims) if (t.geometry.getAttribute('color')) targets.push({ geometry: t.geometry, out: t.geometry, floor: 0.38, smooth: 2 });
      const occluders = [...geo.parts.map((p) => p.geometry), ...geo.trims.map((t) => t.geometry)];
      try {
        if (bakeAmbientOcclusion(gl, occluders, targets, quality === 'low' ? 'low' : 'high')) invalidate();
      } catch (error) {
        // The procedural shading stays; the garment still looks right, just less deep.
        console.warn('Ambient occlusion bake skipped:', error);
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [geo, linings, gl, quality, invalidate]);

  // "Download 3D template": this shape as a GLB, with the print areas drawn on plain fabric.
  useEffect(() => {
    if (!active) return;
    const exportTemplate = () => {
      const zones = Object.fromEntries(Object.entries(doc.zones).map(([id, z]) => [id, { ...z, layers: {}, orderedLayerIds: [] }])) as unknown as DesignDocument['zones'];
      // A template is plain new fabric: no prints, and no wash.
      const blank: DesignDocument = { ...doc, garment: { ...doc.garment, finish: undefined }, zones, projections: emptyProjections() };
      const neutral = {
        ...colorway,
        surfaces: undefined,
        parts: Object.fromEntries(Object.entries(colorway.parts).map(([k]) => [k, k === 'belt' ? '#3A3D44' : k === 'collar' ? '#C9CCD3' : k === 'stitching' ? '#AEB3BC' : '#E4E5E9'])) as typeof colorway.parts,
      };
      const ctx: PaintContext = { doc: blank, model, geo, colorway: neutral, quality: 'high', guides: { zones: true, selection: null, accent }, simulateFinish: false };
      const guideMaps = new Map<PartId, HTMLCanvasElement>();
      for (const p of geo.parts) {
        const canvas = document.createElement('canvas');
        drawPart(canvas, p.id, ctx);
        guideMaps.set(p.id, canvas);
      }
      return exportGarmentTemplate(geo, model, size, guideMaps);
    };
    viewerApi.exportTemplate = exportTemplate;
    return () => {
      if (viewerApi.exportTemplate === exportTemplate) viewerApi.exportTemplate = undefined;
    };
  }, [doc, colorway, model, geo, size, accent, active]);

  useEffect(() => setGpuMaxTexture(gl.capabilities.maxTextureSize), [gl]);
  useEffect(() => {
    // Development-only handle for inspecting textures and captures from the console.
    if (process.env.NODE_ENV !== 'production') Object.assign(window, { __wovexa3d: { textures, layout: geo.layout, viewerApi, stage } });
  }, [textures, geo]);

  const showSelection = guides || mode === 'place';
  /**
   * Paint garment textures. Each part has a change key; a part is repainted and re-uploaded only
   * when its zones, colourway, guides, live drag or quality changed. Synchronous, so captures
   * can repaint at render quality without guides.
   */
  const draw = useCallback(
    (opts: { quality?: Quality; guides?: boolean } = {}) => {
      for (const toggle of overlayGuideToggles) toggle(opts.guides !== false);
      const live = useLive.getState();
      const ctx: PaintContext = {
        doc,
        model,
        geo,
        rest,
        colorway,
        quality: opts.quality ?? quality,
        live: { zoneId: live.zoneId, overrides: live.overrides, projection: live.projection },
        guides:
          opts.guides === false
            ? undefined
            : { zones: guides, selection: showSelection && selected.length ? { zoneId: activeZone, ids: selected } : null, projection: showSelection ? selectedProjection : null, active: showSelection ? activeZone : null, accent },
        // With a surface map, relief, gloss and foil are real lighting, not painted in.
        simulateFinish: !surfaces.size,
      };
      let ok = true;
      let changed = false;
      // three.js allocates fixed-size GPU storage on first upload; when the canvas is
      // resized (quality, garment size or a render) the old storage must be released first.
      const upload = (entry: { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }) => {
        const sizeKey = `${entry.canvas.width}x${entry.canvas.height}`;
        if (entry.texture.userData.uploadedSize !== sizeKey) {
          entry.texture.dispose();
          entry.texture.userData.uploadedSize = sizeKey;
        }
        entry.texture.needsUpdate = true;
        changed = true;
      };
      for (const p of geo.parts) {
        const entry = textures.get(p.id);
        if (!entry) continue;
        const key = partKey(p.id, ctx, generation.current);
        if (lastKeys.current.get(p.id) === key) continue;
        const complete = drawPart(entry.canvas, p.id, ctx);
        const surface = surfaces.get(p.id);
        const surfaceDone = surface ? drawPartSurface(surface.canvas, p.id, ctx, look.roughness) : true;
        ok = ok && complete && surfaceDone;
        lastKeys.current.set(p.id, complete && surfaceDone ? key : '');
        upload(entry);
        if (surface) upload(surface);
      }
      if (changed) invalidate();
      return ok;
    },
    [doc, colorway, model, geo, rest, quality, textures, surfaces, look.roughness, invalidate, guides, showSelection, selected, selectedProjection, activeZone, accent],
  );

  useEffect(() => {
    stage.redraw = draw;
    return () => {
      if (stage.redraw === draw) stage.redraw = null;
    };
  }, [draw]);

  // Path tracing sees real geometry and real light, so while it runs: the lining sits just inside
  // the shell (fabric thickness) instead of on it, true occlusion replaces the baked shading, and
  // each print becomes a raised ink layer with real relief over the knit. Undone afterwards.
  useEffect(() => {
    const prepare = () => {
      const undo: (() => void)[] = [];
      for (const p of geo.parts) {
        const mesh = meshes.current.get(p.id);
        if (!mesh || Array.isArray(mesh.material)) continue;
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.vertexColors = false;
        undo.push(() => {
          material.vertexColors = true;
        });
        const lining = liningMeshes.current.get(p.id);
        if (lining && !Array.isArray(lining.material)) {
          const shell = lining.geometry;
          const inset = insetGeometry(shell, LINING_INSET_MM);
          const liningMaterial = lining.material as THREE.MeshStandardMaterial;
          const tint = liningMaterial.color.clone();
          lining.geometry = inset;
          // Path tracing finds the inside's shadow itself; the baked shade would double it.
          liningMaterial.vertexColors = false;
          liningMaterial.color.copy(shade(partColor(colorway, PART_COLOR[p.id]), 0.92));
          undo.push(() => {
            lining.geometry = shell;
            liningMaterial.vertexColors = true;
            liningMaterial.color.copy(tint);
            inset.dispose();
          });
        }
        const color = textures.get(p.id);
        const surface = surfaces.get(p.id);
        if (!color || !surface || !mesh.parent) continue;
        const { w, h } = partSizeMm(geo, p.id);
        for (const decal of inkDecals(p.geometry, color.canvas, surface.canvas, w, h)) {
          mesh.parent.add(decal);
          undo.push(() => {
            decal.removeFromParent();
            disposeDecal(decal);
          });
        }
      }
      // A shell's plain cloth carries baked shading too; the path tracer finds that occlusion itself.
      for (const mesh of trimMeshes.current.values()) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        if (Array.isArray(mesh.material) || !material.vertexColors) continue;
        material.vertexColors = false;
        undo.push(() => {
          material.vertexColors = true;
        });
      }
      return () => {
        for (const u of undo.reverse()) u();
      };
    };
    stage.preparePhotoreal = prepare;
    return () => {
      if (stage.preparePhotoreal === prepare) stage.preparePhotoreal = null;
    };
  }, [geo, textures, surfaces, colorway]);

  // Redraw when the document, colourway, selection or a live drag changes; coalesced per frame.
  // Hidden, nothing is painted: each part catches up (only those that changed) when it shows again.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let disposed = false;
    const run = () => {
      frame = 0;
      if (disposed || stage.capturing) return;
      // A change while Photoreal view is refining: back to real time, then repaint.
      if (stage.live) stage.stopLive?.();
      if (!draw()) loadMissing();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const loadMissing = () => {
      const ids = new Set<string>();
      for (const zone of [...Object.values(doc.zones), projectionsAsZone(doc), ...designAreas(doc)]) {
        for (const layer of Object.values(zone.layers)) for (const id of layerAssetIds(layer)) ids.add(id);
      }
      for (const surface of Object.values(colorway.surfaces ?? {})) if (surface?.kind === 'image') ids.add(surface.assetId);
      for (const id of ids) if (!getLoadedImage(id)) loadAssetImage(id).then(schedule, () => {});
    };
    schedule();
    ensureFonts([...Object.values(doc.zones), projectionsAsZone(doc), ...designAreas(doc)]).then((loaded) => {
      if (!loaded) return;
      generation.current += 1;
      schedule();
    });
    const unsubscribe = useLive.subscribe(schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [draw, doc, colorway, active]);

  /**
   * A point on the garment in a zone's own millimetres. Artwork graded by size shows at this
   * size's grade, so the point is graded back: picking and dragging land where the artwork shows.
   */
  const ungrade = <P extends { xMm: number; yMm: number }>(zoneId: ZoneId, p: P): P => {
    const d = useStudio.getState().document!;
    const factor = zoneGrade(d, zoneId, d.garment.sizeCode);
    const spec = model.zones[zoneId];
    if (factor === 1 || !spec) return p;
    return { ...p, ...ungradePoint(spec, factor, p.xMm, p.yMm) };
  };

  const pickAt = (part: GarmentPart, uv: THREE.Vector2) => {
    const found = uvToZone(model, geo.layout, part, wrapU(uv.x), uv.y);
    if (!found) return null;
    const hit = ungrade(found.zoneId, found);
    const zone = useStudio.getState().document!.zones[hit.zoneId];
    return { ...hit, layerId: hitTestLayer(zone, hit.xMm, hit.yMm) };
  };

  /** Surface selection (spec ED3-04): the zone under the pointer, then the topmost layer there. */
  const selectHit = (hit: { zoneId: ZoneId; layerId: string | null }, keepSelection: boolean) => {
    const s = useStudio.getState();
    if (s.activeZoneId !== hit.zoneId) {
      onOwnZone(hit.zoneId);
      s.setActiveZone(hit.zoneId);
    }
    if (!hit.layerId) return useStudio.getState().select([]);
    if (keepSelection && useStudio.getState().selectedLayerIds.includes(hit.layerId)) return;
    selectLayers([hit.layerId]);
  };

  /** Each garment mesh carries its part in userData, so one set of handlers serves them all. */
  const partOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.object.userData.part as GarmentPart;

  /** The pressed-flat cloth under a hit on the displayed (draped) garment: same triangle, same place in it. */
  const surfaceUnder = (hit: SurfaceHit): SurfacePoint | null => (rest ? surfaceOnRest(rest, restMeshes, hit) : null);
  /** The cloth under a hit on a part or on a fitted shell's plain piece. */
  const surfaceOf = (hit: THREE.Intersection): SurfacePoint | null => (hit.object.userData.trim ? surfaceOnTrim(hit, camera) : surfaceUnder(hit));

  /** The visible design area under a point of cloth that faces it, topmost first, with the point in the area's millimetres. */
  const areaAt = (at: SurfacePoint): { area: DesignArea; x: number; y: number } | null => {
    const d = useStudio.getState().document;
    if (!d || !rest) return null;
    const scene = { doc: d, rest, geo, live: useLive.getState().projection };
    const areas = designAreas(d);
    for (let k = areas.length - 1; k >= 0; k--) {
      const area = areas[k];
      if (!area.visible) continue;
      const { frame } = projectArea(effectiveArea(area, scene.live), scene);
      const facing = at.normal[0] * frame.normal[0] + at.normal[1] * frame.normal[1] + at.normal[2] * frame.normal[2];
      if (facing <= 0 || !insideDecal(frame, at.point)) continue;
      const q = toDecal(frame, at.point);
      return { area, x: q.x, y: q.y };
    }
    return null;
  };

  /** Pick inside a design area: it becomes the artboard being designed on, then its topmost layer at the point (or none). */
  const selectInArea = (hit: { area: DesignArea; x: number; y: number }, keepSelection: boolean): string | null => {
    const s = useStudio.getState();
    if (s.activeZoneId !== hit.area.id) {
      onOwnZone(hit.area.id as AreaId);
      s.setActiveZone(hit.area.id as AreaId);
    }
    const layerId = hitTestLayer(hit.area, hit.x, hit.y);
    if (!layerId) {
      useStudio.getState().select([]);
      return null;
    }
    if (!(keepSelection && useStudio.getState().selectedLayerIds.includes(layerId))) selectLayers([layerId]);
    return layerId;
  };

  /**
   * Move a whole design area over the garment, its artwork with it: the grabbed point follows the
   * pointer over any part and across seams. One undoable command on release; Escape cancels.
   */
  const startAreaMove = (pointerId: number, area: DesignArea, at: SurfacePoint) => {
    dragRef.current?.cancel();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const targets = pickTargets();
    let current: Projector = area.projector;
    let last: ProjectorSpec | null = null;
    const grab = planeOffset(area.projector, at.point);
    setCursor(gl.domElement, 'grabbing');
    const handle = { cancel: () => finish(false) };
    dragRef.current = handle;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || dragRef.current !== handle) return;
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(targets, false)[0];
      const s = hit ? surfaceOf(hit) : null;
      if (!s) return; // off the garment: hold the last position
      if (!last && Math.hypot(s.point[0] - at.point[0], s.point[1] - at.point[1], s.point[2] - at.point[2]) < 1.5) return;
      current = steadyProjector(clothMeshes, dragProjector(clothMeshes, current, grab, s), Math.max(area.widthMm, area.heightMm));
      last = toSpec(current);
      useLive.getState().setProjection({ id: area.id, projector: last });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('keydown', key, true);
      if (dragRef.current !== handle) return;
      dragRef.current = null;
      if (commit && last) useStudio.getState().dispatch(updateArea(area.id, { projector: last }, `Move ${area.name}`));
      useLive.getState().clear();
      setCursor(gl.domElement, '');
    };
    const up = (ev: PointerEvent) => ev.pointerId === pointerId && finish(true);
    const cancelled = (ev: PointerEvent) => ev.pointerId === pointerId && finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelled);
    window.addEventListener('keydown', key, true);
  };

  /** Drag layers inside a design area on the garment: their centre follows the pointer across the area. */
  const startAreaLayerDrag = (pointerId: number, area: DesignArea, start: { x: number; y: number }, sel: NonNullable<ReturnType<typeof movableSelection>>) => {
    dragRef.current?.cancel();
    if (!rest) return;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const targets = pickTargets();
    const scene = { doc: useStudio.getState().document!, rest, geo, live: null };
    const { frame } = projectArea(area, scene);
    const b = unionBounds(Object.values(sel.origin).map(rotatedBounds));
    const c0 = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    let moved = false;
    let last: Record<string, Partial<LayerTransform>> | null = null;
    setCursor(gl.domElement, 'grabbing');
    const handle = { cancel: () => finish(false) };
    dragRef.current = handle;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || dragRef.current !== handle) return;
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(targets, false)[0];
      const s = hit ? surfaceOf(hit) : null;
      if (!s) return;
      const p = toDecal(frame, s.point);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) < 1.5) return;
      moved = true;
      let x = c0.x + p.x - start.x;
      let y = c0.y + p.y - start.y;
      if (Math.abs(x - area.widthMm / 2) < 4) x = area.widthMm / 2;
      x = clamp(x, 0, area.widthMm);
      y = clamp(y, 0, area.heightMm);
      const dx = x - c0.x;
      const dy = y - c0.y;
      last = Object.fromEntries(sel.ids.map((id) => [id, { centerXmm: sel.origin[id].centerXmm + dx, centerYmm: sel.origin[id].centerYmm + dy }]));
      useLive.getState().setOverrides(area.id as AreaId, last, '3d');
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('keydown', key, true);
      if (dragRef.current !== handle) return;
      dragRef.current = null;
      if (commit && moved && last) useStudio.getState().dispatch(updateTransforms(area.id as AreaId, last, 'Move on garment'));
      useLive.getState().clear();
      setCursor(gl.domElement, '');
    };
    const up = (ev: PointerEvent) => ev.pointerId === pointerId && finish(true);
    const cancelled = (ev: PointerEvent) => ev.pointerId === pointerId && finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelled);
    window.addEventListener('keydown', key, true);
  };

  /** The topmost visible projected layer covering a point of cloth that faces its projector. */
  const projectionAt = (at: SurfacePoint): ProjectedLayer | null => {
    const d = useStudio.getState().document;
    if (!d || !rest) return null;
    const scene = { doc: d, rest, geo, live: useLive.getState().projection };
    const order = d.projections.orderedLayerIds;
    for (let k = order.length - 1; k >= 0; k--) {
      const layer = d.projections.layers[order[k]];
      if (!layer?.visible) continue;
      const { frame } = projectLayer(effectiveLayer(layer, scene.live), scene);
      const facing = at.normal[0] * frame.normal[0] + at.normal[1] * frame.normal[1] + at.normal[2] * frame.normal[2];
      if (facing > 0 && insideDecal(frame, at.point)) return layer;
    }
    return null;
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (mode !== 'orbit' || e.delta > 4 || !e.uv) return; // ignore clicks that ended an orbit drag
    e.stopPropagation();
    const surface = surfaceUnder(e);
    // Design areas lie on top of everything else, like transfers pressed onto the garment.
    const inArea = surface ? areaAt(surface) : null;
    if (inArea) {
      selectInArea(inArea, false);
      return;
    }
    const projected = surface ? projectionAt(surface) : null;
    if (projected) return useStudio.getState().selectProjection(projected.id);
    const hit = pickAt(partOf(e), e.uv);
    if (hit) selectHit(hit, false);
  };

  /**
   * Move projected artwork across the garment: the grabbed point follows the pointer over any
   * part, seams included. With `place`, the artwork first jumps to the pressed point, upright as
   * seen from the camera. Commits one undoable command on release; Escape cancels.
   */
  const startProjectionDrag = (pointerId: number, layer: ProjectedLayer, at: SurfacePoint, place: boolean) => {
    dragRef.current?.cancel();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const parts = [...meshes.current.values()];
    let current: Projector = layer.projector;
    let last: ProjectorSpec | null = null;
    let grab: [number, number] = [0, 0];
    if (place) {
      const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      last = toSpec({ point: at.point, normal: at.normal, up: tangentUp(at.normal, [screenUp.x, screenUp.y, screenUp.z]) });
      current = last;
      useLive.getState().setProjection({ id: layer.id, projector: last });
    } else {
      grab = planeOffset(layer.projector, at.point);
    }
    setCursor(gl.domElement, 'grabbing');
    const handle = { cancel: () => finish(false) };
    dragRef.current = handle;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || dragRef.current !== handle) return;
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(parts, false)[0];
      const s = hit ? surfaceUnder(hit) : null;
      if (!s) return; // off the garment: hold the last position
      if (!last && Math.hypot(s.point[0] - at.point[0], s.point[1] - at.point[1], s.point[2] - at.point[2]) < 1.5) return;
      current = dragProjector(restMeshes, current, grab, s);
      last = toSpec(current);
      useLive.getState().setProjection({ id: layer.id, projector: last });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('keydown', key, true);
      if (dragRef.current !== handle) return;
      dragRef.current = null;
      if (commit && last) useStudio.getState().dispatch(updateProjectedLayer(layer.id, { projector: last }, place ? 'Place on garment' : 'Move on garment'));
      useLive.getState().clear();
      setCursor(gl.domElement, '');
    };
    const up = (ev: PointerEvent) => ev.pointerId === pointerId && finish(true);
    const cancelled = (ev: PointerEvent) => ev.pointerId === pointerId && finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelled);
    window.addEventListener('keydown', key, true);
  };

  /** Direct surface editing (spec ED3-05): press on artwork in Place mode and drag it across the garment. */
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== 'place' || !e.uv) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    const part = partOf(e);
    const surface = surfaceUnder(e);
    // A design area first (it lies on top): press its artwork to move that, its bare cloth to move the whole area.
    const inArea = surface ? areaAt(surface) : null;
    if (inArea && surface) {
      const layerId = selectInArea(inArea, true);
      const sel = movableSelection();
      if (layerId && sel && sel.zoneId === inArea.area.id) startAreaLayerDrag(e.pointerId, inArea.area, inArea, sel);
      else if (!layerId && !inArea.area.locked) startAreaMove(e.pointerId, inArea.area, surface);
      return;
    }
    // Then artwork across seams: it lies over any zone print it covers.
    const projected = surface ? projectionAt(surface) : null;
    if (projected && surface) {
      useStudio.getState().selectProjection(projected.id);
      if (!projected.locked) startProjectionDrag(e.pointerId, projected, surface, false);
      return;
    }
    const hit = pickAt(part, e.uv);
    // Bare cloth while projected artwork is selected: place it here (and keep dragging).
    const placing = movableProjection();
    if (placing && surface && !hit?.layerId) return startProjectionDrag(e.pointerId, placing, surface, true);
    if (!hit) return;
    selectHit(hit, true);
    const mesh = meshes.current.get(part);
    const sel = movableSelection();
    if (!hit.layerId || !mesh || !sel || sel.zoneId !== hit.zoneId) return;
    startDrag({ pointerId: e.pointerId, zoneId: hit.zoneId, mesh, start: { xMm: hit.xMm, yMm: hit.yMm }, ids: sel.ids, origin: sel.origin, moved: false, last: null, cancel: () => {} });
  };

  const startDrag = (d: Drag) => {
    dragRef.current?.cancel();
    dragRef.current = d;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const spec = zoneSpecOrFirst(model, d.zoneId);
    const b = unionBounds(Object.values(d.origin).map(rotatedBounds));
    const c0 = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    setCursor(gl.domElement, 'grabbing');

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId || dragRef.current !== d) return;
      const rect = gl.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const uv = raycaster.intersectObject(d.mesh, false)[0]?.uv;
      if (!uv) return; // off the garment: hold the last position
      const p = ungrade(d.zoneId, uvInZone(model, geo.layout, d.zoneId, wrapU(uv.x), uv.y));
      if (!d.moved && Math.hypot(p.xMm - d.start.xMm, p.yMm - d.start.yMm) < 1.5) return;
      d.moved = true;
      // Snap to the zone's centre line and keep the artwork's centre on the print area.
      let x = c0.x + p.xMm - d.start.xMm;
      let y = c0.y + p.yMm - d.start.yMm;
      if (Math.abs(x - spec.printableWidthMm / 2) < 4) x = spec.printableWidthMm / 2;
      x = clamp(x, 0, spec.printableWidthMm);
      y = clamp(y, 0, spec.printableHeightMm);
      const dx = x - c0.x;
      const dy = y - c0.y;
      d.last = Object.fromEntries(d.ids.map((id) => [id, { centerXmm: d.origin[id].centerXmm + dx, centerYmm: d.origin[id].centerYmm + dy }]));
      useLive.getState().setOverrides(d.zoneId, d.last, '3d');
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('keydown', key, true);
      if (dragRef.current !== d) return;
      dragRef.current = null;
      if (commit && d.moved && d.last) useStudio.getState().dispatch(updateTransforms(d.zoneId, d.last, 'Move on garment'));
      useLive.getState().clear();
      setCursor(gl.domElement, '');
    };
    const up = (ev: PointerEvent) => ev.pointerId === d.pointerId && finish(true);
    const cancelled = (ev: PointerEvent) => ev.pointerId === d.pointerId && finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    d.cancel = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelled);
    window.addEventListener('keydown', key, true);
  };

  // Place mode on touch: two fingers pinch to resize and twist to rotate the selection.
  // The mouse wheel resizes it (Shift rotates). With nothing selected, the camera zooms as usual.
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
    setCursor(gl.domElement, '');
  }, [mode, gl]);
  useEffect(() => {
    const el = gl.domElement;
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { d0: number; a0: number; zoneId: ArtboardId; origin: Record<string, LayerTransform>; last: Record<string, Partial<LayerTransform>> | null } | null = null;
    let pinchProjection: { d0: number; a0: number; id: string; origin: ProjectedTransform; last: Partial<ProjectedTransform> | null } | null = null;
    // A bare design area pinches as a whole: each step applies the change since the last one, as one merged undo step.
    let pinchArea: { d0: number; a0: number; scale: number; turn: number } | null = null;
    const metrics = () => {
      const [p, q] = [...touches.values()];
      return { d: Math.hypot(q.x - p.x, q.y - p.y), a: Math.atan2(q.y - p.y, q.x - p.x) };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size !== 2 || modeRef.current !== 'place') return;
      const projection = movableProjection();
      const sel = projection ? null : movableSelection();
      const area = projection || sel ? null : activeBareArea();
      if (!projection && !sel && !(area && !area.locked)) return;
      dragRef.current?.cancel(); // a one-finger drag becomes a pinch
      const m = metrics();
      if (projection) pinchProjection = { d0: Math.max(10, m.d), a0: m.a, id: projection.id, origin: projection.transform, last: null };
      else if (sel) pinch = { d0: Math.max(10, m.d), a0: m.a, zoneId: sel.zoneId, origin: sel.origin, last: null };
      else pinchArea = { d0: Math.max(10, m.d), a0: m.a, scale: 1, turn: 0 };
    };
    const move = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinchArea && touches.size >= 2) {
        const m = metrics();
        const scale = m.d / pinchArea.d0;
        const turn = normalizeDeg(((m.a - pinchArea.a0) * 180) / Math.PI);
        if (Math.abs(scale / pinchArea.scale - 1) > 0.01 || Math.abs(turn - pinchArea.turn) > 0.5) {
          transformArea(scale / pinchArea.scale, normalizeDeg(turn - pinchArea.turn), 'Resize area');
          pinchArea.scale = scale;
          pinchArea.turn = turn;
        }
        return;
      }
      const active = pinchProjection ?? pinch;
      if (!active || touches.size < 2) return;
      const m = metrics();
      const scale = m.d / active.d0;
      const turn = normalizeDeg(((m.a - active.a0) * 180) / Math.PI);
      if (pinchProjection) {
        const t = pinchProjection.origin;
        const k = clamp(scale, 2 / Math.min(t.widthMm, t.heightMm), 3000 / Math.max(t.widthMm, t.heightMm));
        pinchProjection.last = { widthMm: t.widthMm * k, heightMm: t.heightMm * k, rotationDeg: normalizeDeg(t.rotationDeg + turn) };
        useLive.getState().setProjection({ id: pinchProjection.id, transform: pinchProjection.last });
      } else if (pinch) {
        pinch.last = scaleRotateAbout(pinch.origin, scale, turn);
        useLive.getState().setOverrides(pinch.zoneId, pinch.last, '3d');
      }
    };
    const up = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId) || touches.size >= 2) return;
      if (pinchProjection?.last) useStudio.getState().dispatch(updateProjectedLayer(pinchProjection.id, { transform: pinchProjection.last }, 'Resize on garment'));
      else if (pinch?.last) useStudio.getState().dispatch(updateTransforms(pinch.zoneId, pinch.last, 'Resize on garment'));
      if (pinch || pinchProjection) useLive.getState().clear();
      pinch = null;
      pinchProjection = null;
      pinchArea = null;
    };
    const wheel = (e: WheelEvent) => {
      const bare = activeBareArea();
      if (modeRef.current !== 'place' || (!movableProjection() && !movableSelection() && !(bare && !bare.locked))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const raw = e.deltaY || e.deltaX;
      const delta = e.deltaMode === 1 ? raw * 16 : e.deltaMode === 2 ? raw * 400 : raw;
      if (e.shiftKey) transformSelected(1, clamp(delta * 0.15, -15, 15), 'Rotate on garment');
      else transformSelected(Math.exp(-clamp(delta, -200, 200) * 0.0008), 0, 'Resize on garment');
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false, capture: true });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel, { capture: true });
    };
  }, [gl]);

  // Hover feedback: in Place mode the cursor says whether there is artwork to grab, or a spot to
  // place the selected projected artwork.
  const onHover = (e: ThreeEvent<PointerEvent>) => {
    if (dragRef.current || !e.uv) return;
    if (mode !== 'place') return;
    const surface = surfaceUnder(e);
    const inArea = surface ? areaAt(surface) : null;
    if (inArea) {
      const layerId = hitTestLayer(inArea.area, inArea.x, inArea.y);
      const layer = layerId ? inArea.area.layers[layerId] : null;
      return setCursor(gl.domElement, layer ? (layer.locked ? '' : 'grab') : inArea.area.locked ? '' : 'move');
    }
    const projected = surface ? projectionAt(surface) : null;
    if (projected) return setCursor(gl.domElement, projected.locked ? '' : 'grab');
    const hit = pickAt(partOf(e), e.uv);
    const layer = hit?.layerId ? useStudio.getState().document!.zones[hit.zoneId].layers[hit.layerId] : null;
    setCursor(gl.domElement, layer ? (layer.locked ? '' : 'grab') : movableProjection() ? 'crosshair' : '');
  };
  const onOut = () => {
    if (!dragRef.current) setCursor(gl.domElement, '');
  };

  // A fitted shell's plain pieces (its hood, a belt) take design areas too: press an area there to
  // pick, move or design it. Elsewhere the piece only hides what is behind it.
  const onTrimClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (mode !== 'orbit' || e.delta > 4) return;
    const surface = surfaceOnTrim(e, camera);
    const inArea = surface ? areaAt(surface) : null;
    if (inArea) selectInArea(inArea, false);
  };
  const onTrimDown = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== 'place') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    const surface = surfaceOnTrim(e, camera);
    const inArea = surface ? areaAt(surface) : null;
    if (!inArea || !surface) return;
    const layerId = selectInArea(inArea, true);
    const sel = movableSelection();
    if (layerId && sel && sel.zoneId === inArea.area.id) startAreaLayerDrag(e.pointerId, inArea.area, inArea, sel);
    else if (!layerId && !inArea.area.locked) startAreaMove(e.pointerId, inArea.area, surface);
  };
  const onTrimHover = (e: ThreeEvent<PointerEvent>) => {
    if (dragRef.current || mode !== 'place') return;
    e.stopPropagation();
    const surface = surfaceOnTrim(e, camera);
    const inArea = surface ? areaAt(surface) : null;
    if (!inArea) return setCursor(gl.domElement, '');
    const layerId = hitTestLayer(inArea.area, inArea.x, inArea.y);
    const layer = layerId ? inArea.area.layers[layerId] : null;
    setCursor(gl.domElement, layer ? (layer.locked ? '' : 'grab') : inArea.area.locked ? '' : 'move');
  };
  const trimHandlers = apart ? {} : { onClick: onTrimClick, onPointerDown: onTrimDown, onPointerMove: onTrimHover, onPointerOut: onOut };
  const areaGuide: AreaGuide | null =
    guides || showSelection ? { accent, all: guides, active: showSelection ? activeZone : null, selected: showSelection && selected.length && isAreaId(activeZone) ? selected : undefined } : null;

  const lite = quality === 'low';
  const handlers = apart ? {} : { onClick, onPointerDown, onPointerMove: onHover, onPointerOut: onOut };
  /** The print surface drives roughness, metalness and relief; values in the map are absolute. */
  const surfaceProps = (part: PartId) => {
    const surface = surfaces.get(part)?.texture;
    return surface ? { roughnessMap: surface, metalnessMap: surface, bumpMap: surface, bumpScale: PRINT_RELIEF, roughness: 1, metalness: 1 } : {};
  };
  const noRaycast = () => null;
  const trimColor = (c: TrimColor) => (c === 'button' ? colorway.parts.stitching : c === 'body' || c === 'sleeves' || c === 'collar' ? colorway.parts[c] : partColor(colorway, c));
  const fabricOf = (t: GarmentGeometry['trims'][number]) => (ownRest && t.key.startsWith(SHELL_TRIM_PREFIX) && (t.color === 'body' || t.color === 'sleeves') ? trimFabric.out.get(t.color) : undefined);

  return (
    <group scale={0.001} position={[0, -(geo.layout.bottomMm + geo.layout.heightMm / 2) * 0.001, 0]}>
      {geo.parts.map((p) => {
        const base = partColor(colorway, PART_COLOR[p.id]);
        return (
          <group key={p.id}>
            <mesh
              ref={(m) => {
                if (m) meshes.current.set(p.id, m);
                else meshes.current.delete(p.id);
              }}
              geometry={p.geometry}
              userData={{ part: p.id }}
              castShadow
              receiveShadow
              customDepthMaterial={motionDepthMaterial}
              {...handlers}
            >
              <FabricMaterial lite={lite} look={look} map={textures.get(p.id)?.texture} normalMap={normals.parts.get(p.id)} sheenColor={shade(base, 1.15)} vertexColors {...surfaceProps(p.id)} />
            </mesh>
            <mesh
              ref={(m) => {
                if (m) liningMeshes.current.set(p.id, m);
                else liningMeshes.current.delete(p.id);
              }}
              geometry={linings.get(p.id) ?? p.geometry}
              raycast={noRaycast}
            >
              <meshStandardMaterial color={base} vertexColors side={THREE.BackSide} roughness={1} onBeforeCompile={patchMotion} customProgramCacheKey={motionCacheKey} />
            </mesh>
          </group>
        );
      })}
      {geo.trims.map((t) => {
        const color = trimColor(t.color);
        const trimLook = FABRIC_LOOK[t.surface];
        const shellPiece = ownRest && t.key.startsWith(SHELL_TRIM_PREFIX);
        const fabric = fabricOf(t);
        return (
          <mesh
            key={t.key}
            ref={(m) => {
              if (m) trimMeshes.current.set(t.key, m);
              else trimMeshes.current.delete(t.key);
            }}
            geometry={t.geometry}
            {...(shellPiece ? { userData: { trim: t.key }, ...trimHandlers } : { raycast: noRaycast })}
            castShadow
            receiveShadow
            customDepthMaterial={motionDepthMaterial}
          >
            <FabricMaterial
              // A new material when a fabric print comes or goes: three.js only adds a map to a shader it builds.
              key={fabric ? 'fabric' : 'plain'}
              lite={lite}
              look={trimLook}
              map={t.mapPart ? textures.get(t.mapPart)?.texture : fabric}
              color={t.mapPart ? undefined : fabric ? '#ffffff' : color}
              normalMap={t.surface === 'plastic' ? undefined : t.surface === 'rib' ? normals.trimRib : normals.trimFabric}
              sheenColor={shade(color, 1.1)}
              side={t.doubleSided ? THREE.DoubleSide : THREE.FrontSide}
              vertexColors={!!t.geometry.getAttribute('color')}
              {...(t.mapPart ? surfaceProps(t.mapPart) : {})}
            />
          </mesh>
        );
      })}
      <AreaTrimOverlays doc={doc} rest={rest} geo={geo} lite={lite} quality={quality} guide={areaGuide} />
      {hanger ? (
        <Hanger
          hpsMm={geo.layout.torsoHeightMm}
          shoulderMm={model.shoulderHalfWidthMm * (size.chestFlatMm / (2 * model.chestHalfWidthMm))}
          neckMm={model.neckRadiusMm * size.scale}
          slope={model.shoulderSlope}
        />
      ) : null}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Scene: lights, reflections, exposure, floor shadow (spec ED3-09, ED3-10, MED-02)
// ---------------------------------------------------------------------------

/** The podium sits this far below the hem, so the display form's pole shows; its plinth is this tall. */
const PODIUM_GAP = 0.09;
const PODIUM_HEIGHT = 0.24;

/** An oak table top, drawn once: long grain lines and soft rings in the table colour. */
function woodTexture(base: string): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  // Planks a quarter of the texture wide, each with its own grain.
  for (let plank = 0; plank < 4; plank++) {
    const x0 = (plank * size) / 4;
    const seed = plank * 17.3;
    for (let i = 0; i < 90; i++) {
      const x = x0 + ((i * 37.1 + seed * 13) % (size / 4));
      const dark = (Math.sin(i * 12.9898 + seed) * 43758.5453) % 1;
      ctx.strokeStyle = `rgba(${dark > 0 ? '60,35,15' : '255,240,220'},${0.03 + Math.abs(dark) * 0.07})`;
      ctx.lineWidth = 1 + Math.abs(dark) * 3;
      ctx.beginPath();
      for (let y = 0; y <= size; y += 16) {
        const wobble = Math.sin(y / 90 + i * 0.7 + seed) * 4 + Math.sin(y / 23 + i) * 1.2;
        if (y === 0) ctx.moveTo(x + wobble, y);
        else ctx.lineTo(x + wobble, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,25,10,0.35)';
    ctx.fillRect(x0, 0, 2, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.5, 2.5);
  texture.anisotropy = 8;
  return texture;
}

/**
 * What the garment is shown on (spec MED-02): a display form's pole over a round plinth that takes
 * the garment's shadow, or a table right behind it, so the front view reads as a flat lay from above.
 */
function SceneStage({ scene, floorY, backZ }: { scene: Scene; floorY: number; backZ: number }) {
  const stage = stageOf(scene);
  const base = scene.backdrop.kind === 'gradient' ? scene.backdrop.color2 : scene.backdrop.color;
  const wood = useMemo(() => (stage === 'table' ? woodTexture(base) : null), [stage, base]);
  useEffect(() => () => wood?.dispose(), [wood]);
  if (stage === 'podium') {
    const top = floorY - PODIUM_GAP;
    const plinth = shade(base, 0.93);
    return (
      <group>
        <mesh position={[0, top - PODIUM_HEIGHT / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.36, 0.37, PODIUM_HEIGHT, 96]} />
          <meshStandardMaterial color={plinth} roughness={0.62} />
        </mesh>
        {/* The form's pole, from the plinth up inside the garment. */}
        <mesh position={[0, top + 0.2, 0]} castShadow>
          <cylinderGeometry args={[0.007, 0.007, 0.4, 24]} />
          <meshStandardMaterial color="#c9ccd1" roughness={0.22} metalness={0.95} />
        </mesh>
      </group>
    );
  }
  if (stage === 'table' && wood) {
    return (
      <mesh position={[0, 0, backZ - 0.012]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial map={wood} roughness={0.78} />
      </mesh>
    );
  }
  return null;
}

function SceneLights({ scene, floorY, shadowKey }: { scene: Scene; floorY: number; shadowKey: string }) {
  const preset = presetOf(scene);
  const stage = stageOf(scene);
  // On a podium the soft floor shadow sits under the plinth; on a table the light casts real shadows onto it instead.
  const shadowY = stage === 'podium' ? floorY - PODIUM_GAP - PODIUM_HEIGHT : floorY;
  const rig = preset.rig;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const tone = toneOf(scene);
  useEffect(() => {
    setTone(gl, tone, scene.exposure);
    invalidate();
  }, [gl, tone, scene.exposure, invalidate]);
  const rot = (scene.envRotationDeg * Math.PI) / 180;
  const envRotation = useMemo(() => new THREE.Euler(0, rot, 0), [rot]);
  const [kx, ky, kz] = rig.key.position;
  return (
    <>
      <ambientLight intensity={rig.ambient} />
      {/* Every side the camera can show gets light, like a product shoot; the rig turns with the environment. */}
      <group rotation-y={rot}>
        {/* The key light casts soft shadows: sleeves onto the body, folds onto folds. */}
        <directionalLight
          position={[kx, ky, kz]}
          intensity={rig.key.intensity}
          color={rig.key.color}
          castShadow
          shadow-mapSize={[1536, 1536]}
          shadow-radius={8}
          shadow-intensity={0.72}
          shadow-bias={-0.0003}
          shadow-normalBias={0.003}
          shadow-camera-left={-1.05}
          shadow-camera-right={1.05}
          shadow-camera-top={1.05}
          shadow-camera-bottom={-1.05}
          shadow-camera-near={0.5}
          shadow-camera-far={8}
        />
        <directionalLight position={[-kx * 0.8, ky, -kz]} intensity={rig.key.intensity * 0.85} color={rig.key.color} />
        <directionalLight position={[-kx, ky * 0.7, kz * 0.9]} intensity={rig.fill.intensity * 0.45} color={rig.fill.color} />
        <directionalLight position={[2.4, 1.2, 0]} intensity={rig.rim.intensity} color={rig.rim.color} />
        <directionalLight position={[-2.4, 1.2, 0]} intensity={rig.rim.intensity} color={rig.rim.color} />
      </group>
      <Environment key={preset.id} resolution={256} frames={1} environmentIntensity={rig.environment} environmentRotation={envRotation}>
        <Lightformer form="rect" intensity={2.4} position={[0, 2.6, 2.2]} scale={[5, 2, 1]} color={rig.key.color} />
        <Lightformer form="rect" intensity={2.1} position={[0, 2.6, -2.2]} rotation-y={Math.PI} scale={[5, 2, 1]} />
        <Lightformer form="rect" intensity={1.1} position={[-3.5, 0.8, 0]} rotation-y={Math.PI / 2} scale={[4, 3, 1]} color={rig.fill.color} />
        <Lightformer form="rect" intensity={1.1} position={[3.5, 0.8, 0]} rotation-y={-Math.PI / 2} scale={[4, 3, 1]} />
      </Environment>
      {/* The garment's shape never moves, so its floor shadow is rendered once per garment, not every frame. */}
      {scene.shadows && stage !== 'table' ? (
        <group ref={registerShadow}>
          <ContactShadows key={`${shadowKey}:${stage}`} frames={1} position={[0, shadowY, 0]} opacity={preset.id === 'dark' || preset.id === 'neon' ? 0.55 : 0.32} scale={1.8} blur={2.4} far={1.2} resolution={512} />
        </group>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Camera: orbit bounds, view presets, saved views, lens, turntable, and rendering
// ---------------------------------------------------------------------------

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The camera shot that shows a zone (its preset view) or a design area (looking straight at it). */
function shotForArtboard(doc: DesignDocument | null | undefined, layout: GarmentLayout, id: ArtboardId, fovDeg: number): ShotSpec {
  // A lockup's own board is not on the garment: its placements are, wherever they are.
  if (isLockupId(id)) return { kind: 'preset', view: 'front' };
  if (!isAreaId(id)) return { kind: 'preset', view: ZONE_VIEW[id] };
  const area = doc?.areas?.items[id];
  if (!area) return { kind: 'preset', view: 'front' };
  // Garment millimetres to the stage: metres, centred on the garment as the Garment group places it.
  const lift = -(layout.bottomMm + layout.heightMm / 2);
  const [x, y, z] = area.projector.point;
  const [nx, ny, nz] = area.projector.normal;
  const target: [number, number, number] = [x / 1000, (y + lift) / 1000, z / 1000];
  const distance = 0.7 + Math.max(area.widthMm, area.heightMm) / 450;
  return { kind: 'bookmark', bookmark: { id: `area-${id}`, name: area.name, position: [target[0] + nx * distance, target[1] + ny * distance, target[2] + nz * distance], target, fovDeg } };
}

/** The classic tee's front-view extent in mm, which the preset camera distances were tuned for. */
const TEE_FIT = { heightMm: 730, widthMm: 813 };
/** How much further back the views frame a garment taken apart, so every piece stays in shot. */
const APART_FRAME = 1.3;
/** How far to pull the camera back, relative to the tee, for a garment of relative height h and width w. */
function fitDistance(h: number, w: number, aspect: number) {
  return Math.max(h, (0.95 * w) / Math.max(0.1, aspect));
}

function CameraRig({
  request,
  turntable,
  mode,
  hasSelection,
  fov,
  backdrop,
  fitH,
  fitW,
  centerY = 0,
  active,
}: {
  request: ViewRequest;
  turntable: boolean;
  mode: Mode;
  hasSelection: boolean;
  fov: number;
  backdrop: Scene['backdrop'];
  /** Garment height and width relative to a classic tee: a full uniform or a wide cut frames from further back. */
  fitH: number;
  fitW: number;
  /** Height (m) the preset views aim at: lower when a podium is in the shot. */
  centerY?: number;
  /** On screen: renders and turntables are offered only then, as before the view was kept while hidden. */
  active: boolean;
}) {
  const controls = useRef<CameraControlsImpl>(null);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  // A longer lens moves the camera back so the garment keeps its framing.
  const lens = Math.tan((BASE_FOV * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);
  const lensRef = useRef(lens);
  const fovRef = useRef(fov);
  const frameRef = useRef({ h: fitH, w: fitW, y: centerY });
  const backdropRef = useRef(backdrop);
  useEffect(() => {
    backdropRef.current = backdrop;
  }, [backdrop]);
  useEffect(() => {
    frameRef.current = { h: fitH, w: fitW, y: centerY };
  }, [fitH, fitW, centerY]);

  /** Where a shot puts the camera, for an output of the given aspect. */
  const poseOf = useCallback((shot: ShotSpec, aspect: number) => {
    if (shot.kind === 'bookmark') return { position: shot.bookmark.position, target: shot.bookmark.target, fov: shot.bookmark.fovDeg };
    if (shot.kind === 'current' && controls.current) {
      return { position: controls.current.getPosition(new THREE.Vector3()).toArray(), target: controls.current.getTarget(new THREE.Vector3()).toArray(), fov: camera.fov };
    }
    const view = shot.kind === 'preset' ? shot.view : 'front';
    // Back the camera off until the garment's height and its width (sleeves included) both fit.
    const k = fitDistance(frameRef.current.h, frameRef.current.w, aspect) * lensRef.current;
    const p = VIEW_PRESETS[view].position;
    const y = frameRef.current.y;
    return { position: [p[0] * k, p[1] * k + y, p[2] * k] as [number, number, number], target: [0, y, 0] as [number, number, number], fov: fovRef.current };
  }, [camera]);

  useEffect(() => {
    stage.controls = controls.current;
    return () => {
      stage.controls = null;
    };
  }, []);

  // The lens changes the field of view and dollies to keep the framing.
  useEffect(() => {
    const prev = lensRef.current;
    lensRef.current = lens;
    fovRef.current = fov;
    setLens(camera, fov);
    const c = controls.current;
    if (c && prev !== lens) void c.dollyTo(c.distance * (lens / prev), true);
    invalidate();
  }, [lens, fov, camera, invalidate]);

  // Fly to a requested view (or the same one again), and re-frame when the garment changes size.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const pose = poseOf(request.shot, width / Math.max(1, height));
    setLens(camera, pose.fov);
    void c.setLookAt(pose.position[0], pose.position[1], pose.position[2], pose.target[0], pose.target[1], pose.target[2], true);
  }, [request, width, height, poseOf, camera, fitH, fitW, centerY]);

  // Inspect vs edit (spec ED3-03, MOB-06): Place hands the primary pointer to artwork.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const A = CameraControlsImpl.ACTION;
    if (mode === 'orbit') {
      // Drag turns the garment; right-drag (or two fingers) pans across it, to look at a detail.
      c.mouseButtons.left = A.ROTATE;
      c.mouseButtons.right = A.TRUCK;
      c.mouseButtons.middle = A.DOLLY;
      c.mouseButtons.wheel = A.DOLLY;
      c.touches.one = A.TOUCH_ROTATE;
      c.touches.two = A.TOUCH_DOLLY_TRUCK;
    } else {
      // Place mode: the primary pointer is the artwork's; right-drag still turns, middle-drag pans.
      c.mouseButtons.left = A.NONE;
      c.mouseButtons.right = A.ROTATE;
      c.mouseButtons.middle = A.TRUCK;
      c.mouseButtons.wheel = hasSelection ? A.NONE : A.DOLLY;
      c.touches.one = A.NONE;
      c.touches.two = hasSelection ? A.NONE : A.TOUCH_DOLLY_TRUCK;
    }
    c.touches.three = A.NONE;
  }, [mode, hasSelection]);

  // Panning stays on the garment: the point the camera looks at can't leave its box (a little
  // larger), so the garment is never lost off screen. A view or Home re-centres it.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const hw = (fitW / 2) * 1.15;
    const hh = (fitH / 2) * 1.15;
    const y = centerY ?? fitH / 2;
    c.setBoundary(new THREE.Box3(new THREE.Vector3(-hw, y - hh, -hw), new THREE.Vector3(hw, y + hh, hw)));
  }, [fitW, fitH, centerY]);

  useFrame((_, delta) => {
    if (turntable && !stage.capturing && controls.current) {
      controls.current.azimuthAngle += delta * 0.45;
      invalidate();
    }
  });

  // Rendering for Wovexa Render: stills at any size the GPU allows, and turntable frames.
  useEffect(() => {
    if (!active) return;
    const ctx = gl.getContext();
    const viewport = ctx.getParameter(ctx.MAX_VIEWPORT_DIMS) as Int32Array;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const maxSide = Math.min(ctx.getParameter(ctx.MAX_RENDERBUFFER_SIZE) as number, viewport[0], viewport[1], memory <= 4 ? 4096 : 6144);
    viewerApi.maxOutputSize = () => maxSide;

    /** Backdrop, then each layer (by default the canvas as just rendered). */
    const composite = (W: number, H: number, background: RenderBackground, layers: (HTMLCanvasElement | null)[] = [gl.domElement]) => {
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const o = out.getContext('2d')!;
      if (background === 'scene') paintBackdrop(o, backdropRef.current, W, H);
      else if (background !== 'transparent') paintBackdrop(o, { kind: 'solid', color: background.color }, W, H);
      for (const layer of layers) if (layer) o.drawImage(layer, 0, 0, W, H);
      return out;
    };

    /** Where depth of field focuses: the garment surface at the centre of the frame. */
    const focusDistance = () => {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      const group = motionState.group;
      const hit = group ? ray.intersectObject(group, true)[0] : undefined;
      return hit ? hit.distance : camera.position.distanceTo(controls.current?.getTarget(new THREE.Vector3()) ?? new THREE.Vector3());
    };

    const fit = (w: number, h: number) => {
      const s = Math.min(1, maxSide / Math.max(w, h));
      return { W: even(w * s), H: even(h * s) };
    };

    /** `drawW`, `drawH`: the drawing buffer when it is smaller than the output (tiled renders). */
    async function withOutput<T>(W: number, H: number, run: () => Promise<T>, drawW = W, drawH = H): Promise<T> {
      const c = controls.current;
      if (!c) throw new Error('The 3D view is not ready yet.');
      if (stage.capturing) throw new Error('A render is already running. Wait for it to finish.');
      stage.stopLive?.();
      stage.capturing = true;
      const savedPos = c.getPosition(new THREE.Vector3());
      const savedTarget = c.getTarget(new THREE.Vector3());
      const savedRatio = gl.getPixelRatio();
      const savedSize = gl.getSize(new THREE.Vector2());
      const savedFov = camera.fov;
      // Stills show the finished garment at rest; video frames set motion themselves.
      applyMotion('still', 1, 0, motionState.group);
      try {
        stage.redraw?.({ quality: 'ultra', guides: false });
        gl.setPixelRatio(1);
        gl.setSize(drawW, drawH, false);
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
        return await run();
      } finally {
        camera.clearViewOffset();
        gl.setPixelRatio(savedRatio);
        gl.setSize(savedSize.x, savedSize.y, false);
        camera.aspect = savedSize.x / savedSize.y;
        camera.fov = savedFov;
        camera.updateProjectionMatrix();
        await c.setLookAt(savedPos.x, savedPos.y, savedPos.z, savedTarget.x, savedTarget.y, savedTarget.z, false);
        c.update(0);
        stage.capturing = false;
        stage.redraw?.();
        invalidate();
      }
    }

    /** `framedStage`: the on-screen stage size when "Current view" should match the render frame. */
    const place = async (shot: ShotSpec, aspect: number, liveFov: number, framedStage: THREE.Vector2 | null) => {
      const c = controls.current!;
      if (shot.kind === 'current') {
        // Narrow the lens to exactly the frame drawn over the stage, so framing is what you get.
        const crop = framedStage ? frameFit(framedStage.x, framedStage.y, aspect).h / framedStage.y : 1;
        camera.fov = (2 * Math.atan(Math.tan((liveFov * Math.PI) / 360) * crop) * 180) / Math.PI;
      } else {
        const pose = poseOf(shot, aspect);
        camera.fov = pose.fov;
        await c.setLookAt(pose.position[0], pose.position[1], pose.position[2], pose.target[0], pose.target[1], pose.target[2], false);
      }
      camera.updateProjectionMatrix();
      c.update(0);
    };

    /**
     * One real-time still larger than the GPU draws at once: the same camera, its view cut into
     * tiles the GPU can draw (a view offset per tile), each copied into place. Seamless, since every
     * tile is the same projection.
     */
    const renderTiled = (W: number, H: number, background: RenderBackground) => {
      const out = composite(W, H, background, []);
      const o = out.getContext('2d')!;
      for (let y = 0; y < H; y += maxSide) {
        for (let x = 0; x < W; x += maxSide) {
          const tw = Math.min(maxSide, W - x);
          const th = Math.min(maxSide, H - y);
          gl.setSize(tw, th, false);
          camera.setViewOffset(W, H, x, y, tw, th);
          camera.updateProjectionMatrix();
          gl.render(scene, camera);
          o.drawImage(gl.domElement, 0, 0, tw, th, x, y, tw, th);
        }
      }
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      return out;
    };

    viewerApi.capture = async ({ shots, width: w, height: h, background = 'scene', frameCurrent = false, photoreal }) => {
      // Real time renders any size (in tiles past the GPU's limit); path tracing stops at the limit.
      const tiled = !photoreal && Math.max(w, h) > maxSide;
      const { W, H } = tiled ? { W: even(w), H: even(h) } : fit(w, h);
      const liveFov = camera.fov;
      const framedStage = frameCurrent ? gl.getSize(new THREE.Vector2()) : null;
      if (photoreal) {
        const unsupported = photorealSupport(gl);
        if (unsupported) throw new Error(unsupported);
      }
      return withOutput(
        W,
        H,
        async () => {
          const out = [];
          if (!photoreal) {
            for (const shot of shots) {
              await place(shot, W / H, liveFov, framedStage);
              if (tiled) {
                out.push({ key: shotKey(shot), label: shotLabel(shot), canvas: renderTiled(W, H, background) });
                continue;
              }
              gl.render(scene, camera);
              out.push({ key: shotKey(shot), label: shotLabel(shot), canvas: composite(W, H, background) });
            }
            return out;
          }
        // Photoreal: nothing else draws to the canvas while it renders, the view can't be moved
        // mid-render, and the stage shows the render resolving at the output's proportions.
        const c = controls.current!;
        const el = gl.domElement;
        setFrameloop('never');
        c.enabled = false;
        el.style.objectFit = 'contain';
        let restore: (() => void) | null = null;
        // Path tracing sees the cloth where it is sewn, so a garment shown taken apart renders put together.
        const apartBefore = motionUniforms.uExplode.value;
        motionUniforms.uExplode.value = 0;
        try {
          // Floor shadows come from the rasteriser, before the scene changes for path tracing.
          const shadows: (HTMLCanvasElement | null)[] = [];
          for (const shot of shots) {
            await place(shot, W / H, liveFov, framedStage);
            const layer = document.createElement('canvas');
            shadows.push(shadowLayer(gl, scene, camera, layer) ? layer : null);
          }
          restore = stagePhotoreal(scene);
          for (const [i, shot] of shots.entries()) {
            await place(shot, W / H, liveFov, framedStage);
            const removeCard = fillCard(scene, camera);
            try {
              const traced = await pathTrace(gl, scene, camera, W, H, {
                samples: photoreal.samples,
                denoise: photoreal.denoise,
                focus: photoreal.fStop ? { fStop: photoreal.fStop, distance: focusDistance() } : undefined,
                signal: photoreal.signal,
                onProgress: (f) => photoreal.onProgress?.((i + f) / shots.length),
              });
              out.push({ key: shotKey(shot), label: shotLabel(shot), canvas: composite(W, H, background, [shadows[i], traced]) });
            } finally {
              removeCard();
            }
          }
        } finally {
          motionUniforms.uExplode.value = apartBefore;
          restore?.();
          el.style.objectFit = '';
          c.enabled = true;
          setFrameloop('demand');
        }
        return out;
        },
        tiled ? Math.min(W, maxSide) : W,
        tiled ? Math.min(H, maxSide) : H,
      );
    };

    viewerApi.turntable = async ({ width: w, height: h, frames, degrees, from = { kind: 'current' }, background = 'scene', frameCurrent = false, fps, move, onFrame, signal }) => {
      const { W, H } = fit(w, h);
      const liveFov = camera.fov;
      const framedStage = frameCurrent ? gl.getSize(new THREE.Vector2()) : null;
      await withOutput(W, H, async () => {
        const c = controls.current!;
        await place(from, W / H, liveFov, framedStage);
        const az0 = c.azimuthAngle;
        const polar = c.polarAngle;
        // A camera move glides through its keys instead of turning: from the start view in to the print, or through saved views.
        let keys: CameraKey[] | null = null;
        if (move?.kind === 'path') keys = move.keys;
        else if (move?.kind === 'fly-in') {
          const start: CameraKey = { position: c.getPosition(new THREE.Vector3()).toArray(), target: c.getTarget(new THREE.Vector3()).toArray(), fovDeg: camera.fov };
          const end = viewerApi.printCloseUp?.(move.artboard, camera.fov);
          if (!end) throw new Error('The print could not be found on the garment for a close-up. Add artwork to it first.');
          keys = [start, end];
        }
        const out = document.createElement('canvas');
        out.width = W;
        out.height = H;
        const o = out.getContext('2d')!;
        for (let i = 0; i < frames; i++) {
          if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
          if (keys) {
            const pose = pathPose(keys, frames > 1 ? i / (frames - 1) : 1);
            camera.fov = pose.fovDeg;
            camera.updateProjectionMatrix();
            await c.setLookAt(pose.position[0], pose.position[1], pose.position[2], pose.target[0], pose.target[1], pose.target[2], false);
          } else {
            // A full turn loops seamlessly; a partial sweep ends exactly on its last angle.
            const t = degrees >= 360 ? i / frames : i / Math.max(1, frames - 1);
            await c.rotateTo(az0 + ((degrees * Math.PI) / 180) * t, polar, false);
          }
          c.update(0);
          // The scene's motion plays on the video's own clock, so every frame is exact.
          if (fps && motionState.kind !== 'still') applyMotion(motionState.kind, motionState.speed, i / fps, motionState.group);
          gl.render(scene, camera);
          o.clearRect(0, 0, W, H);
          if (background === 'scene') paintBackdrop(o, backdropRef.current, W, H);
          else if (background !== 'transparent') paintBackdrop(o, { kind: 'solid', color: background.color }, W, H);
          o.drawImage(gl.domElement, 0, 0, W, H);
          await onFrame(out, i);
        }
      });
    };

    viewerApi.currentCamera = () => {
      const c = controls.current!;
      const position = c.getPosition(new THREE.Vector3()).toArray();
      const target = c.getTarget(new THREE.Vector3()).toArray();
      return { position, target, fovDeg: Math.round(camera.fov * 10) / 10 };
    };

    viewerApi.exportModel = async (format) => {
      const group = motionState.group;
      if (!group) throw new Error('The 3D view is not ready yet.');
      stage.stopLive?.();
      stage.capturing = true;
      applyMotion('still', 1, 0, group);
      try {
        // Render-quality textures without guides, then a clean copy of the garment.
        stage.redraw?.({ quality: 'ultra', guides: false });
        const { exportGlb, exportUsdz } = await import('./model-export');
        return format === 'glb' ? await exportGlb(group) : await exportUsdz(group);
      } finally {
        stage.capturing = false;
        stage.redraw?.();
        invalidate();
      }
    };

    return () => {
      viewerApi.capture = undefined;
      viewerApi.turntable = undefined;
      viewerApi.currentCamera = undefined;
      viewerApi.maxOutputSize = undefined;
      viewerApi.exportModel = undefined;
    };
  }, [gl, scene, camera, invalidate, poseOf, setFrameloop, active]);

  // The path tracer belongs to this renderer; free it with the renderer.
  useEffect(() => () => disposePhotoreal(), [gl]);

  const fitFactor = fitDistance(fitH, fitW, width / Math.max(1, height)) * lens;
  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={0.7 * lens}
      maxDistance={3.4 * fitFactor}
      // A full sphere: look down into the neck or up through the hem, all the way round.
      minPolarAngle={0.02}
      maxPolarAngle={Math.PI - 0.02}
      smoothTime={0.28}
    />
  );
}

export type LiveStatus = { kind: 'preparing' } | { kind: 'tracing'; samples: number; target: number } | { kind: 'done'; samples: number } | { kind: 'error'; message: string };

/** How long the view must be left still before it starts refining. */
const LIVE_IDLE_MS = 900;
/** Where the live view stops refining, to rest the GPU and battery. */
const LIVE_SAMPLES = 320;
/** Pixels the live view path traces, whatever the screen density: clean within seconds. */
const LIVE_PIXELS = 1_400_000;

/**
 * Photoreal view, the viewport's second mode: editing stays real time, and when the view is left
 * still it refines in place into a path-traced image (light that bounces, soft softbox shadows,
 * raised ink). Any interaction or edit returns to real time at once.
 */
function PhotorealView({ enabled, overlay, onStatus }: { enabled: boolean; overlay: React.RefObject<HTMLCanvasElement | null>; onStatus: (status: LiveStatus | null) => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const setFrameloop = useThree((s) => s.setFrameloop);

  useEffect(() => {
    if (!enabled) return;
    const unsupported = photorealSupport(gl);
    if (unsupported) {
      onStatus({ kind: 'error', message: unsupported });
      return () => onStatus(null);
    }
    let timer = 0;
    let run: { abort: AbortController; restore: () => void } | null = null;

    const stop = () => {
      window.clearTimeout(timer);
      if (!run) return;
      const r = run;
      run = null;
      r.abort.abort();
      r.restore();
      onStatus(null);
    };
    const arm = () => {
      stop();
      timer = window.setTimeout(start, LIVE_IDLE_MS);
    };
    function start() {
      if (run || document.hidden) return;
      // A render is running: look again shortly.
      if (stage.capturing) return arm();
      const abort = new AbortController();
      const undo: (() => void)[] = [];
      const restore = () => {
        for (const u of undo.splice(0).reverse()) u();
      };
      try {
        stage.live = true;
        setFrameloop('never');
        undo.push(() => {
          stage.live = false;
          setFrameloop('demand');
          invalidate();
        });
        // The garment at rest, its textures without on-garment guides.
        applyMotion('still', 1, 0, motionState.group);
        stage.redraw?.({ guides: false });
        undo.push(() => {
          stage.redraw?.();
        });
        // A pixel budget the GPU refines in seconds, whatever the screen density.
        const ratio = gl.getPixelRatio();
        const css = gl.getSize(new THREE.Vector2());
        gl.setPixelRatio(clamp(Math.sqrt(LIVE_PIXELS / Math.max(1, css.x * css.y)), 0.6, ratio));
        gl.setSize(css.x, css.y, false);
        undo.push(() => {
          gl.setPixelRatio(ratio);
          gl.setSize(css.x, css.y, false);
        });
        // The floor shadow, drawn once by the rasteriser, sits under the traced garment.
        const layer = overlay.current;
        if (layer && shadowLayer(gl, scene, camera, layer)) {
          layer.style.visibility = 'visible';
          undo.push(() => {
            layer.style.visibility = 'hidden';
          });
        }
        undo.push(stagePhotoreal(scene));
        undo.push(fillCard(scene, camera));
      } catch (error) {
        restore();
        onStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Photoreal view could not start.' });
        return;
      }
      run = { abort, restore };
      onStatus({ kind: 'preparing' });
      liveTrace(gl, scene, camera, {
        target: LIVE_SAMPLES,
        signal: abort.signal,
        onSamples: (n) => {
          if (!abort.signal.aborted && n >= 1) onStatus({ kind: 'tracing', samples: Math.floor(n), target: LIVE_SAMPLES });
        },
      }).then(
        () => {
          if (!abort.signal.aborted) onStatus({ kind: 'done', samples: LIVE_SAMPLES });
        },
        (error: unknown) => {
          if (abort.signal.aborted) return;
          stop();
          onStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Photoreal view stopped.' });
        },
      );
    }

    // Anything that changes what the view shows returns it to real time and starts the wait again.
    const host = gl.domElement.closest<HTMLElement>('[data-viewer3d]') ?? gl.domElement;
    const controls = stage.controls;
    host.addEventListener('pointerdown', arm, true);
    host.addEventListener('wheel', arm, { capture: true, passive: true });
    host.addEventListener('keydown', arm, true);
    document.addEventListener('visibilitychange', arm);
    controls?.addEventListener('update', arm);
    controls?.addEventListener('controlstart', arm);
    const resize = new ResizeObserver(arm);
    resize.observe(host);
    const unStudio = useStudio.subscribe((s, p) => {
      if (s.document !== p.document || s.selectedLayerIds !== p.selectedLayerIds || s.selectedProjectionId !== p.selectedProjectionId || s.activeZoneId !== p.activeZoneId) arm();
    });
    const unLive = useLive.subscribe((s, p) => {
      if (s.overrides !== p.overrides || s.projection !== p.projection || s.colorwayOverride !== p.colorwayOverride || s.colorwayPreview !== p.colorwayPreview || s.sceneOverride !== p.sceneOverride) arm();
    });
    stage.stopLive = stop;
    arm();
    return () => {
      stop();
      if (stage.stopLive === stop) stage.stopLive = null;
      host.removeEventListener('pointerdown', arm, true);
      host.removeEventListener('wheel', arm, { capture: true });
      host.removeEventListener('keydown', arm, true);
      document.removeEventListener('visibilitychange', arm);
      controls?.removeEventListener('update', arm);
      controls?.removeEventListener('controlstart', arm);
      resize.disconnect();
      unStudio();
      unLive();
    };
  }, [enabled, gl, scene, camera, invalidate, setFrameloop, overlay, onStatus]);
  return null;
}

/** While the render studio is open, show the output frame over the live view: exactly what "Current view" captures. */
function RenderFrame() {
  const aspect = useLive((s) => s.renderAspect);
  const ref = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [aspect]);
  if (!aspect) return null;
  const box = stageSize ? frameFit(stageSize.w, stageSize.h, aspect) : null;
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden" aria-hidden>
      {box ? <div className="rounded-sm outline outline-2 outline-[var(--accent)]" style={{ width: box.w, height: box.h, boxShadow: '0 0 0 100vmax rgb(13 14 17 / 0.28)' }} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

/**
 * The 3D view. Client-only (loaded with ssr: false), so device checks can run during the first
 * render. `active` is false while it is kept but hidden (the 2D view has the stage to itself): it
 * then draws and paints nothing, and coming back costs nothing (no new WebGL context, garment,
 * shading or shaders).
 */
export function Viewer3D({ compact = false, active = true }: { compact?: boolean; active?: boolean }) {
  const activeZone = useStudio((s) => s.activeZoneId);
  const hasSelection = useStudio((s) => s.selectedLayerIds.length > 0 || !!s.selectedProjectionId);
  const projectionSelected = useStudio((s) => !!s.selectedProjectionId);
  const doc = useStudio((s) => s.document);
  // A render batch (every lighting look) can show other scene settings without changing the design.
  const sceneOverride = useLive((s) => s.sceneOverride);
  const docScene = sceneOf(doc);
  const scene = useMemo(() => (sceneOverride ? { ...docScene, ...sceneOverride } : docScene), [docScene, sceneOverride]);
  const [supported] = useState(hasWebGL);
  const [quality] = useState<Quality>(detectQuality);
  const [mode, setMode] = useState<Mode>('orbit');
  const [request, setRequest] = useState<ViewRequest>(() => ({ shot: { kind: 'preset', view: isAreaId(activeZone) || isLockupId(activeZone) ? 'front' : ZONE_VIEW[activeZone] }, nonce: 0 }));
  const [turntable, setTurntable] = useState(false);
  /** Shown taken apart into its pieces (Orbit mode only: Place mode needs the garment sewn together). */
  const [apart, setApart] = useState(false);
  const [guides, setGuides] = useState(() => readFlag('wovexa.guides3d', true));
  const [sceneOpen, setSceneOpen] = useState(false);
  const [lost, setLost] = useState(false);
  const [generation, setGeneration] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const [photoreal, setPhotoreal] = useState(() => readFlag('wovexa.photoreal3d', false));
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const shadowOverlay = useRef<HTMLCanvasElement>(null);

  // The garment's geometry, rebuilt only when the garment or size changes (or the detail level).
  const modelId = doc?.garment.modelId ?? 'tee-classic';
  const sizeCode = doc?.garment.sizeCode ?? 'M';
  // Read straight from the document (not the derived scene), so the memo depends on a plain string.
  const drapeId = doc?.scene?.drape ?? 'natural';
  const baseGeo = useMemo(() => buildGarmentFor(modelId, sizeCode, quality, drapeAmount(drapeId)), [modelId, sizeCode, quality, drapeId]);
  useEffect(
    () => () => {
      for (const p of baseGeo.parts) p.geometry.dispose();
      for (const t of baseGeo.trims) t.geometry.dispose();
    },
    [baseGeo],
  );

  // A custom 3D shape in place of the built-in parts: made from this style's template (exact print
  // layout), or any garment GLB fitted over the pattern as a shell.
  const shapeRecord = doc?.garment.shape?.modelId === modelId ? doc.garment.shape : undefined;
  const shapeAssetId = shapeRecord && shapeRecord.kind !== 'shell' ? shapeRecord.assetId : null;
  const shapeSizeCode = shapeRecord?.sizeCode ?? sizeCode;
  // A shell's file: a model from the app's library (by file name) or one uploaded to this device.
  const shellLibrary = shapeRecord?.kind === 'shell' ? (shapeRecord.library ?? null) : null;
  const shellAssetId = shapeRecord?.kind === 'shell' ? (shellLibrary ? `library:${shellLibrary}` : (shapeRecord.assetId ?? null)) : null;
  const shellTurn = !!shapeRecord?.turn;
  const shellKey = shellAssetId ? `${shellAssetId}:${modelId}:${sizeCode}:${shellTurn ? 1 : 0}` : null;
  const [fittedShell, setFittedShell] = useState<{ key: string; geo: GarmentGeometry | null } | null>(null);
  useEffect(() => {
    if (!shellAssetId || !shellKey) return;
    let alive = true;
    const model = getGarment(modelId);
    const read = async () => {
      if (shellLibrary) return fetchLibraryModel(shellLibrary);
      const asset = await getAsset(shellAssetId);
      if (!asset) throw new ShapeError('The 3D model file isn’t on this device any more.');
      return asset.blob.arrayBuffer();
    };
    shellGarment(shellAssetId, read, model, getSize(model, sizeCode), shellTurn).then(
      (geo) => alive && setFittedShell({ key: shellKey, geo }),
      (error: unknown) => {
        if (!alive) return;
        setFittedShell({ key: shellKey, geo: null });
        toast(error instanceof Error ? `${error.message} Showing the built-in shape.` : 'The 3D model couldn’t be fitted.', 'error');
      },
    );
    return () => {
      alive = false;
    };
  }, [shellAssetId, shellLibrary, shellKey, shellTurn, modelId, sizeCode]);
  const fittingShell = !!shellKey && fittedShell?.key !== shellKey;
  const [loadedShape, setLoadedShape] = useState<{ assetId: string; shape: ParsedShape } | null>(null);
  useEffect(() => {
    if (!shapeAssetId) return;
    let alive = true;
    const model = getGarment(modelId);
    cachedShape(
      shapeAssetId,
      async () => {
        const asset = await getAsset(shapeAssetId);
        if (!asset) throw new ShapeError('The 3D shape file isn’t on this device any more.');
        return asset.blob.arrayBuffer();
      },
      model,
    ).then(
      (shape) => alive && setLoadedShape({ assetId: shapeAssetId, shape }),
      (error: unknown) => alive && toast(error instanceof Error ? `${error.message} Showing the built-in shape.` : 'The 3D shape couldn’t be loaded.', 'error'),
    );
    return () => {
      alive = false;
    };
  }, [shapeAssetId, modelId]);
  const shellGeo = shellKey && fittedShell?.key === shellKey ? fittedShell.geo : null;
  const geo = useMemo(() => {
    // A shell keeps its own folds, so the drape setting doesn't touch it.
    if (shellGeo) return shellGeo;
    if (!shapeAssetId || loadedShape?.assetId !== shapeAssetId) return baseGeo;
    const model = getGarment(modelId);
    const now = getSize(model, sizeCode);
    const made = getSize(model, shapeSizeCode);
    return shapedGarment(baseGeo, loadedShape.shape, { width: now.chestFlatMm / made.chestFlatMm, length: now.bodyLengthMm / made.bodyLengthMm });
  }, [baseGeo, shellGeo, shapeAssetId, loadedShape, modelId, sizeCode, shapeSizeCode]);
  useEffect(() => {
    if (geo === baseGeo) return;
    // Fitted shells are cached for switching back; freeing their GPU buffers is enough (three uploads them again).
    return () => {
      for (const p of geo.parts) p.geometry.dispose();
      for (const t of geo.trims) t.geometry.dispose();
    };
  }, [geo, baseGeo]);
  const motion = motionOf(scene);
  const motionGroup = useRef<THREE.Group>(null);
  const backdropImage = useBackdropImage(scene.backdrop.kind === 'image' ? scene.backdrop.assetId : undefined);
  // Taken apart: each piece of the garment moves out from where it is sewn, and back.
  const separable = useMemo(() => canTakeApart(geo), [geo]);
  const apartNow = apart && mode === 'orbit' && separable;
  // A podium joins the shot: frame the garment and its plinth together. Taken apart, the pieces
  // spread past the garment's own outline, so the views frame further back to keep them all in.
  const podiumDrop = stageOf(scene) === 'podium' ? PODIUM_GAP + PODIUM_HEIGHT : 0;
  const spread = apartNow ? APART_FRAME : 1;
  const fitH = ((geo.layout.heightMm + podiumDrop * 1000) / TEE_FIT.heightMm) * spread;
  const centerY = -podiumDrop / 2;
  const fitW = (geo.layout.widthMm / TEE_FIT.widthMm) * spread;
  const floorY = -(geo.layout.heightMm / 2) * 0.001 - 0.015;
  // A close-up of a print for video fly-ins: the middle of its artwork, found on the cloth and seen square on.
  useEffect(() => {
    viewerApi.printCloseUp = (id, fovDeg) => {
      const d = useStudio.getState().document;
      if (!d) return null;
      const lift = -(geo.layout.bottomMm + geo.layout.heightMm / 2);
      const toStage = (p: readonly number[]): [number, number, number] => [p[0] / 1000, (p[1] + lift) / 1000, p[2] / 1000];
      if (isAreaId(id)) {
        const area = d.areas?.items[id];
        if (!area) return null;
        return closeUp(toStage(area.projector.point), [...area.projector.normal], distanceToFit(Math.max(area.widthMm, area.heightMm) / 1000, fovDeg), fovDeg);
      }
      if (isLockupId(id)) return null;
      const spec = getGarment(d.garment.modelId).zones[id];
      const zone = d.zones[id];
      const part = geo.parts.find((p) => p.id === partForZone(id));
      if (!spec || !zone || !part?.geometry.index) return null;
      const shown = zone.orderedLayerIds.map((l) => zone.layers[l]).filter((l) => l?.visible);
      const raw = shown.length ? unionBounds(shown.map((l) => rotatedBounds(l.transform))) : { x: 0, y: 0, width: spec.printableWidthMm, height: spec.printableHeightMm };
      // Artwork graded by size shows at this size's scale: frame it as shown.
      const factor = shown.length ? zoneGrade(d, id, d.garment.sizeCode) : 1;
      const corner = gradePoint(spec, factor, raw.x, raw.y);
      const box = { x: corner.xMm, y: corner.yMm, width: raw.width * factor, height: raw.height * factor };
      const { u, v } = zoneToUv(getGarment(d.garment.modelId), geo.layout, id, box.x + box.width / 2, box.y + box.height / 2);
      const g = part.geometry;
      const hit = surfaceAtUv({ position: g.attributes.position.array, uv: g.attributes.uv.array, index: g.index!.array, normal: g.attributes.normal?.array }, u, v);
      if (!hit) return null;
      return closeUp(toStage(hit.point), [...hit.normal], distanceToFit(Math.max(box.width, box.height, 80) / 1000, fovDeg), fovDeg);
    };
    return () => {
      viewerApi.printCloseUp = undefined;
    };
  }, [geo]);

  // The garment's back, in metres: a flat lay's table sits just behind it.
  const backZ = useMemo(() => {
    let z = 0;
    for (const p of geo.parts) {
      if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
      z = Math.min(z, p.geometry.boundingBox!.min.z);
    }
    return z * 0.001;
  }, [geo]);
  // The floor shadow is drawn once per shape: the built-in parts, a template shape or a fitted shell.
  const shapeKey = shellGeo ? shellKey : shapeAssetId && loadedShape?.assetId === shapeAssetId ? shapeAssetId : 'built-in';
  const shadowKey = `${modelId}:${sizeCode}:${quality}:${drapeId}:${shapeKey}`;

  // Adaptive resolution (spec MOB-11): the screen's own pixel ratio up to a cap for the device's
  // quality (never more pixels than the screen shows), dropped to 1 while moving frames come slowly.
  const maxDpr = quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1;
  const [dprCap, setDprCap] = useState(maxDpr);

  // Follow the zone or design area being edited so the artwork stays in view, unless the 3D view chose it.
  const [followedZone, setFollowedZone] = useState(activeZone);
  const [ownZone, setOwnZone] = useState<ArtboardId | null>(null);
  if (followedZone !== activeZone) {
    setFollowedZone(activeZone);
    if (activeZone !== ownZone) setRequest((r) => ({ shot: shotForArtboard(doc, geo.layout, activeZone, scene.fovDeg), nonce: r.nonce + 1 }));
  }

  const fly = useCallback((shot: ShotSpec) => setRequest((r) => ({ shot, nonce: r.nonce + 1 })), [setRequest]);
  useEffect(() => {
    if (!active) return;
    viewerApi.flyTo = fly;
    return () => {
      viewerApi.flyTo = undefined;
    };
  }, [fly, active]);
  // Hidden, the garment goes back together, as it did when the view closed.
  if (!active && apart) setApart(false);

  const currentPreset = request.shot.kind === 'preset' ? request.shot.view : null;

  const toggleGuides = () => {
    setGuides((g) => {
      writeFlag('wovexa.guides3d', !g);
      return !g;
    });
  };
  const togglePhotoreal = () => {
    setPhotoreal((on) => {
      writeFlag('wovexa.photoreal3d', !on);
      return !on;
    });
  };

  const toggleApart = () => {
    const next = !apartNow;
    setApart(next);
    if (!next) return;
    setMode('orbit');
    // Square on from the front or back, the front and back bodies hide each other; from three
    // quarters every piece shows. The views frame the spread pieces while they're apart.
    fly({ kind: 'preset', view: 'three_quarter' });
  };
  /** Place mode works on the garment as sewn, so it puts the pieces back together first. */
  const enterPlace = () => {
    setApart(false);
    setMode('place');
  };

  /** Immediate screen image (spec EXP-01): the current view at up to twice the stage size. */
  const snapshot = async () => {
    const el = stageRef.current;
    if (!el || !viewerApi.capture || !doc) return;
    try {
      const r = el.getBoundingClientRect();
      const k = Math.min(2, 4096 / Math.max(r.width, r.height));
      const [shot] = await viewerApi.capture({ shots: [{ kind: 'current' }], width: r.width * k, height: r.height * k, background: 'scene' });
      downloadBlob(await canvasToBlob(shot.canvas), `${slugify(doc.title)}_snapshot_r${doc.revision}.png`);
      toast(`Saved a ${shot.canvas.width} × ${shot.canvas.height} px snapshot of this view.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The snapshot could not be saved.', 'error');
    }
  };

  /** Keyboard control of the stage (spec DSK-06): orbit, zoom, views; in Place mode, move and resize. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
    const c = stage.controls;
    if (!c) return;
    const projection = mode === 'place' ? movableProjection() : null;
    // A design area with nothing in it selected is itself what moves, resizes and turns.
    const bareArea = mode === 'place' && !projection && !movableSelection() ? activeBareArea() : null;
    const placing = mode === 'place' && (!!projection || !!movableSelection() || !!(bareArea && !bareArea.locked));
    const step = e.shiftKey ? 10 : 1;
    const preset = (Object.keys(VIEW_PRESETS) as ViewPreset[]).find((v) => VIEW_PRESETS[v].key === e.key);
    let handled = true;
    if (e.key.startsWith('Arrow')) {
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (projection) nudgeProjection(projection.id, dx, dy);
      else if (bareArea && placing) nudgeArea(bareArea.id, dx, dy);
      else if (placing) nudgeSelection(dx, dy);
      // Shift and an arrow pans the view a tenth of the way across, within the garment's box.
      else if (e.shiftKey) void c.truck(Math.sign(dx) * c.distance * 0.1, Math.sign(dy) * c.distance * 0.1, true);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') void c.rotate((e.key === 'ArrowLeft' ? 1 : -1) * (Math.PI / 12), 0, true);
      // Up raises the camera to look down on the garment (a smaller polar angle).
      else void c.rotate(0, (e.key === 'ArrowUp' ? -1 : 1) * (Math.PI / 18), true);
    } else if (e.key === '+' || e.key === '=') {
      if (!placing || !transformSelected(1.05, 0, 'Resize on garment')) void c.dolly(0.25, true);
    } else if (e.key === '-' || e.key === '_') {
      if (!placing || !transformSelected(1 / 1.05, 0, 'Resize on garment')) void c.dolly(-0.25, true);
    } else if (placing && (e.key === ',' || e.key === '.')) {
      transformSelected(1, e.key === ',' ? -5 : 5, 'Rotate on garment');
    } else if (e.key === 'Home' || e.key === '0') {
      fly(request.shot.kind === 'current' ? shotForArtboard(doc, geo.layout, activeZone, scene.fovDeg) : request.shot);
    } else if (preset) {
      fly({ kind: 'preset', view: preset });
    } else if (e.key.toLowerCase() === 'o') {
      setMode('orbit');
    } else if (e.key.toLowerCase() === 'p') {
      enterPlace();
    } else if (e.key.toLowerCase() === 'x' && separable) {
      toggleApart();
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // Safari's trackpad pinch arrives as gesture events, not ctrl+wheel: zoom the camera, or resize in Place mode.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !('ongesturestart' in window)) return;
    let base = 1;
    const start = (e: Event) => {
      e.preventDefault();
      base = 1;
    };
    const change = (e: Event) => {
      e.preventDefault();
      const scale = (e as Event & { scale: number }).scale;
      const k = scale / base;
      base = scale;
      if (mode === 'place' && transformSelected(k, 0, 'Resize on garment')) return;
      const c = stage.controls;
      if (c) void c.dollyTo(c.distance / k, false);
    };
    el.addEventListener('gesturestart', start);
    el.addEventListener('gesturechange', change);
    return () => {
      el.removeEventListener('gesturestart', start);
      el.removeEventListener('gesturechange', change);
    };
  }, [mode]);

  // Artwork just wrapped across seams (or picked from the layer list) is moved in Place mode.
  useEffect(() => {
    const place = () => {
      setApart(false);
      setMode('place');
    };
    window.addEventListener('wovexa:place-on-garment', place);
    return () => window.removeEventListener('wovexa:place-on-garment', place);
  }, []);

  if (!supported || lost) {
    return (
      <div className="grid h-full place-items-center p-6 text-center" style={{ background: 'var(--stage-3d)' }}>
        <div className="max-w-xs">
          <p className="font-semibold">{lost ? 'The 3D preview stopped' : '3D preview isn’t available on this device'}</p>
          <p className="mt-2 text-sm text-fg-2">
            Your design is safe. Keep editing in 2D{lost ? ', or restart the preview.' : '; print files still export.'}
          </p>
          {lost ? (
            <button className="btn btn-outline mt-4" onClick={() => { setLost(false); setGeneration((g) => g + 1); }}>
              Restart 3D preview
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const tool = 'touch-hit flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-fg-2 hover:bg-hover';
  return (
    <div className="@container relative h-full w-full" style={{ background: backdropCss(scene) }}>
      {backdropImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable remote image
        <img src={backdropImage} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <div
        ref={stageRef}
        data-viewer3d
        tabIndex={0}
        role="application"
        aria-roledescription="3D garment"
        aria-label={`3D garment, ${mode === 'orbit' ? 'Orbit' : 'Place'} mode`}
        aria-describedby="viewer3d-help"
        onKeyDown={onKeyDown}
        className={`absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] ${mode === 'orbit' ? 'cursor-grab active:cursor-grabbing' : ''}`}
        style={{ touchAction: 'none' }}
      >
        {/* Photoreal view: the floor shadow under the path-traced garment. */}
        <canvas ref={shadowOverlay} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" style={{ visibility: 'hidden' }} />
        <Canvas
          key={generation}
          frameloop={active ? 'demand' : 'never'}
          dpr={[1, dprCap]}
          shadows={quality === 'low' ? false : 'percentage'}
          camera={{ fov: scene.fovDeg, position: VIEW_PRESETS.front.position, near: 0.05, far: 20 }}
          gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping }}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
              setLost(true);
            });
          }}
        >
          <AdaptiveResolution onSlow={() => setDprCap(1)} onSmooth={() => setDprCap(maxDpr)} />
          <WakeOnShow active={active} />
          <SceneLights scene={scene} floorY={floorY} shadowKey={shadowKey} />
          <SceneStage scene={scene} floorY={floorY} backZ={backZ} />
          <group ref={motionGroup}>
            <Garment geo={geo} ownRest={!!shellGeo} quality={quality} mode={mode} guides={guides} hanger={motion.kind === 'hanger'} apart={apartNow} active={active} onOwnZone={setOwnZone} />
          </group>
          <ApartDriver apart={apartNow} />
          <MotionDriver
            kind={mode === 'place' ? 'still' : motion.kind}
            speed={motion.speed}
            groupRef={motionGroup}
            bottomMm={geo.layout.bottomMm}
            heightMm={geo.layout.heightMm}
            hpsMm={geo.layout.torsoHeightMm}
            limbPivots={geo.limbPivots}
          />
          <CameraRig request={request} turntable={turntable} mode={mode} hasSelection={hasSelection} fov={scene.fovDeg} backdrop={scene.backdrop} fitH={fitH} fitW={fitW} centerY={centerY} active={active} />
          {/* Path tracing sees the cloth where it is sewn, so it waits while the garment is taken apart (and while hidden). */}
          <PhotorealView enabled={photoreal && !turntable && !apartNow && active} overlay={shadowOverlay} onStatus={setLiveStatus} />
        </Canvas>
        <RenderFrame />
      </div>
      <p id="viewer3d-help" className="sr-only">
        Orbit mode: drag to rotate, right-drag or drag with two fingers to pan, scroll or pinch to zoom, click artwork to select it. Place mode: drag artwork to move it on the garment,
        scroll or pinch to resize, Shift plus scroll or twist to rotate, right-drag to rotate the view, middle-drag to pan. Keys: arrows rotate the view or nudge artwork in Place mode, Shift
        and an arrow pans, plus and minus zoom or resize, comma and period rotate artwork, 1 to 7 jump to views (6 from the top, 7 from underneath), Home resets the view, O and P switch
        modes, X takes the garment apart into its pieces and puts it back together. The view turns all the way round, over the top and underneath.
      </p>

      <div className={`pointer-events-none absolute inset-x-0 ${compact ? 'top-2' : 'bottom-3'} flex justify-center px-2`}>
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-xl border border-line bg-floating/90 p-1 shadow-sm backdrop-blur" role="toolbar" aria-label="3D view">
          <div className="seg flex-none" role="group" aria-label="3D mode">
            <button aria-pressed={mode === 'orbit'} onClick={() => setMode('orbit')} title="Orbit: drag to rotate the garment (O)">
              <span className="flex items-center gap-1">
                <Rotate3d size={14} aria-hidden /> Orbit
              </span>
            </button>
            <button aria-pressed={mode === 'place'} onClick={enterPlace} title="Place: drag artwork on the garment (P)">
              <span className="flex items-center gap-1">
                <Move size={14} aria-hidden /> Place
              </span>
            </button>
          </div>
          <span className="mx-0.5 h-5 w-px flex-none bg-line" aria-hidden />
          {/* Wide stages show one button per view; narrow ones (split view, phones) a compact picker. */}
          <div className="hidden items-center gap-1 @[44rem]:flex" role="group" aria-label="Views">
            {(Object.keys(VIEW_PRESETS) as ViewPreset[]).map((v) => (
              <button
                key={v}
                className={`${tool} flex-none aria-pressed:bg-inverse aria-pressed:text-fg-inverse`}
                aria-pressed={currentPreset === v}
                onClick={() => fly({ kind: 'preset', view: v })}
                title={`${VIEW_PRESETS[v].long} view (${VIEW_PRESETS[v].key})`}
              >
                {VIEW_PRESETS[v].label}
              </button>
            ))}
          </div>
          <select
            className="field touch-hit h-8 min-h-8 w-auto flex-none py-0 pr-7 text-xs font-semibold @[44rem]:hidden"
            aria-label="View"
            value={request.shot.kind === 'preset' ? request.shot.view : request.shot.kind === 'bookmark' ? request.shot.bookmark.id : ''}
            onChange={(e) => {
              const v = e.target.value;
              const bookmark = scene.cameras.find((c) => c.id === v);
              if (bookmark) fly({ kind: 'bookmark', bookmark });
              else if (v in VIEW_PRESETS) fly({ kind: 'preset', view: v as ViewPreset });
            }}
          >
            {request.shot.kind === 'current' ? <option value="">Custom</option> : null}
            {(Object.keys(VIEW_PRESETS) as ViewPreset[]).map((v) => (
              <option key={v} value={v}>
                {VIEW_PRESETS[v].long}
              </option>
            ))}
            {scene.cameras.length ? (
              <optgroup label="Saved views">
                {scene.cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <span className="mx-0.5 h-5 w-px flex-none bg-line" aria-hidden />
          <button className="icon-btn h-8 w-8 flex-none" aria-pressed={guides} onClick={toggleGuides} aria-label="Print area guides" title="Show print areas and the selection on the garment. Never included in renders.">
            <Frame size={16} />
          </button>
          <button className="icon-btn h-8 w-8 flex-none" aria-pressed={turntable} onClick={() => setTurntable((t) => !t)} aria-label="Turntable" title="Turntable">
            <RotateCw size={16} />
          </button>
          {separable ? (
            <button
              className="icon-btn h-8 w-8 flex-none"
              aria-pressed={apartNow}
              onClick={toggleApart}
              aria-label="Take apart"
              title={apartNow ? 'Put the pieces back together (X)' : 'Take apart: see each piece of the garment on its own (X)'}
            >
              <Ungroup size={16} />
            </button>
          ) : null}
          <button
            className="icon-btn h-8 w-8 flex-none"
            aria-pressed={photoreal}
            onClick={togglePhotoreal}
            aria-label="Photoreal view"
            title="Photoreal view: leave the view still and it refines into a path-traced image with real light and soft shadows. Any change returns to real time."
          >
            <Sparkles size={16} />
          </button>
          <button className="icon-btn h-8 w-8 flex-none" aria-pressed={sceneOpen} aria-expanded={sceneOpen} onClick={() => setSceneOpen((o) => !o)} aria-label="Scene and camera" title="Lighting, backdrop, lens and saved views">
            <SlidersHorizontal size={16} />
          </button>
          <button className="icon-btn h-8 w-8 flex-none" onClick={snapshot} aria-label="Save a snapshot of this view" title="Snapshot of this view (PNG)">
            <CameraIcon size={16} />
          </button>
          <button className="icon-btn h-8 w-8 flex-none" onClick={() => useStudio.getState().setPanel('render')} aria-label="Open Wovexa Render" title="Wovexa Render: product images and turntable video">
            <Clapperboard size={16} />
          </button>
        </div>
      </div>

      {fittingShell ? (
        <p className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-md bg-floating/90 px-2 py-1 text-[11px] text-fg-2 shadow-sm backdrop-blur" role="status">
          <Loader2 size={12} className="animate-spin" /> Fitting your 3D model to size {sizeCode}…
        </p>
      ) : mode === 'place' ? (
        <p className={`pointer-events-none absolute left-3 ${compact ? 'bottom-3 max-w-[85%]' : 'top-3 max-w-[60%]'} rounded-md bg-floating/85 px-2 py-1 text-[11px] text-fg-2 backdrop-blur`}>
          {projectionSelected
            ? 'Drag it over seams, or click the garment to place it there. Scroll or pinch to resize, Shift or twist to rotate.'
            : hasSelection
              ? 'Drag to move. Scroll or pinch to resize, Shift or twist to rotate.'
              : 'Press artwork on the garment to select and move it.'}
        </p>
      ) : apartNow ? (
        <p className={`pointer-events-none absolute left-3 ${compact ? 'bottom-3 max-w-[85%]' : 'top-3 max-w-[60%]'} rounded-md bg-floating/85 px-2 py-1 text-[11px] text-fg-2 backdrop-blur`} role="status">
          Taken apart into its pieces. Turn the view to see each one; press X to put them back together.
        </p>
      ) : photoreal && liveStatus ? null : (
        <p className="pointer-events-none absolute left-3 top-3 hidden rounded-md bg-floating/80 px-2 py-1 text-[11px] text-fg-2 backdrop-blur sm:block">Simulated preview: fabric and ink are approximate</p>
      )}

      {photoreal && liveStatus ? (
        <div
          className={`pointer-events-none absolute right-3 ${compact ? 'bottom-3' : 'top-3'} w-48 rounded-md bg-floating/90 px-2.5 py-1.5 text-[11px] text-fg-2 shadow-sm backdrop-blur`}
          role={liveStatus.kind === 'error' ? 'alert' : 'status'}
        >
          {liveStatus.kind === 'error' ? (
            <span className="text-warning">{liveStatus.message}</span>
          ) : liveStatus.kind === 'preparing' ? (
            'Preparing photoreal view…'
          ) : liveStatus.kind === 'tracing' ? (
            <>
              <span className="flex justify-between">
                <span>Photoreal</span>
                <span className="num">
                  {liveStatus.samples} / {liveStatus.target}
                </span>
              </span>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-hover">
                <span className="block h-full bg-[var(--accent)]" style={{ width: `${Math.round((liveStatus.samples / liveStatus.target) * 100)}%` }} />
              </span>
            </>
          ) : (
            <span className="flex justify-between">
              <span>Photoreal</span>
              <span className="num">{liveStatus.samples} samples</span>
            </span>
          )}
        </div>
      ) : null}

      {sceneOpen ? <ScenePanel compact={compact} onClose={() => { setSceneOpen(false); stageRef.current?.focus(); }} /> : null}
    </div>
  );
}
