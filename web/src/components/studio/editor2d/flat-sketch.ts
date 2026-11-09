/**
 * Flat technical sketches of each garment around a print zone, in zone millimetres
 * (origin = top-left of the printable area), the way a tech pack draws them. Drawn behind the
 * artboard so placement is judged against the real garment, and used for thumbnails.
 */
import { partColor, type GarmentModel, type ZoneSpec } from '@/domain/garments';
import type { Colorway, Surface } from '@/domain/schema';
import { paintFabric } from '@/lib/render/zone-renderer';

type Pt = [number, number];

export interface SketchShape {
  points: Pt[];
  /** `inside` is the garment's inner face seen through an opening: the body colour, shaded. */
  part: 'body' | 'sleeves' | 'pants' | 'belt' | 'collar' | 'stitching' | 'inside';
}

export interface Sketch {
  /** Filled shapes, back to front. */
  shapes: SketchShape[];
  /** The main panel outline: bounds and the clip for artwork in thumbnails. */
  body: Pt[];
  /** Trim bands in the collar colour (neck ribs, V trims, bindings), as outlined thick strokes. */
  bands: { points: Pt[]; width: number }[];
  /** Seams and stitching, dashed. */
  seams: Pt[][];
  /** Filled shapes that sit over the bands (a collar tip, a belt knot). */
  top?: SketchShape[];
  /** Construction lines, solid hairlines (a band's inner edge, box stitching). */
  lines?: Pt[][];
}

const mirror = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [-x, y] as Pt).reverse();
const shift = (pts: Pt[], dx: number): Pt[] => pts.map(([x, y]) => [x + dx, y] as Pt);

/** Move a polyline `d` towards the body (downwards), along its normals, so a band lies on the fabric. */
function inset(pts: Pt[], d: number): Pt[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    return [p[0] + nx * d, p[1] + ny * d] as Pt;
  });
}

export function sketchForZone(model: GarmentModel, zone: ZoneSpec, scale = 1): Sketch {
  if (zone.part === 'torso') return torsoSketch(model, zone, scale);
  if (zone.part === 'sleeveLeft' || zone.part === 'sleeveRight') return sleeveSketch(model, zone, scale);
  return legSketch(model, zone, scale);
}

function neckline(model: GarmentModel, front: boolean, s: number, hps: number): Pt[] {
  const neck = model.neckRadiusMm * s;
  const drop = (front ? model.frontNeckDropMm : model.backNeckDropMm) * s;
  const v = front && (model.neckline === 'v' || model.neckline === 'dobok');
  const scoop = front && model.neckline === 'scoop';
  const pts: Pt[] = [];
  for (let i = 0; i <= 32; i++) {
    const x = -neck + (2 * neck * i) / 32;
    const t = Math.abs(x) / neck;
    const d = v ? drop * (1 - t) ** 1.12 : scoop ? drop * Math.sqrt(Math.max(0, 1 - t * t)) : drop * (1 - t * t);
    pts.push([x, hps + d]);
  }
  return pts;
}

function torsoSketch(model: GarmentModel, zone: ZoneSpec, s: number): Sketch {
  const cx = zone.printableWidthMm / 2;
  const front = zone.id === 'front';
  const hps = -(zone.topFromHpsMm ?? 0);
  const neck = model.neckRadiusMm * s;
  const shoulderX = model.shoulderHalfWidthMm * s;
  const shoulderY = hps + model.shoulderSlope * (shoulderX - neck);
  const H = model.bodyLengthMm * s;
  const rib = model.hem === 'rib';
  const chestX = model.chestHalfWidthMm * s;
  const hemY = hps + H;
  const hemX = chestX * (rib ? 0.93 : 0.975);
  const neckPts = neckline(model, front, s, hps);
  const shapes: SketchShape[] = [];
  const bands: Sketch['bands'] = [];
  const seams: Pt[][] = [];

  // One side of the body, neck to hem; the other side mirrors it.
  let side: Pt[];
  let sleeveShape: Pt[] | null = null;
  if (model.sleeve) {
    const a = (model.sleeve.angleDeg * Math.PI) / 180;
    const len = model.sleeve.lengthMm * s;
    const cuff = model.sleeve.cuffRadiusMm * s * 1.9;
    const top: Pt = [shoulderX + Math.cos(a) * len, shoulderY + Math.sin(a) * len];
    const bottom: Pt = [top[0] - Math.sin(a) * cuff, top[1] + Math.cos(a) * cuff];
    const armpit: Pt = [chestX, hps + H * 0.36];
    side = [[neck, hps], [shoulderX, shoulderY], top, bottom, armpit, [hemX, hemY]];
    sleeveShape = [[shoulderX, shoulderY], top, bottom, armpit];
    seams.push([[shoulderX, shoulderY], armpit]);
    if (model.sleeve.cuff === 'rib') {
      const k = Math.min(1, (60 * s) / len);
      const t2: Pt = [top[0] - Math.cos(a) * len * k, top[1] - Math.sin(a) * len * k];
      const b2: Pt = [bottom[0] - Math.cos(a) * len * k, bottom[1] - Math.sin(a) * len * k];
      shapes.push({ points: [t2, top, bottom, b2], part: 'collar' }, { points: mirror([t2, top, bottom, b2]), part: 'collar' });
    } else {
      // A turned hem (or a uniform's open cuff) shows its stitch line near the end.
      const k = ((model.sleeve.cuff === 'open' ? 26 : 18) * s) / len;
      seams.push([
        [top[0] - Math.cos(a) * len * k, top[1] - Math.sin(a) * len * k],
        [bottom[0] - Math.cos(a) * len * k, bottom[1] - Math.sin(a) * len * k],
      ]);
    }
  } else {
    // Sleeveless: the armhole drops steeply from the strap, then sweeps out to the underarm.
    const armpitY = shoulderY + (model.armholeDropMm ?? 240) * s;
    const hole: Pt[] = [];
    for (let i = 0; i <= 16; i++) {
      const phi = (i / 16) * (Math.PI / 2);
      hole.push([shoulderX + (chestX - shoulderX) * (1 - Math.cos(phi)), shoulderY + (armpitY - shoulderY) * Math.sin(phi)]);
    }
    side = [[neck, hps], [shoulderX, shoulderY], ...hole.slice(1), [hemX, hemY]];
    const w = (model.trimWidthMm ?? 12) * s;
    const binding = hole.map(([x, y]) => [x - w / 2, y + w / 3] as Pt);
    bands.push({ points: shift(binding, cx), width: w }, { points: shift(mirror(binding), cx), width: w });
  }
  // A uniform jacket's fronts overlap in a small inverted V at the hem.
  const uniform = model.category === 'uniform';
  const notchW = 42 * s;
  const notchH = 34 * s;
  const hemNotch: Pt[] = front && uniform ? [[notchW, hemY], [0, hemY - notchH], [-notchW, hemY]] : [];
  const body = shift([...neckPts, ...side, ...hemNotch, ...mirror(side)], cx);
  const top: SketchShape[] = [];
  const lines: Pt[][] = [];

  // Through a uniform's V-neck you see the inside of the back: its collar band and the label.
  if (front && model.neckline === 'dobok') {
    const backDrop = model.backNeckDropMm * s;
    const backNeck: Pt[] = [];
    for (let i = 0; i <= 24; i++) {
      const x = -neck + (2 * neck * i) / 24;
      const t = x / neck;
      backNeck.push([x, hps + backDrop * (1 - t * t)]);
    }
    shapes.push({ points: shift([...backNeck, ...[...neckPts].reverse()], cx), part: 'inside' });
    const w = (model.trimWidthMm ?? 16) * s;
    bands.push({ points: shift(inset(backNeck, w / 2), cx), width: w });
    const labelTop = hps + backDrop + w + 8 * s;
    shapes.push({ points: shift([[-17 * s, labelTop], [17 * s, labelTop], [17 * s, labelTop + 30 * s], [-17 * s, labelTop + 30 * s]], cx), part: 'body' });
  }

  // Uniform pants hang below the top, drawn behind it.
  if (model.pants) {
    const p = model.pants;
    const waist = hps + p.waistFromHpsMm * s;
    const crotch = waist + p.riseMm * s;
    const hem = crotch + p.inseamMm * s;
    const legOut = (p.hipHalfWidthMm * s) * 1.02;
    const hemOut = legOut - 10 * s;
    const hemIn = 14 * s;
    const pants: Pt[] = [
      [-p.waistHalfWidthMm * s, waist],
      [p.waistHalfWidthMm * s, waist],
      [legOut, crotch],
      [hemOut, hem],
      [hemIn, hem],
      [4 * s, crotch + 20 * s],
      [-4 * s, crotch + 20 * s],
      [-hemIn, hem],
      [-hemOut, hem],
      [-legOut, crotch],
    ];
    shapes.push({ points: shift(pants, cx), part: 'pants' });
    seams.push(shift([[hemOut - 6 * s, hem - 26 * s], [hemIn + 4 * s, hem - 26 * s]], cx), shift([[-hemOut + 6 * s, hem - 26 * s], [-hemIn - 4 * s, hem - 26 * s]], cx));
  }

  // Hood rising behind the neck.
  if (model.extras.hood) {
    const r = neck * 1.55;
    const hood: Pt[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = Math.PI + (i / 24) * Math.PI;
      hood.push([Math.cos(t) * r, hps + 10 * s + Math.sin(t) * 310 * s]);
    }
    shapes.push({ points: shift(hood, cx), part: 'body' });
    if (front) {
      const face: Pt[] = [];
      for (let i = 0; i <= 20; i++) {
        const t = Math.PI + (i / 20) * Math.PI;
        face.push([Math.cos(t) * neck * 0.95, hps + 4 * s + Math.sin(t) * 230 * s]);
      }
      bands.push({ points: shift(face, cx), width: 16 * s });
    }
  }

  shapes.push({ points: body, part: 'body' });
  if (sleeveShape) shapes.push({ points: shift(sleeveShape, cx), part: 'sleeves' }, { points: shift(mirror(sleeveShape), cx), part: 'sleeves' });

  // Neck finish: trims lie on the fabric side of the opening.
  if (model.neckline === 'crew') bands.push({ points: shift(neckPts, cx), width: 16 * s });
  else if (model.neckline === 'v' || model.neckline === 'dobok' || model.neckline === 'scoop') {
    const w = (model.trimWidthMm ?? 16) * s;
    bands.push({ points: shift(inset(neckPts, w / 2), cx), width: w });
    if (model.neckline === 'dobok') {
      // The collar's inner edge, and on the front a rank-coloured tip where the V closes.
      lines.push(shift(inset(neckPts, w * 0.62), cx));
      if (front) {
        const vy = hps + model.frontNeckDropMm * s;
        top.push({ points: shift([[-w * 0.78, vy - w * 0.05], [w * 0.78, vy - w * 0.05], [w * 0.78, vy + w * 0.8], [-w * 0.78, vy + w * 0.8]], cx), part: 'belt' });
      }
    }
  }
  else if (model.neckline === 'polo') {
    bands.push({ points: shift(neckPts, cx), width: 26 * s });
    if (front) {
      const drop = model.frontNeckDropMm * s;
      for (const sgn of [-1, 1]) shapes.push({ points: shift([[sgn * 4 * s, hps + drop], [sgn * (neck + 14 * s), hps + 2 * s], [sgn * 70 * s, hps + 74 * s]], cx), part: 'collar' });
      const top = hps + drop;
      seams.push(shift([[-17 * s, top], [-17 * s, top + 150 * s], [17 * s, top + 150 * s], [17 * s, top]], cx));
      for (let b = 0; b < (model.extras.placketButtons ?? 3); b++) {
        const y = top + 26 * s + b * 44 * s;
        const button: Pt[] = [];
        for (let i = 0; i < 12; i++) button.push([Math.cos((i / 12) * Math.PI * 2) * 6 * s, y + Math.sin((i / 12) * Math.PI * 2) * 6 * s]);
        shapes.push({ points: shift(button, cx), part: 'stitching' });
      }
    }
  }

  // Hem: a rib band, or double-needle stitching (with side slits on uniforms).
  if (rib) {
    const band: Pt[] = [[-hemX, hemY - 70 * s], [hemX, hemY - 70 * s], [hemX, hemY], [-hemX, hemY]];
    shapes.push({ points: shift(band, cx), part: 'collar' });
  } else if (hemNotch.length) {
    const y = hemY - 22 * s;
    seams.push(shift([[-hemX, y], [-notchW * 0.55, y], [0, y - notchH], [notchW * 0.55, y], [hemX, y]], cx));
  } else {
    seams.push(shift([[-hemX, hemY - 22 * s], [hemX, hemY - 22 * s]], cx));
  }
  if (model.hem === 'slits') seams.push(shift([[hemX - 2 * s, hemY], [hemX - 2 * s, hemY - 110 * s]], cx), shift([[-hemX + 2 * s, hemY], [-hemX + 2 * s, hemY - 110 * s]], cx));

  // Kangaroo pocket.
  if (front && model.extras.pocket === 'kangaroo') {
    const y1 = hemY - 76 * s;
    const y0 = y1 - 220 * s;
    seams.push(shift([[-150 * s, y0], [150 * s, y0], [178 * s, y1], [-178 * s, y1], [-150 * s, y0]], cx));
    seams.push(shift([[-150 * s, y0 + 6 * s], [-175 * s, y1 - 70 * s]], cx), shift([[150 * s, y0 + 6 * s], [175 * s, y1 - 70 * s]], cx));
  }

  // Rank belt over the top at the waist: a plain band at the back; at the front a square knot
  // with two tails hanging to the hem, their ends box-and-X stitched.
  if (model.pants && model.belt) {
    const y = hps + model.pants.waistFromHpsMm * s;
    const w = model.belt.widthMm * s;
    const half = chestX * 1.02;
    top.push({ points: shift([[-half, y - w / 2], [half, y - w / 2], [half, y + w / 2], [-half, y + w / 2]], cx), part: 'belt' });
    if (front) {
      const tailLen = Math.max(180 * s, hemY - y - 40 * s);
      for (const sgn of [-1, 1]) {
        const a = sgn * w * 0.15;
        const b = sgn * w * 1.25;
        const drift = sgn * 46 * s;
        const tail: Pt[] = [[a, y], [b, y], [b + drift, y + tailLen], [a + drift, y + tailLen]];
        top.push({ points: shift(tail, cx), part: 'belt' });
        // Box-and-X stitching near the end of each tail.
        const e0 = y + tailLen - w * 0.95;
        const e1 = y + tailLen - w * 0.15;
        const at = (yy: number, x0: number) => x0 + (drift * (yy - y)) / tailLen;
        const inner = a + sgn * w * 0.12;
        const outer = b - sgn * w * 0.12;
        const box: Pt[] = [[at(e0, inner), e0], [at(e0, outer), e0], [at(e1, outer), e1], [at(e1, inner), e1], [at(e0, inner), e0]];
        lines.push(shift(box, cx), shift([[at(e0, inner), e0], [at(e1, outer), e1]], cx), shift([[at(e0, outer), e0], [at(e1, inner), e1]], cx));
      }
      // The knot: a rounded square wrapping the band.
      const knot: Pt[] = [];
      for (let i = 0; i < 20; i++) {
        const t = (i / 20) * Math.PI * 2;
        const r = w * 0.95;
        knot.push([Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.55 * r, y + Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.55 * r * 0.86]);
      }
      top.push({ points: shift(knot, cx), part: 'belt' });
      lines.push(shift([[-w * 0.45, y - w * 0.55], [w * 0.2, y + w * 0.55]], cx));
    }
  }

  return { shapes, body, bands, seams, top, lines };
}

function sleeveSketch(model: GarmentModel, zone: ZoneSpec, s: number): Sketch {
  const cx = zone.printableWidthMm / 2;
  const cy = zone.printableHeightMm / 2;
  const sl = model.sleeve ?? { lengthMm: 215, rootRadiusMm: 104, cuffRadiusMm: 80, cuff: 'hem' as const, angleDeg: 30 };
  const seamY = cy - (zone.centerFromShoulderMm ?? 90);
  const cuffY = seamY + sl.lengthMm * s;
  const top = sl.rootRadiusMm * s * 1.08;
  const bottom = sl.cuffRadiusMm * s * 1.08;
  const body: Pt[] = [
    [cx - top, seamY],
    [cx + top, seamY],
    [cx + bottom, cuffY],
    [cx - bottom, cuffY],
  ];
  const shapes: SketchShape[] = [{ points: body, part: 'sleeves' }];
  const seams: Pt[][] = [];
  if (sl.cuff === 'rib') shapes.push({ points: [[cx - bottom, cuffY - 60 * s], [cx + bottom, cuffY - 60 * s], [cx + bottom, cuffY], [cx - bottom, cuffY]], part: 'collar' });
  else if (sl.cuff === 'hem') seams.push([[cx - bottom * 1.02, cuffY - 18 * s], [cx + bottom * 1.02, cuffY - 18 * s]]);
  return { shapes, body, bands: [], seams };
}

function legSketch(model: GarmentModel, zone: ZoneSpec, s: number): Sketch {
  const p = model.pants!;
  const cx = zone.printableWidthMm / 2;
  const waist = -(zone.topFromWaistMm ?? 0);
  const crotch = waist + p.riseMm * s;
  const hem = crotch + p.inseamMm * s;
  // The outside half of the leg, unrolled: half the circumference at each height.
  const top = (Math.PI * (p.waistHalfWidthMm / 2) * s) / 2;
  const thigh = (Math.PI * p.thighRadiusMm * s) / 2;
  const hemHalf = (Math.PI * p.hemRadiusMm * s) / 2;
  const body: Pt[] = [
    [cx - top, waist],
    [cx + top, waist],
    [cx + thigh, crotch],
    [cx + hemHalf, hem],
    [cx - hemHalf, hem],
    [cx - thigh, crotch],
  ];
  return {
    shapes: [{ points: body, part: 'pants' }],
    body,
    bands: [],
    seams: [
      [[cx - top, waist + 40 * s], [cx + top, waist + 40 * s]],
      [[cx - hemHalf, hem - 26 * s], [cx + hemHalf, hem - 26 * s]],
      [[cx, waist + 40 * s], [cx, hem]],
    ],
  };
}

export function sketchBounds(sketch: Sketch) {
  const pts = [...sketch.shapes, ...(sketch.top ?? [])].flatMap((sh) => sh.points);
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** A hex colour scaled towards black by `k` (1 = unchanged). */
function shadeHex(hex: string, k: number) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6).padEnd(6, '0');
  const channel = (i: number) => Math.round(parseInt(full.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

function surfaceFor(colorway: Colorway, part: SketchShape['part']): Surface | undefined {
  const s = colorway.surfaces;
  if (!s) return undefined;
  return part === 'body' ? s.body : part === 'sleeves' ? s.sleeves : part === 'pants' ? s.pants : undefined;
}

/**
 * Draw a sketch in zone millimetres on a context whose transform maps millimetres to pixels.
 * `pxPerMm` is the effective device scale, so fabric prints stay crisp at any zoom.
 */
export function drawSketch(ctx: CanvasRenderingContext2D, sketch: Sketch, colorway: Colorway, pxPerMm: number) {
  const hairline = 1 / pxPerMm;
  const trace = (pts: Pt[], close = true) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (close) ctx.closePath();
  };
  const bounds = sketchBounds(sketch);
  const outline = 'rgba(110,114,125,0.65)';
  const fillShape = (shape: SketchShape) => {
    const base = shape.part === 'inside' ? partColor(colorway, 'body') : shape.part === 'collar' || shape.part === 'stitching' ? colorway.parts[shape.part] : partColor(colorway, shape.part);
    // The inside of the garment, seen through an opening, sits in its own shadow.
    const color = shape.part === 'inside' ? shadeHex(base, 0.86) : base;
    const surface = shape.part === 'inside' ? undefined : surfaceFor(colorway, shape.part);
    trace(shape.points);
    if (surface) {
      ctx.save();
      ctx.clip();
      // Paint in device pixels so patterns stay sharp, centred on the garment's centre line.
      const k = pxPerMm;
      ctx.translate(bounds.minX, bounds.minY);
      ctx.scale(1 / k, 1 / k);
      const w = (bounds.maxX - bounds.minX) * k;
      const h = (bounds.maxY - bounds.minY) * k;
      paintFabric(ctx, color, surface, w, h, k, { x: w / 2, y: 0 });
      ctx.restore();
      trace(shape.points);
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.lineWidth = hairline;
    ctx.strokeStyle = outline;
    ctx.stroke();
  };
  for (const shape of sketch.shapes) fillShape(shape);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Bands get an outline first, so a white collar still reads on a white jacket.
  for (const band of sketch.bands) {
    trace(band.points, false);
    ctx.lineWidth = band.width + 2 * hairline;
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.lineWidth = band.width;
    ctx.strokeStyle = colorway.parts.collar;
    ctx.stroke();
  }
  for (const shape of sketch.top ?? []) fillShape(shape);
  ctx.lineWidth = hairline;
  ctx.strokeStyle = outline;
  for (const line of sketch.lines ?? []) {
    trace(line, false);
    ctx.stroke();
  }
  ctx.setLineDash([4 * hairline, 3 * hairline]);
  ctx.lineWidth = hairline;
  ctx.strokeStyle = colorway.parts.stitching;
  for (const seam of sketch.seams) {
    trace(seam, false);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}
