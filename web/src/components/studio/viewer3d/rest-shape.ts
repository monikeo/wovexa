/**
 * The garment at rest, pressed flat with no drape folds, as projection meshes. Projected artwork
 * is placed and painted on this shape: it is printed on the pressed fabric, then folds with it,
 * so the 3D view (any drape) and the cut-and-sew panels (pressed flat) show the same print.
 * Cached per garment, size and mesh detail, since placing artwork and painting reuse it often.
 */
import type * as THREE from 'three';
import type { GarmentModel, GarmentSize, PartId } from '@/domain/garments';
import { buildGarment, type GarmentGeometry, type GarmentLayout } from './garment-geometry';
import type { ProjectionMesh, Vec3 } from './projection';

export type MeshDetail = 'low' | 'high';

export interface RestPart {
  id: PartId;
  mesh: ProjectionMesh;
  /** Bounds of the part, mm, for a quick test of which parts a projection can reach. */
  min: Vec3;
  max: Vec3;
}

/** A fitted shell's plain piece (its hood, belt, collar): no print texture, but cloth design areas can lie on. */
export interface RestTrim {
  key: string;
  mesh: ProjectionMesh;
  min: Vec3;
  max: Vec3;
}

export interface RestShape {
  parts: RestPart[];
  /** A fitted shell's plain pieces: design areas lie on them too (drawn over them), and prints settle onto them. */
  trims?: RestTrim[];
  layout: GarmentLayout;
}

/** Trim keys of a fitted shell's plain pieces (see garment-shell.ts). */
export const SHELL_TRIM_PREFIX = 'shell-';

/** Every piece of cloth at rest, parts first: what prints are settled, dragged and steadied on. */
export function restCloth(rest: RestShape, parts: readonly ProjectionMesh[] = rest.parts.map((p) => p.mesh)): ProjectionMesh[] {
  return rest.trims?.length ? [...parts, ...rest.trims.map((t) => t.mesh)] : [...parts];
}

function meshOf(g: THREE.BufferGeometry): ProjectionMesh {
  return {
    position: g.getAttribute('position').array as Float32Array,
    normal: g.getAttribute('normal')?.array as Float32Array | undefined,
    uv: g.getAttribute('uv').array as Float32Array,
    index: g.getIndex()!.array,
  };
}

function bounds(position: ArrayLike<number>): { min: Vec3; max: Vec3 } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], position[i + k]);
      max[k] = Math.max(max[k], position[i + k]);
    }
  }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

/** The rest shape of a garment built without drape (as the cut-and-sew export builds it). */
export function restFromGeometry(geo: GarmentGeometry): RestShape {
  const trims = geo.trims
    .filter((t) => t.key.startsWith(SHELL_TRIM_PREFIX) && t.geometry.getAttribute('uv') && t.geometry.getIndex())
    .map((t) => {
      const mesh = meshOf(t.geometry);
      return { key: t.key, mesh, ...bounds(mesh.position) };
    });
  return {
    parts: geo.parts.map((p) => {
      const mesh = meshOf(p.geometry);
      return { id: p.id, mesh, ...bounds(mesh.position) };
    }),
    ...(trims.length ? { trims } : {}),
    layout: geo.layout,
  };
}

const cache = new Map<string, RestShape>();

/** The rest shape for a garment, size and detail level (the displayed mesh's, so triangles correspond). */
export function restShape(model: GarmentModel, size: GarmentSize, detail: MeshDetail): RestShape {
  const key = `${model.id}|${model.assetVersion}|${size.code}|${detail}`;
  const hit = cache.get(key);
  if (hit) {
    // Most recently used last.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const geo = buildGarment(model, size, detail, 0);
  const shape = restFromGeometry(geo);
  for (const t of geo.trims) t.geometry.dispose();
  cache.set(key, shape);
  while (cache.size > 4) cache.delete(cache.keys().next().value!);
  return shape;
}

/**
 * The mesh to paint a displayed part with: rest positions and normals (where the print lands on
 * the pressed fabric) with the displayed mesh's texture coordinates (where that fabric is in the
 * texture). Built-in garments come from the same pattern grid at any drape, so their triangles
 * correspond one to one. A custom shape (a reshaped template GLB) has its own mesh: then the
 * rest mesh paints the shared texture layout and the custom mesh picks it up by its UVs.
 */
export function paintMesh(rest: RestPart, display?: THREE.BufferGeometry): ProjectionMesh {
  return display && sameTriangles(rest, display) ? { ...rest.mesh, uv: display.getAttribute('uv').array as Float32Array, index: display.getIndex()!.array } : rest.mesh;
}

/** Whether a displayed part is the rest part's own mesh (same vertices and triangles), draped or not. */
export function sameTriangles(rest: RestPart, display: THREE.BufferGeometry): boolean {
  const uv = display.getAttribute('uv');
  const index = display.getIndex()?.array;
  if (!uv || !index || uv.array.length !== rest.mesh.uv.length || index.length !== rest.mesh.index.length) return false;
  const own = rest.mesh.index;
  for (let i = 0; i < index.length; i++) if (index[i] !== own[i]) return false;
  return true;
}
