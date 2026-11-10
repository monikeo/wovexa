'use client';
/**
 * The pen, drawn over the 2D artboard: click (or tap) for a corner, press and drag for a smooth
 * point, click the first point (or Finish, or Enter) to close the shape, Backspace removes the
 * last point, Escape cancels. Works with mouse, pen and touch; points are in artboard millimetres.
 */
import type { Canvas as FabricCanvas } from 'fabric';
import { Check, PenTool, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_PEN_POINTS, penPathData, type PenPoint } from '@/domain/pen';

/** Within this many screen pixels of the first point, a press closes the shape. */
const CLOSE_PX = 10;
/** A press that moves less than this many pixels is a corner, not a curve. */
const DRAG_PX = 3;

/**
 * `open`: an open line rather than a closed shape (the path for text on a path), finished with
 * Enter or Finish after two points or more.
 */
export function PenOverlay({ fabric, onFinish, onCancel, open = false }: { fabric: () => FabricCanvas | null; onFinish: (points: PenPoint[]) => void; onCancel: () => void; open?: boolean }) {
  const enough = open ? 2 : 3;
  const ref = useRef<SVGSVGElement>(null);
  const [points, setPoints] = useState<PenPoint[]>([]);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<{ id: number; index: number; x: number; y: number } | null>(null);
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

  const vpt = () => fabric()?.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  const toPx = (x: number, y: number): [number, number] => {
    const v = vpt();
    return [v[0] * x + v[4], v[3] * y + v[5]];
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  const toMm = (e: { clientX: number; clientY: number }) => {
    const v = vpt();
    const { px, py } = local(e);
    return { x: (px - v[4]) / v[0], y: (py - v[5]) / v[3] };
  };

  const finish = (pts: PenPoint[]) => {
    if (pts.length >= enough) onFinish(pts);
    else onCancel();
  };

  // Keys: Enter finishes, Backspace takes back a point, Escape cancels. Ahead of every other shortcut.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== 'Backspace' && e.key !== 'Delete') return;
      // Typing in a field or a dialog (the command palette, a text layer's words) keeps its keys.
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') {
        if (points.length >= enough) onFinish(points);
        else onCancel();
      } else setPoints((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [points, onFinish, onCancel, enough]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const { px, py } = local(e);
    if (!open && points.length >= 3) {
      const [fx, fy] = toPx(points[0].x, points[0].y);
      if (Math.hypot(px - fx, py - fy) <= CLOSE_PX) return finish(points);
    }
    if (points.length >= MAX_PEN_POINTS) return finish(points);
    const p = toMm(e);
    setPoints([...points, { x: p.x, y: p.y }]);
    setDragging({ id: e.pointerId, index: points.length, x: px, y: py });
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      // A pointer already released (or a synthetic one) can't be captured; the point is still placed.
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toMm(e);
    setHover(p);
    if (!dragging || dragging.id !== e.pointerId) return;
    const { px, py } = local(e);
    if (Math.hypot(px - dragging.x, py - dragging.y) < DRAG_PX) return;
    // Dragging out of a new point pulls its handle: the curve leaves the point toward the pointer.
    setPoints((pts) => pts.map((q, i) => (i === dragging.index ? { ...q, hx: p.x - q.x, hy: p.y - q.y } : q)));
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragging?.id === e.pointerId) setDragging(null);
  };

  const last = points[points.length - 1];
  const path = penPathData(points, false, toPx);
  const preview = !open && points.length > 2 ? penPathData(points, true, toPx) : '';
  const handle = last && (last.hx || last.hy) ? { a: toPx(last.x - (last.hx ?? 0), last.y - (last.hy ?? 0)), b: toPx(last.x + (last.hx ?? 0), last.y + (last.hy ?? 0)), p: toPx(last.x, last.y) } : null;
  const band = last && hover && !dragging ? { a: toPx(last.x, last.y), b: toPx(hover.x, hover.y) } : null;

  return (
    <>
      <svg
        ref={ref}
        className="absolute inset-0 z-10 h-full w-full touch-none"
        style={{ cursor: 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        role="application"
        aria-label={
          open
            ? 'Draw the line for your text: click for corners, drag for curves; press Enter to finish, Backspace removes a point, Escape cancels'
            : 'Pen: click for corners, drag for curves; click the first point or press Enter to finish, Backspace removes a point, Escape cancels'
        }
      >
        {preview ? <path d={preview} fill="var(--accent)" fillOpacity={0.12} stroke="none" /> : null}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        {band ? <line x1={band.a[0]} y1={band.a[1]} x2={band.b[0]} y2={band.b[1]} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" /> : null}
        {handle ? (
          <g stroke="var(--accent)" strokeWidth={1}>
            <line x1={handle.a[0]} y1={handle.a[1]} x2={handle.b[0]} y2={handle.b[1]} />
            <circle cx={handle.a[0]} cy={handle.a[1]} r={3} fill="white" />
            <circle cx={handle.b[0]} cy={handle.b[1]} r={3} fill="white" />
          </g>
        ) : null}
        {points.map((p, i) => {
          const [x, y] = toPx(p.x, p.y);
          // The first point grows once the shape can close on it.
          const r = i === 0 && !open && points.length >= 3 ? 5.5 : 3.5;
          return <rect key={i} x={x - r} y={y - r} width={r * 2} height={r * 2} fill={i === 0 ? 'var(--accent)' : 'white'} stroke="var(--accent)" strokeWidth={1.25} />;
        })}
      </svg>
      <div className="absolute left-1/2 top-7 z-20 flex w-max max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-xl border border-line bg-floating/95 p-1 pl-2.5 text-xs shadow-sm backdrop-blur [&>button]:flex-none">
        <PenTool size={14} className="flex-none text-[var(--accent)]" aria-hidden />
        <span className="mr-1 hidden min-w-0 truncate text-fg-2 sm:block">
          {open ? (points.length < 2 ? 'Draw the line for your text: click, or drag for curves' : 'Finish when the line is done') : points.length < 3 ? 'Click for corners, drag for curves' : 'Click the first point or Finish to close'}
        </span>
        <button className="icon-btn h-8 w-8" onClick={() => setPoints((p) => p.slice(0, -1))} disabled={!points.length} aria-label="Remove the last point" title="Remove the last point (Backspace)">
          <Undo2 size={15} />
        </button>
        <button className="btn btn-primary min-h-8 px-2.5 text-xs" onClick={() => finish(points)} disabled={points.length < enough} title={open ? 'Put text along the line (Enter)' : 'Close the shape (Enter)'}>
          <Check size={14} /> Finish
        </button>
        <button className="icon-btn h-8 w-8" onClick={onCancel} aria-label="Cancel the pen" title="Cancel (Esc)">
          <X size={15} />
        </button>
      </div>
    </>
  );
}
