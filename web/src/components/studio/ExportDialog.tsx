'use client';
/**
 * Export centre, tier A browser outputs (spec §15, §31 Tier A): mockup stills from the
 * 3D view, isolated print artwork at true physical size, and a production manifest.
 * Exports always come from the saved document, never unsaved editor state.
 */
import { Download, FileJson, Image as ImageIcon, Loader2, Printer } from 'lucide-react';
import { useState } from 'react';
import { getGarment, PRINT_METHOD_LABELS } from '@/domain/garments';
import { runPreflight, summarize } from '@/domain/preflight';
import { ZONE_IDS, type ZoneId } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from '@/lib/assets';
import { canvasToBlob, downloadBlob, loadImageFromUrl, sha256Hex, slugify } from '@/lib/download';
import { ensureFonts, renderZoneArtwork } from '@/lib/render/zone-renderer';
import { toast } from '@/components/ui/primitives';
import { useStudio } from '@/stores/studio-store';
import { VIEW_PRESETS, viewerApi, type ViewPreset } from './viewer3d/Viewer3D';

const BACKGROUNDS = {
  transparent: { label: 'Transparent', color: null },
  white: { label: 'White', color: '#FFFFFF' },
  studio: { label: 'Studio grey', color: '#ECEEF2' },
} as const;

async function prepareImages(zones: ZoneId[]) {
  const doc = useStudio.getState().document!;
  const ids = zones.flatMap((z) => Object.values(doc.zones[z].layers).flatMap((l) => (l.content.kind === 'image' ? [l.content.assetId] : [])));
  await Promise.all(ids.filter((id) => !getLoadedImage(id)).map((id) => loadAssetImage(id)));
  await ensureFonts(zones.map((z) => doc.zones[z]));
}

export function ExportPanel() {
  const doc = useStudio((s) => s.document);
  const viewMode = useStudio((s) => s.viewMode);
  const setViewMode = useStudio((s) => s.setViewMode);
  const [views, setViews] = useState<ViewPreset[]>(['front', 'back']);
  const [background, setBackground] = useState<keyof typeof BACKGROUNDS>('white');
  const [layout, setLayout] = useState<'sheet' | 'separate'>('sheet');
  const [dpi, setDpi] = useState(300);
  const [busy, setBusy] = useState<string | null>(null);
  if (!doc) return null;

  const model = getGarment(doc.garment.modelId);
  const base = slugify(doc.title);
  const colorway = doc.colorways.find((c) => c.id === doc.activeColorwayId)!;
  const zonesWithArt = ZONE_IDS.filter((z) => doc.zones[z].orderedLayerIds.some((id) => doc.zones[z].layers[id].visible));
  const { errors } = summarize(runPreflight(doc));
  const viewerReady = viewMode !== '2d';

  const run = async (name: string, task: () => Promise<void>) => {
    setBusy(name);
    try {
      await useStudio.getState().saveNow();
      await task();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Export failed. Try again.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const exportMockups = () =>
    run('mockups', async () => {
      if (!viewerApi.capture) throw new Error('Open the 3D or Split view to export mockup images.');
      const shots = await viewerApi.capture({ views, width: 1600, height: 2000 });
      const fill = BACKGROUNDS[background].color;
      const flatten = async (dataUrl: string) => {
        const img = await loadImageFromUrl(dataUrl);
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d')!;
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(0, 0, c.width, c.height);
        }
        ctx.drawImage(img, 0, 0);
        return c;
      };
      const suffix = `${slugify(colorway.name)}-r${doc.revision}`;
      if (layout === 'separate' || shots.length === 1) {
        for (const shot of shots) {
          const c = await flatten(shot.dataUrl);
          downloadBlob(await canvasToBlob(c), `${base}_${shot.view}_${suffix}.png`);
        }
      } else {
        const tiles = await Promise.all(shots.map((s) => flatten(s.dataUrl)));
        const cols = tiles.length <= 2 ? tiles.length : 2;
        const rows = Math.ceil(tiles.length / cols);
        const w = tiles[0].width;
        const h = tiles[0].height;
        const sheet = document.createElement('canvas');
        sheet.width = w * cols;
        sheet.height = h * rows;
        const ctx = sheet.getContext('2d')!;
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(0, 0, sheet.width, sheet.height);
        }
        tiles.forEach((t, i) => ctx.drawImage(t, (i % cols) * w, Math.floor(i / cols) * h));
        downloadBlob(await canvasToBlob(sheet), `${base}_views_${suffix}.png`);
      }
      toast(`Exported ${shots.length} view${shots.length > 1 ? 's' : ''}.`, 'success');
    });

  const exportPrintFiles = () =>
    run('print', async () => {
      if (!zonesWithArt.length) throw new Error('There is no artwork to export yet.');
      await prepareImages(zonesWithArt);
      const current = useStudio.getState().document!;
      for (const zoneId of zonesWithArt) {
        const spec = model.zones[zoneId];
        const { canvas, dpi: actual } = renderZoneArtwork(current.zones[zoneId], spec.printableWidthMm, spec.printableHeightMm, dpi);
        downloadBlob(await canvasToBlob(canvas), `${base}_${zoneId}_print_${spec.printableWidthMm}x${spec.printableHeightMm}mm_${actual}dpi_r${current.revision}.png`);
        if (actual < dpi) toast(`${spec.label} was exported at ${actual} dpi to stay within the browser's image size limit.`);
      }
      toast(`Exported print files for ${zonesWithArt.length} zone${zonesWithArt.length > 1 ? 's' : ''}.`, 'success');
    });

  const exportManifest = () =>
    run('manifest', async () => {
      await prepareImages(zonesWithArt);
      const current = useStudio.getState().document!;
      const outputs = [];
      for (const zoneId of zonesWithArt) {
        const spec = model.zones[zoneId];
        const { canvas, dpi: actual } = renderZoneArtwork(current.zones[zoneId], spec.printableWidthMm, spec.printableHeightMm, dpi);
        const blob = await canvasToBlob(canvas);
        outputs.push({
          zone: zoneId,
          filename: `${base}_${zoneId}_print_${spec.printableWidthMm}x${spec.printableHeightMm}mm_${actual}dpi_r${current.revision}.png`,
          format: 'png',
          colorSpace: 'sRGB',
          physicalWidthMm: spec.printableWidthMm,
          physicalHeightMm: spec.printableHeightMm,
          pixelWidth: canvas.width,
          pixelHeight: canvas.height,
          dpi: actual,
          printMethod: current.zones[zoneId].printMethod,
          sha256: await sha256Hex(blob),
        });
      }
      const issues = runPreflight(current);
      const manifest = {
        packageVersion: 1,
        generator: 'WOVEXA web',
        projectId: current.projectId,
        documentId: current.id,
        title: current.title,
        revision: current.revision,
        garment: { ...current.garment, modelName: model.name, calibrated: model.calibrated },
        colorway,
        units: 'mm',
        outputs,
        preflight: issues.filter((i) => i.severity !== 'info').map(({ severity, code, zoneId, layerId, message }) => ({ severity, code, zoneId, layerId, message })),
        notes: 'Screen colours are sRGB previews. Confirm colour, placement and print method with a physical proof before production.',
        generatedAt: new Date().toISOString(),
      };
      downloadBlob(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), `${base}_manifest_r${current.revision}.json`);
    });

  return (
    <div className="space-y-6 p-4">
      {errors > 0 ? (
        <p className="rounded-lg border border-danger/40 p-3 text-sm">
          <span className="font-semibold text-danger">{errors} print {errors === 1 ? 'issue' : 'issues'} to fix.</span> You can still export previews; fix them before sending files to production.
        </p>
      ) : null}

      <section>
        <h3 className="panel-title flex items-center gap-2">
          <ImageIcon size={15} /> Mockup images
        </h3>
        <p className="mt-1 text-xs text-fg-2">1600 × 2000 px per view (4:5, the common shop listing size).</p>
        <fieldset className="mt-3">
          <legend className="label mb-1.5">Views</legend>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(VIEW_PRESETS) as ViewPreset[]).map((v) => {
              const on = views.includes(v);
              return (
                <button
                  key={v}
                  className={`btn min-h-8 px-3 text-xs ${on ? 'btn-ink' : 'btn-outline'}`}
                  aria-pressed={on}
                  onClick={() => setViews(on ? views.filter((x) => x !== v) : [...views, v])}
                >
                  {v === 'three_quarter' ? 'Three-quarter' : VIEW_PRESETS[v].label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="label">Background</span>
            <select className="field" value={background} onChange={(e) => setBackground(e.target.value as keyof typeof BACKGROUNDS)}>
              {Object.entries(BACKGROUNDS).map(([k, b]) => (
                <option key={k} value={k}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="label">Files</span>
            <select className="field" value={layout} onChange={(e) => setLayout(e.target.value as 'sheet' | 'separate')}>
              <option value="sheet">One sheet</option>
              <option value="separate">One file per view</option>
            </select>
          </label>
        </div>
        {viewerReady ? (
          <button className="btn btn-primary mt-3 w-full" disabled={!views.length || !!busy} onClick={exportMockups}>
            {busy === 'mockups' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download mockups
          </button>
        ) : (
          <button className="btn btn-outline mt-3 w-full" onClick={() => setViewMode('split')}>
            Show the 3D view to export mockups
          </button>
        )}
      </section>

      <section>
        <h3 className="panel-title flex items-center gap-2">
          <Printer size={15} /> Print files
        </h3>
        <p className="mt-1 text-xs text-fg-2">Artwork only, transparent PNG at true size. No garment, shadows or background.</p>
        <ul className="mt-2 space-y-1 text-[13px]">
          {ZONE_IDS.map((z) => {
            const spec = model.zones[z];
            const has = zonesWithArt.includes(z);
            return (
              <li key={z} className={`flex justify-between ${has ? '' : 'text-fg-3'}`}>
                <span>
                  {spec.label}, {PRINT_METHOD_LABELS[doc.zones[z].printMethod]}
                </span>
                <span className="num">{has ? `${spec.printableWidthMm} × ${spec.printableHeightMm} mm` : 'Empty'}</span>
              </li>
            );
          })}
        </ul>
        <label className="mt-3 grid grid-cols-[1fr_auto] items-center gap-2">
          <span className="label">Resolution</span>
          <select className="field w-auto" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
            <option value={150}>150 dpi</option>
            <option value={300}>300 dpi</option>
          </select>
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn btn-outline" disabled={!zonesWithArt.length || !!busy} onClick={exportPrintFiles}>
            {busy === 'print' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Print PNGs
          </button>
          <button className="btn btn-outline" disabled={!!busy} onClick={exportManifest}>
            {busy === 'manifest' ? <Loader2 size={15} className="animate-spin" /> : <FileJson size={15} />} Manifest
          </button>
        </div>
        <p className="mt-2 text-xs text-fg-3">PNG files are RGB. For CMYK or spot colours, your print shop converts them with their own profile.</p>
      </section>
    </div>
  );
}
