/**
 * Garment motion for the live view and video: wind rippling through the fabric, a gentle float,
 * and a knit reveal that builds the garment from the hem up. Every fabric material shares the
 * same uniforms, so the whole garment moves as one, and motion is a pure function of time, so
 * video frames are exact and repeatable.
 *
 * Each vertex carries `aFree` (0 where the garment is held, at the shoulders, collar and
 * waistband; 1 at hems and cuffs), so ripples grow toward the free edges like real cloth.
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
};

/** What the live driver is playing, read by the video recorder so frames match the preview. */
export const motionState: { kind: MotionKind; speed: number; group: THREE.Object3D | null } = { kind: 'still', speed: 1, group: null };

const VERTEX_HEADER = /* glsl */ `
uniform float uTime;
uniform float uWind;
attribute float aFree;
varying float vWovexaY;
float wovexaRipple(vec3 p) {
  return sin(p.y * 0.016 + p.x * 0.006 - uTime * 2.4) * 0.55
       + sin(p.y * 0.031 - p.x * 0.012 + uTime * 1.7 + 1.3) * 0.3
       + sin(p.x * 0.022 + p.z * 0.02 - uTime * 3.3) * 0.15;
}
`;

const FRAGMENT_HEADER = /* glsl */ `
uniform float uReveal;
uniform float uRevealBottom;
uniform float uRevealSpan;
uniform vec3 uThread;
varying float vWovexaY;
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
      }`,
    )
    .replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      if (wovexaAmp > 0.0) transformed += normal * wovexaRipple(position) * wovexaAmp;
      vWovexaY = position.y;`,
    );
  shader.fragmentShader = FRAGMENT_HEADER + shader.fragmentShader;
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

export const MOTION_CACHE_KEY = 'wovexa-motion-1';

/** Set the motion uniforms and the garment's transform for a moment in time. */
export function applyMotion(kind: MotionKind, speed: number, seconds: number, group: THREE.Object3D | null) {
  const t = seconds * speed;
  motionUniforms.uTime.value = t;
  motionUniforms.uWind.value = kind === 'wind' ? 1 : kind === 'float' ? 0.35 : 0;
  if (kind === 'knit') {
    // Knit for 3.2 s, hold the finished garment for 1.8 s, then start again.
    const p = (t % 5) / 3.2;
    motionUniforms.uReveal.value = Math.min(1.04, p * 1.04);
  } else {
    motionUniforms.uReveal.value = 2;
  }
  if (!group) return;
  if (kind === 'float') {
    group.position.y = Math.sin(t * 1.3) * 0.012;
    group.rotation.set(0, Math.sin(t * 0.55) * 0.2, Math.sin(t * 0.9) * 0.015);
  } else {
    group.position.y = 0;
    group.rotation.set(0, 0, 0);
  }
}
