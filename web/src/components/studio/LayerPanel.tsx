'use client';
import { ArrowDown, ArrowUp, Component, CornerLeftDown, Eye, EyeOff, Image as ImageIcon, Lock, Shapes, Type, Unlock } from 'lucide-react';
import { useState } from 'react';
import { clipBases } from '@/domain/clipping';
import * as cmd from '@/domain/commands';
import { projectedLayers } from '@/domain/projected';
import type { ArtworkLayer, ProjectedLayer } from '@/domain/schema';
import { useActiveArtboard, useActiveZoneSpec, useStudio } from '@/stores/studio-store';
import { addImages, addText, selectLayers } from './actions';
import { moveProjectionBy, selectProjection } from './projection-actions';

const ICON = { image: ImageIcon, text: Type, shape: Shapes, lockup: Component } as const;

/** A projected (cross-seam) layer: select, rename, restack, lock and hide, like a zone layer. */
function ProjectedRow({ layer, index, count }: { layer: ProjectedLayer; index: number; count: number }) {
  const selected = useStudio((s) => s.selectedProjectionId === layer.id);
  const dispatch = useStudio((s) => s.dispatch);
  const [renaming, setRenaming] = useState(false);
  const Icon = ICON[layer.content.kind];
  return (
    <li className={`group flex min-h-11 items-center gap-1 rounded-lg pl-2 pr-1 ${selected ? 'bg-selected' : 'hover:bg-hover'} ${layer.visible ? '' : 'opacity-55'}`}>
      <Icon size={15} className={selected ? 'text-accent' : 'text-fg-2'} aria-hidden />
      {renaming ? (
        <input
          className="field ml-1 h-8 flex-1"
          defaultValue={layer.name}
          autoFocus
          aria-label="Layer name"
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== layer.name) dispatch(cmd.updateProjectedLayer(layer.id, { name }, 'Rename layer'));
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
          onClick={() => selectProjection(layer.id)}
          onDoubleClick={() => setRenaming(true)}
          aria-pressed={selected}
          title="On the 3D garment, across seams. Double-click to rename"
        >
          {layer.name}
        </button>
      )}
      <div className="hover-reveal flex items-center">
        <button className="icon-btn h-8 w-8" disabled={index === count - 1} onClick={() => moveProjectionBy(layer.id, 1)} aria-label={`Move ${layer.name} up`} title="Bring forward">
          <ArrowUp size={14} />
        </button>
        <button className="icon-btn h-8 w-8" disabled={index === 0} onClick={() => moveProjectionBy(layer.id, -1)} aria-label={`Move ${layer.name} down`} title="Send backward">
          <ArrowDown size={14} />
        </button>
      </div>
      <button
        className="icon-btn h-8 w-8"
        onClick={() => dispatch(cmd.updateProjectedLayer(layer.id, { locked: !layer.locked }, layer.locked ? 'Unlock layer' : 'Lock layer'))}
        aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
        aria-pressed={layer.locked}
      >
        {layer.locked ? <Lock size={14} /> : <Unlock size={14} className="text-fg-3" />}
      </button>
      <button
        className="icon-btn h-8 w-8"
        onClick={() => dispatch(cmd.updateProjectedLayer(layer.id, { visible: !layer.visible }, layer.visible ? 'Hide layer' : 'Show layer'))}
        aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
      >
        {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
    </li>
  );
}

/** Artwork on the 3D garment that runs across seams: one list for the whole garment, top first. */
function ProjectedLayers() {
  const projections = useStudio((s) => s.document?.projections);
  if (!projections?.orderedLayerIds.length) return null;
  const layers = projectedLayers({ projections });
  return (
    <section className="border-t border-line pt-2" aria-label="Layers across seams">
      <div className="flex items-center justify-between px-4 pb-1">
        <h3 className="panel-title">Across seams</h3>
        <span className="text-xs text-fg-2">3D · sublimation</span>
      </div>
      <ul className="space-y-0.5 px-2 pb-3" aria-label="Layers across seams, top first">
        {[...layers].reverse().map((layer) => (
          <ProjectedRow key={layer.id} layer={layer} index={projections.orderedLayerIds.indexOf(layer.id)} count={layers.length} />
        ))}
      </ul>
    </section>
  );
}

function LayerRow({ layer, index, count, groupEdge, clippedTo }: { layer: ArtworkLayer; index: number; count: number; groupEdge: 'top' | 'middle' | 'bottom' | 'single' | null; clippedTo?: string }) {
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
      className={`group flex min-h-11 items-center gap-1 rounded-lg pr-1 ${clippedTo ? 'pl-3' : 'pl-2'} ${bracket} ${selected ? 'bg-selected' : 'hover:bg-hover'} ${layer.visible ? '' : 'opacity-55'}`}
    >
      {clippedTo && (
        <span title={`Clipped to ${clippedTo}: shows only inside it`} className="flex">
          <CornerLeftDown size={13} className="text-accent" aria-hidden />
          <span className="sr-only">Clipped to {clippedTo}.</span>
        </span>
      )}
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
      <div className="hover-reveal flex items-center">
        <button className="icon-btn h-8 w-8" disabled={index === count - 1} onClick={() => dispatch(cmd.moveLayerBy(zoneId, layer.id, 1))} aria-label={`Move ${layer.name} up`} title="Bring forward (])">
          <ArrowUp size={14} />
        </button>
        <button className="icon-btn h-8 w-8" disabled={index === 0} onClick={() => dispatch(cmd.moveLayerBy(zoneId, layer.id, -1))} aria-label={`Move ${layer.name} down`} title="Send backward ([)">
          <ArrowDown size={14} />
        </button>
        {index > 0 && (
          <button
            className="icon-btn h-8 w-8"
            onClick={() => dispatch(cmd.updateLayer(zoneId, layer.id, { clip: !layer.clip }, layer.clip ? 'Release clipping' : 'Clip to layer below'))}
            aria-label={layer.clip ? `Release ${layer.name} from the layer below` : `Clip ${layer.name} to the layer below`}
            aria-pressed={!!layer.clip}
            title={layer.clip ? 'Release clipping (Ctrl+Alt+G)' : 'Clip to the layer below: show it only inside that layer (Ctrl+Alt+G)'}
          >
            <CornerLeftDown size={14} className={layer.clip ? 'text-accent' : ''} />
          </button>
        )}
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
  const zone = useActiveArtboard();
  const spec = useActiveZoneSpec();
  if (!zone) return null;
  const layers = zone.orderedLayerIds.map((id) => zone.layers[id]).filter(Boolean);
  const bases = clipBases(zone);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <h2 className="panel-title">Layers</h2>
        <span className="text-xs text-fg-2">{spec.label}</span>
      </div>
      {layers.length === 0 ? (
        <div className="mx-3 mb-3 rounded-xl border border-dashed border-line p-4 text-sm">
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
            return <LayerRow key={layer.id} layer={layer} index={zone.orderedLayerIds.indexOf(layer.id)} count={layers.length} groupEdge={edge} clippedTo={bases[layer.id] ? zone.layers[bases[layer.id]]?.name : undefined} />;
          })}
        </ul>
      )}
      <ProjectedLayers />
    </div>
  );
}
