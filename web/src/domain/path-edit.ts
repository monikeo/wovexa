/**
 * Editable vector paths (spec ED2-09): any SVG path data as subpaths of anchor points, each with
 * its own incoming and outgoing handle, and back again. Relative commands become absolute;
 * horizontal and vertical lines become lines; quadratic curves and arcs become cubic curves, so
 * every segment is a line or a cubic. Pure geometry, in the path's own units.
 */

export interface PathNode {
  x: number;
  y: number;
  /** Incoming handle (from the previous point), absolute. Absent: a sharp corner on that side. */
  inX?: number;
  inY?: number;
  /** Outgoing handle (toward the next point), absolute. */
  outX?: number;
  outY?: number;
}

export interface Subpath {
  nodes: PathNode[];
  closed: boolean;
}

type Cubic = [number, number, number, number, number, number, number, number];

const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const EPS = 1e-6;

/**
 * Cubic curves for an SVG elliptical arc from (x1, y1) to (x2, y2), by the spec's endpoint to
 * centre conversion (SVG 1.1, F.6.5), at most a quarter turn per curve.
 */
export function arcToCubics(x1: number, y1: number, rxIn: number, ryIn: number, angleDeg: number, largeArc: boolean, sweep: boolean, x2: number, y2: number): [number, number, number, number, number, number][] {
  if (Math.abs(x1 - x2) < EPS && Math.abs(y1 - y2) < EPS) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < EPS || ry < EPS) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  // Radii too small for the endpoints grow just enough.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const k = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1p) / ry;
  const cyp = (-k * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / segments;
  const t = (4 / 3) * Math.tan(step / 4);
  const point = (a: number) => {
    const ex = rx * Math.cos(a);
    const ey = ry * Math.sin(a);
    return [cx + cos * ex - sin * ey, cy + sin * ex + cos * ey];
  };
  const derivative = (a: number) => {
    const ex = -rx * Math.sin(a);
    const ey = ry * Math.cos(a);
    return [cos * ex - sin * ey, sin * ex + cos * ey];
  };
  const out: [number, number, number, number, number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = theta1 + i * step;
    const a1 = a0 + step;
    const [p0x, p0y] = point(a0);
    const [p1x, p1y] = i === segments - 1 ? [x2, y2] : point(a1);
    const [d0x, d0y] = derivative(a0);
    const [d1x, d1y] = derivative(a1);
    out.push([p0x + t * d0x, p0y + t * d0y, p1x - t * d1x, p1y - t * d1y, p1x, p1y]);
  }
  return out;
}

/** Path data as subpaths of nodes. Malformed trailing parameters are ignored, as browsers do. */
export function parsePath(d: string): Subpath[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const subpaths: Subpath[] = [];
  let current: Subpath | null = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The previous segment's last control point, for S and T reflections.
  let lastCubic: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;
  let cmd = '';
  let i = 0;
  const begin = (px: number, py: number) => {
    if (current?.nodes.length) subpaths.push(current);
    current = { nodes: [{ x: px, y: py }], closed: false };
    startX = px;
    startY = py;
  };
  const lineTo = (px: number, py: number) => {
    if (!current) begin(x, y);
    current!.nodes.push({ x: px, y: py });
  };
  const cubicTo = (c1x: number, c1y: number, c2x: number, c2y: number, px: number, py: number) => {
    if (!current) begin(x, y);
    const prev = current!.nodes[current!.nodes.length - 1];
    prev.outX = c1x;
    prev.outY = c1y;
    current!.nodes.push({ x: px, y: py, inX: c2x, inY: c2y });
  };
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/[A-Za-z]/.test(tok)) {
      cmd = tok;
      i++;
      if (cmd.toLowerCase() === 'z') {
        if (current) {
          const nodes: PathNode[] = (current as Subpath).nodes;
          // A last point back on the first is the same point: keep one, with the curve into it.
          const last = nodes[nodes.length - 1];
          if (nodes.length > 1 && Math.abs(last.x - nodes[0].x) < 1e-4 && Math.abs(last.y - nodes[0].y) < 1e-4) {
            if (last.inX !== undefined) {
              nodes[0].inX = last.inX;
              nodes[0].inY = last.inY;
            }
            nodes.pop();
          }
          (current as Subpath).closed = true;
          subpaths.push(current);
          current = null;
        }
        x = startX;
        y = startY;
        lastCubic = lastQuad = null;
        continue;
      }
    } else if (!cmd) {
      i++;
      continue;
    }
    const lower = cmd.toLowerCase();
    const arity = ARITY[lower];
    const args = tokens.slice(i, i + arity).map(Number);
    if (args.length < arity || args.some((v) => !Number.isFinite(v))) break;
    i += arity;
    const rel = cmd === lower;
    const ax = (v: number) => (rel ? x + v : v);
    const ay = (v: number) => (rel ? y + v : v);
    let cubic: [number, number] | null = null;
    let quad: [number, number] | null = null;
    switch (lower) {
      case 'm':
        x = ax(args[0]);
        y = ay(args[1]);
        begin(x, y);
        // Further pairs after a move are lines.
        cmd = rel ? 'l' : 'L';
        break;
      case 'l':
        x = ax(args[0]);
        y = ay(args[1]);
        lineTo(x, y);
        break;
      case 'h':
        x = rel ? x + args[0] : args[0];
        lineTo(x, y);
        break;
      case 'v':
        y = rel ? y + args[0] : args[0];
        lineTo(x, y);
        break;
      case 'c': {
        const [c1x, c1y, c2x, c2y, px, py] = [ax(args[0]), ay(args[1]), ax(args[2]), ay(args[3]), ax(args[4]), ay(args[5])];
        cubicTo(c1x, c1y, c2x, c2y, px, py);
        cubic = [c2x, c2y];
        x = px;
        y = py;
        break;
      }
      case 's': {
        const [c1x, c1y] = lastCubic ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]] : [x, y];
        const [c2x, c2y, px, py] = [ax(args[0]), ay(args[1]), ax(args[2]), ay(args[3])];
        cubicTo(c1x, c1y, c2x, c2y, px, py);
        cubic = [c2x, c2y];
        x = px;
        y = py;
        break;
      }
      case 'q':
      case 't': {
        const reflected: [number, number] = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
        const [qx, qy]: [number, number] = lower === 'q' ? [ax(args[0]), ay(args[1])] : reflected;
        const [px, py]: [number, number] = lower === 'q' ? [ax(args[2]), ay(args[3])] : [ax(args[0]), ay(args[1])];
        // A quadratic is the cubic with its control points two thirds of the way to the quadratic's.
        cubicTo(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), px + (2 / 3) * (qx - px), py + (2 / 3) * (qy - py), px, py);
        quad = [qx, qy];
        x = px;
        y = py;
        break;
      }
      case 'a': {
        const [px, py] = [ax(args[5]), ay(args[6])];
        for (const c of arcToCubics(x, y, args[0], args[1], args[2], !!args[3], !!args[4], px, py)) cubicTo(...c);
        x = px;
        y = py;
        break;
      }
    }
    lastCubic = cubic;
    lastQuad = quad;
  }
  if (current && (current as Subpath).nodes.length) subpaths.push(current);
  return subpaths;
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

const hasOut = (n: PathNode) => n.outX !== undefined && (Math.abs(n.outX - n.x) > EPS || Math.abs(n.outY! - n.y) > EPS);
const hasIn = (n: PathNode) => n.inX !== undefined && (Math.abs(n.inX - n.x) > EPS || Math.abs(n.inY! - n.y) > EPS);

/** The segments of a subpath, as cubics (a line is a cubic with its controls on its ends). */
export function segmentsOf(sub: Subpath): Cubic[] {
  const n = sub.nodes.length;
  const out: Cubic[] = [];
  const count = sub.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = sub.nodes[i];
    const b = sub.nodes[(i + 1) % n];
    out.push([a.x, a.y, hasOut(a) ? a.outX! : a.x, hasOut(a) ? a.outY! : a.y, hasIn(b) ? b.inX! : b.x, hasIn(b) ? b.inY! : b.y, b.x, b.y]);
  }
  return out;
}

/** Subpaths back to path data: lines where no handle bends a segment, cubics elsewhere. */
export function pathData(subpaths: readonly Subpath[]): string {
  const out: string[] = [];
  for (const sub of subpaths) {
    if (!sub.nodes.length) continue;
    out.push(`M${fmt(sub.nodes[0].x)} ${fmt(sub.nodes[0].y)}`);
    const n = sub.nodes.length;
    const count = sub.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = sub.nodes[i];
      const b = sub.nodes[(i + 1) % n];
      if (!hasOut(a) && !hasIn(b)) {
        // The closing line is drawn by Z itself.
        if (!(sub.closed && i === n - 1)) out.push(`L${fmt(b.x)} ${fmt(b.y)}`);
      } else {
        const [, , c1x, c1y, c2x, c2y, x, y] = segmentsOf({ nodes: [a, b], closed: false })[0];
        out.push(`C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(x)} ${fmt(y)}`);
      }
    }
    if (sub.closed) out.push('Z');
  }
  return out.join(' ');
}

/** A point `t` (0–1) along a cubic. */
export function cubicAt(c: Cubic, t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
}

/** Every subpath as a polyline: lines as they are, curves split until within `tolerance` of the curve. */
export function flattenSubpath(sub: Subpath, tolerance = 0.05): [number, number][] {
  const pts: [number, number][] = sub.nodes.length ? [[sub.nodes[0].x, sub.nodes[0].y]] : [];
  for (const c of segmentsOf(sub)) {
    const straightLine = c[2] === c[0] && c[3] === c[1] && c[4] === c[6] && c[5] === c[7];
    if (straightLine) {
      pts.push([c[6], c[7]]);
      continue;
    }
    // Enough steps that the polyline stays within tolerance: from the control polygon's bend.
    const dd = Math.max(Math.hypot(c[0] - 2 * c[2] + c[4], c[1] - 2 * c[3] + c[5]), Math.hypot(c[2] - 2 * c[4] + c[6], c[3] - 2 * c[5] + c[7]));
    const steps = Math.min(200, Math.max(2, Math.ceil(Math.sqrt((0.75 * dd) / Math.max(1e-6, tolerance)))));
    for (let k = 1; k <= steps; k++) pts.push(cubicAt(c, k / steps));
  }
  if (sub.closed && pts.length > 2) {
    const [fx, fy] = pts[0];
    const [lx, ly] = pts[pts.length - 1];
    if (Math.abs(fx - lx) < 1e-9 && Math.abs(fy - ly) < 1e-9) pts.pop();
  }
  return pts;
}

/** The tight bounds of the subpaths, curves included. */
export function boundsOf(subpaths: readonly Subpath[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const sub of subpaths) {
    for (const [x, y] of flattenSubpath(sub, 0.01)) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * Where a path's own units land in a layer: millimetres from the layer's centre, before it is
 * turned and mirrored, and back. A shape's path spans a 0–100 box; text on a path has its own.
 */
export interface PathSpace {
  toLocal(u: number, v: number): [number, number];
  fromLocal(x: number, y: number): [number, number];
}

/** A shape's 0–100 box stretched across a layer `w` × `h` mm. */
export function boxSpace(w: number, h: number): PathSpace {
  return {
    toLocal: (u, v) => [(u / 100 - 0.5) * w, (v / 100 - 0.5) * h],
    fromLocal: (x, y) => [(x / w + 0.5) * 100, (y / h + 0.5) * 100],
  };
}

/** A path's length in its own units (closed paths include the way back to the start). */
export function pathLength(sub: Subpath, tolerance = 0.05): number {
  const pts = flattenSubpath(sub, tolerance);
  if (sub.closed && pts.length > 1) pts.push(pts[0]);
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return length;
}

/** Every point (anchors and handles) through `map`. */
export function mapSubpaths(subpaths: readonly Subpath[], map: (x: number, y: number) => [number, number]): Subpath[] {
  return subpaths.map((s) => ({
    closed: s.closed,
    nodes: s.nodes.map((n) => {
      const [x, y] = map(n.x, n.y);
      const out: PathNode = { x, y };
      if (n.inX !== undefined) [out.inX, out.inY] = map(n.inX, n.inY!);
      if (n.outX !== undefined) [out.outX, out.outY] = map(n.outX, n.outY!);
      return out;
    }),
  }));
}

/** The point on the subpaths nearest (x, y): which segment, how far along it, and how far away. */
export function nearestOnPath(subpaths: readonly Subpath[], x: number, y: number): { sub: number; seg: number; t: number; x: number; y: number; dist: number } | null {
  let best: { sub: number; seg: number; t: number; x: number; y: number; dist: number } | null = null;
  subpaths.forEach((sub, si) => {
    segmentsOf(sub).forEach((c, ci) => {
      for (let k = 0; k <= 32; k++) {
        const t = k / 32;
        const [px, py] = cubicAt(c, t);
        const dist = Math.hypot(px - x, py - y);
        if (!best || dist < best.dist) best = { sub: si, seg: ci, t, x: px, y: py, dist };
      }
    });
  });
  if (!best) return null;
  // Refine around the best sample.
  const b = best as { sub: number; seg: number; t: number; x: number; y: number; dist: number };
  const c = segmentsOf(subpaths[b.sub])[b.seg];
  const distAt = (t: number) => {
    const [px, py] = cubicAt(c, t);
    return Math.hypot(px - x, py - y);
  };
  let lo = Math.max(0, b.t - 1 / 32);
  let hi = Math.min(1, b.t + 1 / 32);
  for (let k = 0; k < 40; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (distAt(m1) < distAt(m2)) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  const [px, py] = cubicAt(c, t);
  return { sub: b.sub, seg: b.seg, t, x: px, y: py, dist: Math.hypot(px - x, py - y) };
}

/** A new point on segment `seg` of subpath `sub` at `t`, leaving the curve exactly as it was. */
export function splitSegment(subpaths: readonly Subpath[], sub: number, seg: number, t: number): Subpath[] {
  return subpaths.map((s, si) => {
    if (si !== sub) return s;
    const nodes = s.nodes.map((n) => ({ ...n }));
    const ia = seg;
    const ib = (seg + 1) % nodes.length;
    const a = nodes[ia];
    const b = nodes[ib];
    const [p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y] = segmentsOf({ nodes: [a, b], closed: false })[0];
    const lerp = (u: number, v: number) => u + (v - u) * t;
    if (!hasOut(a) && !hasIn(b)) {
      nodes.splice(ia + 1, 0, { x: lerp(p0x, p3x), y: lerp(p0y, p3y) });
      return { ...s, nodes };
    }
    // De Casteljau: the two halves of the curve, joined smoothly at the new point.
    const q0x = lerp(p0x, p1x);
    const q0y = lerp(p0y, p1y);
    const q1x = lerp(p1x, p2x);
    const q1y = lerp(p1y, p2y);
    const q2x = lerp(p2x, p3x);
    const q2y = lerp(p2y, p3y);
    const r0x = lerp(q0x, q1x);
    const r0y = lerp(q0y, q1y);
    const r1x = lerp(q1x, q2x);
    const r1y = lerp(q1y, q2y);
    a.outX = q0x;
    a.outY = q0y;
    b.inX = q2x;
    b.inY = q2y;
    nodes.splice(ia + 1, 0, { x: lerp(r0x, r1x), y: lerp(r0y, r1y), inX: r0x, inY: r0y, outX: r1x, outY: r1y });
    return { ...s, nodes };
  });
}

/** A subpath travelled the other way round: points in reverse order, each point's handles swapped. */
export function reverseSubpath(sub: Subpath): Subpath {
  const nodes = [...sub.nodes].reverse().map((n) => {
    const out: PathNode = { x: n.x, y: n.y };
    if (n.outX !== undefined) [out.inX, out.inY] = [n.outX, n.outY];
    if (n.inX !== undefined) [out.outX, out.outY] = [n.inX, n.inY];
    return out;
  });
  // A closed path keeps its first point first.
  if (sub.closed && nodes.length > 1) nodes.unshift(nodes.pop()!);
  return { nodes, closed: sub.closed };
}

/** Whether a closed subpath runs clockwise on screen (y pointing down). */
export function isClockwise(sub: Subpath): boolean {
  const pts = flattenSubpath(sub, 0.1);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum > 0;
}

/** Whether a point's handles bend smoothly through it (in line with each other). */
export function isSmooth(n: PathNode) {
  if (!hasIn(n) || !hasOut(n)) return false;
  const a = Math.atan2(n.y - n.inY!, n.x - n.inX!);
  const b = Math.atan2(n.outY! - n.y, n.outX! - n.x);
  const diff = Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  return diff < (6 * Math.PI) / 180;
}

/** A corner point (no handles) made smooth along its neighbours, or a curved point made a corner. */
export function toggleSmooth(subpaths: readonly Subpath[], sub: number, index: number): Subpath[] {
  return subpaths.map((s, si) => {
    if (si !== sub) return s;
    const nodes = s.nodes.map((n) => ({ ...n }));
    const node = nodes[index];
    if (hasIn(node) || hasOut(node)) {
      delete node.inX;
      delete node.inY;
      delete node.outX;
      delete node.outY;
      return { ...s, nodes };
    }
    const count = nodes.length;
    const prev = nodes[(index - 1 + count) % count];
    const next = nodes[(index + 1) % count];
    const hasPrev = s.closed || index > 0;
    const hasNext = s.closed || index < count - 1;
    let dx = (hasNext ? next.x : node.x) - (hasPrev ? prev.x : node.x);
    let dy = (hasNext ? next.y : node.y) - (hasPrev ? prev.y : node.y);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const back = hasPrev ? Math.hypot(node.x - prev.x, node.y - prev.y) / 3 : 0;
    const ahead = hasNext ? Math.hypot(next.x - node.x, next.y - node.y) / 3 : 0;
    if (back) {
      node.inX = node.x - dx * back;
      node.inY = node.y - dy * back;
    }
    if (ahead) {
      node.outX = node.x + dx * ahead;
      node.outY = node.y + dy * ahead;
    }
    return { ...s, nodes };
  });
}

/** Subpaths without point `index` of subpath `sub`; a subpath left too small to draw goes too. */
export function deleteNode(subpaths: readonly Subpath[], sub: number, index: number): Subpath[] {
  return subpaths
    .map((s, si) => (si === sub ? { ...s, nodes: s.nodes.filter((_, i) => i !== index) } : s))
    .filter((s) => s.nodes.length >= (s.closed ? 3 : 2));
}

/** A point moved by (dx, dy), its handles with it. */
export function moveNode(subpaths: readonly Subpath[], sub: number, index: number, dx: number, dy: number): Subpath[] {
  return subpaths.map((s, si) =>
    si !== sub
      ? s
      : {
          ...s,
          nodes: s.nodes.map((n, i) => {
            if (i !== index) return n;
            const out: PathNode = { ...n, x: n.x + dx, y: n.y + dy };
            if (n.inX !== undefined) {
              out.inX = n.inX + dx;
              out.inY = n.inY! + dy;
            }
            if (n.outX !== undefined) {
              out.outX = n.outX + dx;
              out.outY = n.outY! + dy;
            }
            return out;
          }),
        },
  );
}

/**
 * A handle moved to (x, y). On a smooth point the other handle turns to stay in line, keeping its
 * length, unless `breakSmooth` (Alt held) lets the point become a corner.
 */
export function moveHandle(subpaths: readonly Subpath[], sub: number, index: number, which: 'in' | 'out', x: number, y: number, breakSmooth = false): Subpath[] {
  return subpaths.map((s, si) => {
    if (si !== sub) return s;
    return {
      ...s,
      nodes: s.nodes.map((n, i) => {
        if (i !== index) return n;
        const smooth = isSmooth(n);
        const out: PathNode = { ...n };
        if (which === 'in') {
          out.inX = x;
          out.inY = y;
        } else {
          out.outX = x;
          out.outY = y;
        }
        if (smooth && !breakSmooth) {
          const other = which === 'in' ? 'out' : 'in';
          const ox = other === 'in' ? n.inX! : n.outX!;
          const oy = other === 'in' ? n.inY! : n.outY!;
          const len = Math.hypot(ox - n.x, oy - n.y);
          const ang = Math.atan2(n.y - y, n.x - x);
          const nx = n.x + Math.cos(ang) * len;
          const ny = n.y + Math.sin(ang) * len;
          if (other === 'in') {
            out.inX = nx;
            out.inY = ny;
          } else {
            out.outX = nx;
            out.outY = ny;
          }
        }
        return out;
      }),
    };
  });
}

/**
 * Subpaths in some box, fitted to a fresh 0–100 box round their own bounds: returns the new
 * subpaths and where that box sits as fractions of the old one, so the layer's box can follow
 * and the shape stays exactly where it was. A flat side (a straight open line) keeps some depth.
 */
export function refitToBox(subpaths: readonly Subpath[], minSpan = 0.5): { subpaths: Subpath[]; crop: { x: number; y: number; w: number; h: number } } {
  const b = boundsOf(subpaths);
  let { x, y, w, h } = b;
  if (w < minSpan) {
    x -= (minSpan - w) / 2;
    w = minSpan;
  }
  if (h < minSpan) {
    y -= (minSpan - h) / 2;
    h = minSpan;
  }
  return { subpaths: mapSubpaths(subpaths, (px, py) => [((px - x) / w) * 100, ((py - y) / h) * 100]), crop: { x: x / 100, y: y / 100, w: w / 100, h: h / 100 } };
}
