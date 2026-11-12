/**
 * Ambient occlusion baked from the garment's real shape on the GPU, the way apparel 3D tools
 * bake it in Blender, but on the fly for every style, size and drape: the soft darkening at the
 * collar, under the arms, between folds and inside the garment that makes cloth read as real.
 *
 * The garment is seen from many directions around it (one depth map each, packed into an atlas).
 * Then every vertex checks which of those directions can see it, weighted by how squarely it
 * faces them. The inside is checked with normals flipped, so it is dark deep inside and lighter
 * near the neck, hem and cuffs, like real cloth. Runs in tens of milliseconds, once per shape.
 */
import * as THREE from 'three';

export interface AoTarget {
  geometry: THREE.BufferGeometry;
  /** Where the result goes: a colour attribute on this geometry (often the same one). */
  out: THREE.BufferGeometry;
  /** Bake for the inside face (normals flipped). */
  inside?: boolean;
  /** Map the raw visibility (0 hidden, 1 open sky) to a shade, so nothing goes fully black. */
  floor: number;
  /**
   * Passes of averaging each vertex with its neighbours afterwards. The bake samples a few dozen
   * directions per vertex, so neighbours can differ by a step; on a large, dim surface (the
   * inside of the body seen through the neck) those steps read as facets.
   */
  smooth?: number;
}

/**
 * Average each vertex's value with its mesh neighbours, `passes` times, in place. Vertices that
 * share no triangle are left alone, so separate panels stay separate.
 */
export function smoothVertexValues(values: Float32Array, index: ArrayLike<number> | null, passes: number) {
  if (!index || passes <= 0) return values;
  const n = values.length;
  // Neighbour lists as offsets into one array (compressed sparse rows).
  const degree = new Uint32Array(n + 1);
  for (let t = 0; t + 2 < index.length; t += 3) {
    degree[index[t]] += 2;
    degree[index[t + 1]] += 2;
    degree[index[t + 2]] += 2;
  }
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + degree[i];
  const fill = start.slice(0, n);
  const near = new Uint32Array(start[n]);
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    near[fill[a]++] = b;
    near[fill[a]++] = c;
    near[fill[b]++] = a;
    near[fill[b]++] = c;
    near[fill[c]++] = a;
    near[fill[c]++] = b;
  }
  let from: Float32Array = values;
  let to: Float32Array = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const s = start[i];
      const e = start[i + 1];
      if (e === s) {
        to[i] = from[i];
        continue;
      }
      let sum = 0;
      for (let k = s; k < e; k++) sum += from[near[k]];
      // Half its own value, half its neighbours': soft, without washing the shading out.
      to[i] = 0.5 * from[i] + (0.5 * sum) / (e - s);
    }
    [from, to] = [to, from];
  }
  if (from !== values) values.set(from);
  return values;
}

function sphereDirections(n: number) {
  const out: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push(new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r));
  }
  return out;
}

/** The view basis three's lookAt builds for a camera on direction d, mirrored in the shader. */
const reference = (d: THREE.Vector3) => (Math.abs(d.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));

const vertexShader = /* glsl */ `
uniform float uOffset;
uniform vec2 uSize;
uniform float uFlip;
out vec3 vPos;
out vec3 vNormal;
void main() {
  float i = float(gl_VertexID) + uOffset;
  vec2 px = vec2(mod(i, uSize.x), floor(i / uSize.x)) + 0.5;
  gl_Position = vec4(px / uSize * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  vPos = position;
  vNormal = normalize(normal) * uFlip;
}`;

const fragmentShader = (dirs: number) => /* glsl */ `
#include <packing>
uniform sampler2D uAtlas;
uniform vec3 uDirs[${dirs}];
uniform vec3 uCenter;
uniform float uRadius;
uniform float uTiles;
uniform float uLift;
uniform float uSlack;
in vec3 vPos;
in vec3 vNormal;
out vec4 outColor;
void main() {
  float seen = 0.0;
  float total = 0.0;
  // Step off the surface so a point never hides itself.
  vec3 q = vPos + vNormal * uLift - uCenter;
  for (int k = 0; k < ${dirs}; k++) {
    vec3 d = uDirs[k];
    float w = dot(vNormal, d);
    if (w <= 0.0) continue;
    vec3 ref = abs(d.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(ref, d));
    vec3 up = cross(d, right);
    vec2 uv = vec2(dot(q, right), dot(q, up)) / uRadius * 0.5 + 0.5;
    float depth = (2.0 * uRadius - dot(q, d)) / (4.0 * uRadius);
    vec2 tile = vec2(mod(float(k), uTiles), floor(float(k) / uTiles));
    float nearest = unpackRGBAToDepth(texture(uAtlas, (tile + clamp(uv, 0.001, 0.999)) / uTiles));
    total += w;
    if (depth <= nearest + uSlack) seen += w;
  }
  outColor = vec4(total > 0.0 ? seen / total : 1.0, 0.0, 0.0, 1.0);
}`;

/**
 * Bake ambient occlusion for `targets`, with every geometry in `occluders` able to cast it.
 * All geometry must share one coordinate space. Writes a `color` attribute on each target's
 * `out` geometry. Returns false if this device can't (nothing is changed then).
 */
export function bakeAmbientOcclusion(renderer: THREE.WebGLRenderer, occluders: THREE.BufferGeometry[], targets: AoTarget[], quality: 'low' | 'high' = 'high'): boolean {
  if (!renderer.capabilities.isWebGL2 || !targets.length) return false;
  const dirs = quality === 'high' ? 64 : 36;
  const tiles = Math.ceil(Math.sqrt(dirs));
  const tile = Math.min(quality === 'high' ? 256 : 160, Math.floor(renderer.capabilities.maxTextureSize / tiles));

  // Bounds of everything that can cast occlusion, with a margin so nothing touches a tile edge.
  const box = new THREE.Box3();
  for (const g of occluders) {
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
  }
  if (box.isEmpty()) return false;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;
  const R = sphere.radius * 1.04;
  const texel = (2 * R) / tile;

  const prev = {
    target: renderer.getRenderTarget(),
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
  };
  const atlas = new THREE.WebGLRenderTarget(tile * tiles, tile * tiles, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: true });
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  const depthScene = new THREE.Scene();
  for (const g of occluders) depthScene.add(new THREE.Mesh(g, depthMaterial));
  depthScene.matrixWorldAutoUpdate = true;

  const count = targets.reduce((n, t) => n + t.geometry.getAttribute('position').count, 0);
  const W = 1024;
  const H = Math.max(1, Math.ceil(count / W));
  const result = new THREE.WebGLRenderTarget(W, H, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: false });
  const directions = sphereDirections(dirs);
  const bake = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader: fragmentShader(dirs),
    uniforms: {
      uAtlas: { value: atlas.texture },
      uDirs: { value: directions },
      uCenter: { value: center },
      uRadius: { value: R },
      uTiles: { value: tiles },
      uOffset: { value: 0 },
      uSize: { value: new THREE.Vector2(W, H) },
      uFlip: { value: 1 },
      uLift: { value: Math.max(3, texel * 1.2) },
      // Depth tolerance of about a texel and a half, as a share of the depth range.
      uSlack: { value: (texel * 1.5) / (4 * R) },
    },
  });
  const pointsScene = new THREE.Scene();
  const disposables: { dispose: () => void }[] = [atlas, result, depthMaterial, bake];
  try {
    // 1. A depth map from each direction, into its tile of the atlas.
    renderer.autoClear = false;
    renderer.setClearColor(0xffffff, 1);
    renderer.setRenderTarget(atlas);
    renderer.clear(true, true, false);
    const camera = new THREE.OrthographicCamera(-R, R, R, -R, 0, 4 * R);
    directions.forEach((d, k) => {
      const tx = k % tiles;
      const ty = Math.floor(k / tiles);
      atlas.viewport.set(tx * tile, ty * tile, tile, tile);
      atlas.scissor.set(tx * tile, ty * tile, tile, tile);
      atlas.scissorTest = true;
      renderer.setRenderTarget(atlas);
      renderer.clear(false, true, false);
      camera.position.copy(center).addScaledVector(d, 2 * R);
      camera.up.copy(reference(d));
      camera.lookAt(center);
      camera.updateMatrixWorld();
      renderer.render(depthScene, camera);
    });
    atlas.scissorTest = false;
    atlas.viewport.set(0, 0, tile * tiles, tile * tiles);

    // 2. Every vertex tests itself against every direction, one pixel per vertex.
    renderer.setRenderTarget(result);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, false, false);
    const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    let offset = 0;
    for (const t of targets) {
      const points = new THREE.BufferGeometry();
      points.setAttribute('position', t.geometry.getAttribute('position'));
      points.setAttribute('normal', t.geometry.getAttribute('normal'));
      // One material for every target: uniforms are uploaded at each render.
      bake.uniforms.uOffset.value = offset;
      bake.uniforms.uFlip.value = t.inside ? -1 : 1;
      const obj = new THREE.Points(points, bake);
      obj.frustumCulled = false;
      pointsScene.add(obj);
      renderer.render(pointsScene, flat);
      pointsScene.remove(obj);
      disposables.push({ dispose: () => points.dispose() });
      offset += t.geometry.getAttribute('position').count;
    }

    // 3. Read the result back into each target's vertex colours.
    const pixels = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(result, 0, 0, W, H, pixels);
    offset = 0;
    for (const t of targets) {
      const n = t.geometry.getAttribute('position').count;
      const seen = new Float32Array(n);
      for (let i = 0; i < n; i++) seen[i] = pixels[(offset + i) * 4] / 255;
      smoothVertexValues(seen, t.geometry.getIndex()?.array ?? null, t.smooth ?? 0);
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const shade = t.floor + (1 - t.floor) * seen[i];
        colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade;
      }
      t.out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      offset += n;
    }
    return true;
  } finally {
    renderer.setRenderTarget(prev.target);
    renderer.setClearColor(prev.clearColor, prev.clearAlpha);
    renderer.autoClear = prev.autoClear;
    for (const d of disposables) d.dispose();
  }
}
