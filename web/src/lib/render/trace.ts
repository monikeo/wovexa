/**
 * Raster to vector for print and cut files (spec EXP-10): trace where a field crosses zero into
 * closed outlines (marching squares, interpolated between pixel centres), then drop the points a
 * cutter would never notice. Pure, so it runs the same in tests and in the browser.
 */

export type Ring = [number, number][];

/**
 * Closed outlines where `field` (w × h, row by row, positive inside) crosses zero. Outside the grid
 * counts as outside, so every outline closes. Points are in pixels, pixel centres at (i + 0.5, j + 0.5).
 * Holes come out as rings of their own: fill the result with the even-odd rule.
 */
export function traceContours(field: ArrayLike<number>, w: number, h: number): Ring[] {
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? -1 : field[j * w + i]);
  // Edges are keyed on the padded grid: horizontal ones between (i, j) and (i + 1, j), vertical ones between (i, j) and (i, j + 1).
  const stride = w + 2;
  const key = (i: number, j: number, vertical: boolean) => ((j + 1) * stride + (i + 1)) * 2 + (vertical ? 1 : 0);
  const points = new Map<number, [number, number]>();
  const point = (i: number, j: number, vertical: boolean): number => {
    const k = key(i, j, vertical);
    if (!points.has(k)) {
      const a = at(i, j);
      const b = vertical ? at(i, j + 1) : at(i + 1, j);
      const t = a / (a - b);
      points.set(k, vertical ? [i + 0.5, j + 0.5 + t] : [i + 0.5 + t, j + 0.5]);
    }
    return k;
  };
  const segments: [number, number][] = [];
  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      const index = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
      if (index === 0 || index === 15) continue;
      const top = () => point(i, j, false);
      const bottom = () => point(i, j + 1, false);
      const left = () => point(i, j, true);
      const right = () => point(i + 1, j, true);
      const centreInside = (a + b + c + d) / 4 > 0;
      switch (index) {
        case 1:
        case 14:
          segments.push([left(), bottom()]);
          break;
        case 2:
        case 13:
          segments.push([bottom(), right()]);
          break;
        case 3:
        case 12:
          segments.push([left(), right()]);
          break;
        case 4:
        case 11:
          segments.push([top(), right()]);
          break;
        case 6:
        case 9:
          segments.push([top(), bottom()]);
          break;
        case 7:
        case 8:
          segments.push([top(), left()]);
          break;
        case 5:
          // b and d inside: joined through the middle, or two separate corners.
          if (centreInside) segments.push([top(), left()], [bottom(), right()]);
          else segments.push([left(), bottom()], [top(), right()]);
          break;
        case 10:
          // a and c inside.
          if (centreInside) segments.push([top(), right()], [left(), bottom()]);
          else segments.push([top(), left()], [bottom(), right()]);
          break;
      }
    }
  }
  // Each crossing point joins exactly two segments: walk them into rings.
  const byPoint = new Map<number, number[]>();
  segments.forEach(([p, q], s) => {
    for (const k of [p, q]) {
      const list = byPoint.get(k);
      if (list) list.push(s);
      else byPoint.set(k, [s]);
    }
  });
  const used = new Uint8Array(segments.length);
  const rings: Ring[] = [];
  for (let s0 = 0; s0 < segments.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const start = segments[s0][0];
    let current = segments[s0][1];
    const ring: Ring = [points.get(start)!];
    for (let guard = 0; current !== start && guard < segments.length; guard++) {
      ring.push(points.get(current)!);
      const next = byPoint.get(current)?.find((s) => !used[s]);
      if (next === undefined) break;
      used[next] = 1;
      current = segments[next][0] === current ? segments[next][1] : segments[next][0];
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Distance from p to the segment a–b. */
function segmentDistance(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer–Douglas–Peucker on an open line: keep only points farther than `tolerance` from the simplified line. */
function simplifyLine(points: Ring, tolerance: number): Ring {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last]);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A closed outline with the points within `tolerance` of its line left out (split at its two farthest-apart points). */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring.slice();
  let far = 0;
  let best = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplifyLine(ring.slice(0, far + 1), tolerance);
  const b = simplifyLine([...ring.slice(far), ring[0]], tolerance);
  return [...a, ...b.slice(1, -1)];
}

/** Rings as SVG path data, mapped by `to` and rounded to a hundredth. */
export function ringsPath(rings: Ring[], to: (p: [number, number]) => [number, number]): string {
  const n = (x: number) => String(Math.round(x * 100) / 100);
  return rings
    .map((ring) => {
      const pts = ring.map(to);
      return `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;
    })
    .join('');
}

/** Area enclosed by a ring (positive either way round). */
export function ringArea(ring: Ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}
