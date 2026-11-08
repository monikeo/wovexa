/**
 * Garment motion for the live view and video: an invisible walker, wind in gusts, a hanger
 * sway, a gentle float, and a knit reveal that builds the garment from the hem up. Every fabric
 * material shares the same uniforms, so the whole garment moves as one, and motion is a pure
 * function of time, so video frames are exact and repeatable.
 *
 * Each vertex carries `aFree` (0 where the garment is held, at the shoulders, collar and
 * waistband; 1 at hems and cuffs), so ripples grow toward the free edges like real cloth.
 * Sleeves and legs also carry `aLimb` (which limb, and how far along it), so they swing from
 * the shoulder or hip, bending smoothly from the seam.
 */
import * as THREE from 'three';
import type { MotionKind } from '@/domain/scene';

export const motionUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0 },
  /** Knit progress, 0 (nothing) to 1 (finished); above 1.5 the reveal is off. */
  uReveal: { value: 2 },
  uRevealBottom: { value: 0 },
  uRevealSpan: { value: 1 },
  uThread: { value: new THREE.Color('#ffffff') },
  /** Swing pivots in garment millimetres, and swing angles in radians: left and right sleeve, left and right leg. */
  uLimbPivot: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
  uLimbSwing: { value: [0, 0, 0, 0] },
};

/** What the live driver is playing, read by the video recorder so frames match the preview. */
export const motionState: { kind: MotionKind; speed: number; group: THREE.Object3D | null; neckY: number } = { kind: 'still', speed: 1, group: null, neckY: 0 };

/** Where each sleeve and leg swings from, for the garment now on show. */
export function setLimbPivots(pivots: Partial<Record<1 | 2 | 3 | 4, [number, number, number]>>) {
  motionUniforms.uLimbPivot.value.forEach((v, i) => v.fromArray(pivots[(i + 1) as 1 | 2 | 3 | 4] ?? [0, 0, 0]));
}

const VERTEX_HEADER = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform vec3 uLimbPivot[4];
uniform float uLimbSwing[4];
attribute float aFree;
attribute vec2 aLimb;
varying float vWovexaY;
varying vec3 vWovexaPos;
float wovexaRipple(vec3 p) {
  return sin(p.y * 0.016 + p.x * 0.006 - uTime * 2.4) * 0.55
       + sin(p.y * 0.031 - p.x * 0.012 + uTime * 1.7 + 1.3) * 0.3
       + sin(p.x * 0.022 + p.z * 0.02 - uTime * 3.3) * 0.15;
}
int wovexaLimb() {
  int limb = int(aLimb.x + 0.5) - 1;
  return limb >= 0 && limb < 4 ? limb : -1;
}
vec3 wovexaRotX(vec3 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}
`;

const FRAGMENT_HEADER = /* glsl */ `
uniform float uReveal;
uniform float uRevealBottom;
uniform float uRevealSpan;
uniform vec3 uThread;
varying float vWovexaY;
varying vec3 vWovexaPos;
float wovexaHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float wovexaNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(wovexaHash(i), wovexaHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(wovexaHash(i + vec3(0.0, 1.0, 0.0)), wovexaHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(wovexaHash(i + vec3(0.0, 0.0, 1.0)), wovexaHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(wovexaHash(i + vec3(0.0, 1.0, 1.0)), wovexaHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
`;

/** Add wind and knit to a three.js standard or physical material. */
export function patchMotion(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, motionUniforms);
  shader.vertexShader = VERTEX_HEADER + shader.vertexShader;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <beginnormal_vertex>',
      /* glsl */ `#include <beginnormal_vertex>
      // Ripple amplitude in millimetres, scaled by how free this part of the garment is.
      float wovexaAmp = uWind * aFree * 11.0;
      if (wovexaAmp > 0.0) {
        float e = 6.0;
        float r0 = wovexaRipple(position);
        vec3 grad = vec3(
          wovexaRipple(position + vec3(e, 0.0, 0.0)) - r0,
          wovexaRipple(position + vec3(0.0, e, 0.0)) - r0,
          wovexaRipple(position + vec3(0.0, 0.0, e)) - r0) / e * wovexaAmp;
        objectNormal = normalize(objectNormal - (grad - dot(grad, objectNormal) * objectNormal));
      }
      // A swinging sleeve or leg turns about the shoulder or hip, more toward the cuff or hem.
      int wovexaLimbIndex = wovexaLimb();
      float wovexaSwing = wovexaLimbIndex >= 0 ? uLimbSwing[wovexaLimbIndex] * aLimb.y : 0.0;
      if (wovexaSwing != 0.0) objectNormal = wovexaRotX(objectNormal, wovexaSwing);`,
    )
    .replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      if (wovexaAmp > 0.0) transformed += normal * wovexaRipple(position) * wovexaAmp;
      if (wovexaSwing != 0.0) {
        vec3 wovexaPivot = uLimbPivot[wovexaLimbIndex];
        transformed = wovexaPivot + wovexaRotX(transformed - wovexaPivot, wovexaSwing);
      }
      vWovexaY = position.y;
      vWovexaPos = position;`,
    );
  shader.fragmentShader = FRAGMENT_HEADER + shader.fragmentShader;
  // Cotton is never perfectly even: a faint, slow variation in the dye, as real fabric has.
  // Printed ink (where the surface map has height) stays even.
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <color_fragment>',
    /* glsl */ `#include <color_fragment>
      float wovexaMottle = wovexaNoise(vWovexaPos * 0.018) * 0.65 + wovexaNoise(vWovexaPos * 0.061 + 7.3) * 0.35;
      float wovexaInk = 0.0;
      #ifdef USE_BUMPMAP
        wovexaInk = step(0.004, texture2D(bumpMap, vBumpMapUv).r);
      #endif
      diffuseColor.rgb *= 1.0 + (wovexaMottle - 0.5) * 0.06 * (1.0 - wovexaInk);`,
  );
  // three.js uses a normal map or a bump map, never both. Fabric needs both: the knit as a tiled
  // normal map and printed relief (puff, embroidery, plastisol) as a bump map over it.
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    /* glsl */ `#include <normal_fragment_maps>
      #if defined( USE_NORMALMAP_TANGENTSPACE ) && defined( USE_BUMPMAP )
        normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
      #endif`,
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <dithering_fragment>',
    /* glsl */ `if (uReveal < 1.5) {
        float level = (vWovexaY - uRevealBottom) / uRevealSpan;
        float edge = uReveal - level;
        if (edge < 0.0) discard;
        // The newest row glows like fresh yarn, with stitch texture along it.
        float row = 1.0 - smoothstep(0.0, 0.022, edge);
        float stitch = 0.6 + 0.4 * sin(vWovexaY * 1.4);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uThread, row * stitch * 0.85);
      }
      #include <dithering_fragment>`,
  );
}

export const MOTION_CACHE_KEY = 'wovexa-motion-4';

/**
 * The same motion for casting shadows (three draws shadow maps with a depth material of its
 * own), so a swinging sleeve's shadow swings with it and wind ripples ripple their shadow.
 */
export function patchMotionDepth(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, motionUniforms);
  shader.vertexShader =
    VERTEX_HEADER +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      float wovexaAmp = uWind * aFree * 11.0;
      if (wovexaAmp > 0.0) transformed += normal * wovexaRipple(position) * wovexaAmp;
      int wovexaLimbIndex = wovexaLimb();
      float wovexaSwing = wovexaLimbIndex >= 0 ? uLimbSwing[wovexaLimbIndex] * aLimb.y : 0.0;
      if (wovexaSwing != 0.0) {
        vec3 wovexaPivot = uLimbPivot[wovexaLimbIndex];
        transformed = wovexaPivot + wovexaRotX(transformed - wovexaPivot, wovexaSwing);
      }
      vWovexaY = position.y;
      vWovexaPos = position;`,
    );
}

/** One shadow-casting depth material for every garment mesh: the motion uniforms are shared. */
export const motionDepthMaterial = new THREE.MeshDepthMaterial();
motionDepthMaterial.onBeforeCompile = patchMotionDepth;
motionDepthMaterial.customProgramCacheKey = () => 'wovexa-motion-depth-1';

/** One stride (a step with each foot) every this many seconds at speed 1: an easy walk. */
const STRIDE_S = 1.15;
const neck = new THREE.Vector3();

/** Set the motion uniforms and the garment's transform for a moment in time. */
export function applyMotion(kind: MotionKind, speed: number, seconds: number, group: THREE.Object3D | null) {
  const t = seconds * speed;
  const swing = motionUniforms.uLimbSwing.value;
  swing.fill(0);
  motionUniforms.uTime.value = t;
  let wind = 0;
  if (kind === 'wind') {
    // Gusts: the breeze rises and falls on two slow, unrelated rhythms, so it never feels looped.
    wind = 0.6 + 0.4 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
  } else if (kind === 'float') {
    wind = 0.35;
  } else if (kind === 'walk') {
    wind = 0.3;
    const p = (t * 2 * Math.PI) / STRIDE_S;
    // Arms swing against the legs: the left sleeve moves with the right leg.
    swing[0] = 0.3 * Math.sin(p);
    swing[1] = -0.3 * Math.sin(p);
    swing[2] = -0.34 * Math.sin(p);
    swing[3] = 0.34 * Math.sin(p);
  } else if (kind === 'hanger') {
    wind = 0.22;
  }
  motionUniforms.uWind.value = wind;
  if (kind === 'knit') {
    // Knit for 3.2 s, hold the finished garment for 1.8 s, then start again.
    const p = (t % 5) / 3.2;
    motionUniforms.uReveal.value = Math.min(1.04, p * 1.04);
  } else {
    motionUniforms.uReveal.value = 2;
  }
  if (!group) return;
  group.position.set(0, 0, 0);
  group.rotation.set(0, 0, 0);
  if (kind === 'float') {
    group.position.y = Math.sin(t * 1.3) * 0.012;
    group.rotation.set(0, Math.sin(t * 0.55) * 0.2, Math.sin(t * 0.9) * 0.015);
  } else if (kind === 'walk') {
    const p = (t * 2 * Math.PI) / STRIDE_S;
    // The body rises over each step (twice a stride), turns with the hips and rocks side to side.
    group.position.y = 0.007 * (0.5 - 0.5 * Math.cos(2 * p)) - 0.0035;
    group.rotation.set(0.015, 0.07 * Math.sin(p), 0.02 * Math.sin(p));
  } else if (kind === 'hanger') {
    // A slow pendulum from the neck with a little turn, as if just hung on a rail.
    group.rotation.set(0, 0.16 * Math.sin(t * 0.45), 0.035 * Math.sin(t * 1.25) + 0.01 * Math.sin(t * 2.9 + 0.7));
    neck.set(0, motionState.neckY, 0).applyEuler(group.rotation);
    group.position.set(-neck.x, motionState.neckY - neck.y, -neck.z);
  }
}
