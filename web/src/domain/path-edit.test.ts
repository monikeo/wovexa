import { describe, expect, it } from 'vitest';
import { boundsOf, cubicAt, deleteNode, flattenSubpath, isSmooth, moveHandle, nearestOnPath, parsePath, pathData, refitToBox, segmentsOf, splitSegment, toggleSmooth } from './path-edit';
import { penShape } from './pen';

describe('editable paths', () => {
  it('reads a pen shape back as the points it was drawn with', () => {
    const shape = penShape([{ x: 0, y: 0 }, { x: 40, y: 0, hx: 10, hy: 10 }, { x: 20, y: 30 }])!;
    const [sub] = parsePath(shape.path);
    expect(sub.closed).toBe(true);
    // Three points: the closing segment back to the first point is not a fourth.
    expect(sub.nodes).toHaveLength(3);
    // Writing it out again draws the same path.
    expect(parsePath(pathData([sub]))).toEqual([sub]);
  });

  it('turns relative, horizontal, vertical, quadratic and arc commands into lines and cubics', () => {
    const subs = parsePath('m10 10 h20 v20 q-10 10 -20 0 z M50 50 a10 10 0 1 0 20 0 a10 10 0 1 0 -20 0 z');
    expect(subs).toHaveLength(2);
    expect(subs[0].nodes.slice(0, 3).map((n) => [n.x, n.y])).toEqual([
      [10, 10],
      [30, 10],
      [30, 30],
    ]);
    // A circle of radius 10 centred on (60, 50), drawn as cubics: its bounds are the circle's.
    const b = boundsOf([subs[1]]);
    expect(b.x).toBeCloseTo(50, 1);
    expect(b.w).toBeCloseTo(20, 1);
    expect(b.h).toBeCloseTo(20, 1);
    for (const [x, y] of flattenSubpath(subs[1], 0.01)) expect(Math.hypot(x - 60, y - 50)).toBeCloseTo(10, 1);
  });

  it('reads arc flags written with nothing between them, as optimised SVGs write them', () => {
    // The same circle as above with each arc's two flags and its end point run together: in
    // "0 1020 0" the rotation is 0, the flags are 1 and 0, and the arc ends 20, 0 further on.
    const compact = parsePath('M50 50a10 10 0 1020 0a10 10 0 10-20 0z');
    const spaced = parsePath('M50 50a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z');
    expect(pathData(compact)).toBe(pathData(spaced));
    const b = boundsOf(compact);
    expect(b.x).toBeCloseTo(50, 1);
    expect(b.w).toBeCloseTo(20, 1);
    // Lucide's lightning bolt, as shipped: "a1.5 1.5 0 00-2.474-1.561" is flags 0 and 0, then the end point.
    const zap = parsePath('M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z');
    const z = boundsOf(zap);
    expect(z.x).toBeGreaterThan(2);
    expect(z.x + z.w).toBeLessThan(22);
    expect(z.y).toBeGreaterThan(1);
    expect(z.y + z.h).toBeLessThan(23);
    // A rotation still reads as a full number, and numbers elsewhere are untouched.
    expect(pathData(parsePath('M0 0L10 01'))).toBe('M0 0 L10 1');
  });

  it('adds a point on a curve without changing its shape', () => {
    const subs = parsePath('M0 0 C0 50 100 50 100 0');
    const before = cubicAt(segmentsOf(subs[0])[0], 0.3);
    const split = splitSegment(subs, 0, 0, 0.5);
    expect(split[0].nodes).toHaveLength(3);
    // The point on the old curve at t = 0.3 is on the first half at t = 0.6.
    const after = cubicAt(segmentsOf(split[0])[0], 0.6);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
    expect(isSmooth(split[0].nodes[1])).toBe(true);
  });

  it('finds the nearest point on the outline, to add points where clicked', () => {
    const hit = nearestOnPath(parsePath('M0 0 L100 0 L100 100 Z'), 50, 3)!;
    expect(hit.seg).toBe(0);
    expect(hit.x).toBeCloseTo(50, 3);
    expect(hit.dist).toBeCloseTo(3, 3);
  });

  it('switches corners and curves, keeps smooth handles in line, and deletes points', () => {
    let subs = parsePath('M0 0 L50 0 L100 0 L50 50 Z');
    subs = toggleSmooth(subs, 0, 1);
    expect(isSmooth(subs[0].nodes[1])).toBe(true);
    // Dragging one handle of a smooth point swings the other round with it.
    subs = moveHandle(subs, 0, 1, 'out', 60, 10);
    expect(isSmooth(subs[0].nodes[1])).toBe(true);
    // With Alt the point breaks into a corner.
    expect(isSmooth(moveHandle(subs, 0, 1, 'out', 60, -10, true)[0].nodes[1])).toBe(false);
    expect(deleteNode(subs, 0, 1)[0].nodes).toHaveLength(3);
    // A closed shape needs three points: deleting below that removes it.
    expect(deleteNode(parsePath('M0 0 L10 0 L5 5 Z'), 0, 0)).toEqual([]);
  });

  it('refits a box round points dragged past it, as fractions of the old box', () => {
    const { subpaths, crop } = refitToBox(parsePath('M0 0 L150 0 L150 50 L0 50 Z'));
    expect(crop).toEqual({ x: 0, y: 0, w: 1.5, h: 0.5 });
    expect(boundsOf(subpaths)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});
