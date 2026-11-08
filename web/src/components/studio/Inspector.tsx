'use client';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  Link2,
  Link2Off,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as cmd from '@/domain/commands';
import { effectiveDpi, checkLayer, DEFAULT_PREFLIGHT } from '@/domain/preflight';
import type { ArtworkLayer, LayerTransform, ShapeContent, TextContent } from '@/domain/schema';
import { ARTWORK_FONTS, fontWeights, nearestWeight } from '@/lib/fonts';
import { usePreference } from '@/lib/preferences';
import { textAspect } from '@/lib/render/zone-renderer';
import { ColorField, NumberField } from '@/components/ui/primitives';
import { useActiveZoneSpec, useStudio } from '@/stores/studio-store';
import { alignSelection, deleteSelection, duplicateSelection } from './actions';
import { GarmentPanel } from './GarmentPanel';
import { IssueItem } from './PreflightPanel';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-4 first:border-t-0">
      <h3 className="panel-title mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function TransformSection({ layer }: { layer: ArtworkLayer }) {
  const zoneId = useStudio((s) => s.activeZoneId);
  const dispatch = useStudio((s) => s.dispatch);
  const units = usePreference('units');
  const [linked, setLinked] = useState(true);
  const k = units === 'in' ? 1 / 25.4 : 1;
  const decimals = units === 'in' ? 2 : 1;
  const t = layer.transform;
  const set = (patch: Partial<LayerTransform>, label: string) => dispatch(cmd.updateTransforms(zoneId, { [layer.id]: patch }, label));
  const setSize = (dim: 'widthMm' | 'heightMm', mm: number) => {
    if (!linked) return set({ [dim]: mm }, 'Resize');
    const ratio = t.widthMm / t.heightMm;
    set(dim === 'widthMm' ? { widthMm: mm, heightMm: mm / ratio } : { heightMm: mm, widthMm: mm * ratio }, 'Resize');
  };
  return (
    <Section title="Position and size">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <NumberField compact label="X" suffix={units} decimals={decimals} value={t.centerXmm * k} step={k} onCommit={(v) => set({ centerXmm: v / k }, 'Move')} />
        <NumberField compact label="Y" suffix={units} decimals={decimals} value={t.centerYmm * k} step={k} onCommit={(v) => set({ centerYmm: v / k }, 'Move')} />
        <NumberField compact label="W" suffix={units} decimals={decimals} value={t.widthMm * k} min={0.5 * k} step={k} onCommit={(v) => setSize('widthMm', v / k)} />
        <NumberField compact label="H" suffix={units} decimals={decimals} value={t.heightMm * k} min={0.5 * k} step={k} onCommit={(v) => setSize('heightMm', v / k)} />
        <NumberField compact label="∠" suffix="°" decimals={0} value={t.rotationDeg} min={-360} max={360} onCommit={(v) => set({ rotationDeg: v }, 'Rotate')} />
        <div className="flex items-center justify-end gap-0.5">
          <button className="icon-btn" aria-pressed={linked} onClick={() => setLinked((l) => !l)} aria-label={linked ? 'Unlink width and height' : 'Link width and height'} title="Keep proportions">
            {linked ? <Link2 size={15} /> : <Link2Off size={15} />}
          </button>
          <button className="icon-btn" aria-pressed={t.flipX} onClick={() => set({ flipX: !t.flipX }, 'Flip')} aria-label="Flip horizontally" title="Flip horizontally">
            <FlipHorizontal2 size={15} />
          </button>
          <button className="icon-btn" aria-pressed={t.flipY} onClick={() => set({ flipY: !t.flipY }, 'Flip')} aria-label="Flip vertically" title="Flip vertically">
            <FlipVertical2 size={15} />
          </button>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button className="btn btn-outline flex-1 px-2 text-xs" onClick={() => alignSelection('x')}>
          <AlignCenterVertical size={14} /> Centre across
        </button>
        <button className="btn btn-outline flex-1 px-2 text-xs" onClick={() => alignSelection('y')}>
          <AlignCenterHorizontal size={14} /> Centre down
        </button>
      </div>
    </Section>
  );
}

function TextSection({ layer, content }: { layer: ArtworkLayer; content: TextContent }) {
  const zoneId = useStudio((s) => s.activeZoneId);
  const dispatch = useStudio((s) => s.dispatch);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(content.value);
  const [synced, setSynced] = useState(content.value);
  if (synced !== content.value) {
    setSynced(content.value);
    setDraft(content.value);
  }
  useEffect(() => {
    const onEdit = (e: Event) => {
      if ((e as CustomEvent).detail?.layerId === layer.id) {
        textRef.current?.focus();
        textRef.current?.select();
      }
    };
    window.addEventListener('wovexa:edit-layer', onEdit);
    return () => window.removeEventListener('wovexa:edit-layer', onEdit);
  }, [layer.id]);

  /** Text changes keep the cap height and let the width follow, like a design tool. */
  const update = (patch: Partial<TextContent>, label: string) => {
    const next = { ...content, ...patch };
    const affectsShape = ['value', 'fontFamily', 'fontWeight', 'italic', 'letterSpacingEm', 'lineHeight'].some((k) => k in patch);
    const transform = affectsShape ? { widthMm: layer.transform.heightMm * textAspect(next) } : undefined;
    const name = patch.value !== undefined ? patch.value.split('\n')[0].slice(0, 40) || 'Text' : undefined;
    dispatch(cmd.updateLayer(zoneId, layer.id, { content: patch, transform, name }, label));
  };
  const commitText = () => draft !== content.value && update({ value: draft }, 'Edit text');

  return (
    <Section title="Text">
      <textarea
        ref={textRef}
        className="field min-h-[68px] py-2 text-sm"
        value={draft}
        aria-label="Text content"
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commitText();
          }
        }}
      />
      <p className="text-xs text-fg-3">Enter to apply, Shift+Enter for a new line.</p>
      <label className="grid grid-cols-[52px_1fr] items-center gap-2">
        <span className="label">Font</span>
        <select
          className="field"
          value={content.fontFamily}
          onChange={(e) => update({ fontFamily: e.target.value, fontWeight: nearestWeight(e.target.value, content.fontWeight) }, 'Change font')}
          style={{ fontFamily: content.fontFamily }}
        >
          {ARTWORK_FONTS.map((f) => (
            <option key={f.family} value={f.family}>
              {f.family}
              {f.note ? ` (${f.note})` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="grid grid-cols-[52px_1fr] items-center gap-2">
        <span className="label">Weight</span>
        <div className="flex gap-2">
          <select className="field" value={content.fontWeight} onChange={(e) => update({ fontWeight: Number(e.target.value) }, 'Change weight')}>
            {fontWeights(content.fontFamily).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <button className="icon-btn border border-line" aria-pressed={content.italic} onClick={() => update({ italic: !content.italic }, 'Italic')} aria-label="Italic">
            <Italic size={15} />
          </button>
        </div>
      </label>
      <ColorField label="Colour" value={content.fill} onChange={(fill) => update({ fill }, 'Text colour')} />
      <div className="grid grid-cols-[52px_1fr] items-center gap-2">
        <span className="label">Align</span>
        <div className="seg w-fit" role="group" aria-label="Text alignment">
          {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => (
            <button key={a} aria-pressed={content.align === a} onClick={() => update({ align: a }, 'Align text')} aria-label={`Align ${a}`}>
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>
      <NumberField label="Spacing" suffix="em" decimals={2} step={0.01} min={-0.2} max={1} value={content.letterSpacingEm} onCommit={(v) => update({ letterSpacingEm: v }, 'Letter spacing')} />
      {content.value.includes('\n') ? (
        <NumberField label="Leading" decimals={2} step={0.05} min={0.6} max={3} value={content.lineHeight} onCommit={(v) => update({ lineHeight: v }, 'Line height')} />
      ) : null}
      <ColorField label="Outline" value={content.strokeColor ?? '#FFFFFF'} onChange={(strokeColor) => update({ strokeColor, strokeWidthMm: content.strokeWidthMm || 1 }, 'Outline colour')} />
      <NumberField label="Outline" suffix="mm" decimals={1} step={0.5} min={0} max={20} value={content.strokeWidthMm ?? 0} onCommit={(v) => update({ strokeWidthMm: v, strokeColor: content.strokeColor ?? '#FFFFFF' }, 'Outline width')} />
    </Section>
  );
}

function ShapeSection({ layer, content }: { layer: ArtworkLayer; content: ShapeContent }) {
  const zoneId = useStudio((s) => s.activeZoneId);
  const dispatch = useStudio((s) => s.dispatch);
  const update = (patch: Partial<ShapeContent>, label: string) => dispatch(cmd.updateLayer(zoneId, layer.id, { content: patch }, label));
  return (
    <Section title="Shape">
      <ColorField label="Fill" value={content.fill} onChange={(fill) => update({ fill }, 'Shape colour')} />
      {content.shape === 'rect' ? (
        <NumberField label="Corners" suffix="mm" decimals={1} min={0} max={500} value={content.cornerRadiusMm} onCommit={(v) => update({ cornerRadiusMm: v }, 'Corner radius')} />
      ) : null}
      <ColorField label="Outline" value={content.strokeColor ?? '#000000'} onChange={(strokeColor) => update({ strokeColor, strokeWidthMm: content.strokeWidthMm || 1 }, 'Outline colour')} />
      <NumberField label="Outline" suffix="mm" decimals={1} step={0.5} min={0} max={50} value={content.strokeWidthMm ?? 0} onCommit={(v) => update({ strokeWidthMm: v, strokeColor: content.strokeColor ?? '#000000' }, 'Outline width')} />
    </Section>
  );
}

function ImageSection({ layer }: { layer: ArtworkLayer }) {
  const zoneId = useStudio((s) => s.activeZoneId);
  const dispatch = useStudio((s) => s.dispatch);
  if (layer.content.kind !== 'image') return null;
  const dpi = effectiveDpi(layer);
  const c = layer.content;
  const at300 = { widthMm: (c.naturalWidthPx / 300) * 25.4, heightMm: (c.naturalHeightPx / 300) * 25.4 };
  return (
    <Section title="Image">
      <dl className="grid grid-cols-2 gap-y-1 text-[13px]">
        <dt className="text-fg-2">Source</dt>
        <dd className="num text-right">
          {c.naturalWidthPx} × {c.naturalHeightPx} px
        </dd>
        <dt className="text-fg-2">Prints at</dt>
        <dd className="num text-right font-semibold">{dpi ? `${Math.round(dpi.min)} dpi` : 'Vector, any size'}</dd>
      </dl>
      {dpi ? (
        <button className="btn btn-outline w-full text-xs" onClick={() => dispatch(cmd.updateTransforms(zoneId, { [layer.id]: at300 }, 'Size for 300 dpi'))}>
          Size for 300 dpi ({Math.round(at300.widthMm)} mm wide)
        </button>
      ) : null}
    </Section>
  );
}

function AppearanceSection({ layer }: { layer: ArtworkLayer }) {
  const zoneId = useStudio((s) => s.activeZoneId);
  const dispatch = useStudio((s) => s.dispatch);
  return (
    <Section title="Appearance">
      <NumberField
        label="Opacity"
        suffix="%"
        decimals={0}
        min={0}
        max={100}
        value={layer.style.opacity * 100}
        onCommit={(v) => dispatch(cmd.updateLayer(zoneId, layer.id, { style: { opacity: v / 100 } }, 'Opacity'))}
      />
      <label className="grid grid-cols-[52px_1fr] items-center gap-2">
        <span className="label">Blend</span>
        <select
          className="field"
          value={layer.style.blendMode}
          onChange={(e) => dispatch(cmd.updateLayer(zoneId, layer.id, { style: { blendMode: e.target.value as ArtworkLayer['style']['blendMode'] } }, 'Blend mode'))}
        >
          <option value="normal">Normal</option>
          <option value="multiply">Multiply</option>
          <option value="screen">Screen</option>
          <option value="overlay">Overlay</option>
        </select>
      </label>
    </Section>
  );
}

export function Inspector() {
  const zone = useStudio((s) => s.document?.zones[s.activeZoneId]);
  const selectedIds = useStudio((s) => s.selectedLayerIds);
  const dispatch = useStudio((s) => s.dispatch);
  const spec = useActiveZoneSpec();
  const layers = useMemo(() => (zone ? selectedIds.map((id) => zone.layers[id]).filter(Boolean) : []), [zone, selectedIds]);

  if (!zone) return null;
  if (layers.length === 0) return <GarmentPanel />;

  if (layers.length > 1) {
    return (
      <div>
        <Section title={`${layers.length} layers selected`}>
          <div className="flex gap-2">
            <button className="btn btn-outline flex-1 px-2 text-xs" onClick={() => alignSelection('x')}>
              <AlignCenterVertical size={14} /> Centre across
            </button>
            <button className="btn btn-outline flex-1 px-2 text-xs" onClick={() => alignSelection('y')}>
              <AlignCenterHorizontal size={14} /> Centre down
            </button>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-outline flex-1" onClick={duplicateSelection}>
              <Copy size={14} /> Duplicate
            </button>
            <button className="btn btn-outline flex-1 text-danger" onClick={deleteSelection}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </Section>
      </div>
    );
  }

  const layer = layers[0];
  const issues = checkLayer(layer, spec, zone.printMethod, DEFAULT_PREFLIGHT);
  const index = zone.orderedLayerIds.indexOf(layer.id);

  return (
    <div>
      <div className="flex items-center gap-2 px-4 pb-1 pt-3">
        <input
          key={`${layer.id}:${layer.name}`}
          className="field h-9 flex-1 font-semibold"
          defaultValue={layer.name}
          aria-label="Layer name"
          onBlur={(e) => e.target.value.trim() && e.target.value !== layer.name && dispatch(cmd.updateLayer(zone.zoneId, layer.id, { name: e.target.value.trim() }, 'Rename layer'))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button className="icon-btn" onClick={duplicateSelection} aria-label="Duplicate layer" title="Duplicate (Ctrl+D)">
          <Copy size={15} />
        </button>
        <button className="icon-btn text-danger" onClick={deleteSelection} aria-label="Delete layer" title="Delete">
          <Trash2 size={15} />
        </button>
      </div>
      {layer.locked ? <p className="px-4 pb-2 text-xs text-fg-2">This layer is locked. Unlock it in the layer list to move it.</p> : null}
      {issues.length ? (
        <div className="mx-2 mb-1">
          {issues.map((i) => (
            <IssueItem key={i.id} issue={i} />
          ))}
        </div>
      ) : null}
      <TransformSection layer={layer} />
      {layer.content.kind === 'text' ? <TextSection key={layer.id} layer={layer} content={layer.content} /> : null}
      {layer.content.kind === 'shape' ? <ShapeSection layer={layer} content={layer.content} /> : null}
      {layer.content.kind === 'image' ? <ImageSection layer={layer} /> : null}
      <AppearanceSection layer={layer} />
      <Section title="Arrange">
        <div className="flex gap-2">
          <button className="btn btn-outline flex-1 px-2 text-xs" disabled={index === zone.orderedLayerIds.length - 1} onClick={() => dispatch(cmd.reorderLayer(zone.zoneId, layer.id, zone.orderedLayerIds.length - 1))}>
            <ArrowUpToLine size={14} /> To front
          </button>
          <button className="btn btn-outline flex-1 px-2 text-xs" disabled={index === 0} onClick={() => dispatch(cmd.reorderLayer(zone.zoneId, layer.id, 0))}>
            <ArrowDownToLine size={14} /> To back
          </button>
        </div>
      </Section>
    </div>
  );
}
