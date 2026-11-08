/**
 * Image operations that run entirely on this device (spec AST-05, AI-01 without a provider:
 * no upload, no consent prompt, no training on customer artwork). Results are new assets;
 * originals are never modified (spec AST-03).
 */

export interface RemoveBackgroundOptions {
  /** Colour distance (0–255 scale) still treated as background. */
  tolerance: number;
  /** 'edges' clears background connected to the border; 'everywhere' also clears enclosed areas. */
  mode: 'edges' | 'everywhere';
}

export interface RemoveBackgroundResult {
  blob: Blob;
  /** Share of pixels made transparent, 0–1. */
  removed: number;
  background: string;
}

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** Most common colour around the border, averaged within its bucket. */
function borderColour(data: Uint8ClampedArray, w: number, h: number): [number, number, number] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) return;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++;
    b.r += data[i];
    b.g += data[i + 1];
    b.b += data[i + 2];
    buckets.set(key, b);
  };
  const step = Math.max(1, Math.floor(Math.max(w, h) / 2000));
  for (let x = 0; x < w; x += step) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    sample(0, y);
    sample(w - 1, y);
  }
  let best = { n: 0, r: 255, g: 255, b: 255 };
  for (const b of buckets.values()) if (b.n > best.n) best = b;
  return best.n ? [best.r / best.n, best.g / best.n, best.b / best.n] : [255, 255, 255];
}

export async function removeBackground(source: HTMLImageElement | ImageBitmap, opts: RemoveBackgroundOptions): Promise<RemoveBackgroundResult> {
  const w = source.width;
  const h = source.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const [br, bg, bb] = borderColour(data, w, h);
  const tol = Math.max(1, opts.tolerance);
  const tol2 = tol * tol;
  const dist2 = (i: number) => {
    const dr = data[i] - br;
    const dg = data[i + 1] - bg;
    const db = data[i + 2] - bb;
    return dr * dr + dg * dg + db * db;
  };

  const n = w * h;
  const clear = new Uint8Array(n);
  if (opts.mode === 'everywhere') {
    for (let p = 0; p < n; p++) if (dist2(p * 4) <= tol2 || data[p * 4 + 3] === 0) clear[p] = 1;
  } else {
    // Flood fill from every border pixel that matches the background.
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    const push = (p: number) => {
      if (clear[p]) return;
      const i = p * 4;
      if (data[i + 3] !== 0 && dist2(i) > tol2) return;
      clear[p] = 1;
      queue[tail++] = p;
    };
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (p >= w) push(p - w);
      if (p < n - w) push(p + w);
    }
  }

  // Soften the cut: pixels next to cleared ones fade by their colour distance, and the
  // background tint is removed from their colour so no halo remains.
  let removed = 0;
  const soft = tol * 1.8;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (clear[p]) {
      data[i + 3] = 0;
      removed++;
      continue;
    }
    const x = p % w;
    const nearClear = (x > 0 && clear[p - 1]) || (x < w - 1 && clear[p + 1]) || (p >= w && clear[p - w]) || (p < n - w && clear[p + w]);
    if (!nearClear) continue;
    const d = Math.sqrt(dist2(i));
    if (d >= soft) continue;
    const alpha = Math.max(0, Math.min(1, (d - tol) / (soft - tol)));
    if (alpha <= 0.02) {
      data[i + 3] = 0;
      removed++;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      const bgc = c === 0 ? br : c === 1 ? bg : bb;
      data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - bgc * (1 - alpha)) / alpha)));
    }
    data[i + 3] = Math.round(data[i + 3] * alpha);
  }
  ctx.putImageData(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be encoded.'))), 'image/png'));
  return { blob, removed: removed / n, background: toHex(Math.round(br), Math.round(bg), Math.round(bb)) };
}
