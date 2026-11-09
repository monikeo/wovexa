'use client';
/**
 * Wovexa Render (spec §14, MED-01…06, MED-09, EXP-01…03, EXP-09): product stills from any
 * preset or saved view at social and e-commerce sizes, in PNG, JPEG or WebP, for one or every
 * colourway, and turntable video. Renders come from the saved document and never include
 * on-garment guides.
 */
import { Clapperboard, Download, Images, Loader2, Sparkles, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as cmd from '@/domain/commands';
import { MOTIONS, motionOf, SCENE_PRESETS, sceneOf } from '@/domain/scene';
import { canvasToBlob, downloadBlob, slugify } from '@/lib/download';
import { canEncodeAvif, encodePdf, encodeTiff } from '@/lib/export/image-formats';
import { planVideo, recordTurntable, type VideoPlan } from '@/lib/video';
import { toast } from '@/components/ui/primitives';
import { useLive, useStudio } from '@/stores/studio-store';
import { PHOTOREAL_PRESETS, VIEW_PRESETS, viewerApi, type CapturedShot, type PhotorealPreset, type RenderBackground, type ShotSpec, type ViewPreset } from './viewer3d/stage';

type Engine = 'realtime' | 'photoreal';
/** Depth of field as an f-number: smaller is a shallower, blurrier background. */
const LENSES = { off: undefined, soft: 2.8, strong: 1.2 } as const;
type Lens = keyof typeof LENSES;

const ASPECTS = [
  { id: '1:1', w: 1, h: 1, hint: 'Square posts and marketplaces' },
  { id: '4:5', w: 4, h: 5, hint: 'Shop listings and feed posts' },
  { id: '9:16', w: 9, h: 16, hint: 'Stories, reels and short video' },
  { id: '16:9', w: 16, h: 9, hint: 'Banners, slides and video' },
] as const;
type AspectId = (typeof ASPECTS)[number]['id'];

/**
 * Still image quality, low to 6K: the lower tiers set the short side (1080 is the social standard),
 * the K tiers the long side (6K is 6144 px). Real-time renders past the GPU's single-pass limit
 * are drawn in tiles and joined; photoreal renders stop at that limit.
 */
const TIERS = [
  { id: 'low', label: 'Low', short: 720 },
  { id: 'social', label: 'Social', short: 1080 },
  { id: 'high', label: 'High', short: 1600 },
  { id: '2k', label: '2K', long: 2560 },
  { id: '4k', label: '4K', long: 3840 },
  { id: '5k', label: '5K', long: 5120 },
  { id: '6k', label: '6K', long: 6144 },
] as const;
type TierId = (typeof TIERS)[number]['id'];
const VIDEO_SIZES = [720, 1080];
type Format = 'png' | 'jpeg' | 'webp' | 'avif' | 'tiff' | 'pdf';
const FORMATS: { id: Format; label: string; ext: string; mime?: string; lossy: boolean; alpha: boolean }[] = [
  { id: 'png', label: 'PNG', ext: 'png', mime: 'image/png', lossy: false, alpha: true },
  { id: 'jpeg', label: 'JPEG', ext: 'jpg', mime: 'image/jpeg', lossy: true, alpha: false },
  { id: 'webp', label: 'WebP', ext: 'webp', mime: 'image/webp', lossy: true, alpha: true },
  { id: 'avif', label: 'AVIF', ext: 'avif', mime: 'image/avif', lossy: true, alpha: true },
  { id: 'tiff', label: 'TIFF (print, 300 dpi)', ext: 'tif', lossy: false, alpha: true },
  { id: 'pdf', label: 'PDF (300 dpi page)', ext: 'pdf', lossy: true, alpha: false },
];
type Backdrop = 'scene' | 'transparent' | 'white';
/** The largest contact sheet a browser canvas holds safely: per side and in all. */
const SHEET_MAX_SIDE = 16384;
const SHEET_MAX_PIXELS = 200_000_000;

function dims(aspect: AspectId, tier: (typeof TIERS)[number] | number, opts: { photoreal?: boolean } = {}) {
  const a = ASPECTS.find((x) => x.id === aspect)!;
  const landscape = a.w >= a.h;
  let w: number;
  let h: number;
  if (typeof tier === 'number' || 'short' in tier) {
    const short = typeof tier === 'number' ? tier : tier.short;
    w = landscape ? Math.round((short * a.w) / a.h) : short;
    h = landscape ? short : Math.round((short * a.h) / a.w);
  } else {
    w = landscape ? tier.long : Math.round((tier.long * a.w) / a.h);
    h = landscape ? Math.round((tier.long * a.h) / a.w) : tier.long;
  }
  // Photoreal output stops at this device's largest render size; the rasteriser tiles past it.
  const max = opts.photoreal ? (viewerApi.maxOutputSize?.() ?? 4096) : Infinity;
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.round((w * k) / 2) * 2, h: Math.round((h * k) / 2) * 2, capped: k < 1 };
}

const nextFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

function flatten(canvas: HTMLCanvasElement, fill: string) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button className={`btn min-h-8 px-3 text-xs ${on ? 'btn-ink' : 'btn-outline'}`} aria-pressed={on} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export function RenderPanel() {
  const doc = useStudio((s) => s.document);
  const viewMode = useStudio((s) => s.viewMode);
  const setViewMode = useStudio((s) => s.setViewMode);
  const [shots, setShots] = useState<string[]>(['front', 'back', 'three_quarter']);
  const [aspect, setAspect] = useState<AspectId>('4:5');
  const [tierId, setTierId] = useState<TierId>('high');
  const [format, setFormat] = useState<Format>('png');
  const [avif] = useState(canEncodeAvif);
  const [quality, setQuality] = useState(0.92);
  const [backdrop, setBackdrop] = useState<Backdrop>('scene');
  const [everyColorway, setEveryColorway] = useState(false);
  const [everyLook, setEveryLook] = useState(false);
  const [layout, setLayout] = useState<'separate' | 'sheet'>('separate');
  const [stillProgress, setStillProgress] = useState<string | null>(null);
  const [engine, setEngine] = useState<Engine>('realtime');
  const [preset, setPreset] = useState<PhotorealPreset>('studio');
  const [lens, setLens] = useState<Lens>('off');
  const [denoise, setDenoise] = useState(true);
  const [traceProgress, setTraceProgress] = useState<number | null>(null);

  const [seconds, setSeconds] = useState(6);
  const [degrees, setDegrees] = useState(360);
  const [fps, setFps] = useState(30);
  const [videoShort, setVideoShort] = useState(1080);
  const [videoFrom, setVideoFrom] = useState('front');
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [plan, setPlan] = useState<VideoPlan | null | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const a = ASPECTS.find((x) => x.id === aspect)!;
  const ratio = a.w / a.h;
  const viewerReady = viewMode !== '2d';

  // Frame the chosen aspect over the live 3D view while this panel is open.
  useEffect(() => {
    useLive.getState().setRenderAspect(ratio);
    return () => useLive.getState().setRenderAspect(null);
  }, [ratio]);

  const video = dims(aspect, videoShort);
  useEffect(() => {
    let alive = true;
    planVideo(video.w, video.h, fps).then((p) => alive && setPlan(p), () => alive && setPlan(null));
    return () => {
      alive = false;
    };
  }, [video.w, video.h, fps]);

  const bookmarks = useMemo(() => sceneOf(doc).cameras, [doc]);
  if (!doc) return null;

  const specOf = (key: string): ShotSpec | null => {
    if (key === 'current') return { kind: 'current' };
    if (key in VIEW_PRESETS) return { kind: 'preset', view: key as ViewPreset };
    const bookmark = bookmarks.find((b) => b.id === key);
    return bookmark ? { kind: 'bookmark', bookmark } : null;
  };
  const specs = shots.map(specOf).filter((s): s is ShotSpec => !!s);
  const tier = TIERS.find((t) => t.id === tierId)!;
  const still = dims(aspect, tier, { photoreal: engine === 'photoreal' });
  const fmt = FORMATS.find((f) => f.id === format)!;
  const background: RenderBackground = backdrop === 'scene' ? 'scene' : backdrop === 'transparent' ? 'transparent' : { color: '#FFFFFF' };
  const base = slugify(doc.title);
  const toggle = (key: string) => setShots((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));
  const colorways = everyColorway ? doc.colorways : doc.colorways.filter((c) => c.id === doc.activeColorwayId);
  // Each row of the batch: a colourway, under one lighting look or every one.
  const looks = everyLook ? SCENE_PRESETS : [null];
  const variants = colorways.flatMap((c) => looks.map((look) => ({ colorway: c, look, name: look ? (colorways.length > 1 ? `${c.name}, ${look.label}` : look.label) : c.name })));
  const total = specs.length * variants.length;
  const busy = stillProgress !== null || videoProgress !== null;
  const scene = sceneOf(doc);
  const motion = motionOf(scene);

  const encode = async (canvas: HTMLCanvasElement) => {
    // JPEG and PDF have no transparency; flatten on white rather than let the encoder fill black.
    const source = !fmt.alpha && backdrop === 'transparent' ? flatten(canvas, '#FFFFFF') : canvas;
    if (format === 'tiff') return encodeTiff(source, 300);
    if (format === 'pdf') return encodePdf(source, { quality, title: doc.title });
    return canvasToBlob(source, fmt.mime!, fmt.lossy ? quality : undefined);
  };

  const renderStills = async () => {
    if (!viewerApi.capture || !specs.length) return;
    setStillProgress(`0 of ${total}`);
    const live = useLive.getState();
    const rows: { name: string; shots: CapturedShot[] }[] = [];
    const traced = engine === 'photoreal';
    const controller = new AbortController();
    if (traced) {
      abortRef.current = controller;
      setTraceProgress(0);
    }
    const samples = PHOTOREAL_PRESETS.find((p) => p.id === preset)!.samples;
    try {
      await useStudio.getState().saveNow();
      for (const [i, v] of variants.entries()) {
        if (everyColorway || v.look) {
          if (everyColorway) live.setColorwayOverride(v.colorway.id);
          // A look brings its own light, tone, exposure, backdrop and floor shadow, for this render only.
          if (v.look) live.setSceneOverride({ presetId: v.look.id, ...v.look.defaults });
          await nextFrames();
        }
        const photoreal = traced
          ? { samples, denoise, fStop: LENSES[lens], signal: controller.signal, onProgress: (f: number) => setTraceProgress((i + f) / variants.length) }
          : undefined;
        rows.push({ name: v.name, shots: await viewerApi.capture({ shots: specs, width: still.w, height: still.h, background, frameCurrent: true, photoreal }) });
        setStillProgress(`${rows.length * specs.length} of ${total}`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') toast('Render cancelled.');
      else toast(error instanceof Error ? error.message : 'Rendering failed. Try a smaller size.', 'error');
      return;
    } finally {
      if (everyColorway) live.setColorwayOverride(null);
      if (everyLook) live.setSceneOverride(null);
      setStillProgress(null);
      setTraceProgress(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
    const ext = fmt.ext;
    if (layout === 'separate' || total === 1) {
      for (const row of rows) {
        for (const shot of row.shots) {
          downloadBlob(await encode(shot.canvas), `${base}_${shot.key}_${slugify(row.name)}_${shot.canvas.width}x${shot.canvas.height}_r${doc.revision}.${ext}`);
        }
      }
    } else {
      const w0 = rows[0].shots[0].canvas.width;
      const h0 = rows[0].shots[0].canvas.height;
      const cols = rows.length > 1 ? specs.length : Math.min(specs.length, 3);
      const perRow = rows.length > 1 ? 1 : Math.ceil(specs.length / cols);
      // A sheet of 6K shots would pass what a browser canvas holds: scale each shot down to fit.
      const label0 = rows.length > 1 ? Math.round(h0 * 0.06) : 0;
      const fullW = w0 * cols;
      const fullH = (h0 + label0) * rows.length * perRow;
      const k = Math.min(1, SHEET_MAX_SIDE / Math.max(fullW, fullH), Math.sqrt(SHEET_MAX_PIXELS / (fullW * fullH)));
      const w = Math.floor(w0 * k);
      const h = Math.floor(h0 * k);
      const labelH = Math.floor(label0 * k);
      const sheet = document.createElement('canvas');
      sheet.width = w * cols;
      sheet.height = (h + labelH) * rows.length * perRow;
      const ctx = sheet.getContext('2d')!;
      if (backdrop !== 'transparent' || !fmt.alpha) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, sheet.width, sheet.height);
      }
      rows.forEach((row, r) => {
        const y0 = r * (h + labelH) * perRow;
        if (labelH) {
          ctx.fillStyle = '#111111';
          ctx.font = `600 ${Math.round(labelH * 0.5)}px system-ui, sans-serif`;
          ctx.textBaseline = 'middle';
          ctx.fillText(row.name, Math.round(labelH * 0.6), y0 + labelH / 2);
        }
        row.shots.forEach((shot, i) => ctx.drawImage(shot.canvas, (i % cols) * w, y0 + labelH + Math.floor(i / cols) * h, w, h));
      });
      const what = rows.length === 1 ? 'views' : everyLook && everyColorway ? 'colourways-and-looks' : everyLook ? 'lighting-looks' : 'all-colourways';
      downloadBlob(await encode(sheet), `${base}_${what}_${sheet.width}x${sheet.height}_r${doc.revision}.${ext}`);
    }
    toast(`Rendered ${total} image${total === 1 ? '' : 's'} at ${still.w} × ${still.h} px.`, 'success');
  };

  const renderVideo = async () => {
    const from = specOf(videoFrom) ?? { kind: 'preset' as const, view: 'front' as const };
    const controller = new AbortController();
    abortRef.current = controller;
    setVideoProgress(0);
    try {
      await useStudio.getState().saveNow();
      const result = await recordTurntable({
        width: video.w,
        height: video.h,
        fps,
        seconds,
        degrees,
        from,
        background,
        signal: controller.signal,
        onProgress: (f) => setVideoProgress(f),
      });
      const kind = degrees ? `turntable_${degrees}deg` : `${motion.kind}_clip`;
      downloadBlob(result.blob, `${base}_${kind}_${seconds}s_${result.width}x${result.height}_r${doc.revision}.${result.plan.extension}`);
      toast(`Rendered a ${seconds}-second ${result.plan.label} ${degrees ? 'turntable' : `${motion.kind} clip`}, ${(result.blob.size / 1048576).toFixed(1)} MB.`, 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') toast('Video render cancelled.');
      else toast(error instanceof Error ? error.message : 'The video could not be rendered.', 'error');
    } finally {
      abortRef.current = null;
      setVideoProgress(null);
    }
  };

  if (!viewerReady) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm text-fg-2">Wovexa Render uses the 3D view. Show it to render product images and video.</p>
        <button className="btn btn-primary w-full" onClick={() => setViewMode('split')}>
          Show the 3D view
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <section className="space-y-3">
        <h3 className="panel-title">Frame</h3>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Aspect ratio">
          {ASPECTS.map((x) => (
            <button key={x.id} className={`btn min-h-9 px-0 text-xs ${aspect === x.id ? 'btn-ink' : 'btn-outline'}`} aria-pressed={aspect === x.id} onClick={() => setAspect(x.id)} title={x.hint}>
              {x.id}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-fg-3">{a.hint}. The outline on the 3D view shows the frame for “Current view”.</p>
        <label className="grid grid-cols-[72px_1fr] items-center gap-2">
          <span className="label">Backdrop</span>
          <select className="field" value={backdrop} onChange={(e) => setBackdrop(e.target.value as Backdrop)}>
            <option value="scene">Scene backdrop</option>
            <option value="white">White</option>
            <option value="transparent">Transparent (stills)</option>
          </select>
        </label>
      </section>

      <section className="space-y-3">
        <h3 className="panel-title flex items-center gap-2">
          <Images size={15} /> Still images
        </h3>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Renderer">
          <button
            className={`btn h-auto min-h-0 flex-col items-start justify-start gap-0.5 whitespace-normal px-3 py-2 text-left ${engine === 'realtime' ? 'btn-ink' : 'btn-outline'}`}
            aria-pressed={engine === 'realtime'}
            onClick={() => setEngine('realtime')}
          >
            <span className="text-sm font-semibold">Real time</span>
            <span className="text-[11px] font-normal leading-snug opacity-75">Instant, as the 3D view shows it</span>
          </button>
          <button
            className={`btn h-auto min-h-0 flex-col items-start justify-start gap-0.5 whitespace-normal px-3 py-2 text-left ${engine === 'photoreal' ? 'btn-ink' : 'btn-outline'}`}
            aria-pressed={engine === 'photoreal'}
            onClick={() => setEngine('photoreal')}
          >
            <span className="flex items-center gap-1 text-sm font-semibold">
              <Sparkles size={13} aria-hidden /> Photoreal
            </span>
            <span className="text-[11px] font-normal leading-snug opacity-75">Real light and soft shadows; takes longer</span>
          </button>
        </div>
        {engine === 'photoreal' ? (
          <div className="space-y-2 rounded-lg border border-line p-2.5">
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Photoreal quality">
              {PHOTOREAL_PRESETS.map((p) => (
                <Chip key={p.id} on={preset === p.id} onClick={() => setPreset(p.id)} title={`${p.samples} samples per pixel`}>
                  {p.label}
                </Chip>
              ))}
            </div>
            <p className="text-[11px] text-fg-3">
              {PHOTOREAL_PRESETS.find((p) => p.id === preset)!.hint} Light bounces between surfaces, prints show their real relief and gloss, and the view on screen resolves as it renders.
            </p>
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-fg-2">Lens and finish</summary>
              <div className="mt-2 space-y-2">
                <label className="grid grid-cols-[96px_1fr] items-center gap-2">
                  <span className="label">Depth of field</span>
                  <select className="field" value={lens} onChange={(e) => setLens(e.target.value as Lens)}>
                    <option value="off">Off</option>
                    <option value="soft">Soft (f/2.8)</option>
                    <option value="strong">Strong (f/1.2)</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={denoise} onChange={(e) => setDenoise(e.target.checked)} />
                  Remove grain
                </label>
                <p className="text-[11px] text-fg-3">Focus lands on the garment at the centre of each shot. Turn off grain removal for the finest print detail at Final quality.</p>
              </div>
            </details>
          </div>
        ) : null}
        <fieldset>
          <legend className="label mb-1.5">Shots</legend>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(VIEW_PRESETS) as ViewPreset[]).map((v) => (
              <Chip key={v} on={shots.includes(v)} onClick={() => toggle(v)}>
                {VIEW_PRESETS[v].long}
              </Chip>
            ))}
            {bookmarks.map((b) => (
              <Chip key={b.id} on={shots.includes(b.id)} onClick={() => toggle(b.id)} title="Saved view">
                {b.name}
              </Chip>
            ))}
            <Chip on={shots.includes('current')} onClick={() => toggle('current')} title="Exactly what the 3D view shows now">
              Current view
            </Chip>
          </div>
          {!bookmarks.length ? <p className="mt-1.5 text-[11px] text-fg-3">Save views in the 3D view’s Scene panel to render them here.</p> : null}
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="label">Quality</span>
            <select className="field" value={tierId} onChange={(e) => setTierId(e.target.value as TierId)}>
              {TIERS.map((t) => {
                const d = dims(aspect, t, { photoreal: engine === 'photoreal' });
                return (
                  <option key={t.id} value={t.id}>
                    {t.label}, {d.w} × {d.h}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="label">Format</span>
            <select className="field" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              {FORMATS.filter((f) => f.id !== 'avif' || avif).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {fmt.lossy ? (
          <label className="grid grid-cols-[72px_1fr_40px] items-center gap-2">
            <span className="label">Quality</span>
            <input type="range" min={0.6} max={1} step={0.02} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="accent-[var(--accent)]" />
            <span className="num text-right text-xs">{Math.round(quality * 100)}</span>
          </label>
        ) : null}
        {still.capped ? <p className="text-[11px] text-warning">Photoreal stops at {still.w} × {still.h} px on this device. Real time goes up to 6K.</p> : null}
        {Math.max(still.w, still.h) > (viewerApi.maxOutputSize?.() ?? 4096) ? <p className="text-[11px] text-fg-3">Larger than this GPU draws at once, so it renders in tiles and joins them. Takes a little longer.</p> : null}
        {!fmt.alpha && backdrop === 'transparent' ? <p className="text-[11px] text-fg-3">{fmt.label.split(' ')[0]} has no transparency, so the background will be white.</p> : null}
        {format === 'tiff' ? <p className="text-[11px] text-fg-3">TIFF keeps every pixel (lossless, with transparency) for print and retouching; large files.</p> : null}
        {doc.colorways.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={everyColorway} onChange={(e) => setEveryColorway(e.target.checked)} />
            Every colourway ({doc.colorways.length})
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={everyLook} onChange={(e) => setEveryLook(e.target.checked)} />
          Every lighting look ({SCENE_PRESETS.length})
        </label>
        {everyLook ? (
          <p className="text-[11px] text-fg-3">
            The same shots under {SCENE_PRESETS.map((p) => p.label.toLowerCase()).join(', ')}: compare moods side by side. Your scene stays as it is. A contact sheet labels each look.
          </p>
        ) : null}
        <label className="grid grid-cols-[72px_1fr] items-center gap-2">
          <span className="label">Files</span>
          <select className="field" value={layout} onChange={(e) => setLayout(e.target.value as 'separate' | 'sheet')}>
            <option value="separate">One file per image</option>
            <option value="sheet">One contact sheet</option>
          </select>
        </label>
        {traceProgress !== null ? (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label="Photoreal render progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(traceProgress * 100)}>
              <div className="h-full bg-[var(--accent)] transition-[width]" style={{ width: `${Math.round(traceProgress * 100)}%` }} />
            </div>
            <button className="btn btn-outline w-full" onClick={() => abortRef.current?.abort()}>
              <Square size={14} /> Cancel ({Math.round(traceProgress * 100)}%)
            </button>
          </div>
        ) : (
          <button className="btn btn-primary w-full" disabled={!specs.length || busy} onClick={() => void renderStills()}>
            {stillProgress ? <Loader2 size={15} className="animate-spin" /> : engine === 'photoreal' ? <Sparkles size={15} /> : <Download size={15} />}
            {stillProgress ? `Rendering ${stillProgress}` : `Render ${total || ''} ${engine === 'photoreal' ? 'photoreal ' : ''}image${total === 1 ? '' : 's'}`}
          </button>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="panel-title flex items-center gap-2">
          <Clapperboard size={15} /> Turntable video
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="label">Length</span>
            <select className="field" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
              {[4, 6, 8, 12].map((s) => (
                <option key={s} value={s}>
                  {s} seconds
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="label">Turn</span>
            <select className="field" value={degrees} onChange={(e) => setDegrees(Number(e.target.value))}>
              <option value={360}>Full turn</option>
              <option value={180}>Half turn</option>
              <option value={90}>Quarter turn</option>
              <option value={0}>No turn (still camera)</option>
            </select>
          </label>
          <label className="col-span-2 grid gap-1">
            <span className="label">Garment motion</span>
            <select
              className="field"
              value={motion.kind}
              onChange={(e) => {
                const m = MOTIONS.find((x) => x.id === e.target.value)!;
                useStudio.getState().dispatch(cmd.updateScene(scene, { motion: { ...motion, kind: m.id } }, `Motion: ${m.label.toLowerCase()}`));
              }}
            >
              {MOTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="label">Size</span>
            <select className="field" value={videoShort} onChange={(e) => setVideoShort(Number(e.target.value))}>
              {VIDEO_SIZES.map((s) => {
                const d = dims(aspect, s);
                return (
                  <option key={s} value={s}>
                    {d.w} × {d.h}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="label">Frame rate</span>
            <select className="field" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
              <option value={24}>24 fps</option>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
        </div>
        <label className="grid grid-cols-[72px_1fr] items-center gap-2">
          <span className="label">Start at</span>
          <select className="field" value={videoFrom} onChange={(e) => setVideoFrom(e.target.value)}>
            {(Object.keys(VIEW_PRESETS) as ViewPreset[]).map((v) => (
              <option key={v} value={v}>
                {VIEW_PRESETS[v].long}
              </option>
            ))}
            {bookmarks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            <option value="current">Current view</option>
          </select>
        </label>
        <p className="text-[11px] text-fg-3">{MOTIONS.find((m) => m.id === motion.kind)?.description} It plays in the 3D view too.</p>
        {!degrees && motion.kind === 'still' ? <p className="text-[11px] text-warning">With no turn and no motion the video stands still. Pick a motion, or a turn.</p> : null}
        <p className="text-[11px] text-fg-3">
          {plan === undefined
            ? 'Checking video support…'
            : plan
              ? `Saves as ${plan.label}. Rendered frame by frame, so it never drops frames.${backdrop === 'transparent' ? ' Video has no transparency; the background will be white.' : ''}`
              : 'This browser can’t encode video. Use Chrome, Edge, Firefox 130+ or Safari 17+.'}
        </p>
        {videoProgress !== null ? (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label="Video render progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(videoProgress * 100)}>
              <div className="h-full bg-[var(--accent)] transition-[width]" style={{ width: `${Math.round(videoProgress * 100)}%` }} />
            </div>
            <button className="btn btn-outline w-full" onClick={() => abortRef.current?.abort()}>
              <Square size={14} /> Cancel ({Math.round(videoProgress * 100)}%)
            </button>
          </div>
        ) : (
          <button className="btn btn-outline w-full" disabled={!plan || busy} onClick={() => void renderVideo()}>
            <Clapperboard size={15} /> Render video
          </button>
        )}
      </section>
      <p className="text-[11px] text-fg-3">Renders are simulated previews: fabric, ink and finishes are approximate. Confirm colour and placement with a physical sample.</p>
    </div>
  );
}
