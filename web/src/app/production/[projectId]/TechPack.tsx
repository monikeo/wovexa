'use client';
/**
 * Wovexa Production tech pack (spec §16 FAC-01…07). Every value comes from the saved design;
 * anything a mesh can't prove (construction, tolerances, sign-off) is a labelled blank field.
 */
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getGarment, getSize, PRINT_METHOD_LABELS } from '@/domain/garments';
import { effectiveDpi, runPreflight, summarize } from '@/domain/preflight';
import { ZONE_IDS, type DesignDocument, type ZoneId } from '@/domain/schema';
import { WovexaLockup } from '@/components/brand/Logo';
import { loadDocument } from '@/lib/local-db';
import { renderZoneSketch } from '@/lib/thumbnail';

function Sketch({ doc, zoneId }: { doc: DesignDocument; zoneId: ZoneId }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    renderZoneSketch(doc, zoneId, 640, { printArea: true }).then((canvas) => {
      if (cancelled || !ref.current) return;
      canvas.className = 'h-auto w-full';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${zoneId.replace('_', ' ')} placement sketch`);
      ref.current.replaceChildren(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, zoneId]);
  return <div ref={ref} className="aspect-square w-full rounded-lg border border-line bg-white" />;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export function TechPack({ projectId }: { projectId: string }) {
  const [doc, setDoc] = useState<DesignDocument | null | 'missing'>(null);
  useEffect(() => {
    loadDocument(projectId).then((r) => setDoc(r.ok ? r.document : 'missing'));
  }, [projectId]);

  if (doc === null) return <p className="p-8 text-sm text-fg-2">Loading tech pack…</p>;
  if (doc === 'missing') {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="heading text-2xl">This project isn’t on this device</h1>
        <Link href="/dashboard" className="btn btn-ink mt-6">
          Back to projects
        </Link>
      </main>
    );
  }

  const model = getGarment(doc.garment.modelId);
  const size = getSize(model, doc.garment.sizeCode);
  const fabric = model.fabricPresets.find((f) => f.id === doc.garment.fabricPresetId);
  const colorway = doc.colorways.find((c) => c.id === doc.activeColorwayId) ?? doc.colorways[0];
  const issues = runPreflight(doc);
  const { errors, warnings } = summarize(issues);
  const zones = ZONE_IDS.filter((z) => doc.zones[z].orderedLayerIds.length > 0);
  const sketchZones: ZoneId[] = zones.length ? zones : ['front'];

  return (
    <main className="mx-auto max-w-5xl bg-panel px-4 py-6 text-fg print:max-w-none print:p-0 md:px-10 md:py-10">
      <style>{`@media print { @page { size: A4; margin: 12mm; } body { background: white; } .no-print { display: none !important; } }`}</style>
      <div className="no-print mb-8 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/studio/${projectId}`} className="btn btn-ghost px-2">
          <ArrowLeft size={16} /> Back to studio
        </Link>
        <button className="btn btn-ink" onClick={() => window.print()}>
          <Printer size={16} /> Print or save as PDF
        </button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-fg pb-5">
        <div>
          <p className="text-sm text-fg-2">Tech pack</p>
          <h1 className="heading mt-1 text-3xl">{doc.title}</h1>
          <p className="num mt-2 text-sm text-fg-2">
            Revision {doc.revision}, generated {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <WovexaLockup className="h-6 w-auto" />
      </header>

      {errors > 0 ? (
        <p className="mt-6 rounded-lg border-2 border-danger p-3 text-sm">
          <strong className="text-danger">Not ready for production.</strong> {errors} print {errors === 1 ? 'check fails' : 'checks fail'}; fix them in the studio first.
        </p>
      ) : null}

      <section className="mt-8 grid gap-8 md:grid-cols-2" aria-labelledby="garment">
        <div>
          <h2 id="garment" className="text-sm font-semibold">
            Garment
          </h2>
          <dl className="mt-3 grid grid-cols-[130px_1fr] gap-y-2 text-sm">
            <dt className="text-fg-2">Style</dt>
            <dd>{model.name}</dd>
            <dt className="text-fg-2">Size</dt>
            <dd className="num">
              {size.code}: chest {size.chestFlatMm / 10} cm flat, body length {size.bodyLengthMm / 10} cm
            </dd>
            <dt className="text-fg-2">Fabric</dt>
            <dd>{fabric?.label ?? 'Not set'}</dd>
            <dt className="text-fg-2">Colourway</dt>
            <dd>{colorway.name}</dd>
            <dt className="text-fg-2">Pattern source</dt>
            <dd>{model.calibrated ? 'Calibrated model' : 'Uncalibrated preview model. Confirm measurements against the physical blank.'}</dd>
          </dl>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Colour reference</h2>
          <p className="mt-1 text-xs text-fg-2">Screen values only. Match against physical swatches.</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {(Object.entries(colorway.parts) as [string, string][]).map(([part, hex]) => (
              <li key={part} className="flex items-center gap-2.5">
                <span className="h-7 w-7 flex-none rounded border border-line" style={{ background: hex }} aria-hidden />
                <span className="capitalize">{part}</span>
                <span className="ml-auto font-mono text-xs text-fg-2">{hex}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-10 break-inside-avoid" aria-labelledby="placement">
        <h2 id="placement" className="text-sm font-semibold">
          Placement
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
          {sketchZones.map((z) => (
            <figure key={z}>
              <Sketch doc={doc} zoneId={z} />
              <figcaption className="mt-1.5 text-xs text-fg-2">{model.zones[z].label}. Dashed line: print area.</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="schedule">
        <h2 id="schedule" className="text-sm font-semibold">
          Decoration schedule
        </h2>
        <p className="mt-1 text-xs text-fg-2">Positions are measured from the centre of each print area; Y is positive downwards. All values in millimetres.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-fg text-left">
                <th className="py-2 pr-3 font-semibold">Zone</th>
                <th className="py-2 pr-3 font-semibold">Method</th>
                <th className="py-2 pr-3 font-semibold">Layer</th>
                <th className="py-2 pr-3 text-right font-semibold">W × H</th>
                <th className="py-2 pr-3 text-right font-semibold">X, Y</th>
                <th className="py-2 pr-3 text-right font-semibold">Rotation</th>
                <th className="py-2 text-right font-semibold">Resolution</th>
              </tr>
            </thead>
            <tbody>
              {zones.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-fg-2">
                    No artwork placed yet.
                  </td>
                </tr>
              ) : (
                zones.flatMap((z) => {
                  const zone = doc.zones[z];
                  const spec = model.zones[z];
                  return zone.orderedLayerIds.map((id) => {
                    const l = zone.layers[id];
                    const dpi = effectiveDpi(l);
                    return (
                      <tr key={id} className={`border-b border-line ${l.visible ? '' : 'text-fg-3'}`}>
                        <td className="py-2 pr-3">{spec.label}</td>
                        <td className="py-2 pr-3">{PRINT_METHOD_LABELS[zone.printMethod]}</td>
                        <td className="py-2 pr-3">
                          {l.name}
                          {l.visible ? '' : ' (hidden, not printed)'}
                        </td>
                        <td className="num py-2 pr-3 text-right">
                          {fmt(l.transform.widthMm)} × {fmt(l.transform.heightMm)}
                        </td>
                        <td className="num py-2 pr-3 text-right">
                          {fmt(l.transform.centerXmm - spec.printableWidthMm / 2)}, {fmt(l.transform.centerYmm - spec.printableHeightMm / 2)}
                        </td>
                        <td className="num py-2 pr-3 text-right">{Math.round(l.transform.rotationDeg)}°</td>
                        <td className="num py-2 text-right">{dpi ? `${Math.round(dpi.min)} dpi` : l.content.kind === 'image' ? 'Vector' : 'Live text/shape'}</td>
                      </tr>
                    );
                  });
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-fg-2">
          Print checks: {errors} failing, {warnings} to review.
        </p>
      </section>

      <section className="mt-10 grid gap-8 md:grid-cols-2" aria-labelledby="manual">
        <div>
          <h2 id="manual" className="text-sm font-semibold">
            Construction notes
          </h2>
          <p className="mt-1 text-xs text-fg-2">To be completed by the product developer. Not inferred from the 3D model.</p>
          {doc.notes ? <p className="mt-3 whitespace-pre-wrap text-sm">{doc.notes}</p> : null}
          <div className="mt-3 space-y-6" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="border-b border-line-strong" />
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Sign-off</h2>
          <p className="mt-1 text-xs text-fg-2">Confirm manually after a physical sample.</p>
          <dl className="mt-3 space-y-5 text-sm">
            {['Approved by', 'Date', 'Sample accepted (placement, colour, size)', 'Factory contact'].map((f) => (
              <div key={f} className="grid grid-cols-[1fr] gap-1">
                <dt className="text-fg-2">{f}</dt>
                <dd className="h-6 border-b border-line-strong" />
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}
