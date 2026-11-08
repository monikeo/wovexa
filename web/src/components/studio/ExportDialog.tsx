'use client';
/**
 * Export centre (spec §15, §31 Tier A, EXP-01…10). Everything comes from the saved document:
 * a production package ZIP, print files with their resolution written into the file,
 * screen-print films, a client proof PDF, team names and numbers, product images through
 * Wovexa Render, and a history of what was exported from which revision.
 */
import { Archive, Box, Check, Clapperboard, Download, FileText, History, Image as ImageIcon, Loader2, Printer, RotateCcw, Ruler, Smartphone, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as cmd from '@/domain/commands';
import { createTextLayer } from '@/domain/factory';
import { getGarment, getSize, hasZone, partColor, PRINT_METHOD_LABELS, sizeLabel, zoneSpecOrFirst } from '@/domain/garments';
import { documentHash } from '@/domain/hash';
import { runPreflight, summarize } from '@/domain/preflight';
import type { DesignDocument, ZoneId } from '@/domain/schema';
import { canvasToBlob, downloadBlob } from '@/lib/download';
import { compareRollWidthsOffThread } from '@/lib/export/marker-compare';
import { DEFAULT_MARKER, FILE_LENGTHS_M, ROLL_WIDTHS_CM, type MarkerSettings, type RollEstimate } from '@/lib/export/marker-layout';
import { DEFAULT_PRINT_NAME, fileSafe, formatName, isoDate, NAME_TOKENS, revisionLabel, unknownTokens } from '@/lib/export/naming';
import { buildClientProof, buildProductionPackage, designRevision, prepareDocument, zonesWithArtwork, type PackageOptions, type ProductRenderOptions, type ProductShot } from '@/lib/export/package';
import { revisionText } from '@/lib/export/proof';
import { pngBlobWithDpi } from '@/lib/export/png-dpi';
import { designPlaceholders, parseRoster, sizeBreakdown, type Roster } from '@/lib/export/roster';
import { addExportRecord, approvalState, clearExports, listExports, type ExportKind, type ExportRecord, type ProjectMeta } from '@/lib/local-db';
import { renderZoneArtwork } from '@/lib/render/zone-renderer';
import { toast } from '@/components/ui/primitives';
import { useLive, useStudio } from '@/stores/studio-store';
import { RangeField } from './inspector-controls';
import { viewerApi } from './viewer3d/stage';

type Include = PackageOptions['include'];
interface Prefs {
  dpi: number;
  colorways: 'active' | 'all';
  include: Include;
  naming: string;
  marker: MarkerSettings;
}

const PREFS_KEY = 'wovexa.export.v1';
const DEFAULT_PREFS: Prefs = {
  dpi: 300,
  colorways: 'all',
  include: { print: true, separations: true, flats: true, mockups: true, proof: true, techSheet: true, cutAndSew: false, marker: false, model: false },
  naming: DEFAULT_PRINT_NAME,
  marker: DEFAULT_MARKER,
};

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    // The first template wrote "r{rev}"; {rev} now carries its own prefix.
    if (p.naming === '{project}_{zone}_{w}x{h}mm_{dpi}dpi_r{rev}') p.naming = DEFAULT_PRINT_NAME;
    return { ...DEFAULT_PREFS, ...p, include: { ...DEFAULT_PREFS.include, ...p.include }, marker: { ...DEFAULT_MARKER, ...p.marker } };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}

const nextFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Open the 3D view if it is closed, and wait for it to be ready to render. */
async function ensureViewer() {
  if (viewerApi.capture) return true;
  const s = useStudio.getState();
  if (s.viewMode === '2d') s.setViewMode('split');
  for (let i = 0; i < 80 && !viewerApi.capture; i++) await new Promise((r) => setTimeout(r, 100));
  await nextFrames();
  return !!viewerApi.capture;
}

/** Front, back and three-quarter product images of one colourway. */
async function renderProducts(colorwayId: string, opts: ProductRenderOptions = {}): Promise<ProductShot[]> {
  if (useLive.getState().colorwayOverride !== colorwayId) {
    useLive.getState().setColorwayOverride(colorwayId);
    await nextFrames();
  }
  if (!viewerApi.capture) throw new Error('The 3D view closed during export.');
  const shots = await viewerApi.capture({
    shots: [
      { kind: 'preset', view: 'front' },
      { kind: 'preset', view: 'back' },
      { kind: 'preset', view: 'three_quarter' },
    ],
    width: opts.width ?? 1600,
    height: opts.height ?? 2000,
    background: opts.transparent ? 'transparent' : 'scene',
  });
  return shots.map((s) => ({ view: s.key, label: s.label, canvas: s.canvas }));
}

function approvalOf(meta: ProjectMeta | null) {
  const state = meta ? approvalState(meta) : 'draft';
  if (meta && state === 'approved') return { label: `Approved, version ${meta.approvedVersionNumber}`, status: 'approved' as const, versionNumber: meta.approvedVersionNumber, hash: meta.approvedHash };
  if (meta && state === 'changed') return { label: 'Changed since approval', status: 'changed-since-approval' as const, versionNumber: meta.approvedVersionNumber, hash: meta.approvedHash };
  return { label: 'Draft, not yet approved', status: 'draft' as const };
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function relativeTime(ts: number) {
  const s = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(s) < 60) return rtf.format(s, 'second');
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

const KIND_ICON: Record<ExportKind, typeof Archive> = { package: Archive, print: Printer, proof: FileText, team: Users, manifest: FileText, mockups: ImageIcon };

function Option({ checked, onChange, title, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 rounded-lg px-2 py-1.5 ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:bg-hover'}`}>
      <input type="checkbox" className="mt-[3px] h-4 w-4 flex-none accent-[var(--accent)]" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-5">{title}</span>
        <span className="block text-xs leading-4 text-fg-2">{hint}</span>
      </span>
    </label>
  );
}

/** Name and number layers on the back (or front), ready for a roster. */
function addTeamLayers(doc: DesignDocument) {
  const model = getGarment(doc.garment.modelId);
  const zoneId: ZoneId = hasZone(model, 'back') ? 'back' : model.zoneOrder[0];
  const spec = zoneSpecOrFirst(model, zoneId);
  const colorway = doc.colorways.find((c) => c.id === doc.activeColorwayId) ?? doc.colorways[0];
  const body = partColor(colorway, 'body').replace('#', '');
  const lum = (parseInt(body.slice(0, 2), 16) * 299 + parseInt(body.slice(2, 4), 16) * 587 + parseInt(body.slice(4, 6), 16) * 114) / 1000;
  const ink = lum < 140 ? '#FFFFFF' : '#111111';
  const w = spec.printableWidthMm;
  const h = spec.printableHeightMm;
  const name = createTextLayer(spec, '{name}');
  name.name = 'Player name';
  Object.assign(name.content, { fontFamily: 'Graduate', fontWeight: 400, fill: ink, letterSpacingEm: 0.04 });
  Object.assign(name.transform, { centerXmm: w / 2, centerYmm: Math.min(h * 0.12, 60), widthMm: Math.min(w * 0.82, 280), heightMm: Math.min(h * 0.14, 60) });
  const number = createTextLayer(spec, '{number}');
  number.name = 'Player number';
  Object.assign(number.content, { fontFamily: 'Graduate', fontWeight: 400, fill: ink });
  Object.assign(number.transform, { centerXmm: w / 2, centerYmm: Math.min(h * 0.12, 60) + Math.min(h * 0.44, 210) / 2 + 30, widthMm: Math.min(w * 0.7, 230), heightMm: Math.min(h * 0.44, 210) });
  const s = useStudio.getState();
  s.dispatch(cmd.batch('Add name and number', [cmd.addLayer(zoneId, name), cmd.addLayer(zoneId, number)]));
  s.setActiveZone(zoneId);
}

/**
 * Fabric marker settings: roll width, spacing, file length and format, and a comparison of every
 * roll width for this order, worked out in a worker, so the least wasteful roll is one click away.
 */
function MarkerPanel({ doc, order, settings, onChange }: { doc: DesignDocument; order: Roster | null; settings: MarkerSettings; onChange: (patch: Partial<MarkerSettings>) => void }) {
  const [compared, setCompared] = useState<{ key: string; estimates: RollEstimate[] } | null>(null);
  const [comparing, setComparing] = useState(false);
  // Estimates hold only while the order and spacing they were made for stay the same.
  const key = JSON.stringify([doc.garment.modelId, doc.garment.sizeCode, order?.rows.map((r) => r.size ?? ''), settings.gapMm, settings.marginMm, settings.allowTurn, settings.lengthPerFileM]);
  const estimates = compared?.key === key ? compared.estimates : null;
  const fit = estimates?.filter((e) => !e.unplaced) ?? [];
  const leastWaste = fit.length ? fit.reduce((b, e) => (e.utilisation > b.utilisation ? e : b)) : null;

  const compare = async () => {
    setComparing(true);
    try {
      const result = await compareRollWidthsOffThread({ modelId: doc.garment.modelId, sampleSize: doc.garment.sizeCode, roster: order, settings, widthsCm: [...ROLL_WIDTHS_CM] });
      setCompared({ key, estimates: result });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The roll comparison failed.', 'error');
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="mb-1 ml-9 mr-1 space-y-3 rounded-xl border border-line p-3">
      <div>
        <span className="label">Roll width</span>
        <div className="seg mt-1 w-full" role="group" aria-label="Fabric roll width">
          {ROLL_WIDTHS_CM.map((w) => (
            <button key={w} className="flex-1" aria-pressed={settings.rollWidthCm === w} onClick={() => onChange({ rollWidthCm: w })}>
              {w} cm
            </button>
          ))}
        </div>
      </div>
      <RangeField label="Gap" value={settings.gapMm} min={0} max={20} format={(v) => `${v} mm`} onChange={(gapMm) => onChange({ gapMm })} />
      <RangeField label="Margin" value={settings.marginMm} min={0} max={50} format={(v) => `${v} mm`} onChange={(marginMm) => onChange({ marginMm })} />
      <div>
        <span className="label">Length per file</span>
        <div className="seg mt-1 w-full" role="group" aria-label="Roll length per file">
          {FILE_LENGTHS_M.map((m) => (
            <button key={m} className="flex-1 whitespace-nowrap" aria-pressed={settings.lengthPerFileM === m} onClick={() => onChange({ lengthPerFileM: m })}>
              {m} m
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className="label">Format</span>
        <div className="seg mt-1 w-full" role="group" aria-label="Marker file format">
          <button className="flex-1" aria-pressed={settings.format === 'png'} onClick={() => onChange({ format: 'png' })}>
            PNG
          </button>
          <button className="flex-1" aria-pressed={settings.format === 'pdf'} onClick={() => onChange({ format: 'pdf' })}>
            PDF with cut paths
          </button>
        </div>
      </div>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" className="mt-[3px] h-4 w-4 flex-none accent-[var(--accent)]" checked={settings.allowTurn} onChange={(e) => onChange({ allowTurn: e.target.checked })} />
        <span className="min-w-0">
          <span className="block text-[13px] leading-5">Turn pieces 180° to save fabric</span>
          <span className="block text-xs leading-4 text-fg-2">Never 90°, so the grain stays straight. Turn off for napped or one-way fabric.</span>
        </span>
      </label>
      <p className="text-[11px] leading-4 text-fg-3">
        {settings.format === 'pdf' ? 'True-size PDF pages with CutContour cut paths for print-and-cut RIPs.' : 'True-size PNGs with the resolution written in.'} 10 mm bleed, a dashed cut line and a label in the bleed on every piece.
      </p>
      <button className="btn btn-outline min-h-8 w-full text-xs" disabled={comparing} onClick={() => void compare()}>
        {comparing ? <Loader2 size={13} className="animate-spin" /> : <Ruler size={13} />} {comparing ? 'Nesting on every roll width' : 'Compare roll widths'}
      </button>
      {estimates ? (
        <div role="group" aria-label="Fabric needed on each roll width" className="space-y-1">
          {estimates.map((e) => (
            <button
              key={e.rollWidthCm}
              aria-pressed={settings.rollWidthCm === e.rollWidthCm}
              onClick={() => onChange({ rollWidthCm: e.rollWidthCm })}
              className={`grid w-full grid-cols-[1fr_auto_auto] items-baseline gap-3 rounded-lg px-2 py-1.5 text-left text-xs ${settings.rollWidthCm === e.rollWidthCm ? 'bg-hover font-semibold' : 'hover:bg-hover'}`}
            >
              <span>
                {e.rollWidthCm} cm{e === leastWaste ? <span className="ml-1.5 font-normal text-accent">least waste</span> : null}
              </span>
              <span className="num">{e.unplaced ? `${e.unplaced} too wide` : `${(e.lengthMm / 1000).toFixed(2)} m`}</span>
              <span className="num w-10 text-right">{e.unplaced ? '–' : `${Math.round(e.utilisation * 100)}%`}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ExportPanel() {
  const doc = useStudio((s) => s.document);
  const meta = useStudio((s) => s.meta);
  const viewMode = useStudio((s) => s.viewMode);
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const [rosterText, setRosterText] = useState('');
  const [progress, setProgress] = useState<{ label: string; fraction: number } | null>(null);
  const [history, setHistory] = useState<ExportRecord[]>([]);
  const [currentHash, setCurrentHash] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const roster = useMemo<Roster>(() => parseRoster(rosterText), [rosterText]);
  const projectId = doc?.projectId;

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void listExports(projectId).then((list) => alive && setHistory(list));
    return () => {
      alive = false;
    };
  }, [projectId]);
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    void documentHash(doc).then((h) => alive && setCurrentHash(h));
    return () => {
      alive = false;
    };
  }, [doc]);

  if (!doc) return null;
  const model = getGarment(doc.garment.modelId);
  const zones = zonesWithArtwork(doc);
  const screenZones = zones.filter((z) => doc.zones[z].printMethod === 'SCREEN_PRINT');
  const mainColorway = doc.colorways.find((c) => c.id === doc.activeColorwayId) ?? doc.colorways[0];
  const allOver = !!mainColorway?.surfaces && Object.values(mainColorway.surfaces).some(Boolean);
  const placeholders = designPlaceholders(doc);
  const missingFields = roster.rows.length ? placeholders.filter((p) => !roster.fields.includes(p)) : [];
  const sizes = sizeBreakdown(roster);
  const { errors } = summarize(runPreflight(doc));
  const busy = progress !== null;
  const team = roster.rows.length && placeholders.length ? roster : null;
  // The marker takes the whole order: a roster of sizes alone is enough.
  const order = roster.rows.length ? roster : null;
  const approval = approvalOf(meta);
  const rev = currentHash ? revisionLabel(doc.revision, currentHash, approval.status === 'approved' ? approval.versionNumber : null) : '';
  const example = formatName(prefs.naming, {
    project: doc.title,
    zone: zones[0] ?? 'front',
    colorway: doc.colorways[0]?.name,
    size: doc.garment.sizeCode,
    method: PRINT_METHOD_LABELS[doc.zones[zones[0] ?? 'front'].printMethod],
    w: zoneSpecOrFirst(model, zones[0] ?? 'front').printableWidthMm,
    h: zoneSpecOrFirst(model, zones[0] ?? 'front').printableHeightMm,
    dpi: prefs.dpi,
    rev,
    date: isoDate(),
    name: team?.rows[0]?.name,
    number: team?.rows[0]?.number,
  });
  const strange = unknownTokens(prefs.naming);

  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch, include: { ...p.include, ...patch.include } };
      writePrefs(next);
      return next;
    });
  const setInclude = (key: keyof Include, value: boolean) => setPrefs({ include: { ...prefs.include, [key]: value } });
  const setMarker = (patch: Partial<MarkerSettings>) => setPrefs({ marker: { ...prefs.marker, ...patch } });

  const record = async (kind: ExportKind, label: string, fileName: string, fileCount: number, bytes: number, settings: Record<string, unknown>) => {
    const current = useStudio.getState().document!;
    const revisionLabel = await designRevision(current, approvalOf(useStudio.getState().meta));
    const rec = await addExportRecord({ projectId: current.projectId, kind, label, revision: current.revision, revisionLabel, contentHash: await documentHash(current), fileName, fileCount, bytes, settings }).catch(() => null);
    if (rec) setHistory((h) => [rec, ...h].slice(0, 12));
  };

  /** Save, run an export with progress and cancel, and always restore the live colourway. */
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ label: 'Saving the design', fraction: 0 });
    try {
      await useStudio.getState().saveNow();
      await task(controller.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') toast('Export cancelled.');
      else toast(error instanceof Error ? error.message : 'Export failed. Try again.', 'error');
    } finally {
      useLive.getState().setColorwayOverride(null);
      abortRef.current = null;
      setProgress(null);
    }
  };

  const exportPackage = (opts: PackageOptions, kind: ExportKind, label: string) =>
    run(async (signal) => {
      const viewer = opts.include.mockups || opts.include.model ? await ensureViewer() : false;
      const current = useStudio.getState().document!;
      const result = await buildProductionPackage(current, opts, {
        renderProducts: viewer ? renderProducts : undefined,
        renderModel: viewer && viewerApi.exportModel ? () => viewerApi.exportModel!('glb') : undefined,
        approval: approvalOf(useStudio.getState().meta),
        signal,
        onProgress: (l, fraction) => setProgress({ label: l, fraction }),
      });
      downloadBlob(result.blob, result.fileName);
      await record(kind, label, result.fileName, result.files.length + 1, result.blob.size, { dpi: opts.dpi, colorways: opts.colorways, include: opts.include, people: opts.roster?.rows.length ?? 0, ...(opts.include.marker ? { marker: opts.marker } : {}) });
      toast(`${label}: ${result.files.length + 1} files, ${formatBytes(result.blob.size)}.`, 'success');
      if (result.marker) toast(`Fabric marker: ${(result.marker.lengthMm / 1000).toFixed(2)} m of ${result.marker.rollWidthMm / 10} cm fabric for ${result.marker.garments} ${result.marker.garments === 1 ? 'garment' : 'garments'}, ${Math.round(result.marker.utilisation * 100)}% used.`, 'success');
      for (const w of result.warnings.slice(0, 2)) toast(w);
    });

  const fullPackage = () =>
    exportPackage(
      {
        dpi: prefs.dpi,
        naming: prefs.naming,
        include: { ...prefs.include, separations: prefs.include.separations && screenZones.length > 0 },
        colorways: prefs.colorways,
        roster: team ?? (prefs.include.marker ? order : null),
        marker: prefs.marker,
      },
      'package',
      'Production package',
    );

  const printFiles = () => {
    if (!zones.length) {
      toast('There is no artwork to export yet.', 'error');
      return;
    }
    if (zones.length > 1) {
      void exportPackage(
        { dpi: prefs.dpi, naming: prefs.naming, include: { print: true, separations: false, flats: false, mockups: false, proof: false, techSheet: false }, colorways: 'active', roster: null },
        'print',
        'Print files',
      );
      return;
    }
    void run(async () => {
      const current = useStudio.getState().document!;
      const zoneId = zones[0];
      const spec = zoneSpecOrFirst(model, zoneId);
      setProgress({ label: `Rendering ${spec.label.toLowerCase()} at ${prefs.dpi} dpi`, fraction: 0.3 });
      await prepareDocument(current, [zoneId]);
      const { canvas, dpi } = renderZoneArtwork(current.zones[zoneId], spec.printableWidthMm, spec.printableHeightMm, prefs.dpi);
      const blob = await pngBlobWithDpi(await canvasToBlob(canvas), dpi);
      const label = await designRevision(current, approvalOf(useStudio.getState().meta));
      const fileName = `${formatName(prefs.naming, { project: current.title, zone: zoneId, colorway: current.colorways[0]?.name, size: current.garment.sizeCode, method: PRINT_METHOD_LABELS[current.zones[zoneId].printMethod], w: spec.printableWidthMm, h: spec.printableHeightMm, dpi, rev: label, date: isoDate() })}.png`;
      downloadBlob(blob, fileName);
      await record('print', 'Print file', fileName, 1, blob.size, { dpi });
      toast(dpi < prefs.dpi ? `Exported at ${dpi} dpi to stay within the browser's image size limit.` : `Exported ${spec.label.toLowerCase()} at ${dpi} dpi, ${spec.printableWidthMm} × ${spec.printableHeightMm} mm.`, dpi < prefs.dpi ? undefined : 'success');
    });
  };

  const proof = () =>
    run(async (signal) => {
      const viewer = await ensureViewer();
      const current = useStudio.getState().document!;
      const result = await buildClientProof(current, { colorways: prefs.colorways, roster: team }, { renderProducts: viewer ? renderProducts : undefined, approval: approvalOf(useStudio.getState().meta), signal, onProgress: (l, fraction) => setProgress({ label: l, fraction }) });
      downloadBlob(result.blob, result.fileName);
      await record('proof', 'Client proof', result.fileName, 1, result.blob.size, { colorways: prefs.colorways });
      toast('Client proof ready to send.', 'success');
    });

  /** The garment as a 3D model: GLB for viewers and engines, USDZ for AR Quick Look. */
  const exportModel3d = (format: 'glb' | 'usdz') =>
    run(async () => {
      setProgress({ label: 'Opening the 3D view', fraction: 0.1 });
      if (!(await ensureViewer()) || !viewerApi.exportModel) throw new Error('The 3D view could not open. Try the Split or 3D view, then export again.');
      setProgress({ label: format === 'glb' ? 'Building the 3D model' : 'Building the AR model', fraction: 0.4 });
      const current = useStudio.getState().document!;
      const blob = await viewerApi.exportModel(format);
      const colorway = current.colorways.find((c) => c.id === current.activeColorwayId) ?? current.colorways[0];
      const fileName = `${fileSafe(current.title) || 'garment'}_${fileSafe(colorway.name)}.${format}`;
      downloadBlob(blob, fileName);
      await record('mockups', format === 'glb' ? '3D model' : 'AR model', fileName, 1, blob.size, { format });
      toast(format === 'glb' ? `Exported a ${formatBytes(blob.size)} GLB. It opens in web viewers, Blender and Android AR.` : `Exported a ${formatBytes(blob.size)} USDZ. Open it on an iPhone or iPad to place the garment in your room.`, 'success');
    });

  const teamFiles = () => exportPackage({ dpi: prefs.dpi, naming: prefs.naming.includes('{name}') ? prefs.naming : `{number}_{name}_${prefs.naming}`, include: { print: false, separations: false, flats: false, mockups: false, proof: false, techSheet: false }, colorways: 'active', roster: team }, 'team', 'Team files');

  const openRender = () => {
    const s = useStudio.getState();
    s.setExportOpen(false);
    s.setMobileSheet(null);
    s.setPanel('render');
  };

  return (
    <div className="space-y-5 p-4">
      {errors > 0 ? (
        <p className="rounded-xl border border-danger/40 px-3 py-2.5 text-[13px]">
          <span className="font-semibold text-danger">
            {errors} print {errors === 1 ? 'issue' : 'issues'} to fix.
          </span>{' '}
          Previews and proofs can go out now; fix these before files go to production.
        </p>
      ) : null}

      {progress ? (
        <div className="rounded-xl border border-line p-3" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <Loader2 size={14} className="flex-none animate-spin text-accent" />
              <span className="truncate">{progress.label}</span>
            </span>
            <span className="num text-xs text-fg-2">{Math.round(progress.fraction * 100)}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover">
            <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${Math.max(4, progress.fraction * 100)}%` }} />
          </div>
          <button className="btn btn-ghost mt-2 min-h-8 px-2 text-xs" onClick={() => abortRef.current?.abort()}>
            <X size={13} /> Cancel
          </button>
        </div>
      ) : null}

      {/* The production package: the main thing most people export. */}
      <section className="rounded-2xl border border-line p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-inverse text-fg-inverse" aria-hidden>
            <Archive size={17} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-tight">Production package</h3>
            <p className="mt-0.5 text-xs text-fg-2">Everything a factory or print shop needs, in one ZIP.</p>
          </div>
        </div>
        <div className="mt-3 space-y-0.5">
          <Option checked={prefs.include.print} onChange={(v) => setInclude('print', v)} title="Print files" hint={zones.length ? `${zones.length} ${zones.length === 1 ? 'zone' : 'zones'}, true size, resolution written into each PNG` : 'Add artwork to make print files'} disabled={!zones.length} />
          <Option
            checked={prefs.include.separations}
            onChange={(v) => setInclude('separations', v)}
            title="Screen-print films"
            hint={screenZones.length ? `One film per ink for ${screenZones.length} screen-printed ${screenZones.length === 1 ? 'zone' : 'zones'}, with registration marks` : 'Set a zone to Screen print to make colour films'}
            disabled={!screenZones.length}
          />
          <Option checked={prefs.include.flats} onChange={(v) => setInclude('flats', v)} title="Placement drawings" hint="Each print on the garment flat, per colourway" />
          <Option checked={prefs.include.mockups} onChange={(v) => setInclude('mockups', v)} title="Product images" hint={viewMode === '2d' ? 'Front, back and three-quarter; the 3D view opens while exporting' : 'Front, back and three-quarter from the 3D view'} />
          <Option checked={prefs.include.proof} onChange={(v) => setInclude('proof', v)} title="Client proof" hint="Two-page PDF with sizes, colours and an approval line" />
          <Option checked={prefs.include.techSheet} onChange={(v) => setInclude('techSheet', v)} title="Tech sheet" hint="Colours, fonts, placements, materials and QA, as a web page" />
          <Option
            checked={!!prefs.include.cutAndSew}
            onChange={(v) => setInclude('cutAndSew', v)}
            title="Cut-and-sew panels"
            hint={allOver ? 'Every pattern piece with its all-over print, 10 mm bleed, 120 dpi. Recommended for this design' : 'Every pattern piece with its print and 10 mm bleed, for all-over sublimation'}
          />
          <Option
            checked={!!prefs.include.marker}
            onChange={(v) => setInclude('marker', v)}
            title="Fabric marker"
            hint={`${order ? `${order.rows.length} ${order.rows.length === 1 ? 'garment' : 'garments'} from the roster` : `One garment in ${sizeLabel(model, getSize(model, doc.garment.sizeCode))}; paste a roster for a team order`}, every piece nested on a ${prefs.marker.rollWidthCm} cm roll at true size, in roll lengths`}
          />
          {prefs.include.marker ? <MarkerPanel doc={doc} order={order} settings={prefs.marker} onChange={setMarker} /> : null}
          <Option checked={!!prefs.include.model} onChange={(v) => setInclude('model', v)} title="3D model" hint="GLB in metres, for web viewers, Blender and AR" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <span className="label">Resolution</span>
            <div className="seg mt-1 w-full" role="group" aria-label="Print resolution">
              {[150, 300, 600].map((d) => (
                <button key={d} className="flex-1" aria-pressed={prefs.dpi === d} onClick={() => setPrefs({ dpi: d })}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="label">Colourways</span>
            <div className="seg mt-1 w-full" role="group" aria-label="Colourways to include">
              <button className="flex-1" aria-pressed={prefs.colorways === 'active'} onClick={() => setPrefs({ colorways: 'active' })}>
                Main
              </button>
              <button className="flex-1" aria-pressed={prefs.colorways === 'all'} onClick={() => setPrefs({ colorways: 'all' })} disabled={doc.colorways.length < 2}>
                All {doc.colorways.length}
              </button>
            </div>
          </div>
        </div>
        {team ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-fg-2">
            <Users size={13} /> Includes {team.rows.length} personalised team {team.rows.length === 1 ? 'set' : 'sets'}.
          </p>
        ) : null}
        <button className="btn btn-primary mt-4 w-full" disabled={busy} onClick={() => void fullPackage()}>
          <Download size={15} /> Download package
        </button>
      </section>

      {/* One-off exports. */}
      <section className="grid grid-cols-2 gap-2">
        <button className="btn btn-outline h-auto flex-col items-start gap-0.5 px-3 py-2.5 text-left" disabled={busy || !zones.length} onClick={printFiles}>
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <Printer size={14} /> Print files
          </span>
          <span className="text-[11px] font-normal text-fg-2">{zones.length > 1 ? `${zones.length} PNGs in a ZIP` : 'True-size PNG'}, {prefs.dpi} dpi</span>
        </button>
        <button className="btn btn-outline h-auto flex-col items-start gap-0.5 px-3 py-2.5 text-left" disabled={busy} onClick={() => void proof()}>
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <FileText size={14} /> Client proof
          </span>
          <span className="text-[11px] font-normal text-fg-2">PDF for approval</span>
        </button>
        <button className="btn btn-outline h-auto flex-col items-start gap-0.5 px-3 py-2.5 text-left" disabled={busy} onClick={() => void exportModel3d('glb')}>
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <Box size={14} /> 3D model
          </span>
          <span className="text-[11px] font-normal text-fg-2">GLB for viewers and Blender</span>
        </button>
        <button className="btn btn-outline h-auto flex-col items-start gap-0.5 px-3 py-2.5 text-left" disabled={busy} onClick={() => void exportModel3d('usdz')}>
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <Smartphone size={14} /> AR model
          </span>
          <span className="text-[11px] font-normal text-fg-2">USDZ for iPhone and iPad</span>
        </button>
        <button className="btn btn-outline col-span-2 h-auto items-center justify-start gap-3 px-3 py-2.5 text-left" onClick={openRender} disabled={busy}>
          <Clapperboard size={15} className="flex-none" />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">Product images and video</span>
            <span className="block text-[11px] font-normal text-fg-2">Wovexa Render: shop and social sizes, every colourway, turntables</span>
          </span>
        </button>
      </section>

      {/* What will print. */}
      <section>
        <h3 className="panel-title flex items-center gap-2">
          <Printer size={15} /> Print zones
        </h3>
        <ul className="mt-2 space-y-1 text-[13px]">
          {model.zoneOrder.map((z) => {
            const spec = zoneSpecOrFirst(model, z);
            const has = zones.includes(z);
            return (
              <li key={z} className={`flex items-baseline justify-between gap-3 ${has ? '' : 'text-fg-3'}`}>
                <span className="truncate">
                  {spec.label}
                  <span className="text-fg-2">, {PRINT_METHOD_LABELS[doc.zones[z].printMethod]}</span>
                </span>
                <span className="num flex-none text-xs">{has ? `${spec.printableWidthMm} × ${spec.printableHeightMm} mm` : 'Empty'}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-fg-3">Print files are RGB PNG. Your print shop converts to CMYK or spot inks with their own profile.</p>
      </section>

      {/* Team orders. */}
      <details className="group rounded-xl border border-line" open={roster.rows.length > 0 || undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
          <Users size={15} className="flex-none" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">Team names and numbers</span>
            <span className="block text-xs text-fg-2">One print set per player or student, plus a size list</span>
          </span>
          <span className="text-xs text-fg-3 group-open:rotate-180" aria-hidden>
            ▾
          </span>
        </summary>
        <div className="space-y-3 border-t border-line px-3 pb-3 pt-3">
          {placeholders.length ? (
            <p className="text-xs text-fg-2">
              This design personalises{' '}
              {placeholders.map((p) => (
                <code key={p} className="mx-0.5 rounded bg-hover px-1 py-0.5 text-[11px] text-fg">{`{${p}}`}</code>
              ))}
              .
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-fg-2">
                Type <code className="rounded bg-hover px-1 text-[11px] text-fg">{'{name}'}</code> or <code className="rounded bg-hover px-1 text-[11px] text-fg">{'{number}'}</code> into any text layer, or start with a ready-made back print.
              </p>
              <button className="btn btn-outline min-h-8 w-full text-xs" onClick={() => addTeamLayers(doc)}>
                Add name and number to the {hasZone(model, 'back') ? 'back' : model.zones[model.zoneOrder[0]]?.label.toLowerCase()}
              </button>
            </div>
          )}
          <label className="grid gap-1">
            <span className="label">Roster</span>
            <textarea
              className="field min-h-[112px] resize-y py-2 font-mono text-xs leading-5"
              value={rosterText}
              onChange={(e) => setRosterText(e.target.value)}
              placeholder={'name, number, size\nSokha, 7, M\nDara, 10, L'}
              spellCheck={false}
            />
          </label>
          <p className="text-[11px] text-fg-3">Paste from a spreadsheet: a header row with name, number and size works best.</p>
          {roster.rows.length ? (
            <div className="rounded-lg bg-hover px-3 py-2 text-xs">
              <p className="font-medium">
                {roster.rows.length} {roster.rows.length === 1 ? 'person' : 'people'}
                {sizes.length ? `: ${sizes.map((s) => `${s.size} × ${s.count}`).join(', ')}` : ''}
              </p>
              <p className="mt-0.5 text-fg-2">
                First: {[roster.rows[0].name, roster.rows[0].number, roster.rows[0].size].filter(Boolean).join(', ') || 'empty row'}
              </p>
              {missingFields.length ? <p className="mt-1 text-danger">No {missingFields.map((f) => `“${f}”`).join(' or ')} column in the roster; those placeholders stay as typed.</p> : null}
            </div>
          ) : null}
          <button className="btn btn-outline w-full" disabled={busy || !team} onClick={() => void teamFiles()}>
            <Download size={15} /> Download team files
          </button>
        </div>
      </details>

      {/* File naming. */}
      <details className="group rounded-xl border border-line">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
          <FileText size={15} className="flex-none" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">File names</span>
            <span className="block truncate text-xs text-fg-2">{example}.png</span>
          </span>
          <span className="text-xs text-fg-3 group-open:rotate-180" aria-hidden>
            ▾
          </span>
        </summary>
        <div className="space-y-2 border-t border-line px-3 pb-3 pt-3">
          <div className="flex gap-2">
            <input className="field font-mono text-xs" value={prefs.naming} onChange={(e) => setPrefs({ naming: e.target.value })} aria-label="Print file name template" spellCheck={false} />
            <button className="icon-btn flex-none" onClick={() => setPrefs({ naming: DEFAULT_PRINT_NAME })} aria-label="Reset file name template" title="Reset">
              <RotateCcw size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {NAME_TOKENS.map((t) => (
              <button key={t.token} className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-fg-2 hover:border-line-strong hover:text-fg" title={t.hint} onClick={() => setPrefs({ naming: `${prefs.naming}_{${t.token}}` })}>
                {`{${t.token}}`}
              </button>
            ))}
          </div>
          {strange.length ? <p className="text-xs text-danger">Unknown {strange.map((t) => `{${t}}`).join(', ')} will be left out.</p> : null}
        </div>
      </details>

      {/* History. */}
      <section>
        <div className="flex items-center justify-between">
          <h3 className="panel-title flex items-center gap-2">
            <History size={15} /> Recent exports
          </h3>
          {history.length ? (
            <button
              className="text-xs text-fg-2 hover:text-fg"
              onClick={() => {
                void clearExports(doc.projectId).then(() => setHistory([]));
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
        {history.length ? (
          <ul className="mt-2 divide-y divide-line">
            {history.map((r) => {
              const Icon = KIND_ICON[r.kind] ?? Archive;
              const outdated = currentHash !== null && r.contentHash !== currentHash;
              return (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <Icon size={15} className="flex-none text-fg-2" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{r.label}</div>
                    <div className="truncate text-xs text-fg-2">
                      {relativeTime(r.createdAt)}, {r.revisionLabel ? revisionText(r.revisionLabel).toLowerCase() : `revision ${r.revision}`}, {r.fileCount} {r.fileCount === 1 ? 'file' : 'files'}, {formatBytes(r.bytes)}
                    </div>
                  </div>
                  {outdated ? (
                    <span className="flex-none rounded-md bg-hover px-1.5 py-0.5 text-[10px] font-semibold text-fg-2" title="The design changed after this export">
                      Outdated
                    </span>
                  ) : (
                    <Check size={14} className="flex-none text-accent" aria-label="Matches the current design" />
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-fg-3">Exports appear here with the revision they came from, so you can tell when files are out of date.</p>
        )}
      </section>
    </div>
  );
}
