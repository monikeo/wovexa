'use client';
import { LayoutTemplate, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { saveUserTemplate } from '@/lib/local-db';
import { thumbnailWithin } from '@/lib/thumbnail';
import { toast } from '@/components/ui/primitives';
import { useStudio } from '@/stores/studio-store';

/** Save the current design as a reusable template (spec BRD-03). */
export function SaveTemplatePanel({ onDone }: { onDone: () => void }) {
  const doc = useStudio((s) => s.document);
  const [name, setName] = useState(doc?.title ?? '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  if (!doc) return null;
  return (
    <form
      className="space-y-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const snapshot = structuredClone(useStudio.getState().document!);
          await saveUserTemplate({ name: name.trim().slice(0, 80), description: description.trim().slice(0, 200), document: snapshot, thumbnail: await thumbnailWithin(snapshot) });
          toast(`Saved “${name.trim()}” to your templates.`, 'success');
          onDone();
        } catch {
          toast('The template could not be saved.', 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-fg-2">Templates keep the garment, colourways and every layer. New projects made from it start as independent copies.</p>
      <label className="grid gap-1">
        <span className="label">Template name</span>
        <input className="field h-10" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="grid gap-1">
        <span className="label">Description (optional)</span>
        <textarea className="field min-h-20 py-2" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button className="btn btn-primary w-full" disabled={busy || !name.trim()}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <LayoutTemplate size={15} />} Save template
      </button>
      <Link href="/templates" className="block text-center text-sm text-fg-2 underline underline-offset-4">
        See all templates
      </Link>
    </form>
  );
}
