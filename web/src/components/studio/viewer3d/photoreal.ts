/**
 * Photoreal rendering: the scene path traced on the GPU (three-gpu-pathtracer), with light that
 * bounces, soft shadows from studio softboxes, fabric sheen, raised ink and optional depth of
 * field, then cleaned by an edge-aware denoiser. One engine serves two uses:
 *
 * - stills (`pathTrace`): offscreen at any size, tiled so large images stay within GPU memory;
 * - the live view (`liveTrace`): with Photoreal view on, the viewport refines into a path-traced
 *   image whenever it is left still, and drops back to real time on any interaction.
 *
 * Path tracing reads standard three.js materials. While it runs, the viewer makes a few changes
 * that only a physical renderer needs and undoes them after: softbox lights (`softStudioLights`),
 * a lining with real thickness (`insetGeometry`) and ink as its own raised layer (`inkDecals`).
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export interface PhotorealOptions {
  /** Samples per pixel: more is cleaner and slower. */
  samples: number;
  /** Edge-aware smoothing of the remaining grain (on unless false). */
  denoise?: boolean;
  /** Depth of field: aperture as an f-number, focused `distance` metres from the camera. */
  focus?: { fStop: number; distance: number };
  /** 0–1 while rendering. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

type Module = typeof import('three-gpu-pathtracer');
type Tracer = InstanceType<Module['WebGLPathTracer']> & { readonly isCompiling?: boolean };
interface Engine {
  renderer: THREE.WebGLRenderer;
  mod: Module;
  pt: Tracer;
  denoise: FullScreenQuad;
}

let engine: Engine | null = null;
let pending: Promise<Engine> | null = null;

const LOST = 'The graphics card stopped during the photoreal render. Try fewer samples or a smaller size.';

/** Why this device can't path trace, or null when it can. */
export function photorealSupport(renderer: THREE.WebGLRenderer): string | null {
  if (!renderer.capabilities.isWebGL2) return 'Photoreal rendering needs WebGL 2, which this browser doesn’t offer.';
  if (!renderer.extensions.has('EXT_color_buffer_float')) return 'This graphics card can’t store the high-precision light that photoreal rendering needs.';
  return null;
}

function getEngine(renderer: THREE.WebGLRenderer): Promise<Engine> {
  if (engine?.renderer === renderer) return Promise.resolve(engine);
  pending ??= (async () => {
    disposePhotoreal();
    // three-gpu-pathtracer 0.0.27 includes a shader chunk that three r187 no longer ships. The
    // shaders this app uses (cube-to-equirect conversion) include it without calling into it,
    // so an empty chunk lets them compile.
    const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
    chunks.cube_uv_reflection_fragment ??= '';
    const mod = await import('three-gpu-pathtracer');
    // The WebGL tracer announces its WebGPU successor on creation; this app renders with WebGL.
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (!(typeof args[0] === 'string' && args[0].startsWith('WebGLPathTracer:'))) warn(...args);
    };
    let pt: Tracer;
    try {
      pt = new mod.WebGLPathTracer(renderer);
    } finally {
      console.warn = warn;
    }
    // Frames are presented here, not by the tracer, and nothing fades or waits.
    pt.renderToCanvas = false;
    pt.rasterizeScene = false;
    pt.renderDelay = 0;
    pt.minSamples = 0;
    pt.fadeDuration = 0;
    pt.dynamicLowRes = false;
    pt.renderScale = 1;
    pt.bounces = 6;
    // Tames fireflies from glossy foil and vinyl without dulling them.
    pt.filterGlossyFactor = 0.5;
    pt.multipleImportanceSampling = true;
    // Every texture is resampled to this size; prints are the point, so keep them sharp where memory allows.
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const side = renderer.capabilities.maxTextureSize >= 4096 && memory >= 8 ? 2048 : 1024;
    pt.textureSize.set(side, side);

    const material = new mod.DenoiseMaterial({ sigma: 2, kSigma: 1.5, threshold: 0.1, premultipliedAlpha: renderer.getContextAttributes()?.premultipliedAlpha !== false });
    // The filter averages premultiplied colour. Return to straight alpha before tone mapping, so
    // the garment's edges over a transparent background keep their true colour.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = smartDeNoise( map, vec2( vUv.x, vUv.y ), sigma, kSigma, threshold );',
        'gl_FragColor = smartDeNoise( map, vec2( vUv.x, vUv.y ), sigma, kSigma, threshold );\n\t\t\t\t\tif ( gl_FragColor.a > 0.0 ) gl_FragColor.rgb /= gl_FragColor.a;',
      );
    };
    engine = { renderer, mod, pt, denoise: new FullScreenQuad(material) };
    return engine;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export function disposePhotoreal() {
  if (!engine) return;
  engine.pt.dispose();
  engine.denoise.material.dispose();
  engine.denoise.dispose();
  engine = null;
}

const nextFrame = () => new Promise<void>((resolve) => (document.hidden ? setTimeout(resolve, 0) : requestAnimationFrame(() => resolve())));

/**
 * The tracer copies a texture into its texture array only when the texture's source changes.
 * Garment canvases are repainted in place, so forget what it copied before each new scene.
 * (Internal to three-gpu-pathtracer 0.0.27, which is pinned; if it moves, this does nothing.)
 */
function forgetTextures(pt: Tracer) {
  const array = (pt as unknown as { _pathTracer?: { material?: { textures?: { hashes?: unknown[] } } } })._pathTracer?.material?.textures;
  array?.hashes?.fill(null);
}

/** Tiles per side so each draw call stays well inside the GPU's time limit. */
const tilesFor = (w: number, h: number) => Math.max(1, Math.ceil(Math.sqrt((w * h) / 600_000)));

/** Fewer samples leave more grain, so smooth harder; print outlines and seams are kept. */
function denoiseFor(samples: number) {
  if (samples >= 768) return { sigma: 1.4, threshold: 0.05 };
  if (samples >= 256) return { sigma: 1.9, threshold: 0.07 };
  if (samples >= 96) return { sigma: 2.5, threshold: 0.1 };
  return { sigma: 3.2, threshold: 0.14 };
}

/** Draw the accumulated image to the canvas, denoised or as it stands. */
function present(e: Engine, denoise: boolean) {
  const { pt, renderer } = e;
  if (denoise && pt.samples >= 1) {
    const material = e.denoise.material as InstanceType<Module['DenoiseMaterial']>;
    const k = denoiseFor(pt.samples);
    material.sigma = k.sigma;
    material.threshold = k.threshold;
    material.map = pt.target.texture;
    renderer.setRenderTarget(null);
    e.denoise.render(renderer);
    return;
  }
  pt.pausePathTracing = true;
  pt.renderToCanvas = true;
  try {
    pt.renderSample();
  } finally {
    pt.pausePathTracing = false;
    pt.renderToCanvas = false;
  }
}

/** Render samples up to the target, a batch per frame, so the page stays responsive. */
async function accumulate(e: Engine, target: number, opts: { signal?: AbortSignal; onSamples?: (samples: number) => void; preview?: () => void }) {
  const { pt, renderer } = e;
  let batch = 1;
  let last = performance.now();
  while (pt.samples < target) {
    if (opts.signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
    if (renderer.getContext().isContextLost()) throw new Error(LOST);
    for (let i = 0; i < batch && pt.samples < target; i++) pt.renderSample();
    opts.preview?.();
    opts.onSamples?.(pt.samples);
    await nextFrame();
    // Grow the batch while frames stay quick; shrink it when the GPU falls behind.
    const now = performance.now();
    const dt = now - last;
    last = now;
    if (!pt.isCompiling) batch = dt < 22 ? Math.min(64, batch + 1) : dt > 45 ? Math.max(1, Math.floor(batch * 0.6)) : batch;
  }
}

/** Largest square the tracer renders in one piece; bigger images are rendered in tiles. */
function tileLimit(renderer: THREE.WebGLRenderer) {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return Math.min(renderer.capabilities.maxTextureSize, memory >= 8 ? 2048 : 1280);
}

/**
 * Path trace the scene from `camera` into a new W × H canvas, transparent where nothing is hit.
 * The renderer's pixel ratio must be 1. The live canvas shows the render as it resolves.
 */
export async function pathTrace(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, W: number, H: number, opts: PhotorealOptions): Promise<HTMLCanvasElement> {
  const e = await getEngine(renderer);
  const { pt, mod } = e;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const o = out.getContext('2d')!;
  // Large images are rendered as overlapping tiles of the same frame; the overlap is wider
  // than the denoiser's reach, so no seams show where tiles meet.
  const limit = tileLimit(renderer);
  const cols = Math.ceil(W / limit);
  const rows = Math.ceil(H / limit);
  const tiled = cols * rows > 1;
  const pad = tiled ? 24 : 0;
  const lens = opts.focus ? new mod.PhysicalCamera() : null;
  const total = cols * rows;
  let first = true;
  try {
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const x0 = Math.floor((tx * W) / cols);
        const x1 = Math.floor(((tx + 1) * W) / cols);
        const y0 = Math.floor((ty * H) / rows);
        const y1 = Math.floor(((ty + 1) * H) / rows);
        const ex0 = Math.max(0, x0 - pad);
        const ey0 = Math.max(0, y0 - pad);
        const ew = Math.min(W, x1 + pad) - ex0;
        const eh = Math.min(H, y1 + pad) - ey0;
        renderer.setSize(ew, eh, false);
        if (tiled) camera.setViewOffset(W, H, ex0, ey0, ew, eh);
        camera.updateProjectionMatrix();
        let view: THREE.Camera = camera;
        if (lens && opts.focus) {
          lens.copy(camera);
          lens.fStop = opts.focus.fStop;
          lens.focusDistance = opts.focus.distance;
          lens.apertureBlades = 0;
          lens.updateMatrixWorld();
          view = lens;
        }
        pt.tiles.set(tilesFor(ew, eh), tilesFor(ew, eh));
        if (first) {
          forgetTextures(pt);
          pt.setScene(scene, view);
          first = false;
        } else {
          pt.setCamera(view);
        }
        const index = ty * cols + tx;
        await accumulate(e, opts.samples, {
          signal: opts.signal,
          preview: () => present(e, false),
          onSamples: (n) => opts.onProgress?.((index + Math.min(1, n / opts.samples)) / total),
        });
        present(e, opts.denoise !== false);
        // Read the canvas in the same task as the draw, before the browser clears it.
        o.drawImage(renderer.domElement, x0 - ex0, y0 - ey0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      }
    }
  } finally {
    if (tiled) camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.setSize(W, H, false);
  }
  return out;
}

/**
 * Refine the live viewport into a path-traced image, in place, until `target` samples or the
 * signal aborts. Each frame is denoised, so it looks clean early; the canvas keeps the last one.
 */
export async function liveTrace(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, opts: { target: number; signal: AbortSignal; onSamples: (samples: number) => void }) {
  const e = await getEngine(renderer);
  if (opts.signal.aborted) return;
  const { pt } = e;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  pt.tiles.set(tilesFor(size.x, size.y), tilesFor(size.x, size.y));
  forgetTextures(pt);
  pt.setScene(scene, camera);
  try {
    await accumulate(e, opts.target, { signal: opts.signal, preview: () => present(e, true), onSamples: opts.onSamples });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Scene changes for path tracing
// ---------------------------------------------------------------------------

/**
 * In a physical renderer, directional lights cast hard-edged shadows, which no product studio
 * uses. Each becomes a softbox from the same direction with the same strength at the garment.
 * Ambient light has no physical counterpart; it folds into the environment, which (unlike
 * ambient light) is properly occluded in folds and under sleeves. Returns the undo.
 */
export function softStudioLights(scene: THREE.Scene): () => void {
  const undo: (() => void)[] = [];
  const directional: THREE.DirectionalLight[] = [];
  let ambient = 0;
  scene.traverseVisible((o) => {
    if ((o as THREE.AmbientLight).isAmbientLight) ambient += (o as THREE.AmbientLight).intensity;
    if ((o as THREE.DirectionalLight).isDirectionalLight) directional.push(o as THREE.DirectionalLight);
  });
  const distance = 3;
  const size = 1.5;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  for (const light of directional) {
    light.getWorldPosition(from);
    light.target.getWorldPosition(to);
    // Same irradiance at the garment: radiance × area / distance² = the light's intensity.
    const box = new THREE.RectAreaLight(light.color, (light.intensity * distance * distance) / (size * size), size, size);
    box.position.copy(from.sub(to).normalize().multiplyScalar(distance));
    box.lookAt(0, 0, 0);
    scene.add(box);
    box.updateMatrixWorld();
    light.visible = false;
    undo.push(() => {
      scene.remove(box);
      box.dispose();
      light.visible = true;
    });
  }
  const intensity = scene.environmentIntensity;
  scene.environmentIntensity = intensity * (1 + ambient * 0.6);
  undo.push(() => {
    scene.environmentIntensity = intensity;
  });
  return () => {
    for (const u of undo.reverse()) u();
  };
}

/**
 * A large soft white card behind the camera, as product photographers use: foil, vinyl and
 * gloss need something bright to reflect, or they read dark. Returns the undo.
 */
export function fillCard(scene: THREE.Scene, camera: THREE.Camera): () => void {
  const direction = camera.getWorldPosition(new THREE.Vector3());
  if (direction.lengthSq() < 1e-6) return () => {};
  const distance = 3.2;
  const width = 2.6;
  const height = 1.8;
  // A quarter of a key light's strength at the garment: fill, not a second key.
  const card = new THREE.RectAreaLight(0xffffff, (0.25 * distance * distance) / (width * height), width, height);
  card.position.copy(direction.normalize().multiplyScalar(distance));
  card.position.y += 0.25;
  card.lookAt(0, 0, 0);
  scene.add(card);
  card.updateMatrixWorld();
  return () => {
    scene.remove(card);
    card.dispose();
  };
}

/** A copy of a surface moved `mm` inward along its normals: a lining with real fabric thickness. */
export function insetGeometry(geometry: THREE.BufferGeometry, mm: number): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const out = new THREE.BufferGeometry();
  const pos = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    pos[i * 3] = position.getX(i) - normal.getX(i) * mm;
    pos[i * 3 + 1] = position.getY(i) - normal.getY(i) * mm;
    pos[i * 3 + 2] = position.getZ(i) - normal.getZ(i) * mm;
  }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', normal.clone());
  const uv = geometry.getAttribute('uv');
  if (uv) out.setAttribute('uv', uv.clone());
  if (geometry.index) out.setIndex(geometry.index.clone());
  return out;
}

/** Ink this thick (red channel of the print-surface map, 0–255) or more is a print layer. */
const INK_MIN = 2;
/** Height 1 in the surface map is about a millimetre of ink: a full puff print. */
const RELIEF_MM = 1;
/** How far the ink layer sits above the knit, comfortably above the tracer's ray offset. */
const INK_LIFT_MM = 0.4;
/** Largest ink layer texture side; the tracer resamples every texture to at most 2048. */
const INK_TEXTURE = 2048;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Areas of a part that carry ink, as pixel boxes of its surface map: one per separate print. */
function inkClusters(data: Uint8ClampedArray, w: number, h: number): Box[] {
  const cell = Math.max(8, Math.ceil(Math.max(w, h) / 96));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const ink = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const g = Math.floor(y / cell) * gw;
    for (let x = 0; x < w; x++) if (data[(row + x) * 4] >= INK_MIN) ink[g + Math.floor(x / cell)] = 1;
  }
  // Group neighbouring cells (one cell of slack joins the letters of a word), then box each group.
  const seen = new Uint8Array(gw * gh);
  const boxes: Box[] = [];
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || seen[start]) continue;
    const box = { x0: gw, y0: gh, x1: -1, y1: -1 };
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % gw;
      const cy = (c - cx) / gw;
      box.x0 = Math.min(box.x0, cx);
      box.y0 = Math.min(box.y0, cy);
      box.x1 = Math.max(box.x1, cx);
      box.y1 = Math.max(box.y1, cy);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (ink[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    boxes.push(box);
  }
  // Boxes that overlap become one; too many separate prints become a single layer.
  let merged = boxes;
  for (let changed = true; changed; ) {
    changed = false;
    const next: Box[] = [];
    for (const b of merged) {
      const hit = next.find((n) => b.x0 <= n.x1 + 1 && n.x0 <= b.x1 + 1 && b.y0 <= n.y1 + 1 && n.y0 <= b.y1 + 1);
      if (hit) {
        hit.x0 = Math.min(hit.x0, b.x0);
        hit.y0 = Math.min(hit.y0, b.y0);
        hit.x1 = Math.max(hit.x1, b.x1);
        hit.y1 = Math.max(hit.y1, b.y1);
        changed = true;
      } else next.push({ ...b });
    }
    merged = next;
  }
  if (merged.length > 8) merged = [merged.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))];
  return merged.map((b) => ({ x0: Math.max(0, (b.x0 - 1) * cell), y0: Math.max(0, (b.y0 - 1) * cell), x1: Math.min(w, (b.x1 + 2) * cell), y1: Math.min(h, (b.y1 + 2) * cell) }));
}

function crop(source: HTMLCanvasElement, u0: number, v0: number, u1: number, v1: number, w: number, h: number) {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const c = out.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  // Canvas rows run down from v = 1.
  c.drawImage(source, u0 * source.width, (1 - v1) * source.height, (u1 - u0) * source.width, (v1 - v0) * source.height, 0, 0, w, h);
  return out;
}

/** Tangent-space normals from ink height (red channel), at true scale in millimetres. */
function reliefNormals(surface: HTMLCanvasElement, mmPerPxX: number, mmPerPxY: number) {
  const w = surface.width;
  const h = surface.height;
  const src = surface.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const c = out.getContext('2d')!;
  const img = c.createImageData(w, h);
  const H = (x: number, y: number) => src[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4];
  const kx = RELIEF_MM / (255 * 2 * mmPerPxX);
  const ky = RELIEF_MM / (255 * 2 * mmPerPxY);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Slopes in mm per mm. Texture v runs up while canvas rows run down.
      const sx = (H(x + 1, y) - H(x - 1, y)) * kx;
      const sy = (H(x, y - 1) - H(x, y + 1)) * ky;
      const len = Math.hypot(sx, sy, 1);
      const o = (y * w + x) * 4;
      img.data[o] = (-sx / len) * 127.5 + 127.5;
      img.data[o + 1] = (-sy / len) * 127.5 + 127.5;
      img.data[o + 2] = (1 / len) * 127.5 + 127.5;
      img.data[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return out;
}

/**
 * Each print on a part as its own thin layer just above the knit, for path tracing: the knit
 * keeps its weave everywhere else, and the ink gets true relief (puff, embroidery stitches),
 * its own gloss and metal, and a sharper texture than the whole part could have. Coverage
 * comes from ink height, so worn and cracked ink lets the fabric show through.
 */
export function inkDecals(geometry: THREE.BufferGeometry, color: HTMLCanvasElement, surface: HTMLCanvasElement, widthMm: number, heightMm: number): THREE.Mesh[] {
  const w = surface.width;
  const h = surface.height;
  const index = geometry.index;
  const uvAttr = geometry.getAttribute('uv');
  if (!w || !h || !color.width || !index || !uvAttr) return [];
  const data = surface.getContext('2d')!.getImageData(0, 0, w, h).data;
  const boxes = inkClusters(data, w, h);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const meshes: THREE.Mesh[] = [];
  for (const box of boxes) {
    // The box in UV space (canvas rows run down from v = 1).
    const bu0 = box.x0 / w;
    const bu1 = box.x1 / w;
    const bv0 = 1 - box.y1 / h;
    const bv1 = 1 - box.y0 / h;
    // Whole triangles that touch the box, and the UV range they cover.
    const tris: number[] = [];
    let u0 = 1;
    let v0 = 1;
    let u1 = 0;
    let v1 = 0;
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      const tu0 = Math.min(uvAttr.getX(a), uvAttr.getX(b), uvAttr.getX(c));
      const tu1 = Math.max(uvAttr.getX(a), uvAttr.getX(b), uvAttr.getX(c));
      const tv0 = Math.min(uvAttr.getY(a), uvAttr.getY(b), uvAttr.getY(c));
      const tv1 = Math.max(uvAttr.getY(a), uvAttr.getY(b), uvAttr.getY(c));
      if (tu1 < bu0 || tu0 > bu1 || tv1 < bv0 || tv0 > bv1) continue;
      tris.push(a, b, c);
      u0 = Math.min(u0, tu0);
      u1 = Math.max(u1, tu1);
      v0 = Math.min(v0, tv0);
      v1 = Math.max(v1, tv1);
    }
    if (!tris.length || u1 <= u0 || v1 <= v0) continue;
    u0 = Math.max(0, u0);
    v0 = Math.max(0, v0);
    u1 = Math.min(1, u1);
    v1 = Math.min(1, v1);

    // A compact mesh of those triangles, lifted off the knit, with UVs spanning the crop.
    const remap = new Map<number, number>();
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const v of tris) {
      let k = remap.get(v);
      if (k === undefined) {
        k = remap.size;
        remap.set(v, k);
        const nx = normal.getX(v);
        const ny = normal.getY(v);
        const nz = normal.getZ(v);
        pos.push(position.getX(v) + nx * INK_LIFT_MM, position.getY(v) + ny * INK_LIFT_MM, position.getZ(v) + nz * INK_LIFT_MM);
        nor.push(nx, ny, nz);
        uv.push((uvAttr.getX(v) - u0) / (u1 - u0), (uvAttr.getY(v) - v0) / (v1 - v0));
      }
      idx.push(k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);

    // Crops of the colour and surface maps at their native detail, up to the tracer's limit.
    const cw = (u1 - u0) * w;
    const ch = (v1 - v0) * h;
    const s = Math.min(1, INK_TEXTURE / Math.max(cw, ch));
    const tw = Math.max(2, Math.round(cw * s));
    const th = Math.max(2, Math.round(ch * s));
    const surfaceCrop = crop(surface, u0, v0, u1, v1, tw, th);
    const colorCrop = crop(color, u0, v0, u1, v1, tw, th);
    const relief = reliefNormals(surfaceCrop, ((u1 - u0) * widthMm) / tw, ((v1 - v0) * heightMm) / th);

    const map = new THREE.CanvasTexture(colorCrop);
    map.colorSpace = THREE.SRGBColorSpace;
    const surfaceMap = new THREE.CanvasTexture(surfaceCrop);
    surfaceMap.colorSpace = THREE.NoColorSpace;
    const normalMap = new THREE.CanvasTexture(relief);
    normalMap.colorSpace = THREE.NoColorSpace;
    // Roughness from green and metalness from blue, as in real time; the path tracer reads
    // alpha from the red channel, which is ink height, so bare fabric is cut away.
    const material = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap: surfaceMap, metalnessMap: surfaceMap, alphaMap: surfaceMap, alphaTest: INK_MIN / 255, roughness: 1, metalness: 1 });
    const mesh = new THREE.Mesh(g, material);
    mesh.raycast = () => {};
    mesh.userData.photoreal = true;
    meshes.push(mesh);
  }
  return meshes;
}

/** Free an ink layer from `inkDecals`. */
export function disposeDecal(mesh: THREE.Mesh) {
  mesh.geometry.dispose();
  const material = mesh.material as THREE.MeshStandardMaterial;
  material.map?.dispose();
  material.normalMap?.dispose();
  material.roughnessMap?.dispose();
  material.dispose();
}
