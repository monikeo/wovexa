/**
 * The garment as a 3D model for other tools (spec EXP-11): GLB for web viewers, Blender, game
 * engines and Android AR, and USDZ for AR Quick Look on iPhone and iPad. Textures are the
 * current print and fabric at render quality; the model is in metres and stands on the floor.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';

const PART_NAMES: Record<string, string> = {
  torso: 'Body',
  sleeveLeft: 'Left sleeve',
  sleeveRight: 'Right sleeve',
  legLeft: 'Left leg',
  legRight: 'Right leg',
};

/**
 * The same surface facing the other way: triangles wound backwards and normals turned round, so a
 * viewer that draws one side only shows it from the inside. Null for interleaved data it can't turn.
 */
export function turnedInside(geometry: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const g = geometry.clone();
  for (const attr of Object.values(g.attributes)) if (!(attr instanceof THREE.BufferAttribute)) return null;
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.index.needsUpdate = true;
  } else {
    for (const attr of Object.values(g.attributes) as THREE.BufferAttribute[]) {
      const { array, itemSize: k } = attr;
      for (let v = 0; v + 2 < attr.count; v += 3) {
        for (let c = 0; c < k; c++) {
          const a = (v + 1) * k + c;
          const b = (v + 2) * k + c;
          const t = array[a];
          array[a] = array[b];
          array[b] = t;
        }
      }
      attr.needsUpdate = true;
    }
  }
  const normal = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (normal) {
    for (let i = 0; i < normal.array.length; i++) normal.array[i] = -normal.array[i];
    normal.needsUpdate = true;
  }
  return g;
}

/**
 * A clean copy of the garment: the outer fabric facing out and its lining (the inside, in plain
 * fabric colour) facing in, so every viewer shows a real inside rather than the print mirrored,
 * with transforms baked to metres, standing at the origin, and no live-view motion. USDZ has no
 * double-sided materials, so there a double-sided trim also gets a turned copy for its other side.
 */
function exportable(group: THREE.Object3D, forUsdz: boolean) {
  const root = new THREE.Group();
  root.name = 'Garment';
  group.updateWorldMatrix(true, true);
  let n = 0;
  const place = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string, world: THREE.Matrix4) => {
    const out = new THREE.Mesh(geometry, material);
    out.name = name;
    out.applyMatrix4(world);
    root.add(out);
  };
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const source = mesh.material as THREE.MeshStandardMaterial;
    const geometry = mesh.geometry.clone();
    if (geometry.getAttribute('aFree')) geometry.deleteAttribute('aFree');
    if (source.side === THREE.BackSide) {
      // The lining, named after the part beside it.
      const inside = turnedInside(geometry);
      if (!inside) return;
      const part = mesh.parent?.children.find((c) => c.userData.part)?.userData.part as string | undefined;
      const lining = new THREE.MeshStandardMaterial({ color: source.color.clone(), roughness: 1, metalness: 0, vertexColors: source.vertexColors });
      place(inside, lining, `${PART_NAMES[part ?? ''] ?? 'Garment'} inside`, mesh.matrixWorld);
      return;
    }
    const material = (forUsdz ? new THREE.MeshStandardMaterial() : source.clone()) as THREE.MeshStandardMaterial;
    if (forUsdz) {
      material.color.copy(source.color);
      material.map = source.map;
      material.roughness = source.roughness;
      material.metalness = 0;
      material.vertexColors = source.vertexColors;
    }
    // Procedural fabric relief does not travel well between apps; the print and colour do.
    material.normalMap = null;
    material.onBeforeCompile = () => {};
    const twoSided = source.side === THREE.DoubleSide;
    material.side = twoSided && !forUsdz ? THREE.DoubleSide : THREE.FrontSide;
    const name = PART_NAMES[mesh.userData.part as string] ?? `Trim ${++n}`;
    place(geometry, material, name, mesh.matrixWorld);
    if (twoSided && forUsdz) {
      const back = turnedInside(geometry);
      if (back) place(back, material, `${name} back`, mesh.matrixWorld);
    }
  });
  // Stand it on the floor, centred.
  const box = new THREE.Box3().setFromObject(root);
  const centre = box.getCenter(new THREE.Vector3());
  for (const child of root.children) child.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
  return root;
}

export async function exportGlb(group: THREE.Object3D): Promise<Blob> {
  const root = exportable(group, false);
  const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
}

export async function exportUsdz(group: THREE.Object3D): Promise<Blob> {
  const root = exportable(group, true);
  const data = await new USDZExporter().parseAsync(root, { quickLookCompatible: true, maxTextureSize: 2048 });
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'model/vnd.usdz+zip' });
}
