'use client';
/** Brand kit manager (spec BRD-01/02): approved logos, a named palette, fonts and usage notes. */
import { Check, Palette, Plus, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { newId } from '@/domain/factory';
import { ACCEPTED_TYPES, AssetError, importImageFile } from '@/lib/assets';
import { ARTWORK_FONTS } from '@/lib/fonts';
import { deleteBrandKit, getAsset, listAssets, listBrandKits, saveBrandKit, type BrandKit, type StoredAsset } from '@/lib/local-db';
import { ConfirmDialog, Sheet, toast } from '@/components/ui/primitives';
import { BlobImage } from '@/components/workspace/projects';
import { PageHeader } from '@/components/workspace/WorkspaceShell';

function blankKit(): BrandKit {
  const now = Date.now();
  return {
    id: newId(),
    name: 'New brand',
    colors: [
      { id: newId(), name: 'Ink', hex: '#111111' },
      { id: newId(), name: 'Paper', hex: '#FFFFFF' },
    ],
    fonts: ['Archivo'],
    logoAssetIds: [],
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

function AssetPicker({ open, chosen, onClose, onPick }: { open: boolean; chosen: string[]; onClose: () => void; onPick: (a: StoredAsset) => void }) {
  const [assets, setAssets] = useState<StoredAsset[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    listAssets().then((a) => alive && setAssets(a), () => alive && setAssets([]));
    return () => {
      alive = false;
    };
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Add logos from your assets" side="right">
      {assets === null ? (
        <p className="p-4 text-sm text-fg-2">Loading…</p>
      ) : assets.length === 0 ? (
        <p className="p-4 text-sm text-fg-2">Your asset library is empty. Upload a logo from the brand kit instead.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 p-4">
          {assets.map((a) => {
            const on = chosen.includes(a.id);
            return (
              <button key={a.id} className={`relative grid aspect-square place-items-center rounded-lg border p-1.5 ${on ? 'border-accent' : 'border-line'} bg-[var(--surface-hover)]`} onClick={() => onPick(a)} aria-pressed={on} title={a.name}>
                <BlobImage blob={a.blob} className="max-h-full max-w-full object-contain" />
                {on ? (
                  <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-fg">
                    <Check size={12} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

function KitEditor({ initial, onSaved, onDeleted }: { initial: BrandKit; onSaved: (k: BrandKit) => void; onDeleted: () => void }) {
  const [kit, setKit] = useState(initial);
  const [logos, setLogos] = useState<StoredAsset[]>([]);
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [dirty, setDirty] = useState(false);
  const update = (patch: Partial<BrandKit>) => {
    setKit((k) => ({ ...k, ...patch }));
    setDirty(true);
  };
  const logoKey = kit.logoAssetIds.join(',');
  useEffect(() => {
    let alive = true;
    Promise.all(logoKey ? logoKey.split(',').map((id) => getAsset(id)) : []).then((list) => alive && setLogos(list.filter((a): a is StoredAsset => !!a)));
    return () => {
      alive = false;
    };
  }, [logoKey]);

  const toggleLogo = (a: StoredAsset) =>
    update({ logoAssetIds: kit.logoAssetIds.includes(a.id) ? kit.logoAssetIds.filter((x) => x !== a.id) : [...kit.logoAssetIds, a.id] });

  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <label className="grid gap-1">
        <span className="label">Brand name</span>
        <input className="field h-10 text-base font-semibold" value={kit.name} maxLength={60} onChange={(e) => update({ name: e.target.value })} />
      </label>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Logos</h3>
          <div className="flex gap-2">
            <button className="btn btn-outline min-h-8 text-xs" onClick={() => setPicker(true)}>
              <Plus size={14} /> From assets
            </button>
            <label className="btn btn-outline min-h-8 text-xs">
              <Upload size={14} /> Upload
              <input
                type="file"
                accept={ACCEPTED_TYPES}
                multiple
                className="sr-only"
                onChange={async (e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  const ids: string[] = [];
                  for (const f of files) {
                    try {
                      ids.push((await importImageFile(f)).id);
                    } catch (err) {
                      toast(err instanceof AssetError ? err.message : `${f.name} couldn't be added.`, 'error');
                    }
                  }
                  if (ids.length) update({ logoAssetIds: [...new Set([...kit.logoAssetIds, ...ids])] });
                }}
              />
            </label>
          </div>
        </div>
        {logos.length ? (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {logos.map((a) => (
              <div key={a.id} className="group relative grid aspect-square place-items-center rounded-lg border border-line bg-[var(--surface-hover)] p-2">
                <BlobImage blob={a.blob} className="max-h-full max-w-full object-contain" />
                <button className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-panel text-fg-2 shadow" aria-label={`Remove ${a.name}`} onClick={() => toggleLogo(a)}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-fg-3">Add the approved versions of your logo: full colour, one colour, white.</p>
        )}
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Colours</h3>
          <button className="btn btn-outline min-h-8 text-xs" disabled={kit.colors.length >= 16} onClick={() => update({ colors: [...kit.colors, { id: newId(), name: `Colour ${kit.colors.length + 1}`, hex: '#2B59FF' }] })}>
            <Plus size={14} /> Add colour
          </button>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {kit.colors.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`${c.name} colour`}
                className="h-9 w-10 flex-none cursor-pointer rounded-md border border-line bg-panel p-0.5"
                value={c.hex.toLowerCase()}
                onChange={(e) => update({ colors: kit.colors.map((x) => (x.id === c.id ? { ...x, hex: e.target.value.toUpperCase() } : x)) })}
              />
              <input className="field" aria-label="Colour name" value={c.name} maxLength={40} onChange={(e) => update({ colors: kit.colors.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)) })} />
              <span className="font-mono text-xs text-fg-2">{c.hex}</span>
              <button className="icon-btn h-8 w-8" aria-label={`Remove ${c.name}`} onClick={() => update({ colors: kit.colors.filter((x) => x.id !== c.id) })}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold">Fonts</h3>
        <p className="mt-1 text-xs text-fg-2">Listed first in the studio’s font menu. All are open-licence and safe to print.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {ARTWORK_FONTS.map((f) => {
            const on = kit.fonts.includes(f.family);
            return (
              <button
                key={f.family}
                className={`rounded-lg border px-3 py-1.5 text-sm ${on ? 'border-accent bg-selected' : 'border-line'}`}
                style={{ fontFamily: `"${f.family}"` }}
                aria-pressed={on}
                onClick={() => update({ fonts: on ? kit.fonts.filter((x) => x !== f.family) : [...kit.fonts, f.family] })}
              >
                {f.family}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <label className="grid gap-1">
          <span className="text-sm font-semibold">Usage notes</span>
          <textarea className="field min-h-24 py-2" maxLength={1000} placeholder="e.g. Keep 10 mm clear around the logo. Never place the white logo on Heather grey." value={kit.notes} onChange={(e) => update({ notes: e.target.value })} />
        </label>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          className="btn btn-primary"
          disabled={!dirty || !kit.name.trim()}
          onClick={async () => {
            const saved = await saveBrandKit({ ...kit, name: kit.name.trim() });
            setDirty(false);
            toast(`Saved ${saved.name}.`, 'success');
            onSaved(saved);
          }}
        >
          Save brand kit
        </button>
        {dirty ? <span className="text-sm text-fg-2">Unsaved changes</span> : null}
        <button className="btn btn-ghost ml-auto text-danger" onClick={() => setConfirm(true)}>
          <Trash2 size={15} /> Delete
        </button>
      </div>

      <AssetPicker open={picker} chosen={kit.logoAssetIds} onClose={() => setPicker(false)} onPick={toggleLogo} />
      <ConfirmDialog
        open={confirm}
        title={`Delete ${kit.name}?`}
        body="Projects linked to this kit keep their artwork; they just lose the shortcut to its logos, colours and fonts."
        confirmLabel="Delete brand kit"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          await deleteBrandKit(kit.id);
          toast('Brand kit deleted.');
          onDeleted();
        }}
      />
    </div>
  );
}

export function BrandKits() {
  const [kits, setKits] = useState<BrandKit[] | null>(null);
  const [editing, setEditing] = useState<BrandKit | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    listBrandKits().then((k) => alive && setKits(k), () => alive && setKits([]));
    return () => {
      alive = false;
    };
  }, [version]);

  return (
    <>
      <PageHeader
        title="Brand kits"
        description="Approved logos, colours and fonts, ready in every project. Link a kit from the studio’s Brand tab."
        action={
          <button className="btn btn-primary" onClick={() => setEditing(blankKit())}>
            <Plus size={16} /> New brand kit
          </button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div>
          {kits === null ? (
            <p className="text-sm text-fg-2">Loading…</p>
          ) : kits.length === 0 && !editing ? (
            <div className="rounded-2xl border border-dashed border-line p-6 text-center">
              <Palette className="mx-auto text-fg-3" size={22} aria-hidden />
              <p className="mt-2 font-semibold">No brand kits yet</p>
              <p className="mt-1 text-sm text-fg-2">Create one to keep logos and colours consistent across every garment.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {kits.map((k) => (
                <li key={k.id}>
                  <button className={`w-full rounded-xl border p-3 text-left ${editing?.id === k.id ? 'border-accent bg-selected' : 'border-line bg-panel hover:border-line-strong'}`} onClick={() => setEditing(k)}>
                    <p className="font-semibold">{k.name}</p>
                    <div className="mt-2 flex gap-1">
                      {k.colors.slice(0, 8).map((c) => (
                        <span key={c.id} className="h-4 w-4 rounded border border-line" style={{ background: c.hex }} title={c.name} />
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-fg-2">
                      {k.logoAssetIds.length} {k.logoAssetIds.length === 1 ? 'logo' : 'logos'}, {k.fonts.length} {k.fonts.length === 1 ? 'font' : 'fonts'}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          {editing ? (
            <KitEditor
              key={editing.id}
              initial={editing}
              onSaved={(k) => {
                setEditing(k);
                refresh();
              }}
              onDeleted={() => {
                setEditing(null);
                refresh();
              }}
            />
          ) : kits && kits.length ? (
            <p className="text-sm text-fg-2">Choose a brand kit to edit it.</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
