'use client';
/**
 * Crop and frame a photo (spec ED2-10): a box over the whole image, moved by dragging, sized by its
 * corners, the arrow keys or the zoom slider. Crop keeps the photo where it is and fits the layer
 * to what is kept; Frame keeps the layer's shape (a circle badge, say) and moves or zooms the photo
 * inside it.
 */
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { clamp, fitCrop, FULL_CROP, isFullCrop, type CropRect } from '@/domain/geometry';
import type { ImageContent } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from '@/lib/assets';
import { imageSource } from '@/lib/render/zone-renderer';

const ASPECTS: { id: string; label: string; ratio: number | 'image' | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: 'original', label: 'Original', ratio: 'image' },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

/** Smallest crop side, as a share of the image. */
const MIN = 0.03;
const VIEW_W = 264;
const VIEW_H = 240;
type Handle = 'nw' | 'ne' | 'sw' | 'se';

const round = (k: CropRect): CropRect => ({ x: +k.x.toFixed(5), y: +k.y.toFixed(5), w: +k.w.toFixed(5), h: +k.h.toFixed(5) });

const line = (to: string, at: string) => `linear-gradient(to ${to}, transparent calc(${at} - 0.5px), rgba(255,255,255,0.35) calc(${at} - 0.5px), rgba(255,255,255,0.35) calc(${at} + 0.5px), transparent calc(${at} + 0.5px))`;
const THIRDS = [line('right', '33.333%'), line('right', '66.667%'), line('bottom', '33.333%'), line('bottom', '66.667%')].join(', ');

export function CropEditor({
  content,
  mode,
  boxAspect,
  onApply,
  onClose,
}: {
  content: ImageContent;
  mode: 'crop' | 'frame';
  /** The layer box's width ÷ height: a frame keeps it. */
  boxAspect: number;
  onApply: (crop: CropRect | undefined) => void;
  onClose: () => void;
}) {
  const natW = content.naturalWidthPx;
  const natH = content.naturalHeightPx;
  const scale = Math.min(VIEW_W / natW, VIEW_H / natH);
  const viewW = Math.round(natW * scale);
  const viewH = Math.round(natH * scale);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(() => !!getLoadedImage(content.assetId));
  const [aspectId, setAspectId] = useState(mode === 'frame' ? 'frame' : 'free');
  const ratio = mode === 'frame' ? boxAspect : (() => {
    const r = ASPECTS.find((a) => a.id === aspectId)?.ratio ?? null;
    return r === 'image' ? natW / natH : r;
  })();
  const [rect, setRect] = useState<CropRect>(() => {
    const current = content.crop ?? FULL_CROP;
    if (mode === 'crop') return current;
    // A frame keeps the box's proportions: start from the current crop when it already has them.
    const shown = (current.w * natW) / (current.h * natH);
    return Math.abs(shown / boxAspect - 1) < 0.01 ? current : fitCrop(boxAspect, natW, natH, current.x + current.w / 2, current.y + current.h / 2);
  });
  const drag = useRef<{ kind: 'move' | Handle; x: number; y: number; start: CropRect } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Opened from the palette or the canvas menu, it may start below the fold.
  useEffect(() => {
    // Braced: scrollIntoView returns a promise in newer browsers, which an effect must not return.
    rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  // The whole image (with its adjustments), drawn once it is decoded.
  useEffect(() => {
    if (!loaded) {
      let live = true;
      loadAssetImage(content.assetId).then(
        () => live && setLoaded(true),
        () => {},
      );
      return () => {
        live = false;
      };
    }
    const canvas = canvasRef.current;
    const src = imageSource(content);
    if (!canvas || !src) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  }, [content, loaded, viewW, viewH]);

  /** A crop resized to `ratio` (pixels), within the image, anchored at the corner opposite `handle`. */
  const sized = (start: CropRect, handle: Handle, px: number, py: number): CropRect => {
    const ax = handle.includes('w') ? start.x + start.w : start.x;
    const ay = handle.includes('n') ? start.y + start.h : start.y;
    const right = !handle.includes('w');
    const down = !handle.includes('n');
    const maxW = right ? 1 - ax : ax;
    const maxH = down ? 1 - ay : ay;
    let w = clamp(Math.abs(px - ax), MIN, maxW);
    let h = clamp(Math.abs(py - ay), MIN, maxH);
    if (ratio) {
      // Follow whichever side the pointer pulls further, then fit inside the image.
      const hFromW = (w * natW) / (ratio * natH);
      if (hFromW >= h) h = hFromW;
      else w = (h * ratio * natH) / natW;
      if (w > maxW) {
        w = maxW;
        h = (w * natW) / (ratio * natH);
      }
      if (h > maxH) {
        h = maxH;
        w = (h * ratio * natH) / natW;
      }
    }
    return { x: right ? ax : ax - w, y: down ? ay : ay - h, w, h };
  };

  const beginDrag = (e: React.PointerEvent, kind: 'move' | Handle) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can't be captured; the drag still works while the pointer stays over the box.
    }
    drag.current = { kind, x: e.clientX, y: e.clientY, start: rect };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / viewW;
    const dy = (e.clientY - d.y) / viewH;
    if (d.kind === 'move') setRect({ ...d.start, x: clamp(d.start.x + dx, 0, 1 - d.start.w), y: clamp(d.start.y + dy, 0, 1 - d.start.h) });
    else {
      const px = (d.kind.includes('w') ? d.start.x : d.start.x + d.start.w) + dx;
      const py = (d.kind.includes('n') ? d.start.y : d.start.y + d.start.h) + dy;
      setRect(sized(d.start, d.kind, px, py));
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // Zoom: the largest crop of these proportions that fits, made smaller about its centre.
  const largest = ratio ? fitCrop(ratio, natW, natH) : null;
  const zoom = largest ? Math.max(1, largest.w / rect.w) : 1;
  const zoomTo = (z: number) => largest && setRect(fitCrop(ratio!, natW, natH, rect.x + rect.w / 2, rect.y + rect.h / 2, clamp(z, 1, 8)));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    const zoomKey = (e.key === '+' || e.key === '=' || e.key === '-') && !!largest;
    if (!move && !zoomKey && e.key !== 'Enter' && e.key !== 'Escape') return;
    // These keys are the crop box's: the studio must not also nudge the layer or zoom the canvas.
    e.preventDefault();
    e.stopPropagation();
    if (move) setRect((r) => ({ ...r, x: clamp(r.x + move[0], 0, 1 - r.w), y: clamp(r.y + move[1], 0, 1 - r.h) }));
    else if (zoomKey) zoomTo(zoom * (e.key === '-' ? 1 / 1.1 : 1.1));
    else if (e.key === 'Enter') onApply(isFullCrop(rect) ? undefined : round(rect));
    else onClose();
  };

  const pick = (id: string) => {
    setAspectId(id);
    const r = ASPECTS.find((a) => a.id === id)?.ratio ?? null;
    const px = r === 'image' ? natW / natH : r;
    if (px) setRect(fitCrop(px, natW, natH, rect.x + rect.w / 2, rect.y + rect.h / 2));
  };

  const reset = () => setRect(mode === 'frame' ? fitCrop(boxAspect, natW, natH) : ratio ? fitCrop(ratio, natW, natH) : FULL_CROP);
  const handles: Handle[] = ['nw', 'ne', 'sw', 'se'];
  const kept = Math.round(rect.w * natW) + ' × ' + Math.round(rect.h * natH) + ' px';

  return (
    <div ref={rootRef} className="space-y-2 rounded-lg border border-line p-3" role="group" aria-label={mode === 'frame' ? 'Move the photo in its frame' : 'Crop the image'}>
      <p className="text-xs text-fg-2">
        {mode === 'frame' ? 'Drag the box to choose what shows in the frame; a smaller box zooms in. The layer keeps its shape.' : 'Drag the box or its corners. What you keep stays where it is on the garment.'}
      </p>
      {mode === 'crop' ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Crop proportions">
          {ASPECTS.map((a) => (
            <button key={a.id} className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-fg-2 aria-pressed:border-[var(--accent)] aria-pressed:text-fg" aria-pressed={aspectId === a.id} onClick={() => pick(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="relative mx-auto touch-none select-none overflow-hidden rounded-md bg-[repeating-conic-gradient(#8883_0%_25%,transparent_0%_50%)] [background-size:12px_12px]" style={{ width: viewW, height: viewH }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
        {!loaded ? (
          <div className="absolute inset-0 grid place-items-center text-fg-2">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : null}
        <div
          className="absolute cursor-move outline-none ring-2 ring-white focus-visible:ring-[var(--accent)]"
          style={{ left: rect.x * viewW, top: rect.y * viewH, width: rect.w * viewW, height: rect.h * viewH, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
          tabIndex={0}
          role="group"
          aria-label={`Kept area ${kept}. Drag or use the arrow keys to move it${largest ? ', plus and minus to zoom' : ''}; Enter applies.`}
          onPointerDown={(e) => beginDrag(e, 'move')}
          onKeyDown={onKeyDown}
        >
          {/* Thirds, for composing. */}
          <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: THIRDS }} />
          {handles.map((h) => (
            <span
              key={h}
              className="absolute h-3.5 w-3.5 rounded-sm border border-black/40 bg-white"
              style={{ left: h.includes('w') ? -7 : undefined, right: h.includes('e') ? -7 : undefined, top: h.includes('n') ? -7 : undefined, bottom: h.includes('s') ? -7 : undefined, cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize' }}
              onPointerDown={(e) => beginDrag(e, h)}
              aria-hidden
            />
          ))}
        </div>
      </div>
      <p className="num text-center text-[11px] text-fg-3">Keeps {kept} of {natW} × {natH} px</p>
      {largest ? (
        <label className="grid grid-cols-[52px_1fr_44px] items-center gap-2">
          <span className="label">Zoom</span>
          <input type="range" min={1} max={8} step={0.05} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} className="min-w-0 accent-[var(--accent)]" aria-valuetext={`${Math.round(zoom * 100)}%`} />
          <span className="num text-right text-xs text-fg-2">{Math.round(zoom * 100)}%</span>
        </label>
      ) : null}
      <div className="flex gap-2">
        <button className="btn btn-ghost px-2 text-xs" onClick={reset} title={mode === 'frame' ? 'Fit the whole photo the frame can show' : 'Keep the whole image'}>
          <RotateCcw size={13} /> Reset
        </button>
        <button className="btn btn-outline ml-auto px-3 text-xs" onClick={onClose}>
          <X size={13} /> Cancel
        </button>
        <button className="btn btn-primary px-3 text-xs" onClick={() => onApply(isFullCrop(rect) ? undefined : round(rect))}>
          <Check size={13} /> Apply
        </button>
      </div>
    </div>
  );
}
