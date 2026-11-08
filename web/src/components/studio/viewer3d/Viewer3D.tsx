'use client';
/**
 * Wovexa 3D: the interactive garment and render camera (spec §9, ED3-01…13, MOB-06).
 * Reads the canonical document and live drag overrides. It writes only through domain
 * commands: zone and layer selection, direct placement on the surface (Place mode), scene
 * settings and saved views. Stills and turntable frames are rendered here for Wovexa Render.
 */
import { CameraControls, CameraControlsImpl, ContactShadows, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Camera as CameraIcon, Clapperboard, Frame, Move, Rotate3d, RotateCw, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { unionBounds } from '@/domain/arrange';
import { coalescing, updateTransforms } from '@/domain/commands';
import { getGarment, getSize, partColor, zoneSpecOrFirst, type PartId } from '@/domain/garments';
import { clamp, hitTestLayer, normalizeDeg, rotatedBounds, scaleRotateAbout } from '@/domain/geometry';
import { backdropCss, motionOf, presetOf, sceneOf, type MotionKind } from '@/domain/scene';
import type { LayerTransform, Scene, ZoneId } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from '@/lib/assets';
import { canvasToBlob, downloadBlob, slugify } from '@/lib/download';
import { paintBackdrop } from '@/lib/render/backdrop';
import { ensureFonts } from '@/lib/render/zone-renderer';
import { toast } from '@/components/ui/primitives';
import { useDisplayColorway, useLive, useStudio } from '@/stores/studio-store';
import { nudgeSelection, selectLayers } from '../actions';
import { ScenePanel } from './ScenePanel';
import { BASE_FOV, frameFit, shotKey, shotLabel, VIEW_PRESETS, viewerApi, ZONE_VIEW, type RenderBackground, type ShotSpec, type ViewPreset } from './stage';
import { buildGarment, createFabricNormalMap, FABRIC_LOOK, type GarmentGeometry, type TrimColor } from './garment-geometry';
import { drawPart, partKey, partSizeMm, setGpuMaxTexture, type PaintContext, type Quality } from './garment-textures';
import { applyMotion, MOTION_CACHE_KEY, motionState, motionUniforms, patchMotion } from './motion';
import { uvInZone, uvToZone, type GarmentPart } from './uv-mapping';

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
} = { controls: null, redraw: null, capturing: false };

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
function setExposure(gl: THREE.WebGLRenderer, exposure: number) {
  gl.toneMappingExposure = exposure;
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

/** Unlocked selected layers of the active zone with their committed transforms. */
function movableSelection() {
  const s = useStudio.getState();
  const zone = s.document?.zones[s.activeZoneId];
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

const motionCacheKey = () => MOTION_CACHE_KEY;

/** Fabric shading: physical sheen on capable devices, a plain standard material on low-power ones. Both carry motion. */
function FabricMaterial({ lite, look, ...props }: { lite: boolean; look: (typeof FABRIC_LOOK)[keyof typeof FABRIC_LOOK] } & Record<string, unknown>) {
  const normalScale = useMemo(() => new THREE.Vector2(look.normal, look.normal), [look.normal]);
  if (lite) return <meshStandardMaterial roughness={look.roughness} normalScale={normalScale} onBeforeCompile={patchMotion} customProgramCacheKey={motionCacheKey} {...props} />;
  return <meshPhysicalMaterial roughness={look.roughness} sheen={look.sheen} sheenRoughness={0.75} normalScale={normalScale} onBeforeCompile={patchMotion} customProgramCacheKey={motionCacheKey} {...props} />;
}

/** Plays the scene's motion in the live view. Video frames set the same state from their own clock. */
function MotionDriver({ kind, speed, groupRef, bottomMm, heightMm }: { kind: MotionKind; speed: number; groupRef: React.RefObject<THREE.Group | null>; bottomMm: number; heightMm: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const [accent] = useState(() => cssVar('--accent', '#2b59ff'));
  useEffect(() => {
    setRevealSpan(bottomMm, heightMm, accent);
    invalidate();
  }, [bottomMm, heightMm, accent, invalidate]);
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
      if (!stage.capturing) {
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

function Garment({ geo, quality, mode, guides, onOwnZone }: { geo: GarmentGeometry; quality: Quality; mode: Mode; guides: boolean; onOwnZone: (zone: ZoneId) => void }) {
  const doc = useStudio((s) => s.document)!;
  const colorway = useDisplayColorway()!;
  const activeZone = useStudio((s) => s.activeZoneId);
  const selected = useStudio((s) => s.selectedLayerIds);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const model = getGarment(doc.garment.modelId);
  const fabricPreset = model.fabricPresets.find((f) => f.id === doc.garment.fabricPresetId) ?? model.fabricPresets[0];
  const meshes = useRef(new Map<PartId, THREE.Mesh>());
  const lastKeys = useRef(new Map<PartId, string>());
  const generation = useRef(0);
  const dragRef = useRef<Drag | null>(null);
  const [accent] = useState(() => cssVar('--accent', '#2b59ff'));

  // One canvas and texture per textured part, made once per geometry.
  const textures = useMemo(() => {
    const out = new Map<PartId, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();
    for (const p of geo.parts) {
      const canvas = document.createElement('canvas');
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
      out.set(p.id, { canvas, texture });
    }
    return out;
  }, [geo, gl]);
  useEffect(() => {
    const keys = lastKeys.current;
    keys.clear();
    return () => {
      for (const t of textures.values()) t.texture.dispose();
      keys.clear();
    };
  }, [textures]);

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
      const mm = FABRIC_LOOK[fabricPreset.surface].tileMm;
      parts.set(p.id, tile(fabric, w / mm, h / mm));
    }
    return { fabric, rib, parts, trimRib: tile(rib, 90, 3), trimFabric: tile(fabric, 60, 60) };
  }, [geo, fabricPreset.surface]);
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
      const live = useLive.getState();
      const ctx: PaintContext = {
        doc,
        model,
        geo,
        colorway,
        quality: opts.quality ?? quality,
        live: { zoneId: live.zoneId, overrides: live.overrides },
        guides: opts.guides === false ? undefined : { zones: guides, selection: showSelection && selected.length ? { zoneId: activeZone, ids: selected } : null, accent },
      };
      let ok = true;
      let changed = false;
      for (const p of geo.parts) {
        const entry = textures.get(p.id);
        if (!entry) continue;
        const key = partKey(p.id, ctx, generation.current);
        if (lastKeys.current.get(p.id) === key) continue;
        const complete = drawPart(entry.canvas, p.id, ctx);
        ok = ok && complete;
        lastKeys.current.set(p.id, complete ? key : '');
        // three.js allocates fixed-size GPU storage on first upload; when the canvas is
        // resized (quality, garment size or a render) the old storage must be released first.
        const sizeKey = `${entry.canvas.width}x${entry.canvas.height}`;
        if (entry.texture.userData.uploadedSize !== sizeKey) {
          entry.texture.dispose();
          entry.texture.userData.uploadedSize = sizeKey;
        }
        entry.texture.needsUpdate = true;
        changed = true;
      }
      if (changed) invalidate();
      return ok;
    },
    [doc, colorway, model, geo, quality, textures, invalidate, guides, showSelection, selected, activeZone, accent],
  );

  useEffect(() => {
    stage.redraw = draw;
    return () => {
      if (stage.redraw === draw) stage.redraw = null;
    };
  }, [draw]);

  // Redraw when the document, colourway, selection or a live drag changes; coalesced per frame.
  useEffect(() => {
    let frame = 0;
    let disposed = false;
    const run = () => {
      frame = 0;
      if (disposed || stage.capturing) return;
      if (!draw()) loadMissing();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const loadMissing = () => {
      const ids = new Set<string>();
      for (const zone of Object.values(doc.zones)) {
        for (const layer of Object.values(zone.layers)) if (layer.content.kind === 'image') ids.add(layer.content.assetId);
      }
      for (const surface of Object.values(colorway.surfaces ?? {})) if (surface?.kind === 'image') ids.add(surface.assetId);
      for (const id of ids) if (!getLoadedImage(id)) loadAssetImage(id).then(schedule, () => {});
    };
    schedule();
    ensureFonts(Object.values(doc.zones)).then((loaded) => {
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
  }, [draw, doc, colorway]);

  const pickAt = (part: GarmentPart, uv: THREE.Vector2) => {
    const hit = uvToZone(model, geo.layout, part, uv.x, uv.y);
    if (!hit) return null;
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

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (mode !== 'orbit' || e.delta > 4 || !e.uv) return; // ignore clicks that ended an orbit drag
    e.stopPropagation();
    const hit = pickAt(partOf(e), e.uv);
    if (hit) selectHit(hit, false);
  };

  /** Direct surface editing (spec ED3-05): press on artwork in Place mode and drag it across the garment. */
  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (mode !== 'place' || !e.uv) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    const part = partOf(e);
    const hit = pickAt(part, e.uv);
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
      const p = uvInZone(model, geo.layout, d.zoneId, uv.x, uv.y);
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
    let pinch: { d0: number; a0: number; zoneId: ZoneId; origin: Record<string, LayerTransform>; last: Record<string, Partial<LayerTransform>> | null } | null = null;
    const metrics = () => {
      const [p, q] = [...touches.values()];
      return { d: Math.hypot(q.x - p.x, q.y - p.y), a: Math.atan2(q.y - p.y, q.x - p.x) };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size !== 2 || modeRef.current !== 'place') return;
      const sel = movableSelection();
      if (!sel) return;
      dragRef.current?.cancel(); // a one-finger drag becomes a pinch
      const m = metrics();
      pinch = { d0: Math.max(10, m.d), a0: m.a, zoneId: sel.zoneId, origin: sel.origin, last: null };
    };
    const move = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinch || touches.size < 2) return;
      const m = metrics();
      pinch.last = scaleRotateAbout(pinch.origin, m.d / pinch.d0, normalizeDeg(((m.a - pinch.a0) * 180) / Math.PI));
      useLive.getState().setOverrides(pinch.zoneId, pinch.last, '3d');
    };
    const up = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId) || !pinch || touches.size >= 2) return;
      if (pinch.last) useStudio.getState().dispatch(updateTransforms(pinch.zoneId, pinch.last, 'Resize on garment'));
      useLive.getState().clear();
      pinch = null;
    };
    const wheel = (e: WheelEvent) => {
      if (modeRef.current !== 'place' || !movableSelection()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const raw = e.deltaY || e.deltaX;
      const delta = e.deltaMode === 1 ? raw * 16 : e.deltaMode === 2 ? raw * 400 : raw;
      if (e.shiftKey) transformSelection(1, clamp(delta * 0.15, -15, 15), 'Rotate on garment');
      else transformSelection(Math.exp(-clamp(delta, -200, 200) * 0.0008), 0, 'Resize on garment');
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

  // Hover feedback: in Place mode the cursor says whether there is artwork to grab.
  const onHover = (e: ThreeEvent<PointerEvent>) => {
    if (dragRef.current || !e.uv) return;
    if (mode !== 'place') return;
    const hit = pickAt(partOf(e), e.uv);
    const layer = hit?.layerId ? useStudio.getState().document!.zones[hit.zoneId].layers[hit.layerId] : null;
    setCursor(gl.domElement, layer && !layer.locked ? 'grab' : '');
  };
  const onOut = () => {
    if (!dragRef.current) setCursor(gl.domElement, '');
  };

  const lite = quality === 'low';
  const look = FABRIC_LOOK[fabricPreset.surface];
  const handlers = { onClick, onPointerDown, onPointerMove: onHover, onPointerOut: onOut };
  const noRaycast = () => null;
  const trimColor = (c: TrimColor) => (c === 'button' ? colorway.parts.stitching : c === 'body' || c === 'sleeves' || c === 'collar' ? colorway.parts[c] : partColor(colorway, c));

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
              {...handlers}
            >
              <FabricMaterial lite={lite} look={look} map={textures.get(p.id)?.texture} normalMap={normals.parts.get(p.id)} sheenColor={shade(base, 1.15)} vertexColors />
            </mesh>
            <mesh geometry={p.geometry} raycast={noRaycast}>
              <meshStandardMaterial color={shade(base, 0.55)} side={THREE.BackSide} roughness={1} onBeforeCompile={patchMotion} customProgramCacheKey={motionCacheKey} />
            </mesh>
          </group>
        );
      })}
      {geo.trims.map((t) => {
        const color = trimColor(t.color);
        const trimLook = FABRIC_LOOK[t.surface];
        return (
          <mesh key={t.key} geometry={t.geometry} raycast={noRaycast}>
            <FabricMaterial
              lite={lite}
              look={trimLook}
              map={t.mapPart ? textures.get(t.mapPart)?.texture : undefined}
              color={t.mapPart ? undefined : color}
              normalMap={t.surface === 'plastic' ? undefined : t.surface === 'rib' ? normals.trimRib : normals.trimFabric}
              sheenColor={shade(color, 1.1)}
              side={t.doubleSided ? THREE.DoubleSide : THREE.FrontSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Scene: lights, reflections, exposure, floor shadow (spec ED3-09, ED3-10, MED-02)
// ---------------------------------------------------------------------------

function SceneLights({ scene, floorY, shadowKey }: { scene: Scene; floorY: number; shadowKey: string }) {
  const preset = presetOf(scene);
  const rig = preset.rig;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    setExposure(gl, scene.exposure);
    invalidate();
  }, [gl, scene.exposure, invalidate]);
  const rot = (scene.envRotationDeg * Math.PI) / 180;
  const envRotation = useMemo(() => new THREE.Euler(0, rot, 0), [rot]);
  const [kx, ky, kz] = rig.key.position;
  return (
    <>
      <ambientLight intensity={rig.ambient} />
      {/* Every side the camera can show gets light, like a product shoot; the rig turns with the environment. */}
      <group rotation-y={rot}>
        <directionalLight position={[kx, ky, kz]} intensity={rig.key.intensity} color={rig.key.color} />
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
      {scene.shadows ? <ContactShadows key={shadowKey} frames={1} position={[0, floorY, 0]} opacity={preset.id === 'dark' ? 0.55 : 0.32} scale={1.8} blur={2.4} far={1.2} resolution={512} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Camera: orbit bounds, view presets, saved views, lens, turntable, and rendering
// ---------------------------------------------------------------------------

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The classic tee's front-view extent in mm, which the preset camera distances were tuned for. */
const TEE_FIT = { heightMm: 730, widthMm: 813 };
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
}) {
  const controls = useRef<CameraControlsImpl>(null);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  // A longer lens moves the camera back so the garment keeps its framing.
  const lens = Math.tan((BASE_FOV * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);
  const lensRef = useRef(lens);
  const fovRef = useRef(fov);
  const frameRef = useRef({ h: fitH, w: fitW });
  const backdropRef = useRef(backdrop);
  useEffect(() => {
    backdropRef.current = backdrop;
  }, [backdrop]);
  useEffect(() => {
    frameRef.current = { h: fitH, w: fitW };
  }, [fitH, fitW]);

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
    return { position: [p[0] * k, p[1] * k, p[2] * k] as [number, number, number], target: [0, 0, 0] as [number, number, number], fov: fovRef.current };
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
  }, [request, width, height, poseOf, camera, fitH, fitW]);

  // Inspect vs edit (spec ED3-03, MOB-06): Place hands the primary pointer to artwork.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const A = CameraControlsImpl.ACTION;
    if (mode === 'orbit') {
      c.mouseButtons.left = A.ROTATE;
      c.mouseButtons.right = A.ROTATE;
      c.mouseButtons.middle = A.DOLLY;
      c.mouseButtons.wheel = A.DOLLY;
      c.touches.one = A.TOUCH_ROTATE;
      c.touches.two = A.TOUCH_DOLLY;
    } else {
      c.mouseButtons.left = A.NONE;
      c.mouseButtons.right = A.ROTATE;
      c.mouseButtons.middle = A.DOLLY;
      c.mouseButtons.wheel = hasSelection ? A.NONE : A.DOLLY;
      c.touches.one = A.NONE;
      c.touches.two = hasSelection ? A.NONE : A.TOUCH_DOLLY;
    }
    c.touches.three = A.NONE;
  }, [mode, hasSelection]);

  useFrame((_, delta) => {
    if (turntable && !stage.capturing && controls.current) {
      controls.current.azimuthAngle += delta * 0.45;
      invalidate();
    }
  });

  // Rendering for Wovexa Render: stills at any size the GPU allows, and turntable frames.
  useEffect(() => {
    const ctx = gl.getContext();
    const viewport = ctx.getParameter(ctx.MAX_VIEWPORT_DIMS) as Int32Array;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const maxSide = Math.min(ctx.getParameter(ctx.MAX_RENDERBUFFER_SIZE) as number, viewport[0], viewport[1], memory <= 4 ? 4096 : 6144);
    viewerApi.maxOutputSize = () => maxSide;

    const composite = (W: number, H: number, background: RenderBackground) => {
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const o = out.getContext('2d')!;
      if (background === 'scene') paintBackdrop(o, backdropRef.current, W, H);
      else if (background !== 'transparent') paintBackdrop(o, { kind: 'solid', color: background.color }, W, H);
      o.drawImage(gl.domElement, 0, 0, W, H);
      return out;
    };

    const fit = (w: number, h: number) => {
      const s = Math.min(1, maxSide / Math.max(w, h));
      return { W: even(w * s), H: even(h * s) };
    };

    async function withOutput<T>(W: number, H: number, run: () => Promise<T>): Promise<T> {
      const c = controls.current;
      if (!c) throw new Error('The 3D view is not ready yet.');
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
        gl.setSize(W, H, false);
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
        return await run();
      } finally {
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

    viewerApi.capture = async ({ shots, width: w, height: h, background = 'scene', frameCurrent = false }) => {
      const { W, H } = fit(w, h);
      const liveFov = camera.fov;
      const framedStage = frameCurrent ? gl.getSize(new THREE.Vector2()) : null;
      return withOutput(W, H, async () => {
        const out = [];
        for (const shot of shots) {
          await place(shot, W / H, liveFov, framedStage);
          gl.render(scene, camera);
          out.push({ key: shotKey(shot), label: shotLabel(shot), canvas: composite(W, H, background) });
        }
        return out;
      });
    };

    viewerApi.turntable = async ({ width: w, height: h, frames, degrees, from = { kind: 'current' }, background = 'scene', frameCurrent = false, fps, onFrame, signal }) => {
      const { W, H } = fit(w, h);
      const liveFov = camera.fov;
      const framedStage = frameCurrent ? gl.getSize(new THREE.Vector2()) : null;
      await withOutput(W, H, async () => {
        const c = controls.current!;
        await place(from, W / H, liveFov, framedStage);
        const az0 = c.azimuthAngle;
        const polar = c.polarAngle;
        const out = document.createElement('canvas');
        out.width = W;
        out.height = H;
        const o = out.getContext('2d')!;
        for (let i = 0; i < frames; i++) {
          if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
          // A full turn loops seamlessly; a partial sweep ends exactly on its last angle.
          const t = degrees >= 360 ? i / frames : i / Math.max(1, frames - 1);
          await c.rotateTo(az0 + ((degrees * Math.PI) / 180) * t, polar, false);
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
  }, [gl, scene, camera, invalidate, poseOf]);

  const fitFactor = fitDistance(fitH, fitW, width / Math.max(1, height)) * lens;
  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={0.7 * lens}
      maxDistance={3.4 * fitFactor}
      minPolarAngle={Math.PI * 0.22}
      maxPolarAngle={Math.PI * 0.7}
      truckSpeed={0}
      smoothTime={0.28}
    />
  );
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

/** Client-only (loaded with ssr: false), so device checks can run during the first render. */
export function Viewer3D({ compact = false }: { compact?: boolean }) {
  const activeZone = useStudio((s) => s.activeZoneId);
  const hasSelection = useStudio((s) => s.selectedLayerIds.length > 0);
  const doc = useStudio((s) => s.document);
  const scene = sceneOf(doc);
  const [supported] = useState(hasWebGL);
  const [quality] = useState<Quality>(detectQuality);
  const [mode, setMode] = useState<Mode>('orbit');
  const [request, setRequest] = useState<ViewRequest>(() => ({ shot: { kind: 'preset', view: ZONE_VIEW[activeZone] }, nonce: 0 }));
  const [turntable, setTurntable] = useState(false);
  const [guides, setGuides] = useState(() => readFlag('wovexa.guides3d', true));
  const [sceneOpen, setSceneOpen] = useState(false);
  const [lost, setLost] = useState(false);
  const [generation, setGeneration] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  // The garment's geometry, rebuilt only when the garment or size changes (or the detail level).
  const modelId = doc?.garment.modelId ?? 'tee-classic';
  const sizeCode = doc?.garment.sizeCode ?? 'M';
  const geo = useMemo(() => {
    const model = getGarment(modelId);
    return buildGarment(model, getSize(model, sizeCode), quality === 'low' ? 'low' : 'high');
  }, [modelId, sizeCode, quality]);
  useEffect(
    () => () => {
      for (const p of geo.parts) p.geometry.dispose();
      for (const t of geo.trims) t.geometry.dispose();
    },
    [geo],
  );
  const motion = motionOf(scene);
  const motionGroup = useRef<THREE.Group>(null);
  const backdropImage = useBackdropImage(scene.backdrop.kind === 'image' ? scene.backdrop.assetId : undefined);
  const fitH = geo.layout.heightMm / TEE_FIT.heightMm;
  const fitW = geo.layout.widthMm / TEE_FIT.widthMm;
  const floorY = -(geo.layout.heightMm / 2) * 0.001 - 0.015;
  const shadowKey = `${modelId}:${sizeCode}:${quality}`;

  // Adaptive resolution (spec MOB-11): drop the pixel ratio if frames slow down, restore it when they recover.
  const maxDpr = quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1;
  const [dpr, setDpr] = useState(maxDpr);

  // Follow the zone being edited so the artwork stays in view, unless the 3D view chose it.
  const [followedZone, setFollowedZone] = useState(activeZone);
  const [ownZone, setOwnZone] = useState<ZoneId | null>(null);
  if (followedZone !== activeZone) {
    setFollowedZone(activeZone);
    if (activeZone !== ownZone) setRequest((r) => ({ shot: { kind: 'preset', view: ZONE_VIEW[activeZone] }, nonce: r.nonce + 1 }));
  }

  const fly = useCallback((shot: ShotSpec) => setRequest((r) => ({ shot, nonce: r.nonce + 1 })), []);
  useEffect(() => {
    viewerApi.flyTo = fly;
    return () => {
      viewerApi.flyTo = undefined;
    };
  }, [fly]);

  const currentPreset = request.shot.kind === 'preset' ? request.shot.view : null;

  const toggleGuides = () => {
    setGuides((g) => {
      writeFlag('wovexa.guides3d', !g);
      return !g;
    });
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
    const placing = mode === 'place' && !!movableSelection();
    const step = e.shiftKey ? 10 : 1;
    const preset = (Object.keys(VIEW_PRESETS) as ViewPreset[]).find((v) => VIEW_PRESETS[v].key === e.key);
    let handled = true;
    if (e.key.startsWith('Arrow')) {
      if (placing) nudgeSelection(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') void c.rotate((e.key === 'ArrowLeft' ? 1 : -1) * (Math.PI / 12), 0, true);
      // Up raises the camera to look down on the garment (a smaller polar angle).
      else void c.rotate(0, (e.key === 'ArrowUp' ? -1 : 1) * (Math.PI / 18), true);
    } else if (e.key === '+' || e.key === '=') {
      if (!placing || !transformSelection(1.05, 0, 'Resize on garment')) void c.dolly(0.25, true);
    } else if (e.key === '-' || e.key === '_') {
      if (!placing || !transformSelection(1 / 1.05, 0, 'Resize on garment')) void c.dolly(-0.25, true);
    } else if (placing && (e.key === ',' || e.key === '.')) {
      transformSelection(1, e.key === ',' ? -5 : 5, 'Rotate on garment');
    } else if (e.key === 'Home' || e.key === '0') {
      fly(request.shot.kind === 'current' ? { kind: 'preset', view: ZONE_VIEW[activeZone] } : request.shot);
    } else if (preset) {
      fly({ kind: 'preset', view: preset });
    } else if (e.key.toLowerCase() === 'o') {
      setMode('orbit');
    } else if (e.key.toLowerCase() === 'p') {
      setMode('place');
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
      if (mode === 'place' && transformSelection(k, 0, 'Resize on garment')) return;
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
        <Canvas
          key={generation}
          frameloop="demand"
          dpr={dpr}
          camera={{ fov: scene.fovDeg, position: VIEW_PRESETS.front.position, near: 0.05, far: 20 }}
          gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping }}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
              setLost(true);
            });
          }}
        >
          <PerformanceMonitor flipflops={3} onDecline={() => setDpr(1)} onIncline={() => setDpr(maxDpr)} onFallback={() => setDpr(1)} />
          <SceneLights scene={scene} floorY={floorY} shadowKey={shadowKey} />
          <group ref={motionGroup}>
            <Garment geo={geo} quality={quality} mode={mode} guides={guides} onOwnZone={setOwnZone} />
          </group>
          <MotionDriver kind={mode === 'place' ? 'still' : motion.kind} speed={motion.speed} groupRef={motionGroup} bottomMm={geo.layout.bottomMm} heightMm={geo.layout.heightMm} />
          <CameraRig request={request} turntable={turntable} mode={mode} hasSelection={hasSelection} fov={scene.fovDeg} backdrop={scene.backdrop} fitH={fitH} fitW={fitW} />
        </Canvas>
        <RenderFrame />
      </div>
      <p id="viewer3d-help" className="sr-only">
        Orbit mode: drag to rotate, scroll or pinch to zoom, click artwork to select it. Place mode: drag artwork to move it on the garment, scroll or pinch to resize, Shift plus scroll or
        twist to rotate, right-drag to rotate the view. Keys: arrows rotate the view or nudge artwork in Place mode, plus and minus zoom or resize, comma and period rotate artwork, 1 to 5
        jump to views, Home resets the view, O and P switch modes.
      </p>

      <div className={`pointer-events-none absolute inset-x-0 ${compact ? 'top-2' : 'bottom-3'} flex justify-center px-2`}>
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-xl border border-line bg-floating/90 p-1 shadow-sm backdrop-blur" role="toolbar" aria-label="3D view">
          <div className="seg flex-none" role="group" aria-label="3D mode">
            <button aria-pressed={mode === 'orbit'} onClick={() => setMode('orbit')} title="Orbit: drag to rotate the garment (O)">
              <span className="flex items-center gap-1">
                <Rotate3d size={14} aria-hidden /> Orbit
              </span>
            </button>
            <button aria-pressed={mode === 'place'} onClick={() => setMode('place')} title="Place: drag artwork on the garment (P)">
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

      {mode === 'place' ? (
        <p className={`pointer-events-none absolute left-3 ${compact ? 'bottom-3 max-w-[85%]' : 'top-3 max-w-[60%]'} rounded-md bg-floating/85 px-2 py-1 text-[11px] text-fg-2 backdrop-blur`}>
          {hasSelection ? 'Drag to move. Scroll or pinch to resize, Shift or twist to rotate.' : 'Press artwork on the garment to select and move it.'}
        </p>
      ) : (
        <p className="pointer-events-none absolute left-3 top-3 hidden rounded-md bg-floating/80 px-2 py-1 text-[11px] text-fg-2 backdrop-blur sm:block">Simulated preview: fabric and ink are approximate</p>
      )}

      {sceneOpen ? <ScenePanel compact={compact} onClose={() => { setSceneOpen(false); stageRef.current?.focus(); }} /> : null}
    </div>
  );
}
