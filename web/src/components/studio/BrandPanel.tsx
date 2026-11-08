'use client';
/**
 * Brand kit inside the studio (spec BRD-01/02): approved logos to place, palette colours and
 * fonts to apply to the selection. The kit itself is managed on the Brand kits page.
 */
import { Palette, Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import * as cmd from '@/domain/commands';
import { createImageLayer } from '@/domain/factory';
import { getGarment } from '@/domain/garments';
import type { TextContent } from '@/domain/schema';
import { nearestWeight } from '@/lib/fonts';
import { getAsset, listBrandKits, type BrandKit, type StoredAsset } from '@/lib/local-db';
import { textAspect } from '@/lib/render/zone-renderer';
import { toast } from '@/components/ui/primitives';
import { BlobImage } from '@/components/workspace/projects';
import { useStudio } from '@/stores/studio-store';
import { useBrandKit } from './brand-context';

function useAssets(ids: string[]) {
  const [assets, setAssets] = useState<StoredAsset[]>([]);
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    Promise.all(key ? key.split(',').map((id) => getAsset(id)) : []).then((list) => alive && setAssets(list.filter((a): a is StoredAsset => !!a)));
    return () => {
      alive = false;
    };
  }, [key]);
  return assets;
}

function insertLogo(asset: StoredAsset) {
  const s = useStudio.getState();
  if (!s.document) return;
  const spec = getGarment(s.document.garment.modelId).zones[s.activeZoneId];
  const layer = createImageLayer(spec, { id: asset.id, width: asset.width, height: asset.height, mime: asset.mime, name: asset.name });
  s.dispatch(cmd.addLayer(s.activeZoneId, layer));
  s.select([layer.id]);
}

function applyColour(hex: string) {
  const s = useStudio.getState();
  const zone = s.document?.zones[s.activeZoneId];
  if (!zone) return;
  const targets = s.selectedLayerIds.map((id) => zone.layers[id]).filter((l) => l && l.content.kind !== 'image');
  if (!targets.length) return toast('Select text or a shape to colour it.');
  for (const l of targets) s.dispatch(cmd.updateLayer(s.activeZoneId, l.id, { content: { fill: hex } }, 'Apply brand colour'));
}

function applyFont(family: string) {
  const s = useStudio.getState();
  const zone = s.document?.zones[s.activeZoneId];
  if (!zone) return;
  const texts = s.selectedLayerIds.map((id) => zone.layers[id]).filter((l) => l?.content.kind === 'text');
  if (!texts.length) return toast('Select a text layer to change its font.');
  for (const l of texts) {
    const content = l.content as TextContent;
    const next = { ...content, fontFamily: family, fontWeight: nearestWeight(family, content.fontWeight) };
    s.dispatch(cmd.updateLayer(s.activeZoneId, l.id, { content: { fontFamily: next.fontFamily, fontWeight: next.fontWeight }, transform: { widthMm: l.transform.heightMm * textAspect(next) } }, 'Apply brand font'));
  }
}

function LinkKit() {
  const dispatch = useStudio((s) => s.dispatch);
  const [kits, setKits] = useState<BrandKit[] | null>(null);
  useEffect(() => {
    let alive = true;
    listBrandKits().then((k) => alive && setKits(k), () => alive && setKits([]));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="mx-3 rounded-xl border border-dashed border-line p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Palette size={15} /> No brand kit linked
      </p>
      <p className="mt-1 text-fg-2">Link a kit to place approved logos and use brand colours and fonts.</p>
      {kits && kits.length ? (
        <select className="field mt-3" defaultValue="" onChange={(e) => e.target.value && dispatch(cmd.setBrandKit(e.target.value))} aria-label="Link a brand kit">
          <option value="">Choose a brand kit…</option>
          {kits.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      ) : null}
      <Link href="/brands" className="btn btn-outline mt-3 w-full">
        <Plus size={15} /> {kits && kits.length ? 'Manage brand kits' : 'Create a brand kit'}
      </Link>
    </div>
  );
}

export function BrandPanel() {
  const kit = useBrandKit();
  const brandKitId = useStudio((s) => s.document?.brandKitId);
  const dispatch = useStudio((s) => s.dispatch);
  const logos = useAssets(kit?.logoAssetIds ?? []);
  if (!brandKitId) return <LinkKit />;
  if (!kit) return <p className="px-4 py-3 text-sm text-fg-2">Loading brand kit…</p>;
  return (
    <div className="space-y-5 px-3 pb-4 pt-1">
      <div className="flex items-center justify-between px-1">
        <p className="truncate text-sm font-semibold">{kit.name}</p>
        <button className="text-xs text-fg-2 underline underline-offset-2" onClick={() => dispatch(cmd.setBrandKit(undefined))}>
          Unlink
        </button>
      </div>
      <section>
        <h3 className="label mb-2 px-1">Logos, click to place</h3>
        {logos.length ? (
          <div className="grid grid-cols-3 gap-2">
            {logos.map((a) => (
              <button key={a.id} className="grid aspect-square place-items-center rounded-lg border border-line bg-[var(--surface-hover)] p-1.5 hover:border-line-strong" onClick={() => insertLogo(a)} title={`Place ${a.name}`}>
                <BlobImage blob={a.blob} className="max-h-full max-w-full object-contain" />
              </button>
            ))}
          </div>
        ) : (
          <p className="px-1 text-xs text-fg-3">No logos in this kit yet.</p>
        )}
      </section>
      <section>
        <h3 className="label mb-2 px-1">Colours, applied to the selection</h3>
        <div className="grid grid-cols-6 gap-1.5">
          {kit.colors.map((c) => (
            <button key={c.id} className="aspect-square rounded-md border border-line" style={{ background: c.hex }} title={`${c.name} ${c.hex}`} aria-label={`Apply ${c.name}`} onClick={() => applyColour(c.hex)} />
          ))}
        </div>
      </section>
      {kit.fonts.length ? (
        <section>
          <h3 className="label mb-2 px-1">Fonts, applied to selected text</h3>
          <ul className="space-y-0.5">
            {kit.fonts.map((f) => (
              <li key={f}>
                <button className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover" style={{ fontFamily: `"${f}"` }} onClick={() => applyFont(f)}>
                  {f}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {kit.notes ? <p className="whitespace-pre-wrap px-1 text-xs text-fg-2">{kit.notes}</p> : null}
    </div>
  );
}
