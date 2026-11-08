'use client';
import { Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ZONE_IDS, type DesignDocument } from '@/domain/schema';
import { BUILT_IN_TEMPLATES, type TemplateDef } from '@/domain/templates';
import { deleteUserTemplate, listUserTemplates, type StoredTemplate } from '@/lib/local-db';
import { previewTemplate, projectFromTemplate, projectFromUserTemplate } from '@/lib/templates-apply';
import { renderZoneSketch } from '@/lib/thumbnail';
import { ConfirmDialog, toast } from '@/components/ui/primitives';
import { BlobImage } from './projects';

/** The zone a preview should show: the one carrying the most artwork. */
function showcaseZone(doc: DesignDocument) {
  return [...ZONE_IDS].sort((a, b) => doc.zones[b].orderedLayerIds.length - doc.zones[a].orderedLayerIds.length)[0];
}

function TemplatePreview({ def }: { def: TemplateDef }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    previewTemplate(def)
      .then((doc) => renderZoneSketch(doc, showcaseZone(doc), 360))
      .then((canvas) => {
        if (!alive || !ref.current) return;
        canvas.className = 'h-full w-full object-contain';
        ref.current.replaceChildren(canvas);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [def]);
  return <div ref={ref} className="grid aspect-[4/3] place-items-center overflow-hidden rounded-t-xl bg-[var(--surface-hover)] p-2" />;
}

function useCreate() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const create = async (key: string, make: () => Promise<{ id: string }>) => {
    setBusy(key);
    try {
      const meta = await make();
      router.push(`/studio/${meta.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The project could not be created.', 'error');
      setBusy(null);
    }
  };
  return { busy, create };
}

export function BuiltInTemplates({ limit }: { limit?: number }) {
  const { busy, create } = useCreate();
  const list = limit ? BUILT_IN_TEMPLATES.slice(0, limit) : BUILT_IN_TEMPLATES;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      {list.map((def) => (
        <article key={def.id} className="rounded-xl border border-line bg-panel">
          <button className="block w-full rounded-t-xl text-left" onClick={() => create(def.id, () => projectFromTemplate(def))} disabled={!!busy} aria-label={`Use template ${def.name}`}>
            <TemplatePreview def={def} />
          </button>
          <div className="p-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              {def.name}
              {busy === def.id ? <Loader2 size={14} className="animate-spin" /> : null}
            </h3>
            <p className="mt-0.5 line-clamp-2 text-xs text-fg-2">{def.description}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function UserTemplates() {
  const { busy, create } = useCreate();
  const [templates, setTemplates] = useState<StoredTemplate[] | null>(null);
  const [pending, setPending] = useState<StoredTemplate | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    listUserTemplates().then((t) => alive && setTemplates(t), () => alive && setTemplates([]));
    return () => {
      alive = false;
    };
  }, [version]);

  if (templates === null) return <p className="text-sm text-fg-2">Loading your templates…</p>;
  if (!templates.length) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-6 text-center">
        <p className="font-semibold">No saved templates yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-fg-2">In the studio, open the ⋯ menu and choose Save as template. It keeps the garment, colourways and every layer.</p>
      </div>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {templates.map((t) => (
          <article key={t.id} className="rounded-xl border border-line bg-panel">
            <button className="block w-full rounded-t-xl" onClick={() => create(t.id, () => projectFromUserTemplate(t))} disabled={!!busy} aria-label={`Use template ${t.name}`}>
              <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-t-xl bg-[var(--surface-hover)] p-2">
                {t.thumbnail ? <BlobImage blob={t.thumbnail} className="h-full w-full object-contain" /> : null}
              </div>
            </button>
            <div className="flex items-start gap-2 p-3">
              <div className="min-w-0 flex-1">
                <h3 className="flex items-center gap-2 truncate text-sm font-semibold">
                  {t.name}
                  {busy === t.id ? <Loader2 size={14} className="animate-spin" /> : null}
                </h3>
                <p className="mt-0.5 line-clamp-2 text-xs text-fg-2">{t.description || `Saved ${new Date(t.createdAt).toLocaleDateString()}`}</p>
              </div>
              <button className="icon-btn" aria-label={`Delete template ${t.name}`} onClick={() => setPending(t)}>
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <ConfirmDialog
        open={!!pending}
        title={`Delete template ${pending?.name ?? ''}?`}
        body="Projects already made from it are not affected."
        confirmLabel="Delete template"
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (pending) await deleteUserTemplate(pending.id);
          setPending(null);
          toast('Template deleted.');
          refresh();
        }}
      />
    </>
  );
}
