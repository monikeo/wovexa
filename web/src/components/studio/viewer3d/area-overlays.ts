/**
 * Design areas over a fitted shell's plain pieces (a hood, a belt, a collar). Those pieces have no
 * print texture, so the part of an area lying on them is drawn as its own thin mesh: the piece's
 * triangles under the area, textured by where each sits in the area's artwork. It moves with the
 * cloth (same vertices, same motion attributes) and sits just in front of it.
 */
import * as THREE from 'three';
import type { DecalFrame, DecalImage, ProjectedPart } from './projection';

/**
 * The triangles of `source` (the plain piece's displayed geometry) that `projected` selected, as a
 * mesh of their own: every attribute but uv copied, uv the point's place in the area (0..1, v up).
 */
export function overlayGeometry(source: THREE.BufferGeometry, projected: ProjectedPart, frame: DecalFrame): THREE.BufferGeometry | null {
  const index = source.getIndex();
  if (!index || !projected.triangles.length) return null;
  const idx = index.array;
  const remap = new Map<number, number>();
  const order: number[] = [];
  const tris = new Uint32Array(projected.triangles.length * 3);
  let n = 0;
  for (const t of projected.triangles) {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      let j = remap.get(v);
      if (j === undefined) {
        j = order.length;
        remap.set(v, j);
        order.push(v);
      }
      tris[n++] = j;
    }
  }
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(source.attributes)) {
    if (name === 'uv') continue;
    const a = source.getAttribute(name) as THREE.BufferAttribute;
    const size = a.itemSize;
    const out = new Float32Array(order.length * size);
    for (let j = 0; j < order.length; j++) for (let c = 0; c < size; c++) out[j * size + c] = a.array[order[j] * size + c];
    g.setAttribute(name, new THREE.BufferAttribute(out, size, a.normalized));
  }
  const uv = new Float32Array(order.length * 2);
  const d = projected.decal;
  for (let j = 0; j < order.length; j++) {
    const v = order[j];
    uv[j * 2] = d[v * 3] / frame.widthMm;
    uv[j * 2 + 1] = 1 - d[v * 3 + 1] / frame.heightMm;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(tris, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * An area's artwork (or guide) as a texture for overlay meshes. Its outermost pixels are cleared:
 * with clamped edges, cloth just past the area's edge then samples nothing.
 */
export function overlayTexture(image: DecalImage, anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  ctx.clearRect(0, 0, canvas.width, 1);
  ctx.clearRect(0, canvas.height - 1, canvas.width, 1);
  ctx.clearRect(0, 0, 1, canvas.height);
  ctx.clearRect(canvas.width - 1, 0, 1, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}
