/**
 * A library model's 2D views: the model itself, fitted as the studio wears it (standing, facing
 * front), drawn flat from the front and from the back like a garment flat: soft shading for its
 * folds and seams, a crisp outline round its silhouette. What the 3D model is, exactly, in 2D.
 * Browser only (it draws with WebGL); loaded on demand by the library.
 */
import * as THREE from 'three';
import { getGarment, getSize } from '@/domain/garments';
import { buildGarment } from './garment-geometry';
import { loadGltf } from './garment-glb';
import { fitShell, shellFromScene } from './garment-shell';

/** Square views, this many pixels a side (cards show them small, previews up to half this). */
export const VIEW_PX = 512;
/** Outline thickness, px. */
const OUTLINE_PX = 2;
const INK = '#23262d';

export type ViewSide = 'front' | 'back';

let renderer: THREE.WebGLRenderer | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;

/** One small renderer for every view, released a while after the last one. */
function rendererFor(): THREE.WebGLRenderer {
  clearTimeout(idle);
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(VIEW_PX, VIEW_PX, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
  }
  idle = setTimeout(() => {
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer = null;
  }, 15000);
  return renderer;
}

/** The silhouette of `image` in solid ink, for the outline. */
function silhouette(image: CanvasImageSource, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** A view drawn flat: the render on top of its silhouette stamped round it (the outline). */
function outlined(render: HTMLCanvasElement): Promise<Blob> {
  const out = document.createElement('canvas');
  out.width = out.height = VIEW_PX;
  const ctx = out.getContext('2d')!;
  const ink = silhouette(render, VIEW_PX);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    ctx.drawImage(ink, Math.cos(a) * OUTLINE_PX, Math.sin(a) * OUTLINE_PX);
  }
  ctx.drawImage(render, 0, 0);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('The 2D view could not be drawn.'))), 'image/png'));
}

/**
 * Front and back views of a library model (its GLB bytes), fitted over the style it most likely
 * is. Throws when the model can't be stood up as a garment (the library then shows its style's glyph).
 */
export async function renderModelViews(data: ArrayBuffer, styleId: string): Promise<Record<ViewSide, Blob>> {
  const gltf = await loadGltf(data);
  const shell = shellFromScene(gltf);
  const style = getGarment(styleId);
  const base = buildGarment(style, getSize(style, style.defaultSize), 'low', 0);
  let geometry: THREE.BufferGeometry | null = null;
  const material = new THREE.MeshStandardMaterial({ color: '#f3f3f1', roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  try {
    const fitted = fitShell(shell, base, false);
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(fitted.position, 3));
    geometry.setIndex(new THREE.BufferAttribute(fitted.index, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const half = (Math.max(size.x, size.y) / 2) * 1.08;

    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(geometry, material));
    scene.add(new THREE.HemisphereLight('#ffffff', '#b9bcc4', 1.6));
    const key = new THREE.DirectionalLight('#ffffff', 1.5);
    scene.add(key, key.target);
    key.target.position.copy(center);

    const camera = new THREE.OrthographicCamera(-half, half, half, -half, 1, size.z * 4 + 4000);
    const gl = rendererFor();
    const views = {} as Record<ViewSide, Blob>;
    for (const side of ['front', 'back'] as const) {
      const dir = side === 'front' ? 1 : -1;
      camera.position.set(center.x, center.y, center.z + dir * (size.z + 2000));
      camera.up.set(0, 1, 0);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      // Light from above and to one side of the viewer, so folds and seams read.
      key.position.set(center.x - dir * size.x, center.y + size.y, center.z + dir * (size.z + 2000));
      gl.render(scene, camera);
      const copy = document.createElement('canvas');
      copy.width = copy.height = VIEW_PX;
      copy.getContext('2d')!.drawImage(gl.domElement, 0, 0);
      views[side] = await outlined(copy);
    }
    return views;
  } finally {
    geometry?.dispose();
    material.dispose();
    for (const p of base.parts) p.geometry.dispose();
    for (const t of base.trims) t.geometry.dispose();
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
        m.dispose();
      }
    });
  }
}
