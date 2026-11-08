/**
 * Spot-colour separations for screen printing: one film positive per ink, black where that ink
 * prints, found from the flat print artwork's own colours. Near-identical shades (anti-aliased
 * edges, slight gradients) fold into the nearest ink. Photos and wide gradients need halftone
 * separation, which the printer does; the package says so.
 */

export interface Ink {
  hex: string;
  rgb: [number, number, number];
  /** Share of the printed area this ink covers, 0–1. */
  share: number;
}

/** Perceptual-ish colour distance ("redmean"), 0 to about 765. */
export function colorDistance(a: readonly number[], b: readonly number[]) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

const toHex = (rgb: readonly number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** The inks an artwork needs, most-used first. `data` is RGBA pixels. */
export function findInks(data: Uint8ClampedArray, opts: { maxInks?: number; minShare?: number; merge?: number } = {}): Ink[] {
  const maxInks = opts.maxInks ?? 8;
  const minShare = opts.minShare ?? 0.003;
  const merge = opts.merge ?? 70;
  const counts = new Uint32Array(32768);
  const sums = new Float64Array(32768 * 3);
  let solid = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    counts[bin]++;
    sums[bin * 3] += r;
    sums[bin * 3 + 1] += g;
    sums[bin * 3 + 2] += b;
    solid++;
  }
  if (!solid) return [];
  const bins: { count: number; rgb: [number, number, number] }[] = [];
  for (let bin = 0; bin < counts.length; bin++) {
    const n = counts[bin];
    if (n) bins.push({ count: n, rgb: [sums[bin * 3] / n, sums[bin * 3 + 1] / n, sums[bin * 3 + 2] / n] });
  }
  bins.sort((a, b) => b.count - a.count);
  // Greedy clustering: each ink takes the colour of its most-used shade.
  const clusters: { count: number; rgb: [number, number, number] }[] = [];
  for (const bin of bins) {
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < clusters.length; k++) {
      const d = colorDistance(clusters[k].rgb, bin.rgb);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0 && bestD < merge) clusters[best].count += bin.count;
    else clusters.push({ count: bin.count, rgb: bin.rgb });
  }
  clusters.sort((a, b) => b.count - a.count);
  const kept = clusters.filter((c, i) => i === 0 || c.count / solid >= minShare).slice(0, maxInks);
  // Pixels of dropped clusters print with their nearest kept ink.
  const totals = kept.map((k) => k.count);
  for (const c of clusters) {
    if (kept.includes(c)) continue;
    let best = 0;
    for (let k = 1; k < kept.length; k++) if (colorDistance(kept[k].rgb, c.rgb) < colorDistance(kept[best].rgb, c.rgb)) best = k;
    totals[best] += c.count;
  }
  return kept.map((c, k) => ({ hex: toHex(c.rgb), rgb: [Math.round(c.rgb[0]), Math.round(c.rgb[1]), Math.round(c.rgb[2])], share: totals[k] / solid }));
}

/** For every pixel, the index of the ink that prints it, or 255 where nothing prints. */
export function assignInks(data: Uint8ClampedArray, inks: Ink[]): Uint8Array {
  const out = new Uint8Array(data.length / 4).fill(255);
  const memo = new Int16Array(32768).fill(-1);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] < 8) continue;
    const bin = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    let k = memo[bin];
    if (k < 0) {
      const rgb = [data[i], data[i + 1], data[i + 2]];
      k = 0;
      for (let j = 1; j < inks.length; j++) if (colorDistance(inks[j].rgb, rgb) < colorDistance(inks[k].rgb, rgb)) k = j;
      memo[bin] = k;
    }
    out[p] = k;
  }
  return out;
}

/** One film positive: black at the source's coverage wherever `ink` prints (or any ink, for an underbase). */
export function plateData(data: Uint8ClampedArray, index: Uint8Array, ink: number | 'any', out = new Uint8ClampedArray(data.length)) {
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const on = ink === 'any' ? index[p] !== 255 : index[p] === ink;
    out[i] = out[i + 1] = out[i + 2] = 0;
    out[i + 3] = on ? data[i + 3] : 0;
  }
  return out;
}

export interface SeparationSet {
  inks: Ink[];
  plates: { label: string; file: string; canvas: HTMLCanvasElement }[];
  /** True when the artwork has many shades that will print as flat ink unless halftoned. */
  tonal: boolean;
}

function registrationMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
}

/**
 * Film positives for one zone's artwork: one per ink, plus a white underbase when the garment
 * is dark. Each film adds a margin with registration marks and a label, outside the artwork.
 */
export function buildSeparations(art: HTMLCanvasElement, dpi: number, opts: { label: string; underbase: boolean; maxInks?: number }): SeparationSet {
  const ctx = art.getContext('2d', { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, art.width, art.height);
  const inks = findInks(data, { maxInks: opts.maxInks ?? 8 });
  const index = assignInks(data, inks);
  let distinct = 0;
  const seen = new Set<number>();
  for (let i = 0; i < data.length && distinct < 400; i += 4 * 7) {
    if (data[i + 3] < 200) continue;
    const bin = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    if (!seen.has(bin)) {
      seen.add(bin);
      distinct++;
    }
  }
  const pxPerMm = dpi / 25.4;
  const margin = Math.round(15 * pxPerMm);
  const plateBuffer = new Uint8ClampedArray(data.length);
  const make = (ink: number | 'any', label: string, file: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = art.width + margin * 2;
    canvas.height = art.height + margin * 2;
    const c = canvas.getContext('2d')!;
    plateData(data, index, ink, plateBuffer);
    c.putImageData(new ImageData(plateBuffer, art.width, art.height), margin, margin);
    c.strokeStyle = '#000000';
    c.lineWidth = Math.max(1, 0.25 * pxPerMm);
    const r = 5 * pxPerMm;
    const m = margin / 2;
    for (const [x, y] of [
      [m, m],
      [canvas.width - m, m],
      [m, canvas.height - m],
      [canvas.width - m, canvas.height - m],
      [canvas.width / 2, m],
      [canvas.width / 2, canvas.height - m],
    ]) {
      registrationMark(c, x, y, r);
    }
    c.fillStyle = '#000000';
    c.font = `${Math.round(3 * pxPerMm)}px system-ui, sans-serif`;
    c.textBaseline = 'middle';
    c.fillText(`${opts.label}  ·  ${label}`, margin + 8 * pxPerMm, canvas.height - m);
    return { label, file, canvas };
  };
  const plates: SeparationSet['plates'] = [];
  if (opts.underbase && inks.length) plates.push(make('any', 'White underbase (dark garments)', '00-underbase-white'));
  inks.forEach((ink, k) => plates.push(make(k, `Ink ${k + 1} of ${inks.length}, ${ink.hex}`, `${String(k + 1).padStart(2, '0')}-ink-${ink.hex.slice(1).toLowerCase()}`)));
  return { inks, plates, tonal: distinct > inks.length * 24 };
}
