'use client';
/**
 * The pencil and the brush, drawn over the 2D artboard: press and draw, and each stroke becomes a
 * layer as the pointer lifts, with the tool still on for the next one. A stylus presses the brush
 * thicker. Escape (or Done) puts the tool away. Points are in artboard millimetres.
 */
import type { Canvas as FabricCanvas } from 'fabric';
import { Brush as BrushIcon, Check, Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BRUSH_LABELS, BRUSHES, MAX_STROKE_POINTS, type Brush, type StrokePoint } from '@/lib/freehand';
import type { FreehandSettings } from '../actions';

/** Screen pixels the pointer moves before the next sample is kept. */
const SAMPLE_PX = 0.75;

export function FreehandOverlay({
  fabric,
  tool,
  settings,
  onSettings,
  onTool,
  onStroke,
  onDone,
}: {
  fabric: () => FabricCanvas | null;
  tool: 'pencil' | 'brush';
  settings: FreehandSettings;
  onSettings: (next: FreehandSettings) => void;
  onTool: (tool: 'pencil' | 'brush') => void;
  onStroke: (points: StrokePoint[]) => void;
  onDone: () => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  // The stroke as it is drawn (the handlers' working copy) and as last shown.
  const points = useRef<StrokePoint[] | null>(null);
  const [drawn, setDrawn] = useState<StrokePoint[] | null>(null);
  const pointer = useRef<number | null>(null);
  // Redrawn as the artboard zooms and pans.
  const [, setFrame] = useState(0);
  useEffect(() => {
    const c = fabric();
    if (!c) return;
    const bump = () => setFrame((f) => f + 1);
    c.on('after:render', bump);
    return () => {
      c.off('after:render', bump);
    };
  }, [fabric]);

  // Escape puts the tool away, ahead of every other shortcut; typing in a field keeps its keys.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      e.stopPropagation();
      onDone();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onDone]);

  const vpt = () => fabric()?.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  const toPx = (x: number, y: number): [number, number] => {
    const v = vpt();
    return [v[0] * x + v[4], v[3] * y + v[5]];
  };
  const toMm = (e: { clientX: number; clientY: number }) => {
    const v = vpt();
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - v[4]) / v[0], y: (e.clientY - r.top - v[5]) / v[3] };
  };
  const sample = (e: PointerEvent): StrokePoint => ({ ...toMm(e), ...(e.pointerType === 'pen' && e.pressure > 0 ? { p: e.pressure } : {}) });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointer.current !== null) return;
    e.preventDefault();
    e.stopPropagation();
    pointer.current = e.pointerId;
    points.current = [sample(e.nativeEvent)];
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that can't be captured still draws while it stays over the artboard.
    }
    setDrawn(points.current.slice());
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointer.current !== e.pointerId || !points.current) return;
    const scale = Math.abs(vpt()[0]) || 1;
    // Every sample the browser saw since the last frame, for a stroke as smooth as the hand.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const p = sample(ev);
      const last = points.current[points.current.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) * scale < SAMPLE_PX) continue;
      if (points.current.length >= MAX_STROKE_POINTS) break;
      points.current.push(p);
    }
    setDrawn(points.current.slice());
  };
  const finish = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    const done = points.current;
    points.current = null;
    setDrawn(null);
    if (done?.length) onStroke(done);
  };

  const pts = drawn;
  const preview = pts?.length ? pts.map((p, i) => `${i ? 'L' : 'M'}${toPx(p.x, p.y).join(' ')}`).join(' ') : '';
  const widthPx = Math.max(1, settings.widthMm * Math.abs(vpt()[0]));
  const set = (patch: Partial<FreehandSettings>) => onSettings({ ...settings, ...patch });

  return (
    <>
      <svg
        ref={ref}
        className="absolute inset-0 z-10 h-full w-full touch-none"
        style={{ cursor: 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        role="application"
        aria-label={`${tool === 'pencil' ? 'Pencil' : 'Brush'}: press and draw; each stroke becomes a layer. Escape puts the tool away.`}
      >
        {preview ? (
          pts!.length === 1 ? (
            <circle cx={toPx(pts![0].x, pts![0].y)[0]} cy={toPx(pts![0].x, pts![0].y)[1]} r={widthPx / 2} fill="var(--accent)" fillOpacity={0.8} />
          ) : (
            <path d={preview} fill="none" stroke="var(--accent)" strokeOpacity={0.8} strokeWidth={widthPx} strokeLinecap={tool === 'brush' && settings.brush === 'marker' ? 'butt' : 'round'} strokeLinejoin="round" />
          )
        ) : null}
      </svg>
      <div className="absolute left-1/2 top-7 z-20 flex w-max max-w-[calc(100%-1rem)] -translate-x-1/2 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-floating/95 p-1 pl-1.5 text-xs shadow-sm backdrop-blur">
        <div className="seg" role="group" aria-label="Drawing tool">
          <button aria-pressed={tool === 'pencil'} onClick={() => onTool('pencil')} title="Pencil: a smooth line you can edit point by point (N)">
            <Pencil size={14} /> Pencil
          </button>
          <button aria-pressed={tool === 'brush'} onClick={() => onTool('brush')} title="Brush: a filled stroke, thicker where a stylus presses (B)">
            <BrushIcon size={14} /> Brush
          </button>
        </div>
        {tool === 'brush' ? (
          <select className="field h-8 w-auto py-0 text-xs" aria-label="Brush" value={settings.brush} onChange={(e) => set({ brush: e.target.value as Brush })}>
            {BRUSHES.map((b) => (
              <option key={b} value={b}>
                {BRUSH_LABELS[b]}
              </option>
            ))}
          </select>
        ) : null}
        <label className="flex items-center gap-1.5 text-fg-2">
          Width
          <input type="range" min={0.3} max={15} step={0.1} value={settings.widthMm} onChange={(e) => set({ widthMm: Number(e.target.value) })} className="w-20 accent-[var(--accent)]" aria-valuetext={`${settings.widthMm} mm`} />
          <span className="num w-11 text-fg">{settings.widthMm.toFixed(1)} mm</span>
        </label>
        <label className="flex items-center gap-1.5 text-fg-2">
          Smooth
          <input type="range" min={0} max={1} step={0.05} value={settings.smoothing} onChange={(e) => set({ smoothing: Number(e.target.value) })} className="w-16 accent-[var(--accent)]" aria-valuetext={`${Math.round(settings.smoothing * 100)}%`} />
        </label>
        <button className="btn btn-primary min-h-8 px-2.5 text-xs" onClick={onDone} title="Put the tool away (Esc)">
          <Check size={14} /> Done
        </button>
      </div>
    </>
  );
}
