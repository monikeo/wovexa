/**
 * Studio scene presets (spec MED-02 scene presets, ED3-09 light controls, MED-04 backdrops).
 * A preset sets the lighting rig; the document's scene record stores the chosen preset plus
 * the person's own adjustments (exposure, rotation, backdrop, field of view, saved views).
 */
import type { DesignDocument, Scene } from './schema';

export interface LightRig {
  ambient: number;
  key: { intensity: number; color: string; position: [number, number, number] };
  fill: { intensity: number; color: string };
  rim: { intensity: number; color: string };
  /** Brightness of the reflections the fabric picks up. */
  environment: number;
}

export type ToneId = NonNullable<Scene['tone']>;

export interface ScenePreset {
  id: string;
  label: string;
  description: string;
  rig: LightRig;
  /** Starting values applied when the preset is chosen. */
  defaults: Pick<Scene, 'exposure' | 'backdrop' | 'shadows'> & { tone: ToneId };
}

/** How light becomes screen colour. Everything a render shows passes through one of these. */
export const TONES: { id: ToneId; label: string; description: string }[] = [
  { id: 'neutral', label: 'True colour', description: 'Keeps garment and ink colours closest to your file. Best for proofs and shop listings.' },
  { id: 'agx', label: 'Filmic', description: 'AgX, as in Blender: bright whites roll off softly instead of clipping, and strong light gently desaturates.' },
  { id: 'aces', label: 'Cinematic', description: 'ACES: punchy contrast and rich colour for campaigns and social. Colours shift from the file.' },
];

/** Older documents keep true colour until a tone is chosen. */
export function toneOf(scene: Scene): ToneId {
  return scene.tone ?? 'neutral';
}

export type DrapeId = NonNullable<Scene['drape']>;

/** How the cloth falls in 3D. The amount scales the folds the garment is built with. */
export const DRAPES: { id: DrapeId; label: string; description: string; amount: number }[] = [
  { id: 'pressed', label: 'Pressed', description: 'Smooth and flat, like a steamed garment on a ghost mannequin. Clearest view of the print.', amount: 0 },
  { id: 'natural', label: 'Natural', description: 'Soft folds where cloth hangs from the shoulders, a gentle wave at the hem and gathers under the arms.', amount: 1 },
  { id: 'relaxed', label: 'Relaxed', description: 'Deeper, lived-in folds, like a garment just put on. Most realistic, least flat.', amount: 1.8 },
];

export function drapeOf(scene: Scene): DrapeId {
  return scene.drape ?? 'natural';
}

/** Fold depth for a drape: 0 pressed flat, 1 natural. */
export function drapeAmount(id: DrapeId): number {
  return DRAPES.find((d) => d.id === id)?.amount ?? 1;
}

export const SCENE_PRESETS: ScenePreset[] = [
  {
    id: 'studio',
    label: 'Studio',
    description: 'Even softbox light on a pale grey sweep. Accurate colour for reviews.',
    rig: { ambient: 0.35, key: { intensity: 1.1, color: '#ffffff', position: [1.4, 2.4, 2.2] }, fill: { intensity: 0.9, color: '#ffffff' }, rim: { intensity: 0.35, color: '#ffffff' }, environment: 1 },
    defaults: { exposure: 1, shadows: true, backdrop: { kind: 'gradient', color: '#FFFFFF', color2: '#E3E5EA' }, tone: 'neutral' },
  },
  {
    id: 'ecommerce',
    label: 'Shop white',
    description: 'Bright, high-key light on pure white, ready for product listings.',
    rig: { ambient: 0.5, key: { intensity: 1.0, color: '#ffffff', position: [0.6, 2.6, 2.6] }, fill: { intensity: 1.0, color: '#ffffff' }, rim: { intensity: 0.2, color: '#ffffff' }, environment: 1.2 },
    defaults: { exposure: 1.15, shadows: true, backdrop: { kind: 'solid', color: '#FFFFFF', color2: '#FFFFFF' }, tone: 'neutral' },
  },
  {
    id: 'daylight',
    label: 'Daylight',
    description: 'Warm key from one side, cool sky fill. Natural and soft.',
    rig: { ambient: 0.3, key: { intensity: 1.35, color: '#fff1dc', position: [2.4, 2.2, 1.4] }, fill: { intensity: 0.7, color: '#dfe9ff' }, rim: { intensity: 0.45, color: '#fff7ea' }, environment: 0.9 },
    defaults: { exposure: 1.05, shadows: true, backdrop: { kind: 'gradient', color: '#F4EFE7', color2: '#DCD3C6' }, tone: 'agx' },
  },
  {
    id: 'dark',
    label: 'Dark studio',
    description: 'Moody single key and a strong rim on charcoal. For launches and social.',
    rig: { ambient: 0.12, key: { intensity: 1.6, color: '#ffffff', position: [1.8, 2.2, 1.6] }, fill: { intensity: 0.25, color: '#cfd8ff' }, rim: { intensity: 1.1, color: '#ffffff' }, environment: 0.55 },
    defaults: { exposure: 1, shadows: true, backdrop: { kind: 'gradient', color: '#2A2C33', color2: '#0D0E11' }, tone: 'agx' },
  },
  {
    id: 'golden',
    label: 'Golden hour',
    description: 'Low warm sun from the side, a cool sky fill and a glowing rim. For lifestyle and campaign images.',
    rig: { ambient: 0.2, key: { intensity: 1.75, color: '#ffc48a', position: [2.6, 1.1, 1.3] }, fill: { intensity: 0.45, color: '#bccaff' }, rim: { intensity: 0.95, color: '#ffd09c' }, environment: 0.7 },
    defaults: { exposure: 1.05, shadows: true, backdrop: { kind: 'gradient', color: '#FBE6CF', color2: '#E3B48A' }, tone: 'agx' },
  },
  {
    id: 'neon',
    label: 'Neon',
    description: 'Magenta key and cyan rim on near-black, high contrast. For drops and night-time social.',
    rig: { ambient: 0.08, key: { intensity: 1.5, color: '#ff5bd9', position: [1.8, 1.6, 1.8] }, fill: { intensity: 0.4, color: '#6170ff' }, rim: { intensity: 1.7, color: '#43efff' }, environment: 0.35 },
    defaults: { exposure: 1.1, shadows: true, backdrop: { kind: 'gradient', color: '#22183A', color2: '#07060C' }, tone: 'aces' },
  },
  {
    id: 'flat',
    label: 'Flat',
    description: 'Shadowless, even light that shows true colour with the least modelling.',
    rig: { ambient: 0.9, key: { intensity: 0.5, color: '#ffffff', position: [0, 2, 3] }, fill: { intensity: 0.5, color: '#ffffff' }, rim: { intensity: 0, color: '#ffffff' }, environment: 0.6 },
    defaults: { exposure: 1, shadows: false, backdrop: { kind: 'solid', color: '#F5F6F8', color2: '#F5F6F8' }, tone: 'neutral' },
  },
];

export const DEFAULT_SCENE: Scene = {
  presetId: 'studio',
  exposure: 1,
  envRotationDeg: 0,
  shadows: true,
  backdrop: { kind: 'gradient', color: '#FFFFFF', color2: '#E3E5EA' },
  fovDeg: 28,
  cameras: [],
};

export function sceneOf(doc: Pick<DesignDocument, 'scene'> | null | undefined): Scene {
  return doc?.scene ?? DEFAULT_SCENE;
}

export function presetOf(scene: Scene): ScenePreset {
  return SCENE_PRESETS.find((p) => p.id === scene.presetId) ?? SCENE_PRESETS[0];
}

/** CSS background for a scene backdrop, used behind the live view and baked into renders. */
export function backdropCss(scene: Scene): string {
  const b = scene.backdrop;
  if (b.kind === 'transparent') return 'repeating-conic-gradient(#e9eaee 0 25%, #ffffff 0 50%) 0 0 / 20px 20px';
  // Image backdrops are drawn by the viewer; the colour shows until the image is ready.
  if (b.kind === 'solid' || b.kind === 'image') return b.color;
  return `radial-gradient(120% 90% at 50% 30%, ${b.color} 0%, ${b.color2} 100%)`;
}

export type MotionKind = NonNullable<Scene['motion']>['kind'];

export const MOTIONS: { id: MotionKind; label: string; description: string }[] = [
  { id: 'still', label: 'Still', description: 'No motion.' },
  { id: 'walk', label: 'Walk', description: 'Worn by an invisible walker: the body bobs and turns with each step, sleeves swing and the hem sways.' },
  { id: 'wind', label: 'Wind', description: 'Gusts ripple through the fabric; shoulders stay put, hems and cuffs move.' },
  { id: 'hanger', label: 'Hanger', description: 'Hangs from the neck and sways gently, turning a little, like on a shop rail.' },
  { id: 'float', label: 'Float', description: 'The garment hovers and turns gently, with a light breeze.' },
  { id: 'knit', label: 'Knit', description: 'The garment knits itself from the hem up, row by row, then holds.' },
];

export function motionOf(scene: Scene): NonNullable<Scene['motion']> {
  return scene.motion ?? { kind: 'still', speed: 1 };
}
