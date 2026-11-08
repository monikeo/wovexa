'use client';
import { Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ACCEPTED_TYPES, AssetError, formatBytes, importImageFile } from '@/lib/assets';
import { assetUsage, deleteAsset, listAssets, type StoredAsset } from '@/lib/local-db';
import { ConfirmDialog, toast } from '@/components/ui/primitives';
import { BlobImage } from '@/components/workspace/projects';
import { PageHeader } from '@/components/workspace/WorkspaceShell';

function AssetTile({ asset, onDelete }: { asset: StoredAsset; onDelete: (a: StoredAsset) => void }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-panel">
      <div
        className="grid aspect-square place-items-center p-3"
        style={{ backgroundImage: 'repeating-conic-gradient(var(--surface-hover) 0 25%, transparent 0 50%)', backgroundSize: '16px 16px' }}
      >
        <BlobImage blob={asset.blob} className="max-h-full max-w-full object-contain" />
      </div>
      <figcaption className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={asset.name}>
            {asset.name}
          </p>
          <p className="num text-xs text-fg-2">
            {asset.mime === 'image/svg+xml' ? 'SVG vector' : `${asset.width} × ${asset.height} px`}, {formatBytes(asset.bytes)}
          </p>
        </div>
        <button className="icon-btn" onClick={() => onDelete(asset)} aria-label={`Delete ${asset.name}`}>
          <Trash2 size={15} />
        </button>
      </figcaption>
    </figure>
  );
}

export function AssetLibrary() {
  const [assets, setAssets] = useState<StoredAsset[] | null>(null);
  const [pending, setPending] = useState<StoredAsset | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    listAssets()
      .catch(() => [])
      .then((list) => alive && setAssets(list));
    return () => {
      alive = false;
    };
  }, [version]);

  const upload = async (files: FileList) => {
    for (const file of Array.from(files)) {
      try {
        await importImageFile(file);
      } catch (e) {
        toast(e instanceof AssetError ? e.message : `${file.name} couldn't be added.`, 'error');
      }
    }
    void refresh();
  };

  return (
    <>
      <PageHeader
        title="Assets"
        description="Artwork you’ve uploaded. Originals are kept unchanged, SVGs are cleaned of scripts, and duplicates are stored once."
        action={
          <label className="btn btn-primary">
            <Upload size={16} /> Upload artwork
            <input type="file" accept={ACCEPTED_TYPES} multiple className="sr-only" onChange={(e) => e.target.files && void upload(e.target.files)} />
          </label>
        }
      />
      {assets === null ? (
        <p className="text-sm text-fg-2">Loading assets…</p>
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center">
          <p className="font-semibold">No artwork yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-2">Upload PNG, JPEG, WebP or SVG files up to 25 MB, or add them straight from the studio.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {assets.map((a) => (
            <AssetTile key={a.id} asset={a} onDelete={setPending} />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!pending}
        title={`Delete ${pending?.name ?? ''}?`}
        body="The original file is removed from this browser. Projects that use it will show an empty placeholder."
        confirmLabel="Delete artwork"
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          const usedIn = await assetUsage(pending.id);
          if (usedIn.length) {
            toast(`Still used in ${usedIn.slice(0, 2).join(', ')}${usedIn.length > 2 ? ` and ${usedIn.length - 2} more` : ''}. Remove it there first.`, 'error');
          } else {
            await deleteAsset(pending.id);
            toast('Artwork deleted.');
            void refresh();
          }
          setPending(null);
        }}
      />
    </>
  );
}
