import { describe, expect, it } from 'vitest';
import { ringArea } from '@/lib/render/trace';
import { borderColour, fittedPath, outlinesToPath, simplifyOutlines, traceColours } from './vectorize';

type RGB = [number, number, number];

/** A w × h picture painted by `at(x, y)`: a colour, or null for see-through. */
function picture(w: number, h: number, at: (x: number, y: number) => RGB | null) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = at(x, y);
      const i = (y * w + x) * 4;
      if (!c) continue;
      [data[i], data[i + 1], data[i + 2]] = c;
      data[i + 3] = 255;
    }
  return data;
}

const WHITE: RGB = [255, 255, 255];
const RED: RGB = [220, 30, 40];
const NAVY: RGB = [20, 30, 90];
const inCircle = (x: number, y: number, cx: number, cy: number, r: number) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;

/** A red disc with a navy ring round a white hole (an O), on a white card. */
const badge = picture(120, 120, (x, y) => {
  if (inCircle(x, y, 60, 60, 12)) return WHITE;
  if (inCircle(x, y, 60, 60, 30)) return NAVY;
  if (inCircle(x, y, 60, 60, 45)) return RED;
  return WHITE;
});

const filled = (rings: [number, number][][]) => {
  // Even-odd: the outer ring adds, rings inside it take away.
  const areas = rings.map(ringArea).sort((a, b) => b - a);
  return areas.reduce((sum, a, i) => sum + (i === 0 ? a : -a), 0);
};

describe('tracing a picture into colours', () => {
  it('finds the colour around the artwork from its border', () => {
    expect(borderColour(badge, 120, 120)!.map(Math.round)).toEqual(WHITE);
    // A see-through border has no background to leave out.
    expect(borderColour(picture(40, 40, (x, y) => (inCircle(x, y, 20, 20, 10) ? RED : null)), 40, 40)).toBeNull();
    // Nor does a border of many colours.
    expect(borderColour(picture(40, 40, (x) => (x < 13 ? RED : x < 26 ? NAVY : WHITE)), 40, 40)).toBeNull();
  });

  it('stacks the colours largest first, each covering the ones above it, and leaves out the background', () => {
    const traced = traceColours(badge, 120, 120, { colours: 3, detail: 'medium', background: 'everywhere' });
    expect(traced.background).toBe('#FFFFFF');
    expect(traced.colours.map((c) => c.hex)).toEqual(['#DC1E28', '#141E5A']);
    const [red, navy] = traced.colours;
    // The red layer covers the whole disc less the hole; the navy one its ring.
    expect(filled(red.rings)).toBeCloseTo(Math.PI * (45 ** 2 - 12 ** 2), -2);
    expect(filled(navy.rings)).toBeCloseTo(Math.PI * (30 ** 2 - 12 ** 2), -2);
    expect(red.share + navy.share).toBeCloseTo(1, 6);
    expect(traced.tonal).toBe(false);
  });

  it('keeps enclosed areas of the background colour when told to leave it out only around the artwork', () => {
    const traced = traceColours(badge, 120, 120, { colours: 3, detail: 'medium', background: 'around' });
    expect(traced.colours.map((c) => c.hex)).toContain('#FFFFFF');
    // The white middle is the smallest colour: on top of the stack.
    expect(traced.colours.at(-1)!.hex).toBe('#FFFFFF');
    expect(filled(traced.colours[0].rings)).toBeCloseTo(Math.PI * 45 ** 2, -2);
  });

  it('traces the background as a colour when told to keep it', () => {
    const traced = traceColours(badge, 120, 120, { colours: 3, detail: 'medium', background: 'keep' });
    expect(traced.background).toBeNull();
    expect(traced.colours[0].hex).toBe('#FFFFFF');
    expect(filled(traced.colours[0].rings)).toBeCloseTo(120 * 120, -2);
  });

  it('makes a one-colour silhouette', () => {
    const traced = traceColours(badge, 120, 120, { colours: 1, detail: 'medium', background: 'everywhere' });
    expect(traced.colours).toHaveLength(1);
    expect(filled(traced.colours[0].rings)).toBeCloseTo(Math.PI * (45 ** 2 - 12 ** 2), -2);
  });

  it('cleans up specks at medium detail and keeps small marks at high', () => {
    // Two 3 × 3 px navy marks beside a red disc.
    const mark = (x: number, y: number, mx: number, my: number) => x >= mx && x < mx + 3 && y >= my && y < my + 3;
    const specks = picture(60, 60, (x, y) => (mark(x, y, 10, 10) || mark(x, y, 40, 12) ? NAVY : inCircle(x, y, 30, 45, 8) ? RED : WHITE));
    const medium = traceColours(specks, 60, 60, { colours: 3, detail: 'medium', background: 'everywhere' });
    expect(medium.colours.map((c) => c.hex)).toEqual(['#DC1E28']);
    const high = traceColours(specks, 60, 60, { colours: 3, detail: 'high', background: 'everywhere' });
    expect(high.colours.map((c) => c.hex)).toEqual(['#DC1E28', '#141E5A']);
    expect(high.colours[1].rings).toHaveLength(2);
  });

  it('leaves see-through pixels out and finds nothing in an empty picture', () => {
    expect(traceColours(picture(10, 10, () => null), 10, 10, { colours: 4, detail: 'medium', background: 'everywhere' }).colours).toEqual([]);
    expect(traceColours(picture(10, 10, () => WHITE), 10, 10, { colours: 4, detail: 'medium', background: 'everywhere' }).colours).toEqual([]);
  });

  it('folds the blended pixels along soft edges into the real colours, instead of tracing them as colours of their own', () => {
    // A red disc and a navy bar on white, every edge pixel a blend by how much of it each covers.
    const coverage = (x: number, y: number, inside: (px: number, py: number) => boolean) => {
      let n = 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) n += inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4) ? 1 : 0;
      return n / 16;
    };
    const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((k) => Math.round(a[k] * (1 - t) + b[k] * t)) as RGB;
    const soft = picture(160, 160, (x, y) => {
      const disc = coverage(x, y, (px, py) => (px - 70) ** 2 + (py - 70) ** 2 <= 50 ** 2);
      const bar = coverage(x, y, (px, py) => px >= 40.3 && px <= 120.6 && py >= 130.2 && py <= 146.7);
      return mix(mix(WHITE, RED, disc), NAVY, bar);
    });
    const traced = traceColours(soft, 160, 160, { colours: 4, detail: 'medium', background: 'everywhere' });
    expect(traced.background).toBe('#FFFFFF');
    expect(traced.colours.map((c) => c.hex)).toEqual(['#DC1E28', '#141E5A']);
    expect(traced.tonal).toBe(false);
  });

  it('notices a photo-like gradient', () => {
    const gradient = picture(64, 64, (x, y) => [x * 4, y * 4, 128]);
    expect(traceColours(gradient, 64, 64, { colours: 4, detail: 'low', background: 'keep' }).tonal).toBe(true);
  });
});

describe('outlines as shape paths', () => {
  const ring: [number, number][] = [
    [10, 10],
    [30, 10],
    [30, 20],
    [10, 20],
  ];

  it('maps outlines into their own 0–100 box', () => {
    const out = outlinesToPath([ring])!;
    expect(out.box).toEqual({ x: 10, y: 10, w: 20, h: 10 });
    expect(out.path).toBe('M0 0L100 0L100 100L0 100Z');
    expect(outlinesToPath([])).toBeNull();
  });

  it('drops specks smaller than the detail keeps', () => {
    const speck: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    expect(simplifyOutlines([ring, speck], 'medium')).toHaveLength(1);
    expect(simplifyOutlines([speck], 'high')).toHaveLength(0);
  });

  it('simplifies further, then leaves out the smallest pieces, to fit a size limit', () => {
    // Many small wobbly squares.
    const rings: [number, number][][] = [];
    for (let k = 0; k < 60; k++) {
      const ox = (k % 10) * 30;
      const oy = Math.floor(k / 10) * 30;
      const r: [number, number][] = [];
      for (let i = 0; i < 40; i++) r.push([ox + i * 0.5, oy + (i % 2) * 0.3]);
      for (let i = 0; i < 40; i++) r.push([ox + 20, oy + i * 0.5]);
      for (let i = 0; i < 40; i++) r.push([ox + 20 - i * 0.5, oy + 20]);
      for (let i = 0; i < 40; i++) r.push([ox, oy + 20 - i * 0.5]);
      rings.push(r);
    }
    const loose = fittedPath(rings, 'high', 2000)!;
    expect(loose.path.length).toBeLessThanOrEqual(2000);
    expect(loose.loosened).toBe(true);
    const roomy = fittedPath(rings, 'high', 1_000_000)!;
    expect(roomy.loosened).toBe(false);
  });
});
