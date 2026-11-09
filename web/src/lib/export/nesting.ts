/**
 * Fabric marker nesting: every pattern piece of an order laid on a fabric roll of fixed width, as
 * short as it will go, so a cut-and-sew or sublimation factory prints and cuts with little waste.
 *
 * Grain: each piece's own y axis (the garment's length, which is the fabric's lengthwise grain)
 * runs along the roll. A piece may turn 180°, never 90°, so the grain line stays straight.
 *
 * Method: a skyline fill on the real outlines. The roll is divided across into narrow columns. In
 * each column a piece covers one span, measured exactly from its edges, then grown by its bleed
 * and half the gap. A piece drops toward the start of the roll until one of its columns meets what
 * is already placed there, so slanted sides slide past each other and turned pieces interlock.
 * Spans only ever over-cover a piece, so placed pieces cannot overlap. Several piece orders and
 * placement rules are tried, and the shortest marker wins.
 *
 * Long markers are split into sections (one print file each) with no piece crossing a split.
 */

export type Point = [number, number];

export interface NestPiece {
  /** Unique within the order. */
  id: string;
  /** Pieces with the same key have the same outline (one size of one pattern piece). */
  shape: string;
  /** The cut line in millimetres: x across the roll, y along it, in the direction of the grain. */
  outline: Point[];
  /** Pieces of one garment share a group, so one of the piece orders can keep them together. */
  group?: number;
}

export interface NestOptions {
  rollWidthMm: number;
  /** Clear fabric between neighbouring pieces' bleed. */
  gapMm: number;
  /** Clear fabric between any bleed and the roll's edges, and the start and end of each section. */
  marginMm: number;
  /** Printed bleed around every cut line. */
  bleedMm: number;
  /** Pieces may turn 180°. Off for napped or one-way fabrics. */
  allowTurn: boolean;
  /** Longest section (one print file). Raised when a piece is longer than this. */
  maxLengthMm: number;
  /** Column width across the roll. Narrower packs a little tighter and runs slower. */
  resolutionMm?: number;
}

export interface Placement {
  id: string;
  section: number;
  /** Turned 180°. */
  turned: boolean;
  /** Maps the outline into its section: X = tx + x and Y = ty + y, or tx − x and ty − y when turned. */
  tx: number;
  ty: number;
}

export interface NestSection {
  index: number;
  /** From the section's start to the margin after its last bleed. */
  lengthMm: number;
  placements: Placement[];
  /** Cut area of the pieces in this section. */
  pieceAreaMm2: number;
}

export interface NestResult {
  rollWidthMm: number;
  sections: NestSection[];
  /** Pieces wider than the roll. */
  unplaced: string[];
  /** Fabric used: every section's length added up. */
  lengthMm: number;
  pieceAreaMm2: number;
  /** Cut area of the pieces over the fabric used. */
  utilisation: number;
  /** The section length actually allowed, raised to fit the longest piece. */
  maxLengthMm: number;
  /** The piece order and placement rule that gave the shortest marker. */
  strategy: string;
}

const EPS = 1e-7;

export function polygonArea(points: readonly Point[]): number {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  return Math.abs(a) / 2;
}

export function bounds(points: readonly Point[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** A piece's outline where it was placed in its section. */
export function placeOutline(outline: readonly Point[], p: Pick<Placement, 'turned' | 'tx' | 'ty'>): Point[] {
  return outline.map(([x, y]) => (p.turned ? [p.tx - x, p.ty - y] : [p.tx + x, p.ty + y]));
}

function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Douglas–Peucker on a closed outline: no point of the original lies further than `tolerance` from the result. */
export function simplifyOutline(points: readonly Point[], tolerance: number): Point[] {
  const n = points.length;
  if (n < 4) return points.slice();
  let far = 0;
  let farDist = -1;
  for (let i = 1; i < n; i++) {
    const d = (points[i][0] - points[0][0]) ** 2 + (points[i][1] - points[0][1]) ** 2;
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  // Index n stands for point 0, closing the loop.
  const stack: [number, number][] = [
    [0, far],
    [far, n],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstDist = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i], points[a], points[b % n]);
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** One outline in one orientation, as grown spans per column. */
interface Shape {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Local x where column 0 starts. */
  x0: number;
  /** Lowest and highest y the grown piece covers in each column. */
  low: Float64Array;
  high: Float64Array;
  minLow: number;
  maxHigh: number;
  /** Area-weighted mean height of the grown piece. */
  centroid: number;
}

function shapeOf(outline: readonly Point[], grow: number, res: number): Shape {
  const b = bounds(outline);
  const reach = Math.ceil(grow / res) + 1;
  const x0 = b.minX - reach * res;
  const cols = Math.ceil((b.maxX - x0) / res) + reach + 1;
  // The outline's exact span in each column: the extremes of its edges clipped to the column.
  const low = new Float64Array(cols).fill(Infinity);
  const high = new Float64Array(cols).fill(-Infinity);
  for (let e = 0; e < outline.length; e++) {
    const [ax, ay] = outline[e];
    const [bx, by] = outline[(e + 1) % outline.length];
    const lx = Math.min(ax, bx);
    const rx = Math.max(ax, bx);
    const c1 = Math.floor((rx - x0) / res);
    for (let c = Math.floor((lx - x0) / res); c <= c1; c++) {
      let y0 = ay;
      let y1 = by;
      if (bx !== ax) {
        y0 = ay + ((Math.max(lx, x0 + c * res) - ax) / (bx - ax)) * (by - ay);
        y1 = ay + ((Math.min(rx, x0 + (c + 1) * res) - ax) / (bx - ax)) * (by - ay);
      }
      low[c] = Math.min(low[c], y0, y1);
      high[c] = Math.max(high[c], y0, y1);
    }
  }
  // Grow by `grow`: a point that close to the outline lies at most √(grow² − g²) beyond the span of
  // the column it is near, where g is the least horizontal distance between the two columns.
  const lift: number[] = [];
  for (let j = 0; j <= reach; j++) {
    const g = Math.max(0, j - 1) * res;
    lift.push(g <= grow ? Math.sqrt(grow * grow - g * g) : -1);
  }
  const gl = new Float64Array(cols).fill(Infinity);
  const gh = new Float64Array(cols).fill(-Infinity);
  for (let c = 0; c < cols; c++) {
    if (low[c] === Infinity) continue;
    for (let j = -reach; j <= reach; j++) {
      const h = lift[Math.abs(j)];
      const t = c + j;
      if (h < 0 || t < 0 || t >= cols) continue;
      if (low[c] - h < gl[t]) gl[t] = low[c] - h;
      if (high[c] + h > gh[t]) gh[t] = high[c] + h;
    }
  }
  let first = 0;
  while (gl[first] === Infinity) first++;
  let last = cols - 1;
  while (gl[last] === Infinity) last--;
  const lowT = gl.slice(first, last + 1);
  const highT = gh.slice(first, last + 1);
  let minLow = Infinity;
  let maxHigh = -Infinity;
  let mass = 0;
  let moment = 0;
  for (let c = 0; c < lowT.length; c++) {
    minLow = Math.min(minLow, lowT[c]);
    maxHigh = Math.max(maxHigh, highT[c]);
    const h = highT[c] - lowT[c];
    mass += h;
    moment += (h * (lowT[c] + highT[c])) / 2;
  }
  return { ...b, x0: x0 + first * res, low: lowT, high: highT, minLow, maxHigh, centroid: mass ? moment / mass : minLow };
}

/** Lowest bottom, then leftmost; lowest centre of area; or lowest top plus the gap left beneath. */
type Rule = 'bottom-left' | 'centroid' | 'snug';
type Order = 'area' | 'length' | 'width' | 'garment';

interface Candidate {
  key: number;
  /** Column the piece's first column sits in. */
  k: number;
  ty: number;
  turned: boolean;
}

/** The best place for a piece on one skyline, in either orientation, ending at or before `limit`. */
function bestPlacement(sky: Float64Array, frames: Shape[], limit: number, rule: Rule): Candidate | null {
  let best: Candidate | null = null;
  for (let f = 0; f < frames.length; f++) {
    const s = frames[f];
    const n = s.low.length;
    const lift = rule === 'bottom-left' ? s.minLow : rule === 'centroid' ? s.centroid : s.maxHigh;
    for (let k = 0; k + n <= sky.length; k++) {
      // Drop the piece: the lowest offset at which every column clears the skyline. Every rule's
      // score is at least ty + lift, so stop as soon as this offset cannot beat the best so far.
      const cap: number = best ? best.key - lift - EPS : Infinity;
      let ty = -Infinity;
      let j = 0;
      for (; j < n; j++) {
        const v = sky[k + j] - s.low[j];
        if (v > ty) {
          ty = v;
          if (ty >= cap) break;
        }
      }
      if (j < n || ty + s.maxHigh > limit + EPS) continue;
      let key = ty + lift;
      if (rule === 'snug') {
        let gap = 0;
        for (let m = 0; m < n; m++) gap += ty + s.low[m] - sky[k + m];
        key += gap / n;
      }
      if (!best || key < best.key - EPS) best = { key, k, ty, turned: f === 1 };
    }
  }
  return best;
}

interface Sheet {
  index: number;
  sky: Float64Array;
  /** Lowest point of the skyline. */
  floor: number;
  /** Shapes that did not fit. The skyline only rises, so they never will. */
  misses: Set<string>;
  placements: Placement[];
  area: number;
  maxY: number;
}

export function nest(pieces: readonly NestPiece[], opts: NestOptions): NestResult {
  const res = opts.resolutionMm ?? 2;
  const grow = opts.bleedMm + opts.gapMm / 2;
  // Grown pieces may reach half the gap past the margin, so their bleed stops exactly at it.
  const xMin = opts.marginMm - opts.gapMm / 2;
  const cols = Math.max(0, Math.floor((opts.rollWidthMm - 2 * opts.marginMm + opts.gapMm) / res + 1e-9));
  const yStart = opts.marginMm - opts.gapMm / 2;

  const shapes = new Map<string, { area: number; height: number; frames: Shape[] }>();
  for (const p of pieces) {
    if (shapes.has(p.shape)) continue;
    const frames = [shapeOf(p.outline, grow, res)];
    if (opts.allowTurn) frames.push(shapeOf(p.outline.map(([x, y]) => [-x, -y] as Point), grow, res));
    shapes.set(p.shape, { area: polygonArea(p.outline), height: frames[0].maxHigh - frames[0].minLow, frames });
  }
  let tallest = 0;
  for (const s of shapes.values()) tallest = Math.max(tallest, s.height);
  const maxLength = Math.max(opts.maxLengthMm, tallest + 2 * yStart + EPS);
  const limit = maxLength - yStart;

  const info = pieces.map((p, i) => {
    const s = shapes.get(p.shape)!;
    const f = s.frames[0];
    return { i, area: s.area, length: f.maxY - f.minY, width: f.maxX - f.minX, group: p.group ?? 0 };
  });
  const by = (...keys: ((x: (typeof info)[number]) => number)[]) =>
    [...info]
      .sort((a, b) => {
        for (const key of keys) {
          const d = key(a) - key(b);
          if (Math.abs(d) > EPS) return d;
        }
        return a.i - b.i;
      })
      .map((x) => x.i);
  const orders: [Order, number[]][] = [
    ['area', by((x) => -x.area)],
    ['length', by((x) => -x.length, (x) => -x.area)],
    ['width', by((x) => -x.width, (x) => -x.area)],
    ['garment', by((x) => x.group, (x) => -x.area)],
  ];
  const rules: Rule[] = ['bottom-left', 'centroid', 'snug'];

  const attempt = (order: number[], rule: Rule) => {
    const sheets: Sheet[] = [];
    const unplaced: string[] = [];
    for (const i of order) {
      const piece = pieces[i];
      const shape = shapes.get(piece.shape)!;
      if (shape.frames.every((f) => f.low.length > cols)) {
        unplaced.push(piece.id);
        continue;
      }
      // First fit: the earliest section with room, so later, smaller pieces fill the ends of
      // sections that larger ones left.
      let target: { sheet: Sheet; c: Candidate } | null = null;
      for (const sheet of sheets) {
        if (sheet.misses.has(piece.shape)) continue;
        const c = sheet.floor + shape.height <= limit + EPS ? bestPlacement(sheet.sky, shape.frames, limit, rule) : null;
        if (c) {
          target = { sheet, c };
          break;
        }
        sheet.misses.add(piece.shape);
      }
      if (!target) {
        const sheet: Sheet = { index: sheets.length, sky: new Float64Array(cols).fill(yStart), floor: yStart, misses: new Set(), placements: [], area: 0, maxY: -Infinity };
        const c = bestPlacement(sheet.sky, shape.frames, limit, rule);
        if (!c) {
          unplaced.push(piece.id);
          continue;
        }
        sheets.push(sheet);
        target = { sheet, c };
      }
      const { sheet, c } = target;
      const f = shape.frames[c.turned ? 1 : 0];
      for (let j = 0; j < f.low.length; j++) sheet.sky[c.k + j] = c.ty + f.high[j];
      sheet.floor = Math.min(...sheet.sky);
      sheet.placements.push({ id: piece.id, section: sheet.index, turned: c.turned, tx: xMin + c.k * res - f.x0, ty: c.ty });
      sheet.area += shape.area;
      sheet.maxY = Math.max(sheet.maxY, c.ty + f.maxY);
    }
    const sections: NestSection[] = sheets.map((s) => ({ index: s.index, lengthMm: s.maxY + opts.bleedMm + opts.marginMm, placements: s.placements, pieceAreaMm2: s.area }));
    return { sections, unplaced, lengthMm: sections.reduce((n, s) => n + s.lengthMm, 0) };
  };

  let best: (ReturnType<typeof attempt> & { strategy: string }) | null = null;
  for (const [name, order] of orders) {
    for (const rule of rules) {
      const r = attempt(order, rule);
      const better =
        !best ||
        r.unplaced.length < best.unplaced.length ||
        (r.unplaced.length === best.unplaced.length && (r.lengthMm < best.lengthMm - EPS || (Math.abs(r.lengthMm - best.lengthMm) <= EPS && r.sections.length < best.sections.length)));
      if (better) best = { ...r, strategy: `${name} order, ${rule}` };
    }
  }
  const result = best!;
  const pieceAreaMm2 = result.sections.reduce((n, s) => n + s.pieceAreaMm2, 0);
  return {
    rollWidthMm: opts.rollWidthMm,
    sections: result.sections,
    unplaced: result.unplaced,
    lengthMm: result.lengthMm,
    pieceAreaMm2,
    utilisation: result.lengthMm > 0 ? pieceAreaMm2 / (opts.rollWidthMm * result.lengthMm) : 0,
    maxLengthMm: maxLength,
    strategy: result.strategy,
  };
}
