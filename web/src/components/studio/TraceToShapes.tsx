'use client';
/**
 * Trace an image into vector shapes: choose how many colours, how much detail and what happens to
 * the colour around the artwork, watch the preview, then put the shapes in place of the image.
 * Everything runs on this device; the image is kept, hidden underneath, unless asked otherwise.
 */
import { AlertTriangle, Loader2, Shapes } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { artboardOf } from '@/domain/areas';
import * as cmd from '@/domain/commands';
import type { ArtworkLayer } from '@/domain/schema';
import { toast } from '@/components/ui/primitives';
import { MAX_TRACE_COLOURS, TRACE_DEFAULTS, TraceError, traceImageLayer, type TracedImage, type TraceOptions } from '@/lib/vectorize';
import { useStudio } from '@/stores/studio-store';

/** The preview traces smaller than the real thing, so it keeps up with the sliders. */
const PREVIEW_SIDE = 420;

const DETAILS: { id: TraceOptions['detail']; label: string; title: string }[] = [
  { id: 'low', label: 'Low', title: 'Smooth, simple outlines: bold logos and stencils' },
  { id: 'medium', label: 'Medium', title: 'Close to the image, with specks cleaned up' },
  { id: 'high', label: 'High', title: 'Every fine line and small detail' },
];

const BACKGROUNDS: { id: TraceOptions['background']; label: string; title: string }[] = [
  { id: 'everywhere', label: 'Leave out', title: 'Leave out the colour around the artwork, inside it too (like the middle of an O)' },
  { id: 'around', label: 'Only around', title: 'Leave it out around the artwork, keep enclosed areas of it (like white details inside a badge)' },
  { id: 'keep', label: 'Keep', title: 'Trace the background as a colour too' },
];

function traceMessage(error: unknown) {
  if (error instanceof TraceError) return error.message;
  // Unexpected: worth seeing while developing.
  if (process.env.NODE_ENV !== 'production') console.error(error);
  return 'This image couldn’t be traced. Try fewer colours or less detail.';
}

export function TraceToShapes({ layer }: { layer: ArtworkLayer }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<TraceOptions>(TRACE_DEFAULTS);
  const [keepImage, setKeepImage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ key: string; traced: TracedImage | null; error?: string } | null>(null);

  // Opened from the command palette or the canvas menu.
  useEffect(() => {
    const show = (e: Event) => {
      if ((e as CustomEvent<{ layerId: string }>).detail?.layerId === layer.id) setOpen(true);
    };
    window.addEventListener('wovexa:trace', show);
    return () => window.removeEventListener('wovexa:trace', show);
  }, [layer.id]);
  // The panel sits low in the image's settings: bring it into view when it opens (on phones it is below the fold).
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [open]);

  // A new preview a moment after the options or the image change.
  const key = JSON.stringify([opts, layer.transform.widthMm, layer.transform.heightMm, layer.content]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(() => {
      traceImageLayer(layer, opts, PREVIEW_SIDE).then(
        (traced) => live && setResult({ key, traced }),
        (error: unknown) => live && setResult({ key, traced: null, error: traceMessage(error) }),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, key, layer, opts]);

  if (layer.content.kind !== 'image') return null;
  const previewing = open && result?.key !== key;
  const preview = result?.traced;
  const set = (patch: Partial<TraceOptions>) => setOpts((o) => ({ ...o, ...patch }));

  const apply = async () => {
    setBusy(true);
    // Where the image is now: the shapes go there, even if another artboard is opened meanwhile.
    const zoneId = useStudio.getState().activeZoneId;
    const from = layer;
    try {
      const traced = await traceImageLayer(from, opts);
      if (!traced.layers.length) return void toast('Nothing was left to trace. Keep the background, or choose more colours.', 'error');
      const s = useStudio.getState();
      const zone = s.document ? artboardOf(s.document, zoneId) : undefined;
      const now = zone?.layers[from.id];
      if (!zone || !now) return void toast('The image is no longer on this artboard.', 'error');
      if (now.locked) return void toast('Unlock the image to trace it.', 'error');
      // Moved, resized or edited while it was traced: the shapes would land where it was.
      if (now.transform !== from.transform || now.content !== from.content) return void toast('The image changed while it was being traced. Trace it again.', 'error');
      // Just above the image, past the rest of its group, so groups stay together in the stack.
      const order = zone.orderedLayerIds;
      const group = now.groupId;
      const last = group ? Math.max(...order.map((id, i) => (zone.layers[id]?.groupId === group ? i : -1))) : order.indexOf(from.id);
      const commands = traced.layers.map((l, i) => cmd.addLayer(zoneId, l, last + 1 + i));
      commands.push(keepImage ? cmd.updateLayer(zoneId, from.id, { visible: false }, 'Hide image') : cmd.removeLayers(zoneId, [from.id]));
      if (!s.dispatch(cmd.batch('Trace to shapes', commands))) return;
      s.select(traced.layers.map((l) => l.id));
      const n = traced.layers.length;
      toast(
        `Traced into ${n} colour shape${n === 1 ? '' : 's'}${keepImage ? '. The image is hidden underneath.' : '.'}${traced.loosened ? ' Some outlines were simplified to keep the shapes a workable size.' : ''}`,
        'success',
      );
      setOpen(false);
    } catch (error) {
      toast(traceMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const aspect = layer.transform.widthMm / layer.transform.heightMm;
  return (
    <div className="space-y-2">
      <button className="btn btn-outline w-full text-xs" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={layer.locked} title="Redraw the image as flat colour shapes">
        <Shapes size={14} /> Trace to shapes
      </button>
      {open ? (
        <div ref={panelRef} className="space-y-2.5 rounded-lg border border-line p-3" data-testid="trace-panel">
          <p className="text-xs text-fg-2">Redraws the image as flat colour shapes you can recolour, reshape point by point and print at any size. Works best on logos and flat artwork.</p>
          <label className="grid grid-cols-[64px_1fr_24px] items-center gap-2 text-xs">
            <span className="text-fg-2">Colours</span>
            <input type="range" min={1} max={MAX_TRACE_COLOURS} value={opts.colours} onChange={(e) => set({ colours: Number(e.target.value) })} className="accent-[var(--accent)]" aria-label="Number of colours" />
            <span className="num text-right">{opts.colours}</span>
          </label>
          <div className="grid grid-cols-[64px_1fr] items-center gap-2 text-xs">
            <span className="text-fg-2">Detail</span>
            <div className="seg w-fit" role="group" aria-label="Detail">
              {DETAILS.map((d) => (
                <button key={d.id} aria-pressed={opts.detail === d.id} title={d.title} onClick={() => set({ detail: d.id })}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[64px_1fr] items-center gap-2 text-xs">
            <span className="text-fg-2">Background</span>
            <div className="seg w-fit" role="group" aria-label="Background colour">
              {BACKGROUNDS.map((b) => (
                <button key={b.id} aria-pressed={opts.background === b.id} title={b.title} onClick={() => set({ background: b.id })}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="relative mx-auto max-h-56 w-full overflow-hidden rounded-md border border-line bg-[repeating-conic-gradient(#8883_0%_25%,transparent_0%_50%)] [background-size:12px_12px]"
            style={{ aspectRatio: String(Math.max(0.25, Math.min(4, aspect))) }}
          >
            {preview ? (
              <svg viewBox={`0 0 ${preview.preview.width} ${preview.preview.height}`} className="absolute inset-0 h-full w-full" role="img" aria-label={`Preview: ${preview.layers.length} colour shapes`}>
                {preview.preview.shapes.map((s, i) => (
                  <path key={i} d={s.d} fill={s.hex} fillRule="evenodd" />
                ))}
              </svg>
            ) : null}
            {previewing ? (
              <span className="absolute inset-0 grid place-items-center bg-panel/40">
                <Loader2 size={18} className="animate-spin text-fg-2" aria-label="Tracing the preview" />
              </span>
            ) : null}
          </div>

          {result?.error && !previewing ? <p className="text-xs text-danger">{result.error}</p> : null}
          {preview ? (
            <div className="space-y-1 text-xs text-fg-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span>
                  {preview.layers.length ? `${preview.layers.length} colour${preview.layers.length === 1 ? '' : 's'}` : 'Nothing left to trace'}
                </span>
                {preview.layers.map((l) => (
                  <span key={l.id} className="h-3.5 w-3.5 rounded-full border border-line" style={{ background: l.content.kind === 'shape' ? l.content.fill : undefined }} title={l.content.kind === 'shape' ? l.content.fill : undefined} />
                ))}
              </div>
              {preview.background && opts.background !== 'keep' ? <p>Leaves out {preview.background}, the colour around the artwork.</p> : null}
              {!preview.tonal && preview.found > opts.colours ? (
                <p>
                  The image has {preview.found} colours: {preview.found - opts.colours === 1 ? 'the other one joins' : `the other ${preview.found - opts.colours} join`} the nearest you keep.
                </p>
              ) : null}
              {preview.tonal ? (
                <p className="flex items-start gap-1.5 text-warning">
                  <AlertTriangle size={13} className="mt-0.5 flex-none" aria-hidden /> This looks like a photo or a gradient: tracing turns it into flat patches of colour.
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={keepImage} onChange={(e) => setKeepImage(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Keep the image, hidden underneath
          </label>
          <button className="btn btn-primary w-full text-xs" onClick={() => void apply()} disabled={busy || layer.locked || (!!preview && !preview.layers.length)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Shapes size={14} />} Trace
          </button>
        </div>
      ) : null}
    </div>
  );
}
