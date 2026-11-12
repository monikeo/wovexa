'use client';
/**
 * Social and marketing images (spec EXP-11): the garment rendered once on a transparent
 * background, then laid out for each place it gets posted with a headline, a line under it, a
 * price or call to action and the brand, plus an optional presentation board with every
 * colourway. One image downloads as a PNG, several as a ZIP.
 */
import { LayoutTemplate, Loader2, Megaphone } from 'lucide-react';
import { useState } from 'react';
import { getGarment, partColor, PRINT_METHOD_LABELS } from '@/domain/garments';
import { canvasToBlob, downloadBlob, slugify } from '@/lib/download';
import { composeBoard, composeSocial, SOCIAL_FORMATS, trimShot, type SocialStyle } from '@/lib/export/social';
import { alphaBounds } from '@/lib/image-ops';
import { ZipWriter } from '@/lib/export/zip';
import { toast } from '@/components/ui/primitives';
import { useLive, useStudio } from '@/stores/studio-store';
import { useBrandKit } from './brand-context';
import { viewerApi } from './viewer3d/stage';

/** Two frames, so a colourway shown for a render is on the garment before it is captured. */
const nextFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** A transparent render cut close round the garment, so it fills its place in the layout. */
function trimmed(shot: HTMLCanvasElement) {
  const data = shot.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, shot.width, shot.height).data;
  return trimShot(shot, data ? alphaBounds(data, shot.width, shot.height, 12) : null);
}

export function SocialKit() {
  const doc = useStudio((s) => s.document);
  const kit = useBrandKit();
  const [formats, setFormats] = useState<string[]>(['post', 'story', 'square']);
  const [headline, setHeadline] = useState<string | null>(null);
  const [subline, setSubline] = useState('New drop. Limited run.');
  const [tag, setTag] = useState('');
  const [tone, setTone] = useState<SocialStyle['tone']>('light');
  const [board, setBoard] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  if (!doc) return null;
  const title = headline ?? doc.title;
  const brand = kit?.name ?? '';
  const toggle = (id: string) => setFormats((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const count = formats.length + (board ? 1 : 0);

  const make = async () => {
    if (!viewerApi.capture) return void toast('Open the 3D or Split view to make marketing images.', 'error');
    setProgress('Rendering the garment');
    const live = useLive.getState();
    try {
      await useStudio.getState().saveNow();
      const now = useStudio.getState().document!;
      // The headline in the design's own lettering where there is some.
      const textLayer = Object.values(now.zones).flatMap((z) => z.orderedLayerIds.map((id) => z.layers[id])).find((l) => l?.content.kind === 'text' && !l.content.fontAssetId);
      const font = textLayer?.content.kind === 'text' ? textLayer.content.fontFamily : 'Archivo';
      await Promise.all([document.fonts.load(`800 80px "${font}"`), document.fonts.load('700 40px "Archivo"')]).catch(() => undefined);
      const style: SocialStyle = { tone, accent: kit?.colors[0]?.hex ?? '#2B59FF', font };
      const shots = await viewerApi.capture({ shots: [{ kind: 'preset', view: 'front' }, { kind: 'preset', view: 'back' }], width: 1200, height: 1500, background: 'transparent' });
      const front = trimmed(shots[0].canvas);
      const back = shots[1] ? trimmed(shots[1].canvas) : undefined;
      const files: { name: string; canvas: HTMLCanvasElement }[] = [];
      const base = slugify(now.title);
      const copy = { headline: title, subline, tag, brand };
      for (const f of SOCIAL_FORMATS.filter((s) => formats.includes(s.id))) {
        files.push({ name: `${base}_${f.id}_${f.w}x${f.h}.png`, canvas: composeSocial(f, { front, back }, copy, style) });
      }
      if (board) {
        setProgress('Rendering each colourway');
        const model = getGarment(now.garment.modelId);
        const colorways = [];
        for (const c of now.colorways.slice(0, 6)) {
          live.setColorwayOverride(c.id);
          await nextFrames();
          const [shot] = await viewerApi.capture({ shots: [{ kind: 'preset', view: 'front' }], width: 600, height: 750, background: 'transparent' });
          colorways.push({ name: c.name, shot: trimmed(shot.canvas), hex: partColor(c, 'body') });
        }
        live.setColorwayOverride(null);
        const fabric = model.fabricPresets.find((p) => p.id === now.garment.fabricPresetId) ?? model.fabricPresets[0];
        const methods = [...new Set(model.zoneOrder.filter((z) => now.zones[z].orderedLayerIds.length).map((z) => PRINT_METHOD_LABELS[now.zones[z].printMethod]))];
        const details: [string, string][] = [
          ['Style', model.name],
          ['Fabric', `${fabric.label}${now.garment.finish ? `, ${now.garment.finish === 'vintage' ? 'vintage' : 'garment'} washed` : ''}`],
          ['Sizes', `${model.sizes[0].code} to ${model.sizes[model.sizes.length - 1].code}`],
          ...(methods.length ? [['Print', methods.join(', ')] as [string, string]] : []),
          ...(tag.trim() ? [['Price', tag.trim()] as [string, string]] : []),
        ];
        files.push({ name: `${base}_presentation-board_2400x1600.png`, canvas: composeBoard({ title, brand, front, back, colorways, details, style }) });
      }
      setProgress('Saving');
      if (files.length === 1) downloadBlob(await canvasToBlob(files[0].canvas, 'image/png'), files[0].name);
      else {
        const zip = new ZipWriter();
        for (const f of files) await zip.add(f.name, await canvasToBlob(f.canvas, 'image/png'), { compress: false });
        downloadBlob(zip.finish(), `${base}_marketing_${files.length}-images.zip`);
      }
      toast(`Made ${files.length} marketing image${files.length === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The marketing images couldn’t be made.', 'error');
    } finally {
      live.setColorwayOverride(null);
      setProgress(null);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="panel-title flex items-center gap-2">
        <Megaphone size={15} aria-hidden /> Social and marketing
      </h3>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Where it gets posted">
        {SOCIAL_FORMATS.map((f) => (
          <button key={f.id} className="btn btn-outline min-h-8 px-2.5 text-xs" aria-pressed={formats.includes(f.id)} title={`${f.hint}, ${f.w} × ${f.h} px`} onClick={() => toggle(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <label className="grid gap-1 text-xs">
        <span className="text-fg-2">Headline</span>
        <input className="field" value={title} maxLength={60} onChange={(e) => setHeadline(e.target.value)} />
      </label>
      <label className="grid gap-1 text-xs">
        <span className="text-fg-2">Line under it</span>
        <input className="field" value={subline} maxLength={90} onChange={(e) => setSubline(e.target.value)} placeholder="New drop. Limited run." />
      </label>
      <label className="grid gap-1 text-xs">
        <span className="text-fg-2">Price or call to action (optional)</span>
        <input className="field" value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} placeholder="$35 · Shop now" />
      </label>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="seg w-fit" role="group" aria-label="Background">
          <button aria-pressed={tone === 'light'} onClick={() => setTone('light')}>
            Light
          </button>
          <button aria-pressed={tone === 'dark'} onClick={() => setTone('dark')}>
            Dark
          </button>
        </div>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={board} onChange={(e) => setBoard(e.target.checked)} />
          <LayoutTemplate size={13} aria-hidden /> Presentation board
        </label>
      </div>
      <p className="text-[11px] text-fg-3">{brand ? `Signed ${brand}, with its first colour for the price tag.` : 'Link a brand kit to sign them with its name and colour.'}</p>
      <button className="btn btn-primary w-full" disabled={!count || !!progress} onClick={() => void make()}>
        {progress ? <Loader2 size={15} className="animate-spin" /> : <Megaphone size={15} />} {progress ?? `Make ${count} image${count === 1 ? '' : 's'}`}
      </button>
    </section>
  );
}
