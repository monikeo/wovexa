/**
 * Handles shared between the 3D viewer and the panels that drive it (render studio, scene
 * panel, export). Free of three.js imports, so panels can use it without pulling the 3D engine
 * into their bundle; the viewer fills in `viewerApi` while it is mounted.
 */
import type { CameraBookmark, ProjectorSpec, ZoneId } from '@/domain/schema';
import type { ProjectionMesh } from './projection';

export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'three_quarter' | 'top' | 'bottom';

/** Lens the preset distances were tuned for. Other lenses move the camera so framing stays the same. */
export const BASE_FOV = 28;
const D = 2.15;

export const VIEW_PRESETS: Record<ViewPreset, { label: string; long: string; key: string; position: [number, number, number] }> = {
  front: { label: 'Front', long: 'Front', key: '1', position: [0, 0.04, D] },
  back: { label: 'Back', long: 'Back', key: '2', position: [0, 0.04, -D] },
  left: { label: 'Left', long: 'Left side', key: '3', position: [D, 0.04, 0] },
  right: { label: 'Right', long: 'Right side', key: '4', position: [-D, 0.04, 0] },
  three_quarter: { label: '¾', long: 'Three-quarter', key: '5', position: [D * 0.68, 0.32, D * 0.72] },
  // Straight down into the neck and straight up through the hem; a hair off the axis keeps "up" defined.
  top: { label: 'Top', long: 'Top', key: '6', position: [0, D, D * 0.02] },
  bottom: { label: 'Under', long: 'Underneath', key: '7', position: [0, -D, D * 0.02] },
};

export const ZONE_VIEW: Record<ZoneId, ViewPreset> = { front: 'front', back: 'back', left_sleeve: 'left', right_sleeve: 'right', left_leg: 'left', right_leg: 'right' };

export type ShotSpec = { kind: 'preset'; view: ViewPreset } | { kind: 'bookmark'; bookmark: CameraBookmark } | { kind: 'current' };

/** Scene backdrop, nothing (alpha), or a flat colour. */
export type RenderBackground = 'scene' | 'transparent' | { color: string };

/** Share of the stage the render frame may fill, leaving a margin around it. */
export const FRAME_MARGIN = 0.92;

/** The render frame for an output aspect, centred in a stage of W × H: what "Current view" captures. */
export function frameFit(W: number, H: number, aspect: number) {
  const w = Math.min(W * FRAME_MARGIN, H * FRAME_MARGIN * aspect);
  return { w, h: w / aspect };
}

export interface CaptureOptions {
  shots: ShotSpec[];
  /** Output size in pixels, independent of the on-screen stage. */
  width: number;
  height: number;
  background?: RenderBackground;
  /** "Current view" captures exactly the render frame shown over the stage, not the whole stage. */
  frameCurrent?: boolean;
  /** Path trace instead of the real-time renderer: physical light, slower. */
  photoreal?: PhotorealSettings;
}

/** A path-traced still. Light bounces between surfaces and every shadow is soft. */
export interface PhotorealSettings {
  /** Samples per pixel: more is cleaner and slower. */
  samples: number;
  /** Smooth the remaining grain while keeping edges (default on). */
  denoise?: boolean;
  /** Depth of field as an f-number (smaller is blurrier), focused on the garment. Omit for all sharp. */
  fStop?: number;
  /** 0–1 across all shots of one capture. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Photoreal quality presets: what each is for, and its samples per pixel. */
export const PHOTOREAL_PRESETS = [
  { id: 'draft', label: 'Draft', samples: 64, hint: 'A quick look at light and shadow.' },
  { id: 'studio', label: 'Studio', samples: 256, hint: 'Clean product images for shops and posts.' },
  { id: 'final', label: 'Final', samples: 1024, hint: 'Hero images and print. Slowest.' },
] as const;
export type PhotorealPreset = (typeof PHOTOREAL_PRESETS)[number]['id'];

export interface CapturedShot {
  key: string;
  label: string;
  canvas: HTMLCanvasElement;
}

export interface TurntableOptions {
  width: number;
  height: number;
  frames: number;
  /** Total rotation across the clip. */
  degrees: number;
  from?: ShotSpec;
  background?: RenderBackground;
  frameCurrent?: boolean;
  /** Frames per second, so the scene's motion (wind, float, knit) plays in real time in the clip. */
  fps?: number;
  /** Receives each finished frame; awaited, so an encoder can apply backpressure. */
  onFrame: (canvas: HTMLCanvasElement, index: number) => Promise<void> | void;
  signal?: AbortSignal;
}

export const viewerApi: {
  capture?: (opts: CaptureOptions) => Promise<CapturedShot[]>;
  turntable?: (opts: TurntableOptions) => Promise<void>;
  /** Largest output side this GPU can render in one pass. */
  maxOutputSize?: () => number;
  /** Fly the live camera to a shot. */
  flyTo?: (shot: ShotSpec) => void;
  /** The live camera, for saving a view. */
  currentCamera?: () => Omit<CameraBookmark, 'id' | 'name'>;
  /** The garment as a 3D model: GLB for viewers and engines, USDZ for AR Quick Look. */
  exportModel?: (format: 'glb' | 'usdz') => Promise<Blob>;
  /** This style as a garment template GLB for Blender, Clo3D or Marvelous Designer (see garment-glb.ts). */
  exportTemplate?: () => Promise<Blob>;
  /** Where a new design area goes: the cloth at the middle of the view, upright as seen. Null when the view misses the garment. */
  areaAnchor?: () => ProjectorSpec | null;
  /** The cloth at rest that design areas lie on, as the 3D view shows it (a fitted shell is its own). */
  restCloth?: () => readonly ProjectionMesh[];
} = {};

export function shotKey(shot: ShotSpec) {
  return shot.kind === 'preset' ? shot.view : shot.kind === 'bookmark' ? `view-${shot.bookmark.id}` : 'current';
}

export function shotLabel(shot: ShotSpec) {
  return shot.kind === 'preset' ? VIEW_PRESETS[shot.view].long : shot.kind === 'bookmark' ? shot.bookmark.name : 'Current view';
}
