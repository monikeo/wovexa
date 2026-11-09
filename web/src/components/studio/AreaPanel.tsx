'use client';
/**
 * Settings of the design area being designed on: its name, print size, turn and print method,
 * whether it shows and moves, and copies. Where it sits is set on the 3D garment itself.
 */
import { Copy, Crosshair, Eye, EyeOff, Lock, LockOpen, Move3d, Trash2 } from 'lucide-react';
import * as cmd from '@/domain/commands';
import { PRINT_METHOD_LABELS } from '@/domain/garments';
import { normalizeDeg } from '@/domain/geometry';
import type { DesignArea, PrintMethod } from '@/domain/schema';
import { useStudio } from '@/stores/studio-store';
import { bringAreaToView, deleteDesignArea, duplicateDesignArea } from './area-actions';
import { showOnGarment } from './projection-actions';

function NumberBox({ label, value, min, max, unit, onCommit }: { label: string; value: number; min: number; max: number; unit: string; onCommit: (v: number) => void }) {
  return (
    <label className="grid gap-1">
      <span className="label">{label}</span>
      <span className="relative">
        <input
          key={value}
          type="number"
          inputMode="decimal"
          className="field num pr-9"
          defaultValue={Math.round(value * 10) / 10}
          min={min}
          max={max}
          step={1}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v !== value) onCommit(Math.min(max, Math.max(min, v)));
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-3">{unit}</span>
      </span>
    </label>
  );
}

export function AreaPanel({ area }: { area: DesignArea }) {
  const dispatch = useStudio((s) => s.dispatch);
  const set = (patch: cmd.AreaPatch, label: string) => dispatch(cmd.updateArea(area.id, patch, label));
  return (
    <section className="space-y-3 border-b border-line px-4 pb-5 pt-3" aria-label={`${area.name} settings`}>
      <div className="flex items-center gap-2">
        <input
          key={`${area.id}:${area.name}`}
          className="field h-9 flex-1 font-semibold"
          defaultValue={area.name}
          aria-label="Area name"
          maxLength={60}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== area.name && set({ name: e.target.value.trim() }, 'Rename area')}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button className="icon-btn h-9 w-9" onClick={() => set({ visible: !area.visible }, area.visible ? 'Hide area' : 'Show area')} aria-label={area.visible ? `Hide ${area.name}` : `Show ${area.name}`} title={area.visible ? 'Hide' : 'Show'}>
          {area.visible ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <button className="icon-btn h-9 w-9" onClick={() => set({ locked: !area.locked }, area.locked ? 'Unlock area' : 'Lock area')} aria-label={area.locked ? `Unlock ${area.name}` : `Lock ${area.name}`} title={area.locked ? 'Unlock: let it move' : 'Lock where it is'}>
          {area.locked ? <Lock size={16} /> : <LockOpen size={16} />}
        </button>
      </div>
      <p className="text-xs text-fg-2">
        A print area of your own, anywhere on the garment. Design in it like any zone; in 3D Place mode, drag its bare cloth to move it, scroll or pinch to resize it with its artwork, Shift and scroll to turn it.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <NumberBox label="Width" value={area.widthMm} min={10} max={1500} unit="mm" onCommit={(v) => set({ widthMm: v }, 'Area width')} />
        <NumberBox label="Height" value={area.heightMm} min={10} max={1500} unit="mm" onCommit={(v) => set({ heightMm: v }, 'Area height')} />
        <NumberBox label="Turn" value={area.rotationDeg} min={-360} max={360} unit="°" onCommit={(v) => set({ rotationDeg: normalizeDeg(v) }, 'Turn area')} />
      </div>
      <label className="grid gap-1">
        <span className="label">Print method</span>
        <select className="field" value={area.printMethod} onChange={(e) => set({ printMethod: e.target.value as PrintMethod }, 'Area print method')}>
          {(Object.keys(PRINT_METHOD_LABELS) as PrintMethod[]).map((m) => (
            <option key={m} value={m}>
              {PRINT_METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <button className="btn btn-outline min-h-9 px-2 text-xs" onClick={showOnGarment} title="Show it on the 3D garment, ready to drag">
          <Move3d size={14} /> Move
        </button>
        <button className="btn btn-outline min-h-9 px-2 text-xs" onClick={() => bringAreaToView(area.id)} title="Put it on the cloth in the middle of the 3D view">
          <Crosshair size={14} /> Bring to view
        </button>
        <button className="btn btn-outline min-h-9 px-2 text-xs" onClick={() => duplicateDesignArea(area.id)} title="A copy with its artwork, beside it">
          <Copy size={14} /> Copy
        </button>
        <button className="btn btn-outline min-h-9 px-2 text-xs text-danger" onClick={() => deleteDesignArea(area.id)} title="Delete the area and its artwork (undo brings it back)">
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </section>
  );
}
