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
 * A clean copy of the garment: outer fabric only (shown on both sides, since other viewers have
 * no inside shell), transforms baked to metres, standing at the origin, no live-view motion.
 */
function exportable(group: THREE.Object3D, forUsdz: boolean) {
  const root = new THREE.Group();
  root.name = 'Garment';
  group.updateWorldMatrix(true, true);
  let n = 0;
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const source = mesh.material as THREE.MeshStandardMaterial;
    if (source.side === THREE.BackSide) return;
    const geometry = mesh.geometry.clone();
    if (geometry.getAttribute('aFree')) geometry.deleteAttribute('aFree');
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
    material.side = THREE.DoubleSide;
    material.onBeforeCompile = () => {};
    const out = new THREE.Mesh(geometry, material);
    out.name = PART_NAMES[mesh.userData.part as string] ?? `Trim ${++n}`;
    out.applyMatrix4(mesh.matrixWorld);
    root.add(out);
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
