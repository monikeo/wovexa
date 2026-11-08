'use client';
/**
 * Wovexa 3D: live garment preview (spec §9). Reads the canonical document and live drag
 * overrides, never writes design state except through normal commands (zone selection).
 */
import { CameraControls, ContactShadows, Environment, Lightformer } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { getGarment, getSize } from '@/domain/garments';
import type { ZoneId } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from '@/lib/assets';
import { ensureFonts } from '@/lib/render/zone-renderer';
import { useDisplayColorway, useLive, useStudio } from '@/stores/studio-store';
import { buildTee, createKnitNormalMap } from './tee-geometry';
import { drawSleeve, drawTorso, type Quality } from './tee-textures';

export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'three_quarter';

const D = 2.15;
export const VIEW_PRESETS: Record<ViewPreset, { label: string; position: [number, number, number] }> = {
  front: { label: 'Front', position: [0, 0.04, D] },
  back: { label: 'Back', position: [0, 0.04, -D] },
  left: { label: 'Left', position: [D, 0.04, 0] },
  right: { label: 'Right', position: [-D, 0.04, 0] },
  three_quarter: { label: '¾', position: [D * 0.68, 0.32, D * 0.72] },
};

export interface CaptureOptions {
  views: ViewPreset[];
  /** Output size in pixels, independent of the on-screen stage. Defaults to 1600 × 2000 (4:5). */
  width?: number;
  height?: number;
}

/** Imperative capture hook for exports; set while a viewer is mounted. */
export const viewerApi: { capture?: (opts: CaptureOptions) => Promise<{ view: ViewPreset; dataUrl: string; width: number; height: number }[]> } = {};

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

function Garment({ quality }: { quality: Quality }) {
  const doc = useStudio((s) => s.document)!;
  const colorway = useDisplayColorway()!;
  const setActiveZone = useStudio((s) => s.setActiveZone);
  const invalidate = useThree((s) => s.invalidate);
  const model = getGarment(doc.garment.modelId);
  const size = getSize(model, doc.garment.sizeCode);
  const tee = useMemo(() => buildTee(model, size), [model, size]);

  const canvases = useMemo(
    () => ({ torso: document.createElement('canvas'), left: document.createElement('canvas'), right: document.createElement('canvas') }),
    [],
  );
  const maps = useMemo(() => {
    const make = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    };
    return { torso: make(canvases.torso), left: make(canvases.left), right: make(canvases.right) };
  }, [canvases]);
  const knit = useMemo(() => {
    const base = createKnitNormalMap();
    const torso = base.clone();
    torso.repeat.set(tee.layout.torsoCircumferenceMm / 5, tee.layout.torsoHeightMm / 5);
    const sleeve = base.clone();
    sleeve.repeat.set(tee.layout.sleeveCircumferenceMm / 5, tee.layout.sleeveLengthMm / 5);
    const collar = base.clone();
    collar.repeat.set(60, 2);
    [torso, sleeve, collar].forEach((t) => (t.needsUpdate = true));
    return { torso, sleeve, collar };
  }, [tee]);

  useEffect(() => () => {
    tee.torso.dispose();
    tee.sleeveLeft.dispose();
    tee.sleeveRight.dispose();
    tee.collar.dispose();
  }, [tee]);
  useEffect(() => () => Object.values(maps).forEach((t) => t.dispose()), [maps]);
  useEffect(() => {
    // Development-only handle for inspecting textures and captures from the console.
    if (process.env.NODE_ENV !== 'production') Object.assign(window, { __wovexa3d: { canvases, layout: tee.layout, viewerApi } });
  }, [canvases, tee]);
  useEffect(() => () => Object.values(knit).forEach((t) => t.dispose()), [knit]);

  // Redraw textures when the document, colourway or live drag changes; coalesced per frame.
  useEffect(() => {
    let frame = 0;
    let disposed = false;
    const redraw = () => {
      frame = 0;
      if (disposed) return;
      const live = useLive.getState();
      const state = { zoneId: live.zoneId, overrides: live.overrides };
      const ok = [
        drawTorso(canvases.torso, doc, model, tee.layout, colorway, quality, state),
        drawSleeve(canvases.left, doc, model, tee.layout, colorway, quality, 'left_sleeve', state),
        drawSleeve(canvases.right, doc, model, tee.layout, colorway, quality, 'right_sleeve', state),
      ].every(Boolean);
      for (const tex of [maps.torso, maps.left, maps.right]) {
        // three.js allocates fixed-size GPU storage on first upload; when the canvas is
        // resized (quality or garment size change) the old storage must be released first.
        const key = `${tex.image.width}x${tex.image.height}`;
        if (tex.userData.uploadedSize !== key) {
          tex.dispose();
          tex.userData.uploadedSize = key;
        }
        tex.needsUpdate = true;
      }
      invalidate();
      if (!ok) loadMissing();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(redraw);
    };
    const loadMissing = () => {
      for (const zone of Object.values(doc.zones)) {
        for (const layer of Object.values(zone.layers)) {
          if (layer.content.kind === 'image' && !getLoadedImage(layer.content.assetId)) {
            loadAssetImage(layer.content.assetId).then(schedule, () => {});
          }
        }
      }
    };
    schedule();
    ensureFonts(Object.values(doc.zones)).then(schedule);
    const unsubscribe = useLive.subscribe(schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [doc, colorway, model, tee, quality, canvases, maps, invalidate]);

  const pick = (zone: ZoneId) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // ignore clicks that ended an orbit drag
    e.stopPropagation();
    setActiveZone(zone);
  };
  const pickTorso = (e: ThreeEvent<MouseEvent>) => {
    const u = e.uv?.x ?? 0.75;
    pick(Math.abs(u - tee.layout.frontCenterU) < 0.25 ? 'front' : 'back')(e);
  };

  const fabric = {
    roughness: 0.93,
    sheen: 0.45,
    sheenRoughness: 0.75,
    normalScale: new THREE.Vector2(0.32, 0.32),
  };
  const inside = shade(colorway.parts.body, 0.55);
  const H = tee.layout.heightMm;

  return (
    <group scale={0.001} position={[0, (-H / 2) * 0.001 - 0.02, 0]}>
      <mesh geometry={tee.torso} onClick={pickTorso} castShadow>
        <meshPhysicalMaterial map={maps.torso} normalMap={knit.torso} sheenColor={shade(colorway.parts.body, 1.15)} {...fabric} />
      </mesh>
      <mesh geometry={tee.torso}>
        <meshStandardMaterial color={inside} side={THREE.BackSide} roughness={1} />
      </mesh>
      <mesh geometry={tee.sleeveLeft} onClick={pick('left_sleeve')}>
        <meshPhysicalMaterial map={maps.left} normalMap={knit.sleeve} sheenColor={shade(colorway.parts.sleeves, 1.15)} {...fabric} />
      </mesh>
      <mesh geometry={tee.sleeveLeft}>
        <meshStandardMaterial color={shade(colorway.parts.sleeves, 0.55)} side={THREE.BackSide} roughness={1} />
      </mesh>
      <mesh geometry={tee.sleeveRight} onClick={pick('right_sleeve')}>
        <meshPhysicalMaterial map={maps.right} normalMap={knit.sleeve} sheenColor={shade(colorway.parts.sleeves, 1.15)} {...fabric} />
      </mesh>
      <mesh geometry={tee.sleeveRight}>
        <meshStandardMaterial color={shade(colorway.parts.sleeves, 0.55)} side={THREE.BackSide} roughness={1} />
      </mesh>
      <mesh geometry={tee.collar}>
        <meshPhysicalMaterial color={colorway.parts.collar} normalMap={knit.collar} {...fabric} />
      </mesh>
    </group>
  );
}

function CameraRig({ preset, turntable }: { preset: ViewPreset; turntable: boolean }) {
  const controls = useRef<CameraControls>(null);
  const { gl, scene, camera, invalidate, size } = useThree();
  // Back the camera off on tall, narrow stages so the sleeves stay in frame.
  const fit = Math.max(1, 0.95 / (size.width / Math.max(1, size.height)));
  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

  useEffect(() => {
    const p = VIEW_PRESETS[preset].position;
    void controls.current?.setLookAt(p[0] * fit, p[1], p[2] * fit, 0, 0, 0, true);
  }, [preset, fit]);

  useFrame((_, delta) => {
    if (turntable && controls.current) {
      controls.current.azimuthAngle += delta * 0.45;
      invalidate();
    }
  });

  useEffect(() => {
    viewerApi.capture = async ({ views, width = 1600, height = 2000 }) => {
      const c = controls.current;
      const cam = camera as THREE.PerspectiveCamera;
      if (!c) return [];
      // Check GPU limits before allocating the export buffer (spec §31 Tier A).
      const max = Math.min(gl.capabilities.maxTextureSize, 8192);
      const scale = Math.min(1, max / Math.max(width, height));
      const W = Math.round(width * scale);
      const H = Math.round(height * scale);
      const savedPos = c.getPosition(new THREE.Vector3());
      const savedTarget = c.getTarget(new THREE.Vector3());
      const savedRatio = gl.getPixelRatio();
      const savedSize = gl.getSize(new THREE.Vector2());
      const k = Math.max(1, 0.95 / (W / H));
      const shots = [];
      try {
        gl.setPixelRatio(1);
        gl.setSize(W, H, false);
        cam.aspect = W / H;
        cam.updateProjectionMatrix();
        for (const view of views) {
          const p = VIEW_PRESETS[view].position;
          await c.setLookAt(p[0] * k, p[1], p[2] * k, 0, 0, 0, false);
          c.update(0);
          gl.render(scene, camera);
          shots.push({ view, dataUrl: gl.domElement.toDataURL('image/png'), width: W, height: H });
        }
      } finally {
        gl.setPixelRatio(savedRatio);
        gl.setSize(savedSize.x, savedSize.y, false);
        cam.aspect = savedSize.x / savedSize.y;
        cam.updateProjectionMatrix();
        await c.setLookAt(savedPos.x, savedPos.y, savedPos.z, savedTarget.x, savedTarget.y, savedTarget.z, false);
        invalidate();
      }
      return shots;
    };
    return () => {
      viewerApi.capture = undefined;
    };
  }, [gl, scene, camera, invalidate]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={1.05}
      maxDistance={3.4 * fit}
      minPolarAngle={Math.PI * 0.28}
      maxPolarAngle={Math.PI * 0.66}
      truckSpeed={0}
      smoothTime={0.28}
    />
  );
}

const ZONE_VIEW: Record<ZoneId, ViewPreset> = { front: 'front', back: 'back', left_sleeve: 'left', right_sleeve: 'right' };

/** Client-only (loaded with ssr: false), so device checks can run during the first render. */
export function Viewer3D({ compact = false }: { compact?: boolean }) {
  const activeZone = useStudio((s) => s.activeZoneId);
  const [supported] = useState(hasWebGL);
  const [quality] = useState<Quality>(detectQuality);
  const [preset, setPreset] = useState<ViewPreset>(() => ZONE_VIEW[activeZone]);
  const [turntable, setTurntable] = useState(false);
  const [lost, setLost] = useState(false);
  const [generation, setGeneration] = useState(0);

  // Follow the zone being edited so the artwork stays in view.
  const [followedZone, setFollowedZone] = useState(activeZone);
  if (followedZone !== activeZone) {
    setFollowedZone(activeZone);
    setPreset(ZONE_VIEW[activeZone]);
  }

  if (!supported || lost) {
    return (
      <div className="grid h-full place-items-center p-6 text-center" style={{ background: 'var(--stage-3d)' }}>
        <div className="max-w-xs">
          <p className="font-semibold">{lost ? 'The 3D preview stopped' : '3D preview isn’t available on this device'}</p>
          <p className="mt-2 text-sm text-fg-2">
            Your design is safe. Keep editing in 2D{lost ? ', or restart the preview.' : '; exports still work.'}
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

  return (
    <div className="relative h-full w-full" style={{ background: 'var(--stage-3d)' }}>
      {(
        <Canvas
          key={generation}
          frameloop="demand"
          dpr={quality === 'high' ? [1, 2] : quality === 'medium' ? [1, 1.5] : 1}
          camera={{ fov: 28, position: VIEW_PRESETS.front.position, near: 0.05, far: 20 }}
          gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping }}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener('webglcontextlost', (e) => {
              e.preventDefault();
              setLost(true);
            });
          }}
          aria-label="3D garment preview. Drag to rotate."
        >
          {/* Balanced studio lighting: every side the camera can show gets a key light, like a product shoot. */}
          <ambientLight intensity={0.35} />
          <directionalLight position={[1.4, 2.4, 2.2]} intensity={1.1} />
          <directionalLight position={[-1.4, 2.4, -2.2]} intensity={1.0} />
          <directionalLight position={[2.4, 1.2, 0]} intensity={0.35} />
          <directionalLight position={[-2.4, 1.2, 0]} intensity={0.35} />
          <Environment resolution={256} frames={1}>
            <Lightformer form="rect" intensity={2.4} position={[0, 2.6, 2.2]} scale={[5, 2, 1]} />
            <Lightformer form="rect" intensity={2.1} position={[0, 2.6, -2.2]} rotation-y={Math.PI} scale={[5, 2, 1]} />
            <Lightformer form="rect" intensity={1.1} position={[-3.5, 0.8, 0]} rotation-y={Math.PI / 2} scale={[4, 3, 1]} />
            <Lightformer form="rect" intensity={1.1} position={[3.5, 0.8, 0]} rotation-y={-Math.PI / 2} scale={[4, 3, 1]} />
          </Environment>
          <Garment quality={quality} />
          <ContactShadows position={[0, -0.4, 0]} opacity={0.32} scale={1.6} blur={2.4} far={0.9} resolution={512} />
          <CameraRig preset={preset} turntable={turntable} />
        </Canvas>
      )}

      <div className={`pointer-events-none absolute inset-x-0 ${compact ? 'top-2' : 'bottom-3'} flex justify-center px-2`}>
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-line bg-floating/90 p-1 shadow-sm backdrop-blur">
          {(Object.keys(VIEW_PRESETS) as ViewPreset[]).map((v) => (
            <button
              key={v}
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-fg-2 hover:bg-hover aria-pressed:bg-inverse aria-pressed:text-fg-inverse"
              aria-pressed={preset === v}
              onClick={() => setPreset(v)}
              title={`${VIEW_PRESETS[v].label} view`}
            >
              {VIEW_PRESETS[v].label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <button
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-fg-2 hover:bg-hover aria-pressed:bg-selected aria-pressed:text-accent"
            aria-pressed={turntable}
            onClick={() => setTurntable((t) => !t)}
          >
            Turntable
          </button>
        </div>
      </div>
      <p className="pointer-events-none absolute left-3 top-3 hidden rounded-md bg-floating/80 px-2 py-1 text-[11px] text-fg-2 backdrop-blur sm:block">
        Simulated preview: fabric and ink are approximate
      </p>
    </div>
  );
}
