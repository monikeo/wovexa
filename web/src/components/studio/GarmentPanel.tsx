'use client';
import { Check, GitCompare, Plus, Trash2 } from 'lucide-react';
import { useBrandKit } from './brand-context';
import * as cmd from '@/domain/commands';
import { createColorway } from '@/domain/factory';
import { COLORWAY_PRESETS, getGarment, PRINT_METHOD_LABELS } from '@/domain/garments';
import type { GarmentPart, PrintMethod } from '@/domain/schema';
import { ColorField } from '@/components/ui/primitives';
import { useActiveColorway, useActiveZoneSpec, useStudio } from '@/stores/studio-store';

const PART_LABELS: Record<GarmentPart, string> = { body: 'Body', sleeves: 'Sleeves', collar: 'Collar', stitching: 'Stitch' };

export function GarmentPanel() {
  const doc = useStudio((s) => s.document);
  const dispatch = useStudio((s) => s.dispatch);
  const zoneId = useStudio((s) => s.activeZoneId);
  const colorway = useActiveColorway();
  const spec = useActiveZoneSpec();
  const setPanel = useStudio((s) => s.setPanel);
  const kit = useBrandKit();
  if (!doc || !colorway) return null;
  const model = getGarment(doc.garment.modelId);
  const unused = COLORWAY_PRESETS.filter((p) => !doc.colorways.some((c) => c.name === p.name));

  return (
    <div className="space-y-6 px-4 pb-6 pt-3">
      <section>
        <h2 className="panel-title">Garment</h2>
        <p className="mt-0.5 text-xs text-fg-2">
          {model.name}
          {model.calibrated ? '' : ' (uncalibrated preview model)'}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="label">Size</span>
            <select className="field" value={doc.garment.sizeCode} onChange={(e) => dispatch(cmd.setGarmentSize(e.target.value))}>
              {model.sizes.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} · chest {s.chestFlatMm / 10} cm
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
                const preset = COLORWAY_PRESETS.find((p) => p.name === e.target.value);
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
                <button className="flex flex-1 items-center gap-2.5 text-left" onClick={() => dispatch(cmd.setActiveColorway(c.id))} aria-pressed={active}>
                  <span className="h-7 w-7 flex-none rounded-md border border-line" style={{ background: c.parts.body }} aria-hidden />
                  <span className="flex-1 truncate text-[13px] font-medium">{c.name}</span>
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
          {(Object.keys(PART_LABELS) as GarmentPart[]).map((part) => (
            <ColorField key={part} label={PART_LABELS[part]} value={colorway.parts[part]} onChange={(hex) => dispatch(cmd.setColorwayPart(colorway.id, part, hex))} swatches={kit?.colors} />
          ))}
          <p className="text-xs text-fg-3">Screen colours are previews, not verified print or fabric matches.</p>
        </div>
      </section>

      <section>
        <h2 className="panel-title">Print method, {spec.label.toLowerCase()}</h2>
        <select
          className="field mt-2"
          value={doc.zones[zoneId].printMethod}
          onChange={(e) => dispatch(cmd.setPrintMethod(zoneId, e.target.value as PrintMethod))}
        >
          {(Object.keys(PRINT_METHOD_LABELS) as PrintMethod[]).map((m) => (
            <option key={m} value={m} disabled={!spec.methods.includes(m)}>
              {PRINT_METHOD_LABELS[m]}
              {spec.methods.includes(m) ? '' : ' (not available here)'}
            </option>
          ))}
        </select>
      </section>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-outline flex-1 text-xs" onClick={() => dispatch(cmd.addColorway(createColorway({ name: `Custom ${doc.colorways.length + 1}`, parts: { ...colorway.parts } })))}>
          <Plus size={14} /> Custom colourway
        </button>
        <button className="btn btn-outline flex-1 text-xs" onClick={() => setPanel('compare')} disabled={doc.colorways.length < 2}>
          <GitCompare size={14} /> Compare all
        </button>
      </div>
    </div>
  );
}
