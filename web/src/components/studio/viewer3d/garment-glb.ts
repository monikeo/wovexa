/**
 * Smart garment GLB: the bridge between WOVEXA and 3D garment tools (Blender, Clo3D, Marvelous
 * Designer). Each style downloads as a template: one named mesh per pattern part (`torso`,
 * `sleeveLeft`, `sleeveRight`, `legLeft`, `legRight`) whose UVs are WOVEXA's print layout,
 * trims named `trim_<name>`, print areas drawn on, in metres. An artist reshapes it (simulated
 * drape, sculpted folds, a real collar), keeps the part names and UVs, and loads it back: prints,
 * colours, shading, shadows, motion and photoreal renders then follow the new shape.
 *
 * Loading needs no network: Meshopt compression is decoded locally. Draco needs a decoder from
 * a third-party server, so Draco files are refused with a clear message.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { newId } from '@/domain/factory';
import type { GarmentModel, GarmentSize, PartId } from '@/domain/garments';
import { findAssetByHash, putAsset, type StoredAsset } from '@/lib/local-db';
import type { GarmentGeometry, TrimColor, TrimMesh } from './garment-geometry';

export const TEMPLATE_FORMAT = 'wovexa-garment';

/** What a template says about itself, stored in the GLB as extras on the root node. */
export interface TemplateInfo {
  format: typeof TEMPLATE_FORMAT;
  version: 1;
  modelId: string;
  sizeCode: string;
  units: 'metres';
  parts: PartId[];
  note: string;
}

export class ShapeError extends Error {}

const PART_IDS: PartId[] = ['torso', 'sleeveLeft', 'sleeveRight', 'legLeft', 'legRight'];
/** Names WOVEXA's earlier 3D exports use for the same parts. */
const ALIASES: Record<string, PartId> = { body: 'torso', 'left sleeve': 'sleeveLeft', 'right sleeve': 'sleeveRight', 'left leg': 'legLeft', 'right leg': 'legRight' };

/** The pattern part a mesh name refers to: exact, or with a suffix such as Blender's ".001". */
export function partOfName(name: string): PartId | null {
  const lower = name.trim().toLowerCase();
  for (const id of PART_IDS) {
    const l = id.toLowerCase();
    if (lower === l || ['_', '.', ' ', '-'].some((sep) => lower.startsWith(l + sep))) return id;
  }
  return ALIASES[lower] ?? null;
}

/** File units from the garment's height: metres (glTF's unit), centimetres or millimetres. */
export function unitScaleToMm(heightInFileUnits: number): number {
  if (heightInFileUnits < 5) return 1000;
  if (heightInFileUnits < 500) return 10;
  return 1;
}

/** Parts a style needs before a shape can stand in for it. */
export function requiredParts(model: GarmentModel): PartId[] {
  return ['torso', ...(model.sleeve ? (['sleeveLeft', 'sleeveRight'] as PartId[]) : []), ...(model.pants ? (['legLeft', 'legRight'] as PartId[]) : [])];
}

// ---------------------------------------------------------------------------
// Template out
// ---------------------------------------------------------------------------

function copyGeometry(source: THREE.BufferGeometry, names: string[]) {
  const g = new THREE.BufferGeometry();
  for (const name of names) {
    const a = source.getAttribute(name);
    if (a) g.setAttribute(name, a.clone());
  }
  if (source.index) g.setIndex(source.index.clone());
  return g;
}

/**
 * The garment as a template GLB. `guides` are optional part textures (print areas drawn on
 * plain fabric) so the artist can see where prints land while reshaping.
 */
export async function exportGarmentTemplate(geo: GarmentGeometry, model: GarmentModel, size: GarmentSize, guides: Map<PartId, HTMLCanvasElement>): Promise<Blob> {
  const root = new THREE.Group();
  root.name = `${model.id}_${size.code}`;
  const toMetres = new THREE.Matrix4().makeScale(0.001, 0.001, 0.001);
  for (const p of geo.parts) {
    const g = copyGeometry(p.geometry, ['position', 'normal', 'uv']);
    g.applyMatrix4(toMetres);
    const canvas = guides.get(p.id);
    const map = canvas ? new THREE.CanvasTexture(canvas) : null;
    if (map) map.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: `${p.id}_fabric`, map, color: map ? 0xffffff : 0xd9dbe0, roughness: 0.9 }));
    mesh.name = p.id;
    root.add(mesh);
  }
  const trimMaterial = new THREE.MeshStandardMaterial({ name: 'trim', color: 0xc6c9d0, roughness: 0.85 });
  for (const t of geo.trims) {
    const g = copyGeometry(t.geometry, ['position', 'normal', 'uv']);
    g.applyMatrix4(toMetres);
    const mesh = new THREE.Mesh(g, trimMaterial);
    mesh.name = `trim_${t.key}`;
    root.add(mesh);
  }
  const info: TemplateInfo = {
    format: TEMPLATE_FORMAT,
    version: 1,
    modelId: model.id,
    sizeCode: size.code,
    units: 'metres',
    parts: geo.parts.map((p) => p.id),
    note: 'Reshape freely (drape, folds, collar, fit). Keep the part mesh names and their UV maps, so prints still land in the right place. Trims may be replaced; name them trim_<anything>.',
  };
  root.userData = { wovexa: info };
  const result = await new GLTFExporter().parseAsync(root, { binary: true });
  return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
}

// ---------------------------------------------------------------------------
// Shape in
// ---------------------------------------------------------------------------

export interface ParsedShape {
  /** Pattern parts in garment millimetres, indexed, with normals and WOVEXA UVs. */
  parts: Map<PartId, THREE.BufferGeometry>;
  trims: { key: string; geometry: THREE.BufferGeometry }[];
  info: Partial<TemplateInfo>;
}

function findInfo(root: THREE.Object3D): Partial<TemplateInfo> {
  let info: Partial<TemplateInfo> = {};
  root.traverse((o) => {
    const w = (o.userData as { wovexa?: Partial<TemplateInfo> }).wovexa;
    if (w && w.format === TEMPLATE_FORMAT) info = w;
  });
  return info;
}

/** Read a garment GLB and check it can stand in for `model`. Throws ShapeError with what to fix. */
export async function parseGarmentShape(data: ArrayBuffer, model: GarmentModel): Promise<ParsedShape> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let gltf: Awaited<ReturnType<GLTFLoader['parseAsync']>>;
  try {
    gltf = await loader.parseAsync(data, '');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/draco/i.test(message)) throw new ShapeError('This file uses Draco compression. Export it again uncompressed or with Meshopt compression.');
    throw new ShapeError(`This file couldn’t be read as a GLB (${message}).`);
  }
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const info = findInfo(scene);

  const pieces = new Map<PartId, THREE.BufferGeometry[]>();
  const trims: { key: string; geometry: THREE.BufferGeometry }[] = [];
  const bounds = new THREE.Box3();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = mesh.name || mesh.parent?.name || '';
    const part = partOfName(name);
    const g = copyGeometry(mesh.geometry, part ? ['position', 'normal', 'uv'] : ['position', 'normal']);
    g.applyMatrix4(mesh.matrixWorld);
    g.computeBoundingBox();
    if (g.boundingBox) bounds.union(g.boundingBox);
    if (part) pieces.set(part, [...(pieces.get(part) ?? []), g]);
    else trims.push({ key: name.replace(/^trim[_ -]?/i, '').slice(0, 40) || `trim${trims.length + 1}`, geometry: g });
  });

  if (!pieces.size) throw new ShapeError('No garment parts found. Name the meshes as in the template: torso, sleeveLeft, sleeveRight (and legLeft, legRight for uniforms).');
  const missing = requiredParts(model).filter((p) => !pieces.has(p));
  if (missing.length) throw new ShapeError(`This shape is missing ${missing.join(', ')} for the ${model.name.toLowerCase()}. Start from this style’s template and keep its part names.`);
  if (info.modelId && info.modelId !== model.id) throw new ShapeError(`This shape was made from the ${info.modelId} template. Choose that style first, or start from this style’s template.`);

  const toMm = unitScaleToMm(bounds.max.y - bounds.min.y);
  const scale = new THREE.Matrix4().makeScale(toMm, toMm, toMm);
  const parts = new Map<PartId, THREE.BufferGeometry>();
  for (const [part, list] of pieces) {
    if (list.some((g) => !g.getAttribute('uv'))) throw new ShapeError(`The ${part} mesh has no UV map. Keep the template’s UVs so prints land in the right place.`);
    for (const g of list) if (!g.getAttribute('normal')) g.computeVertexNormals();
    let g = list.length > 1 ? mergeGeometries(list, false) : list[0];
    if (!g) throw new ShapeError(`The ${part} pieces couldn’t be joined. Give them the same attributes (positions, normals, UVs).`);
    g.applyMatrix4(scale);
    if (!g.index) g = mergeVertices(g);
    parts.set(part, g);
  }
  for (const t of trims) {
    t.geometry.applyMatrix4(scale);
    if (!t.geometry.getAttribute('normal')) t.geometry.computeVertexNormals();
  }
  return { parts, trims, info };
}

export const MAX_SHAPE_BYTES = 80 * 1048576;

/**
 * Check a GLB the person chose, keep it on this device, and say how to use it. The size it was
 * made at comes from the template's own record when it has one, else the size on show now.
 */
export async function importGarmentShape(file: File, model: GarmentModel, sizeCode: string) {
  if (file.size > MAX_SHAPE_BYTES) throw new ShapeError(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB. The limit is 80 MB: compress it with Meshopt first (gltf-transform).`);
  const data = await file.arrayBuffer();
  if (data.byteLength < 12 || new DataView(data).getUint32(0, true) !== 0x46546c67) throw new ShapeError(`${file.name} isn’t a binary glTF (.glb) file.`);
  const shape = await parseGarmentShape(data, model);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  let asset: StoredAsset | undefined = await findAssetByHash(sha256);
  if (!asset) {
    asset = { id: newId(), name: file.name.slice(0, 120), mime: 'model/gltf-binary', width: 0, height: 0, bytes: data.byteLength, sha256, blob: new Blob([data], { type: 'model/gltf-binary' }), createdAt: Date.now() };
    await putAsset(asset);
  }
  const madeAt = shape.info.sizeCode && model.sizes.some((s) => s.code === shape.info.sizeCode) ? shape.info.sizeCode : sizeCode;
  return { assetId: asset.id, name: file.name.replace(/\.glb$/i, '').slice(0, 120) || 'Custom shape', modelId: model.id, sizeCode: madeAt };
}

const shapeCache = new Map<string, Promise<ParsedShape>>();

/** Parse a stored shape once per asset. */
export function cachedShape(assetId: string, read: () => Promise<ArrayBuffer>, model: GarmentModel): Promise<ParsedShape> {
  const key = `${assetId}:${model.id}`;
  let pending = shapeCache.get(key);
  if (!pending) {
    pending = read().then((data) => parseGarmentShape(data, model));
    pending.catch(() => shapeCache.delete(key));
    shapeCache.set(key, pending);
  }
  return pending;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function trimLook(key: string): { color: TrimColor; surface: TrimMesh['surface'] } {
  const k = key.toLowerCase();
  if (/belt/.test(k)) return { color: 'belt', surface: 'rib' };
  if (/button|zip|snap/.test(k)) return { color: 'button', surface: 'plastic' };
  if (/collar|rib|cuff|band|binding|trim|neck|placket|cord/.test(k)) return { color: 'collar', surface: 'rib' };
  if (/sleeve/.test(k)) return { color: 'sleeves', surface: 'jersey' };
  if (/pant|leg|trouser/.test(k)) return { color: 'pants', surface: 'jersey' };
  return { color: 'body', surface: 'jersey' };
}

/**
 * The live garment with a custom shape in place of the built-in parts. Texture layout, print
 * zones, pattern pieces and size grading come from `base`; the shape is scaled by `fit` (the
 * chosen size against the size the template was made at). Motion weights come from the UVs.
 */
export function shapedGarment(base: GarmentGeometry, shape: ParsedShape, fit: { width: number; length: number }): GarmentGeometry {
  const sizeIt = new THREE.Matrix4().makeScale(fit.width, fit.length, fit.width);
  const parts: GarmentGeometry['parts'] = [];
  const limbPivots: GarmentGeometry['limbPivots'] = {};
  for (const bp of base.parts) {
    const source = shape.parts.get(bp.id);
    if (!source) {
      parts.push({ id: bp.id, geometry: bp.geometry.clone() });
      continue;
    }
    const g = source.clone();
    g.applyMatrix4(sizeIt);
    const uv = g.getAttribute('uv');
    const pos = g.getAttribute('position');
    const n = pos.count;
    const free = new Float32Array(n);
    const limb = new Float32Array(n * 2);
    const limbId = ({ sleeveLeft: 1, sleeveRight: 2, legLeft: 3, legRight: 4 } as Partial<Record<PartId, number>>)[bp.id] ?? 0;
    const pivot = [0, 0, 0];
    let pivotCount = 0;
    for (let i = 0; i < n; i++) {
      const v = uv.getY(i);
      // WOVEXA's layout: torso v is height over body length; sleeves and legs run v from 1 at the seam to 0 at the end.
      free[i] = bp.id === 'torso' ? clamp01(1 - v / 0.64) ** 1.4 : clamp01(1 - v) ** 1.5;
      if (limbId) {
        limb[i * 2] = limbId;
        limb[i * 2 + 1] = clamp01(1 - v) ** 1.1;
        if (v > 0.97) {
          pivot[0] += pos.getX(i);
          pivot[1] += pos.getY(i);
          pivot[2] += pos.getZ(i);
          pivotCount++;
        }
      }
    }
    g.setAttribute('aFree', new THREE.BufferAttribute(free, 1));
    if (limbId) {
      g.setAttribute('aLimb', new THREE.BufferAttribute(limb, 2));
      if (pivotCount) limbPivots[limbId as 1 | 2 | 3 | 4] = [pivot[0] / pivotCount, pivot[1] / pivotCount, pivot[2] / pivotCount];
    }
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    parts.push({ id: bp.id, geometry: g });
  }
  const torso = parts.find((p) => p.id === 'torso')?.geometry;
  torso?.computeBoundingBox();
  const hem = torso?.boundingBox?.min.y ?? 0;
  const top = torso?.boundingBox?.max.y ?? base.layout.torsoHeightMm;
  const trims: TrimMesh[] = shape.trims.map((t, i) => {
    const g = t.geometry.clone();
    g.applyMatrix4(sizeIt);
    const pos = g.getAttribute('position');
    const free = new Float32Array(pos.count);
    for (let k = 0; k < pos.count; k++) free[k] = clamp01(1 - (pos.getY(k) - hem) / Math.max(1, (top - hem) * 0.64)) ** 1.4;
    g.setAttribute('aFree', new THREE.BufferAttribute(free, 1));
    return { key: `shape-${i}-${t.key}`, geometry: g, ...trimLook(t.key) };
  });

  // Frame the stage on the shape itself.
  const span = new THREE.Box3();
  for (const g of [...parts.map((p) => p.geometry), ...trims.map((t) => t.geometry)]) {
    g.computeBoundingBox();
    if (g.boundingBox) span.union(g.boundingBox);
  }
  return {
    ...base,
    parts,
    trims,
    limbPivots,
    layout: {
      ...base.layout,
      heightMm: span.isEmpty() ? base.layout.heightMm : span.max.y - span.min.y,
      widthMm: span.isEmpty() ? base.layout.widthMm : span.max.x - span.min.x,
      bottomMm: span.isEmpty() ? base.layout.bottomMm : span.min.y,
    },
  };
}
