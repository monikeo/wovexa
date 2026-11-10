'use client';
/**
 * Wovexa Production tech pack (spec §16 FAC-01…07).
 * - Current design: live and editable (bill of materials, construction notes, QA checklist).
 * - Approved version (?version=…): frozen, read-only, with approver, date and content hash.
 * Every value comes from the design; anything a 3D model can't prove is a labelled field
 * that someone must confirm.
 */
import { ArrowLeft, BadgeCheck, Plus, Printer, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { areaSpec, describeAreaPlacement, designAreas } from '@/domain/areas';
import * as cmd from '@/domain/commands';
import { newId } from '@/domain/factory';
import { getGarment, getSize, partColor, PRINT_METHOD_LABELS, zoneSpecOrFirst } from '@/domain/garments';
import { detachedLayers, isPlacement } from '@/domain/lockups';
import { effectiveDpi, runPreflight, summarize } from '@/domain/preflight';
import { migrateDesignDocument, type BomItem, type DesignArea, type DesignDocument, type ZoneId } from '@/domain/schema';
import { prepareDocument } from '@/lib/export/package';
import { renderZoneArtwork } from '@/lib/render/zone-renderer';
import { WovexaLockup } from '@/components/brand/Logo';
import { approvalState, getVersion, type StoredVersion } from '@/lib/local-db';
import { renderZoneSketch } from '@/lib/thumbnail';
import { useStudio } from '@/stores/studio-store';

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

/** A design area's artwork at its true proportions, for the placement section. */
function AreaArtwork({ doc, area }: { doc: DesignDocument; area: DesignArea }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    // Loads every design area's images and fonts (the zones' are not needed here).
    prepareDocument(doc, []).then(() => {
      if (cancelled || !ref.current) return;
      const { canvas } = renderZoneArtwork(area, area.widthMm, area.heightMm, 72);
      canvas.className = 'h-full w-full object-contain';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${area.name} artwork`);
      ref.current.replaceChildren(canvas);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, area]);
  return <div ref={ref} className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-line bg-white p-2" />;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Text input that commits on blur or Enter, so typing doesn't create an undo step per key. */
function Field({ value, onCommit, label, className = '', multiline = false }: { value: string; onCommit: (v: string) => void; label: string; className?: string; multiline?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }
  const common = {
    'aria-label': label,
    value: draft,
    onBlur: () => draft !== value && onCommit(draft),
    className: `w-full rounded-md border border-line bg-transparent px-2 py-1 text-sm focus:border-[var(--focus-ring)] focus:outline-none print:border-transparent print:px-0 ${className}`,
  };
  return multiline ? (
    <textarea {...common} rows={4} onChange={(e) => setDraft(e.target.value)} />
  ) : (
    <input {...common} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
  );
}

interface Header {
  kind: 'draft' | 'approved' | 'version';
  version?: StoredVersion;
}

function TechPackBody({ doc, editable, header, projectId }: { doc: DesignDocument; editable: boolean; header: Header; projectId: string }) {
  const dispatch = useStudio((s) => s.dispatch);
  const meta = useStudio((s) => s.meta);
  const model = getGarment(doc.garment.modelId);
  const size = getSize(model, doc.garment.sizeCode);
  const fabric = model.fabricPresets.find((f) => f.id === doc.garment.fabricPresetId);
  const colorway = doc.colorways.find((c) => c.id === doc.activeColorwayId) ?? doc.colorways[0];
  const { errors, warnings } = summarize(runPreflight(doc));
  const zones = model.zoneOrder.filter((z) => doc.zones[z].orderedLayerIds.length > 0);
  const areas = designAreas(doc).filter((a) => a.orderedLayerIds.length > 0);
  const sketchZones: ZoneId[] = zones.length ? zones : ['front'];
  const p = doc.production;
  const approval = header.version?.approval;
  const setBom = (row: BomItem, patch: Partial<Omit<BomItem, 'id'>>) => dispatch(cmd.updateBomItem(row.id, patch));

  return (
    <main className="mx-auto max-w-5xl bg-panel px-4 py-6 text-fg print:max-w-none print:p-0 md:px-10 md:py-10">
      <style>{`@media print { @page { size: A4; margin: 12mm; } body { background: white; } .no-print { display: none !important; } }`}</style>
      <div className="no-print mb-8 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/studio/${projectId}`} className="btn btn-ghost px-2">
          <ArrowLeft size={16} /> Back to studio
        </Link>
        <div className="flex flex-wrap gap-2">
          {header.kind !== 'draft' ? (
            <Link href={`/production/${projectId}`} className="btn btn-outline">
              Current design
            </Link>
          ) : meta?.approvedVersionId ? (
            <Link href={`/production/${projectId}?version=${meta.approvedVersionId}`} className="btn btn-outline">
              <BadgeCheck size={16} /> Approved version {meta.approvedVersionNumber}
            </Link>
          ) : null}
          <button className="btn btn-ink" onClick={() => window.print()}>
            <Printer size={16} /> Print or save as PDF
          </button>
        </div>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-fg pb-5">
        <div>
          <p className="text-sm text-fg-2">Tech pack</p>
          <h1 className="heading mt-1 text-3xl">{doc.title}</h1>
          <p className="num mt-2 text-sm text-fg-2">
            {header.version ? `Version ${header.version.number}, ${header.version.label}` : 'Current working design'}, generated{' '}
            {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <WovexaLockup className="h-6 w-auto" />
      </header>

      {approval ? (
        <p className="mt-6 flex flex-wrap items-center gap-x-2 rounded-lg border-2 border-success p-3 text-sm">
          <BadgeCheck size={16} className="text-success" />
          <strong>Approved for production</strong> by {approval.approvedBy} on {new Date(approval.approvedAt).toLocaleDateString(undefined, { dateStyle: 'long' })}.
          {approval.note ? ` ${approval.note}.` : ''}
          <span className="font-mono text-xs text-fg-2">Content hash {header.version?.hash.slice(0, 16)}</span>
        </p>
      ) : header.kind === 'draft' ? (
        <p className={`mt-6 rounded-lg border-2 p-3 text-sm ${meta && approvalState(meta) === 'approved' ? 'border-success' : 'border-warning'}`}>
          {meta && approvalState(meta) === 'approved' ? (
            <>
              <strong>Matches approved version {meta.approvedVersionNumber}.</strong> Print the approved version for the factory record.
            </>
          ) : meta && approvalState(meta) === 'changed' ? (
            <>
              <strong>Changed since version {meta.approvedVersionNumber} was approved.</strong> Approve the changes from the studio’s Versions panel, or send the factory the approved version.
            </>
          ) : (
            <>
              <strong>Draft, not approved.</strong> Approve a version from the studio’s Versions panel before sending this to a factory.
            </>
          )}
        </p>
      ) : (
        <p className="mt-6 rounded-lg border-2 border-warning p-3 text-sm">
          <strong>Saved version, not approved.</strong>
        </p>
      )}

      {errors > 0 ? (
        <p className="mt-3 rounded-lg border-2 border-danger p-3 text-sm">
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
            <dt className="text-fg-2">Factory contact</dt>
            <dd>{editable ? <Field label="Factory contact" value={p.factoryContact} onCommit={(v) => dispatch(cmd.updateProduction({ factoryContact: v.slice(0, 200) }, 'Edit factory contact'))} /> : p.factoryContact || '—'}</dd>
          </dl>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Colour reference</h2>
          <p className="mt-1 text-xs text-fg-2">Screen values only. Match against physical swatches.</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {model.colorParts.map(({ part, label }) => {
              const hex = partColor(colorway, part);
              return (
                <li key={part} className="flex items-center gap-2.5">
                  <span className="h-7 w-7 flex-none rounded border border-line" style={{ background: hex }} aria-hidden />
                  <span>{label}</span>
                  <span className="ml-auto font-mono text-xs text-fg-2">{hex}</span>
                </li>
              );
            })}
          </ul>
          {colorway.surfaces && Object.keys(colorway.surfaces).length ? (
            <p className="mt-3 text-xs text-fg-2">
              All-over print on {Object.keys(colorway.surfaces).join(', ')}: needs sublimation or printed fabric. See the 3D renders for the look.
            </p>
          ) : null}
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
              <figcaption className="mt-1.5 text-xs text-fg-2">{zoneSpecOrFirst(model, z).label}. Dashed line: print area.</figcaption>
            </figure>
          ))}
          {areas.map((a) => (
            <figure key={a.id}>
              <AreaArtwork doc={doc} area={a} />
              <figcaption className="mt-1.5 text-xs text-fg-2">
                <span className="font-medium text-fg">{a.name}</span>, {PRINT_METHOD_LABELS[a.printMethod]}: {describeAreaPlacement(a)}.
              </figcaption>
            </figure>
          ))}
        </div>
        {areas.length ? <p className="mt-2 text-xs text-fg-2">Design areas are placed on the garment in 3D; measure their centres on the finished garment, from the hem and the centre line.</p> : null}
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
              {zones.length + areas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-fg-2">
                    No artwork placed yet.
                  </td>
                </tr>
              ) : (
                [...zones.map((z) => ({ key: z as string, zone: doc.zones[z], spec: zoneSpecOrFirst(model, z) })), ...areas.map((a) => ({ key: a.id as string, zone: a, spec: areaSpec(a) }))].flatMap(({ key, zone, spec }) => {
                  return zone.orderedLayerIds.map((id) => {
                    const l = zone.layers[id];
                    // A lockup prints at its photos' lowest resolution, at the size this placement gives them.
                    const dpis = (isPlacement(l) ? detachedLayers(l, (x) => x.id, '') : [l]).map((x) => effectiveDpi(x)).filter((d): d is NonNullable<typeof d> => !!d);
                    const dpi = dpis.length ? { min: Math.min(...dpis.map((d) => d.min)) } : null;
                    return (
                      <tr key={`${key}:${id}`} className={`border-b border-line ${l.visible ? '' : 'text-fg-3'}`}>
                        <td className="py-2 pr-3">{spec.label}</td>
                        <td className="py-2 pr-3">{PRINT_METHOD_LABELS[zone.printMethod]}</td>
                        <td className="py-2 pr-3">
                          {l.name}
                          {l.content.kind === 'text' && l.content.onPath ? ', on a path' : l.content.kind === 'text' && l.content.curveDeg ? `, curved ${Math.round(l.content.curveDeg)}°` : ''}
                          {l.content.kind === 'lockup' ? (l.content.name === l.name ? ' (lockup)' : `, lockup ${l.content.name}`) : ''}
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

      <section className="mt-10" aria-labelledby="bom">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="bom" className="text-sm font-semibold">
              Bill of materials
            </h2>
            <p className="mt-1 text-xs text-fg-2">Rows marked “Confirm” have not been checked against a supplier yet.</p>
          </div>
          {editable ? (
            <button
              className="no-print btn btn-outline min-h-8 text-xs"
              onClick={() => dispatch(cmd.addBomItem({ id: newId(), component: 'New material', description: '', supplierRef: '', colour: '', quantity: '', confirmed: false }))}
            >
              <Plus size={14} /> Add material
            </button>
          ) : null}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-fg text-left">
                <th className="py-2 pr-2 font-semibold">Component</th>
                <th className="py-2 pr-2 font-semibold">Description</th>
                <th className="py-2 pr-2 font-semibold">Supplier ref.</th>
                <th className="py-2 pr-2 font-semibold">Colour</th>
                <th className="py-2 pr-2 font-semibold">Qty per unit</th>
                <th className="py-2 pr-2 font-semibold">Status</th>
                {editable ? <th className="no-print py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {p.bom.map((row) => (
                <tr key={row.id} className="border-b border-line align-top">
                  {(['component', 'description', 'supplierRef', 'colour', 'quantity'] as const).map((key) => (
                    <td key={key} className="py-1.5 pr-2">
                      {editable ? <Field label={`${row.component} ${key}`} value={row[key]} onCommit={(v) => setBom(row, { [key]: v.slice(0, key === 'description' ? 200 : 80) })} /> : row[key] || '—'}
                    </td>
                  ))}
                  <td className="py-1.5 pr-2">
                    {editable ? (
                      <label className="flex items-center gap-1.5 whitespace-nowrap">
                        <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={row.confirmed} onChange={(e) => setBom(row, { confirmed: e.target.checked })} />
                        <span className={row.confirmed ? 'text-success' : 'font-semibold text-warning'}>{row.confirmed ? 'Confirmed' : 'Confirm'}</span>
                      </label>
                    ) : (
                      <span className={row.confirmed ? 'text-success' : 'font-semibold text-warning'}>{row.confirmed ? 'Confirmed' : 'Confirm'}</span>
                    )}
                  </td>
                  {editable ? (
                    <td className="no-print py-1.5">
                      <button className="icon-btn h-8 w-8" aria-label={`Remove ${row.component}`} onClick={() => dispatch(cmd.removeBomItem(row.id))}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10 grid gap-8 md:grid-cols-2" aria-labelledby="manual">
        <div>
          <h2 id="manual" className="text-sm font-semibold">
            Construction notes
          </h2>
          <p className="mt-1 text-xs text-fg-2">Written by the product developer. Not inferred from the 3D model.</p>
          <div className="mt-3">
            {editable ? (
              <Field multiline label="Construction notes" value={p.constructionNotes} onCommit={(v) => dispatch(cmd.updateProduction({ constructionNotes: v.slice(0, 4000) }))} />
            ) : p.constructionNotes ? (
              <p className="whitespace-pre-wrap text-sm">{p.constructionNotes}</p>
            ) : (
              <p className="text-sm text-fg-3">None recorded.</p>
            )}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Sample QA checklist</h2>
          <p className="mt-1 text-xs text-fg-2">Tick each check against the physical sample.</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {p.qa.map((q) => (
              <li key={q.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 flex-none accent-[var(--accent)]"
                  checked={q.checked}
                  disabled={!editable}
                  aria-label={q.label}
                  onChange={(e) => dispatch(cmd.updateQaItem(q.id, { checked: e.target.checked }))}
                />
                <span className="flex-1">{q.label}</span>
                {editable ? (
                  <button className="no-print text-fg-3 hover:text-danger" aria-label={`Remove check ${q.label}`} onClick={() => dispatch(cmd.removeQaItem(q.id))}>
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {editable ? (
            <form
              className="no-print mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem('check') as HTMLInputElement;
                const label = input.value.trim();
                if (!label) return;
                dispatch(cmd.addQaItem({ id: newId(), label: label.slice(0, 120), checked: false }));
                input.value = '';
              }}
            >
              <input name="check" className="field" placeholder="Add a check" aria-label="New QA check" maxLength={120} />
              <button className="btn btn-outline flex-none text-xs">Add</button>
            </form>
          ) : null}
          <h2 className="mt-8 text-sm font-semibold">Sign-off</h2>
          <dl className="mt-3 space-y-5 text-sm">
            {[
              ['Approved by', approval?.approvedBy],
              ['Date', approval ? new Date(approval.approvedAt).toLocaleDateString(undefined, { dateStyle: 'long' }) : undefined],
              ['Sample accepted (placement, colour, size)', undefined],
              ['Factory acknowledgement', undefined],
            ].map(([f, v]) => (
              <div key={f} className="grid grid-cols-[1fr] gap-1">
                <dt className="text-fg-2">{f}</dt>
                <dd className="min-h-6 border-b border-line-strong">{v ?? ''}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}

function DraftTechPack({ projectId }: { projectId: string }) {
  const status = useStudio((s) => s.status);
  const loadedId = useStudio((s) => s.projectId);
  const doc = useStudio((s) => s.document);
  const load = useStudio((s) => s.load);
  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);
  if (status === 'missing' || status === 'invalid') return <Missing />;
  if (status !== 'ready' || loadedId !== projectId || !doc) return <p className="p-8 text-sm text-fg-2">Loading tech pack…</p>;
  return <TechPackBody doc={doc} editable header={{ kind: 'draft' }} projectId={projectId} />;
}

function VersionTechPack({ projectId, versionId }: { projectId: string; versionId: string }) {
  const [state, setState] = useState<{ version: StoredVersion; doc: DesignDocument } | null | 'missing'>(null);
  useEffect(() => {
    let alive = true;
    getVersion(versionId).then((version) => {
      if (!alive) return;
      const parsed = version && version.projectId === projectId ? migrateDesignDocument(version.document) : null;
      setState(version && parsed?.ok ? { version, doc: parsed.document } : 'missing');
    });
    // Load the project too, so the header knows the current approval state.
    void useStudio.getState().load(projectId);
    return () => {
      alive = false;
    };
  }, [projectId, versionId]);
  if (state === 'missing') return <Missing />;
  if (!state) return <p className="p-8 text-sm text-fg-2">Loading tech pack…</p>;
  return <TechPackBody doc={state.doc} editable={false} header={{ kind: state.version.approval ? 'approved' : 'version', version: state.version }} projectId={projectId} />;
}

function Missing() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="heading text-2xl">This tech pack isn’t on this device</h1>
      <p className="mt-2 text-fg-2">The project or version may have been deleted, or it was made in another browser.</p>
      <Link href="/dashboard" className="btn btn-ink mt-6">
        Back to projects
      </Link>
    </main>
  );
}

export function TechPack({ projectId }: { projectId: string }) {
  const versionId = useSearchParams().get('version');
  return versionId ? <VersionTechPack projectId={projectId} versionId={versionId} /> : <DraftTechPack projectId={projectId} />;
}
