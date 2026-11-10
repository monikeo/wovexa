'use client';
/**
 * Editing a shape's points (spec ED2-09), over the 2D artboard: drag a point or its handles, click
 * the outline to add a point there, double-click a point to switch it between corner and curve,
 * Delete removes the chosen point, arrows nudge it, Enter or Escape (or a click off the shape)
 * finishes. Alt while dragging a handle breaks a smooth point into a corner. Each drag is one undo step.
 */
import type { Canvas as FabricCanvas } from 'fabric';
import { Check, Spline, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { deleteNode, isSmooth, mapSubpaths, moveHandle, moveNode, nearestOnPath, parsePath, pathData, splitSegment, toggleSmooth, type Subpath } from '@/domain/path-edit';
import type { ArtworkLayer, ShapeContent } from '@/domain/schema';
import { shapeToBoxPath } from '@/domain/shape-path';

/** Clicks within this many screen pixels of the outline add a point; handles grab from a little further. */
const OUTLINE_PX = 8;

type Drag = { kind: 'node'; sub: number; index: number; from: [number, number]; start: Subpath[]; moved: boolean } | { kind: 'handle'; sub: number; index: number; which: 'in' | 'out'; moved: boolean };

export function PathEditOverlay({ fabric, layer, onCommit, onDone }: { fabric: () => FabricCanvas | null; layer: ArtworkLayer; onCommit: (subpaths: Subpath[]) => void; onDone: () => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const t = layer.transform;
  const source = shapeToBoxPath(layer.content as ShapeContent, t.widthMm, t.heightMm);
  const [subs, setSubs] = useState(() => parsePath(source));
  const [synced, setSynced] = useState(source);
  // An undo, or the committed edit coming back refitted, replaces what is shown.
  if (synced !== source) {
    setSynced(source);
    setSubs(parsePath(source));
  }
  const [sel, setSel] = useState<{ sub: number; index: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const lastPress = useRef<{ sub: number; index: number; at: number } | null>(null);
  // Redrawn as the artboard zooms and pans.
  const [, setView] = useState(0);
  useEffect(() => {
    const c = fabric();
    if (!c) return;
    const bump = () => setView((v) => v + 1);
    c.on('after:render', bump);
    return () => {
      c.off('after:render', bump);
    };
  }, [fabric]);

  const a = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const vpt = () => fabric()?.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  /** Box units (0–100 across the layer) to screen pixels. */
  const toScreen = (u: number, v: number): [number, number] => {
    let lx = (u / 100 - 0.5) * t.widthMm;
    let ly = (v / 100 - 0.5) * t.heightMm;
    if (t.flipX) lx = -lx;
    if (t.flipY) ly = -ly;
    const x = t.centerXmm + lx * cos - ly * sin;
    const y = t.centerYmm + lx * sin + ly * cos;
    const p = vpt();
    return [p[0] * x + p[4], p[3] * y + p[5]];
  };
  /** Screen pixels to box units. */
  const toBox = (px: number, py: number): [number, number] => {
    const p = vpt();
    const dx = (px - p[4]) / p[0] - t.centerXmm;
    const dy = (py - p[5]) / p[3] - t.centerYmm;
    let lx = dx * cos + dy * sin;
    let ly = -dx * sin + dy * cos;
    if (t.flipX) lx = -lx;
    if (t.flipY) ly = -ly;
    return [(lx / t.widthMm + 0.5) * 100, (ly / t.heightMm + 0.5) * 100];
  };
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const capture = (e: React.PointerEvent) => {
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      // A pointer already released (or a synthetic one) can't be captured.
    }
  };

  const commit = (next: Subpath[]) => {
    if (!next.length) return;
    setSubs(next);
    onCommit(next);
  };

  // Keys, ahead of the studio's own: Delete removes the chosen point, arrows nudge it, Enter or Escape finish.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return;
      const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onDone();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault();
        e.stopPropagation();
        const next = deleteNode(subs, sel.sub, sel.index);
        if (next.length) {
          setSel(null);
          commit(next);
        }
      } else if (nudge && sel) {
        e.preventDefault();
        e.stopPropagation();
        // Half a millimetre, or 5 mm with Shift, in the box's own units.
        const mm = e.shiftKey ? 5 : 0.5;
        commit(moveNode(subs, sel.sub, sel.index, (nudge[0] * mm * 100) / t.widthMm, (nudge[1] * mm * 100) / t.heightMm));
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const [px, py] = local(e);
    const target = (e.target as Element).closest('[data-node], [data-handle]');
    if (target) {
      const sub = Number(target.getAttribute('data-sub'));
      const index = Number(target.getAttribute('data-index'));
      const which = target.getAttribute('data-handle') as 'in' | 'out' | null;
      if (which) drag.current = { kind: 'handle', sub, index, which, moved: false };
      else {
        // A second press on the same point soon after is a double-click: corner or curve. (Pointer capture
        // sends the browser's own dblclick to the overlay, not the point, so it is counted here.)
        const last = lastPress.current;
        lastPress.current = { sub, index, at: e.timeStamp };
        if (last && last.sub === sub && last.index === index && e.timeStamp - last.at < 400) {
          lastPress.current = null;
          setSel({ sub, index });
          commit(toggleSmooth(subs, sub, index));
          return;
        }
        setSel({ sub, index });
        drag.current = { kind: 'node', sub, index, from: toBox(px, py), start: subs, moved: false };
      }
      capture(e);
      return;
    }
    // On the outline: a new point there, ready to drag.
    const [u, v] = toBox(px, py);
    const hit = nearestOnPath(subs, u, v);
    if (hit) {
      const [hx, hy] = toScreen(hit.x, hit.y);
      if (Math.hypot(hx - px, hy - py) <= OUTLINE_PX) {
        const next = splitSegment(subs, hit.sub, hit.seg, hit.t);
        setSubs(next);
        setSel({ sub: hit.sub, index: hit.seg + 1 });
        drag.current = { kind: 'node', sub: hit.sub, index: hit.seg + 1, from: [u, v], start: next, moved: true };
        capture(e);
        return;
      }
    }
    // Anywhere else finishes.
    onDone();
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const [u, v] = toBox(...local(e));
    if (d.kind === 'node') setSubs(moveNode(d.start, d.sub, d.index, u - d.from[0], v - d.from[1]));
    else setSubs((s) => moveHandle(s, d.sub, d.index, d.which, u, v, e.altKey));
    d.moved = true;
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) onCommit(subs);
  };
  const screenSubs = mapSubpaths(subs, toScreen);
  const outline = pathData(screenSubs);
  const chosen = sel ? subs[sel.sub]?.nodes[sel.index] : undefined;
  const handleOf = (which: 'in' | 'out') => {
    if (!chosen || !sel) return null;
    const hx = which === 'in' ? chosen.inX : chosen.outX;
    const hy = which === 'in' ? chosen.inY : chosen.outY;
    if (hx === undefined || hy === undefined || (Math.abs(hx - chosen.x) < 1e-6 && Math.abs(hy - chosen.y) < 1e-6)) return null;
    return { which, p: toScreen(hx, hy), a: toScreen(chosen.x, chosen.y) };
  };
  const handles = [handleOf('in'), handleOf('out')].filter((h): h is NonNullable<typeof h> => !!h);

  return (
    <>
      <svg
        ref={ref}
        className="absolute inset-0 z-10 h-full w-full touch-none"
        style={{ cursor: 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="application"
        aria-label="Editing points: drag a point or its handles, click the outline to add a point, double-click a point for a corner or a curve, Delete removes it, Enter finishes"
      >
        <path d={outline} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        {/* A wider invisible outline, so a point can be added anywhere along it. */}
        <path d={outline} fill="none" stroke="transparent" strokeWidth={OUTLINE_PX * 2} style={{ cursor: 'copy' }} />
        {handles.map((h) => (
          <g key={h.which}>
            <line x1={h.a[0]} y1={h.a[1]} x2={h.p[0]} y2={h.p[1]} stroke="var(--accent)" strokeWidth={1} />
            <circle data-handle={h.which} data-sub={sel!.sub} data-index={sel!.index} cx={h.p[0]} cy={h.p[1]} r={5} fill="white" stroke="var(--accent)" strokeWidth={1.25} style={{ cursor: 'move' }} />
          </g>
        ))}
        {screenSubs.map((s, si) =>
          s.nodes.map((n, i) => {
            const on = sel?.sub === si && sel.index === i;
            const smooth = isSmooth(subs[si].nodes[i]);
            const r = on ? 5 : 4;
            return smooth ? (
              <circle key={`${si}-${i}`} data-node="" data-sub={si} data-index={i} cx={n.x} cy={n.y} r={r} fill={on ? 'var(--accent)' : 'white'} stroke="var(--accent)" strokeWidth={1.25} style={{ cursor: 'move' }} />
            ) : (
              <rect key={`${si}-${i}`} data-node="" data-sub={si} data-index={i} x={n.x - r} y={n.y - r} width={r * 2} height={r * 2} fill={on ? 'var(--accent)' : 'white'} stroke="var(--accent)" strokeWidth={1.25} style={{ cursor: 'move' }} />
            );
          }),
        )}
      </svg>
      <div className="absolute left-1/2 top-7 z-20 flex w-max max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-xl border border-line bg-floating/95 p-1 pl-2.5 text-xs shadow-sm backdrop-blur [&>button]:flex-none">
        <Spline size={14} className="flex-none text-[var(--accent)]" aria-hidden />
        <span className="mr-1 hidden min-w-0 truncate text-fg-2 sm:block">{sel ? 'Drag the point or its handles' : 'Drag points; click the outline to add one'}</span>
        <button className="icon-btn h-8 w-8" disabled={!sel} onClick={() => sel && commit(toggleSmooth(subs, sel.sub, sel.index))} aria-label="Switch the point between corner and curve" title="Corner or curve (double-click a point)">
          <Spline size={15} />
        </button>
        <button
          className="icon-btn h-8 w-8"
          disabled={!sel}
          onClick={() => {
            if (!sel) return;
            const next = deleteNode(subs, sel.sub, sel.index);
            if (next.length) {
              setSel(null);
              commit(next);
            }
          }}
          aria-label="Delete the point"
          title="Delete the point (Delete)"
        >
          <Trash2 size={15} />
        </button>
        <button className="btn btn-primary min-h-8 px-2.5 text-xs" onClick={onDone} title="Finish editing points (Enter)">
          <Check size={14} /> Done
        </button>
      </div>
    </>
  );
}
