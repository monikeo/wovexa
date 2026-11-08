'use client';
import { ArrowDown, ArrowUp, Eye, EyeOff, Image as ImageIcon, Lock, Shapes, Type, Unlock } from 'lucide-react';
import { useState } from 'react';
import * as cmd from '@/domain/commands';
import type { ArtworkLayer } from '@/domain/schema';
import { useActiveZoneSpec, useStudio } from '@/stores/studio-store';
import { addImages, addText, selectLayers } from './actions';

const ICON = { image: ImageIcon, text: Type, shape: Shapes } as const;

function LayerRow({ layer, index, count, groupEdge }: { layer: ArtworkLayer; index: number; count: number; groupEdge: 'top' | 'middle' | 'bottom' | 'single' | null }) {
  const zoneId = useStudio((s) => s.activeZoneId);
  const selected = useStudio((s) => s.selectedLayerIds.includes(layer.id));
  const dispatch = useStudio((s) => s.dispatch);
  const [renaming, setRenaming] = useState(false);
  const Icon = ICON[layer.content.kind];

  const onSelect = (e: React.MouseEvent | React.KeyboardEvent) => {
    const { selectedLayerIds } = useStudio.getState();
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      selectLayers(selectedLayerIds.includes(layer.id) ? selectedLayerIds.filter((id) => id !== layer.id) : [...selectedLayerIds, layer.id]);
    } else {
      selectLayers([layer.id]);
    }
  };

  const bracket =
    groupEdge === null
      ? ''
      : `ml-2 border-l-2 border-[color-mix(in_srgb,var(--accent)_45%,transparent)] ${groupEdge === 'top' ? 'mt-1 rounded-tl-none' : ''} ${groupEdge === 'bottom' ? 'mb-1 rounded-bl-none' : ''}`;

  return (
    <li
      className={`group flex min-h-11 items-center gap-1 rounded-lg pl-2 pr-1 ${bracket} ${selected ? 'bg-selected' : 'hover:bg-hover'} ${layer.visible ? '' : 'opacity-55'}`}
    >
      <Icon size={15} className={selected ? 'text-accent' : 'text-fg-2'} aria-hidden />
      {renaming ? (
        <input
          className="field ml-1 h-8 flex-1"
          defaultValue={layer.name}
          autoFocus
          aria-label="Layer name"
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== layer.name) dispatch(cmd.updateLayer(zoneId, layer.id, { name }, 'Rename layer'));
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <button
          className="ml-1 min-w-0 flex-1 truncate py-2 text-left text-[13px]"
          onClick={onSelect}
          onDoubleClick={() => setRenaming(true)}
          aria-pressed={selected}
          title="Double-click to rename"
        >
          {layer.name}
        </button>
      )}
      <div className="flex items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <button className="icon-btn h-8 w-8" disabled={index === count - 1} onClick={() => dispatch(cmd.moveLayerBy(zoneId, layer.id, 1))} aria-label={`Move ${layer.name} up`} title="Bring forward (])">
          <ArrowUp size={14} />
        </button>
        <button className="icon-btn h-8 w-8" disabled={index === 0} onClick={() => dispatch(cmd.moveLayerBy(zoneId, layer.id, -1))} aria-label={`Move ${layer.name} down`} title="Send backward ([)">
          <ArrowDown size={14} />
        </button>
      </div>
      <button
        className="icon-btn h-8 w-8"
        onClick={() => dispatch(cmd.updateLayer(zoneId, layer.id, { locked: !layer.locked }, layer.locked ? 'Unlock layer' : 'Lock layer'))}
        aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
        aria-pressed={layer.locked}
      >
        {layer.locked ? <Lock size={14} /> : <Unlock size={14} className="text-fg-3" />}
      </button>
      <button
        className="icon-btn h-8 w-8"
        onClick={() => dispatch(cmd.updateLayer(zoneId, layer.id, { visible: !layer.visible }, layer.visible ? 'Hide layer' : 'Show layer'))}
        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
      >
        {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
    </li>
  );
}

export function LayerPanel() {
  const zone = useStudio((s) => s.document?.zones[s.activeZoneId]);
  const spec = useActiveZoneSpec();
  if (!zone) return null;
  const layers = zone.orderedLayerIds.map((id) => zone.layers[id]).filter(Boolean);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <h2 className="panel-title">Layers</h2>
        <span className="text-xs text-fg-2">{spec.label}</span>
      </div>
      {layers.length === 0 ? (
        <div className="mx-3 rounded-xl border border-dashed border-line p-4 text-sm">
          <p className="font-medium">Nothing on the {spec.label.toLowerCase()} yet</p>
          <p className="mt-1 text-fg-2">Add text or an image. It lands inside the {spec.printableWidthMm} × {spec.printableHeightMm} mm print area.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-outline" onClick={() => addText()}>
              <Type size={15} /> Add text
            </button>
            <label className="btn btn-outline">
              <ImageIcon size={15} /> Add image
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" multiple className="sr-only" onChange={(e) => e.target.files && addImages(e.target.files)} />
            </label>
          </div>
        </div>
      ) : (
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" aria-label={`${spec.label} layers, top first`}>
          {[...layers].reverse().map((layer, i, list) => {
            const g = layer.groupId;
            const prev = list[i - 1]?.groupId;
            const next = list[i + 1]?.groupId;
            const edge = !g ? null : prev !== g && next !== g ? 'single' : prev !== g ? 'top' : next !== g ? 'bottom' : 'middle';
            return <LayerRow key={layer.id} layer={layer} index={zone.orderedLayerIds.indexOf(layer.id)} count={layers.length} groupEdge={edge} />;
          })}
        </ul>
      )}
    </div>
  );
}
