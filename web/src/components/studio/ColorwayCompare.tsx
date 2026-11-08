'use client';
/**
 * Colourway comparison (spec VAR-02, VAR-05): every colourway side by side, front and back,
 * rendered the same way so differences are judgeable.
 */
import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { setActiveColorway } from '@/domain/commands';
import type { DesignDocument, ZoneId } from '@/domain/schema';
import { renderZoneSketch } from '@/lib/thumbnail';
import { useStudio } from '@/stores/studio-store';

function Sketch({ doc, colorwayId, zoneId }: { doc: DesignDocument; colorwayId: string; zoneId: ZoneId }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    renderZoneSketch({ ...doc, activeColorwayId: colorwayId }, zoneId, 320).then((canvas) => {
      if (!alive || !ref.current) return;
      canvas.className = 'h-auto w-full';
      ref.current.replaceChildren(canvas);
    });
    return () => {
      alive = false;
    };
  }, [doc, colorwayId, zoneId]);
  return <div ref={ref} className="aspect-square w-full" />;
}

export function ColorwayCompare() {
  const doc = useStudio((s) => s.document);
  const dispatch = useStudio((s) => s.dispatch);
  if (!doc) return null;
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
      {doc.colorways.map((c) => {
        const active = c.id === doc.activeColorwayId;
        return (
          <article key={c.id} className={`rounded-xl border p-2 ${active ? 'border-accent' : 'border-line'}`}>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--surface-hover)]">
              <Sketch doc={doc} colorwayId={c.id} zoneId="front" />
              <Sketch doc={doc} colorwayId={c.id} zoneId="back" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="h-5 w-5 flex-none rounded border border-line" style={{ background: c.parts.body }} aria-hidden />
              <span className="flex-1 truncate text-sm font-semibold">{c.name}</span>
              {active ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-accent">
                  <Check size={13} /> Main
                </span>
              ) : (
                <button className="btn btn-outline min-h-8 px-2.5 text-xs" onClick={() => dispatch(setActiveColorway(c.id))}>
                  Make main
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
