'use client';
/**
 * Garment panel (spec GAR-02/05/06/07/09, VAR-01/02): style, size, fabric, colourways with a
 * colour for every part the garment has, and all-over fabric prints per part.
 */
import { Check, Dices, Download, GitCompare, ImagePlus, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useBrandKit } from './brand-context';
import * as cmd from '@/domain/commands';
import { createColorway } from '@/domain/factory';
import { BELT_COLOURS, colorwayPresetsFor, GARMENT_LIST, getGarment, hasZone, partColor, PRINT_METHOD_LABELS, sizeChart, sizeLabel, type GarmentModel } from '@/domain/garments';
import { FABRIC_EFFECTS, PATTERNS, ZONE_IDS, type Colorway, type DesignDocument, type FabricEffect, type PrintMethod, type Surface } from '@/domain/schema';
import { downloadBlob } from '@/lib/download';
import { viewerApi } from './viewer3d/stage';
import { AssetError, importImageFile, loadAssetImage } from '@/lib/assets';
import { ColorField, toast } from '@/components/ui/primitives';
import { useActiveColorway, useActiveZoneSpec, useStudio } from '@/stores/studio-store';
import { GarmentGlyph } from './GarmentGlyph';
import { RangeField } from './inspector-controls';

const EFFECT_LABELS: Record<FabricEffect, string> = {
  spiral: 'Spiral tie-dye',
  crumple: 'Crumple dye',
  'acid-wash': 'Acid wash',
  heather: 'Heather',
  'dip-dye': 'Dip-dye',
  marble: 'Marble',
};

const seed = () => Math.floor(Math.random() * 2147483646) + 1;

function isLight(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150;
}

/** Starting looks for each dye effect, chosen to show on the garment's colour. */
const EFFECT_DEFAULTS: Record<FabricEffect, (base: string) => Extract<Surface, { kind: 'effect' }>> = {
  spiral: () => ({ kind: 'effect', effect: 'spiral', color2: '#E63973', color3: '#2B59FF', scaleMm: 140, intensity: 0.9, seed: seed() }),
  crumple: () => ({ kind: 'effect', effect: 'crumple', color2: '#7B2FF7', color3: '#10B5A6', scaleMm: 120, intensity: 0.85, seed: seed() }),
  // Acid wash bleaches dark fabric; on light fabric it reads as a stone-washed shadow.
  'acid-wash': (base) => ({ kind: 'effect', effect: 'acid-wash', color2: isLight(base) ? '#7C818B' : '#D8D4CC', scaleMm: 160, intensity: 0.75, seed: seed() }),
  heather: (base) => ({ kind: 'effect', effect: 'heather', color2: isLight(base) ? '#6B7079' : '#F2F2F2', scaleMm: 40, intensity: 0.55, seed: seed() }),
  'dip-dye': () => ({ kind: 'effect', effect: 'dip-dye', color2: '#1E3A8A', color3: '#60A5FA', scaleMm: 320, intensity: 0.95, seed: seed() }),
  marble: (base) => ({ kind: 'effect', effect: 'marble', color2: '#9CA3AF', color3: isLight(base) ? '#1F2937' : '#F3F4F6', scaleMm: 180, intensity: 0.8, seed: seed() }),
};

const PATTERN_LABELS: Record<(typeof PATTERNS)[number], string> = {
  stripes: 'Stripes',
  dots: 'Dots',
  checks: 'Checks',
  grid: 'Grid',
  zigzag: 'Zigzag',
  waves: 'Waves',
  diamonds: 'Diamonds',
  camo: 'Camo',
};

function StylePicker({ current }: { current: GarmentModel }) {
  const doc = useStudio((s) => s.document)!;
  const dispatch = useStudio((s) => s.dispatch);
  const choose = (model: GarmentModel) => {
    if (model.id === current.id) return;
    const stranded = ZONE_IDS.filter((z) => !hasZone(model, z) && doc.zones[z].orderedLayerIds.length);
    dispatch(cmd.setGarmentModel(model));
    if (stranded.length) toast(`Artwork on the ${stranded.map((z) => z.replace('_', ' ')).join(' and ')} is kept, but a ${model.shortName.toLowerCase()} has no such zone, so it won't print. Switch back any time.`);
  };
  return (
    <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Garment style">
      {GARMENT_LIST.map((m) => {
        const on = m.id === current.id;
        return (
          <button
            key={m.id}
            role="radio"
            aria-checked={on}
            title={`${m.name}. ${m.description}`}
            onClick={() => choose(m)}
            className="touch-hit group flex min-h-[78px] flex-col items-center justify-start gap-1 rounded-xl border border-line px-0.5 pb-1.5 pt-2 text-fg-2 transition-colors hover:border-line-strong hover:text-fg aria-checked:border-[var(--accent)] aria-checked:bg-selected aria-checked:text-fg"
          >
            <GarmentGlyph model={m} className="h-9 w-9 flex-none" />
            <span className="w-full text-balance break-words text-center text-[10.5px] font-medium leading-[1.15]">{m.shortName}</span>
          </button>
        );
      })}
    </div>
  );
}

/** All-over fabric print for one part of the colourway (sublimation or printed fabric). */
function FabricPrint({ colorway, model }: { colorway: Colorway; model: GarmentModel }) {
  const dispatch = useStudio((s) => s.dispatch);
  const parts = (['body', 'sleeves', 'pants'] as const).filter((p) => (p === 'sleeves' ? !!model.sleeve : p === 'pants' ? !!model.pants : true));
  const [part, setPart] = useState<(typeof parts)[number]>('body');
  const [alsoSleeves, setAlsoSleeves] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const target = parts.includes(part) ? part : 'body';
  const surface = colorway.surfaces?.[target];
  const kind = surface?.kind ?? 'solid';
  const base = partColor(colorway, target);

  const set = (next: Surface | undefined, label: string, gesture?: string) => {
    const apply = (p: 'body' | 'sleeves' | 'pants') => {
      const command = cmd.setColorwaySurface(colorway.id, p, next, label);
      dispatch(gesture ? cmd.coalescing(command, `surface-${gesture}-${p}`) : command);
    };
    apply(target);
    if (target === 'body' && alsoSleeves && model.sleeve) apply('sleeves');
  };

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const asset = await importImageFile(file);
      await loadAssetImage(asset.id);
      set({ kind: 'image', assetId: asset.id, naturalWidthPx: asset.width, naturalHeightPx: asset.height, tileWidthMm: 120, angleDeg: 0 }, 'Image fabric print');
    } catch (error) {
      toast(error instanceof AssetError ? error.message : 'That image could not be used.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {parts.length > 1 ? (
        <div className="seg w-fit" role="group" aria-label="Printed part">
          {parts.map((p) => (
            <button key={p} aria-pressed={target === p} onClick={() => setPart(p)}>
              {model.colorParts.find((c) => c.part === p)?.label ?? p}
            </button>
          ))}
        </div>
      ) : null}
      <div className="seg w-fit" role="group" aria-label="Fabric print">
        <button aria-pressed={kind === 'solid'} onClick={() => set(undefined, 'Solid fabric')}>
          Solid
        </button>
        <button aria-pressed={kind === 'gradient'} onClick={() => kind !== 'gradient' && set({ kind: 'gradient', to: '#2B59FF', angleDeg: 90 }, 'Gradient fabric')}>
          Gradient
        </button>
        <button aria-pressed={kind === 'pattern'} onClick={() => kind !== 'pattern' && set({ kind: 'pattern', pattern: 'camo', color2: '#3B4A2F', scaleMm: 140, angleDeg: 0 }, 'Pattern fabric')}>
          Pattern
        </button>
        <button aria-pressed={kind === 'effect'} onClick={() => kind !== 'effect' && set(EFFECT_DEFAULTS.spiral(base), 'Dye effect')}>
          Dye
        </button>
        <button aria-pressed={kind === 'image'} onClick={() => fileRef.current?.click()}>
          Image
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />
      {busy ? (
        <p className="flex items-center gap-2 text-xs text-fg-2">
          <Loader2 size={13} className="animate-spin" /> Adding image…
        </p>
      ) : null}
      {surface?.kind === 'gradient' ? (
        <>
          <ColorField label="To" value={surface.to} onChange={(to) => set({ ...surface, to }, 'Gradient fabric colour')} />
          <RangeField label="Angle" value={surface.angleDeg} min={-180} max={180} step={5} format={(v) => `${v}°`} onChange={(angleDeg) => set({ ...surface, angleDeg }, 'Gradient fabric angle', 'angle')} />
        </>
      ) : null}
      {surface?.kind === 'pattern' ? (
        <>
          <label className="grid grid-cols-[52px_1fr] items-center gap-2">
            <span className="label">Pattern</span>
            <select className="field" value={surface.pattern} onChange={(e) => set({ ...surface, pattern: e.target.value as typeof surface.pattern }, 'Fabric pattern')}>
              {PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {PATTERN_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <ColorField label="Colour 2" value={surface.color2} onChange={(color2) => set({ ...surface, color2 }, 'Fabric pattern colour')} />
          <RangeField label="Scale" value={surface.scaleMm} min={4} max={400} format={(v) => `${v} mm`} onChange={(scaleMm) => set({ ...surface, scaleMm }, 'Fabric pattern scale', 'scale')} />
          <RangeField label="Angle" value={surface.angleDeg} min={-180} max={180} step={5} format={(v) => `${v}°`} onChange={(angleDeg) => set({ ...surface, angleDeg }, 'Fabric pattern angle', 'angle')} />
        </>
      ) : null}
      {surface?.kind === 'effect' ? (
        <>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label="Dye effect">
            {FABRIC_EFFECTS.map((e) => (
              <button
                key={e}
                className="rounded-lg border border-line px-1.5 py-1.5 text-[11.5px] font-medium text-fg-2 hover:border-line-strong hover:text-fg aria-pressed:border-[var(--accent)] aria-pressed:bg-selected aria-pressed:text-fg"
                aria-pressed={surface.effect === e}
                onClick={() => surface.effect !== e && set({ ...EFFECT_DEFAULTS[e](base), seed: surface.seed }, `Dye: ${EFFECT_LABELS[e].toLowerCase()}`)}
              >
                {EFFECT_LABELS[e]}
              </button>
            ))}
          </div>
          <ColorField label={surface.effect === 'acid-wash' ? 'Bleach' : surface.effect === 'heather' ? 'Fleck' : 'Dye 1'} value={surface.color2} onChange={(color2) => set({ ...surface, color2 }, 'Dye colour')} />
          {surface.effect === 'spiral' || surface.effect === 'crumple' || surface.effect === 'dip-dye' || surface.effect === 'marble' ? (
            <ColorField label="Dye 2" value={surface.color3 ?? '#FFFFFF'} onChange={(color3) => set({ ...surface, color3 }, 'Dye colour')} />
          ) : null}
          {surface.effect !== 'heather' ? (
            <RangeField
              label={surface.effect === 'spiral' ? 'Twist' : surface.effect === 'dip-dye' ? 'Height' : 'Size'}
              value={surface.scaleMm}
              min={surface.effect === 'dip-dye' ? 40 : 20}
              max={surface.effect === 'dip-dye' ? 900 : 600}
              step={5}
              format={(v) => `${v} mm`}
              onChange={(scaleMm) => set({ ...surface, scaleMm }, 'Dye size', 'dye-scale')}
            />
          ) : null}
          <RangeField label="Strength" value={Math.round(surface.intensity * 100)} min={5} max={100} format={(v) => `${v}%`} onChange={(v) => set({ ...surface, intensity: v / 100 }, 'Dye strength', 'dye-strength')} />
          <button className="btn btn-ghost min-h-8 px-2 text-xs" onClick={() => set({ ...surface, seed: (surface.seed * 48271 + 11) % 2147483647 }, 'New dye pattern')}>
            <Dices size={14} /> New pattern
          </button>
        </>
      ) : null}
      {surface?.kind === 'image' ? (
        <>
          <RangeField label="Tile" value={surface.tileWidthMm} min={20} max={600} format={(v) => `${v} mm`} onChange={(tileWidthMm) => set({ ...surface, tileWidthMm }, 'Fabric print size', 'tile')} />
          <RangeField label="Angle" value={surface.angleDeg} min={-180} max={180} step={5} format={(v) => `${v}°`} onChange={(angleDeg) => set({ ...surface, angleDeg }, 'Fabric print angle', 'angle')} />
          <button className="btn btn-ghost min-h-8 px-2 text-xs" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={14} /> Replace image
          </button>
        </>
      ) : null}
      {target === 'body' && model.sleeve ? (
        <label className="flex items-center gap-2 text-xs text-fg-2">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={alsoSleeves} onChange={(e) => setAlsoSleeves(e.target.checked)} />
          Apply to the sleeves too
        </label>
      ) : null}
      {kind !== 'solid' ? <p className="text-[11px] text-fg-3">The colour above is the base under the print. All-over prints are made by sublimation or on printed fabric.</p> : null}
      <p className="sr-only" aria-live="polite">
        {kind === 'solid' ? `${base} solid` : `${kind} print`}
      </p>
    </div>
  );
}

const cm = (mm: number | undefined) => (mm === undefined ? '–' : (mm / 10).toFixed(mm % 10 ? 1 : 0));

/**
 * The garment's 3D shape: built in, or one an artist made from this style's template in Blender,
 * Clo3D or Marvelous Designer. Prints, colours, lighting, motion and renders follow either.
 */
function ShapePicker({ model, doc }: { model: GarmentModel; doc: DesignDocument }) {
  const dispatch = useStudio((s) => s.dispatch);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'template' | 'shape' | null>(null);
  const shape = doc.garment.shape?.modelId === model.id ? doc.garment.shape : undefined;

  const downloadTemplate = async () => {
    if (!viewerApi.exportTemplate) {
      toast('Show the 3D view to download this style’s template.', 'error');
      return;
    }
    setBusy('template');
    try {
      downloadBlob(await viewerApi.exportTemplate(), `${model.id}_${doc.garment.sizeCode}_template.glb`);
      toast('Template downloaded. Reshape it, keep the part names and UVs, then load it back here.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The template couldn’t be made.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const load = async (file: File) => {
    setBusy('shape');
    try {
      const { importGarmentShape } = await import('./viewer3d/garment-glb');
      const next = await importGarmentShape(file, model, doc.garment.sizeCode);
      dispatch(cmd.setGarmentShape(next));
      toast(`Using your 3D shape “${next.name}”. Prints, colours and lighting follow it.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That file couldn’t be used.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-line p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold">3D shape</p>
          <p className="truncate text-[11px] text-fg-3">{shape ? `Your shape: ${shape.name}` : 'Built-in shape'}</p>
        </div>
        {shape ? (
          <button className="btn btn-ghost min-h-8 flex-none px-2 text-xs" onClick={() => dispatch(cmd.setGarmentShape(null))}>
            Use built-in
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button className="btn btn-outline min-h-8 px-2 text-xs" disabled={busy !== null} onClick={() => void downloadTemplate()} title="This style as a GLB with named parts and print areas, for Blender, Clo3D or Marvelous Designer">
          {busy === 'template' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Template
        </button>
        <button className="btn btn-outline min-h-8 px-2 text-xs" disabled={busy !== null} onClick={() => fileRef.current?.click()} title="Load a GLB made from this style’s template">
          {busy === 'shape' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {shape ? 'Replace' : 'Load shape'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".glb,model/gltf-binary"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void load(f);
          e.target.value = '';
        }}
      />
      <p className="text-[11px] text-fg-3">
        Download this style’s template, reshape it in Blender, Clo3D or Marvelous Designer with the part names and UVs kept, then load it back for a more natural drape. Use models you own or have a licence for.
      </p>
    </div>
  );
}

/** The style's size chart in centimetres. Choosing a size here is the same as the size menu. */
function SizeGuide({ model, selected, onPick }: { model: GarmentModel; selected: string; onPick: (code: string) => void }) {
  const { columns, rows } = sizeChart(model);
  return (
    <details className="rounded-lg border border-line">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-fg-2">Size guide</summary>
      <div className="max-h-72 overflow-auto border-t border-line">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--surface-panel)]">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold">Size</th>
              {columns.map((c) => (
                <th key={c.key} className="px-2 py-1.5 text-right font-semibold" title={c.hint}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className={`border-t border-line ${r.code === selected ? 'bg-selected font-semibold' : ''}`}>
                <td className="px-1 py-0.5">
                  <button className="w-full rounded px-1 py-1 text-left hover:bg-hover" aria-pressed={r.code === selected} onClick={() => onPick(r.code)}>
                    {r.label}
                  </button>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className="num px-2 py-1 text-right">
                    {cm(r.values[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-3 py-2 text-[11px] text-fg-3">
        Finished garment in cm, measured flat. {columns.map((c) => `${c.label}: ${c.hint.toLowerCase()}`).join('. ')}. Choose a size to see it in 3D.
      </p>
    </details>
  );
}

export function GarmentPanel() {
  const doc = useStudio((s) => s.document);
  const dispatch = useStudio((s) => s.dispatch);
  const colorway = useActiveColorway();
  const spec = useActiveZoneSpec();
  const setPanel = useStudio((s) => s.setPanel);
  const kit = useBrandKit();
  if (!doc || !colorway) return null;
  const model = getGarment(doc.garment.modelId);
  const unused = colorwayPresetsFor(model).filter((p) => !doc.colorways.some((c) => c.name === p.name));

  return (
    <div className="relative space-y-6 px-4 pb-6 pt-3">
      <section className="space-y-3">
        <div>
          <h2 className="panel-title">Garment</h2>
          <p className="mt-0.5 text-xs text-fg-2">
            {model.name}
            {model.calibrated ? '' : ' (uncalibrated preview model)'}
          </p>
        </div>
        <StylePicker current={model} />
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="label">Size</span>
            <select className="field" value={doc.garment.sizeCode} onChange={(e) => dispatch(cmd.setGarmentSize(e.target.value))}>
              {model.sizes.map((s) => (
                <option key={s.code} value={s.code}>
                  {model.category === 'uniform' ? sizeLabel(model, s) : `${sizeLabel(model, s)} · chest ${s.chestFlatMm / 10} cm`}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="label">Fabric</span>
            <select className="field" value={doc.garment.fabricPresetId} onChange={(e) => dispatch(cmd.setFabricPreset(e.target.value))}>
              {model.fabricPresets.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <SizeGuide model={model} selected={doc.garment.sizeCode} onPick={(code) => dispatch(cmd.setGarmentSize(code))} />
        <ShapePicker model={model} doc={doc} />
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="panel-title">Colourways</h2>
          {unused.length ? (
            <select
              className="field h-8 w-auto text-xs"
              value=""
              aria-label="Add a colourway"
              onChange={(e) => {
                const preset = unused.find((p) => p.name === e.target.value);
                if (preset) dispatch(cmd.addColorway(createColorway(preset)));
              }}
            >
              <option value="">Add colourway…</option>
              {unused.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <ul className="mt-2 grid grid-cols-1 gap-1">
          {doc.colorways.map((c) => {
            const active = c.id === colorway.id;
            return (
              <li key={c.id} className={`flex items-center gap-2 rounded-lg p-1.5 ${active ? 'bg-selected' : 'hover:bg-hover'}`}>
                <button className="flex flex-1 items-center gap-2.5 text-left" onClick={() => dispatch(cmd.setActiveColorway(c.id))} aria-pressed={active} aria-label={`Use colourway ${c.name}`}>
                  <span className="relative h-7 w-7 flex-none overflow-hidden rounded-md border border-line" aria-hidden>
                    <span className="absolute inset-0" style={{ background: c.parts.body }} />
                    <span className="absolute inset-y-0 right-0 w-1/3" style={{ background: c.parts.sleeves }} />
                    {c.parts.belt ? <span className="absolute inset-x-0 top-1/2 h-1" style={{ background: c.parts.belt }} /> : null}
                  </span>
                  <span className="flex-1 truncate text-[13px] font-medium">{c.name}</span>
                  {c.surfaces ? <span className="rounded bg-hover px-1.5 py-0.5 text-[10px] font-semibold text-fg-2">Print</span> : null}
                  {active ? <Check size={15} className="text-accent" aria-label="Active" /> : null}
                </button>
                {doc.colorways.length > 1 ? (
                  <button className="icon-btn h-8 w-8" onClick={() => dispatch(cmd.removeColorway(c.id))} aria-label={`Delete colourway ${c.name}`}>
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="mt-3 space-y-2">
          <label className="grid grid-cols-[52px_1fr] items-center gap-2">
            <span className="label">Name</span>
            <input
              key={colorway.id}
              className="field"
              defaultValue={colorway.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== colorway.name && dispatch(cmd.renameColorway(colorway.id, e.target.value.trim()))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          {model.colorParts.map(({ part, label }) => (
            <ColorField
              key={part}
              label={label}
              value={partColor(colorway, part)}
              onChange={(hex) => dispatch(cmd.setColorwayPart(colorway.id, part, hex))}
              swatches={part === 'belt' ? BELT_COLOURS.map((b) => ({ name: `${b.name} belt`, hex: b.hex })) : kit?.colors}
            />
          ))}
          <p className="text-xs text-fg-3">Screen colours are previews, not verified print or fabric matches.</p>
        </div>
      </section>

      <section>
        <h2 className="panel-title">Fabric print</h2>
        <p className="mb-2 mt-0.5 text-xs text-fg-2">Cover the fabric with a gradient, a pattern or your own image, under the artwork.</p>
        <FabricPrint key={colorway.id} colorway={colorway} model={model} />
      </section>

      <section>
        <h2 className="panel-title">Print method, {spec.label.toLowerCase()}</h2>
        <select className="field mt-2" value={doc.zones[spec.id].printMethod} onChange={(e) => dispatch(cmd.setPrintMethod(spec.id, e.target.value as PrintMethod))}>
          {(Object.keys(PRINT_METHOD_LABELS) as PrintMethod[]).map((m) => (
            <option key={m} value={m} disabled={!spec.methods.includes(m)}>
              {PRINT_METHOD_LABELS[m]}
              {spec.methods.includes(m) ? '' : ' (not available here)'}
            </option>
          ))}
        </select>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-outline flex-1 text-xs"
          onClick={() => dispatch(cmd.addColorway(createColorway({ name: `Custom ${doc.colorways.length + 1}`, parts: { ...colorway.parts }, surfaces: colorway.surfaces })))}
        >
          <Plus size={14} /> Custom colourway
        </button>
        <button className="btn btn-outline flex-1 text-xs" onClick={() => setPanel('compare')} disabled={doc.colorways.length < 2}>
          <GitCompare size={14} /> Compare all
        </button>
      </div>
    </div>
  );
}
