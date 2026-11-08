'use client';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  Italic,
  Link2,
  Link2Off,
  Loader2,
  RotateCcw,
  Trash2,
  Ungroup,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { selectionUnits, type AlignMode } from '@/domain/arrange';
import * as cmd from '@/domain/commands';
import { checkLayer, DEFAULT_PREFLIGHT, effectiveDpi } from '@/domain/preflight';
import type { ArtworkLayer, LayerTransform, ShapeContent, TextContent } from '@/domain/schema';
import { AssetError, getLoadedImage, importImageFile, loadAssetImage } from '@/lib/assets';
import { ARTWORK_FONTS, fontWeights, nearestWeight } from '@/lib/fonts';
import { removeBackground } from '@/lib/image-ops';
import { getAsset } from '@/lib/local-db';
import { usePreference } from '@/lib/preferences';
import { isCurved, textAspect } from '@/lib/render/zone-renderer';
import { ColorField, NumberField, toast } from '@/components/ui/primitives';
import { useActiveZoneSpec, useStudio } from '@/stores/studio-store';
import { alignSelection, deleteSelection, distributeSelection, duplicateSelection, groupSelection, ungroupSelection } from './actions';
import { useBrandKit } from './brand-context';
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

const ALIGN_BUTTONS: [AlignMode, typeof AlignCenter, string][] = [
  ['left', AlignStartVertical, 'Align left'],
  ['hcenter', AlignCenterVertical, 'Centre horizontally'],
  ['right', AlignEndVertical, 'Align right'],
  ['top', AlignStartHorizontal, 'Align top'],
  ['vcenter', AlignCenterHorizontal, 'Centre vertically'],
  ['bottom', AlignEndHorizontal, 'Align bottom'],
];

function AlignBar({ toPrintArea }: { toPrintArea: boolean }) {
  return (
    <div>
      <div className="flex justify-between rounded-lg border border-line p-0.5" role="group" aria-label={toPrintArea ? 'Align to print area' : 'Align selected layers'}>
        {ALIGN_BUTTONS.map(([mode, Icon, label]) => (
          <button key={mode} className="icon-btn h-8 w-8" onClick={() => alignSelection(mode)} aria-label={label} title={label}>
            <Icon size={15} />
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-fg-3">{toPrintArea ? 'Aligns to the print area.' : 'Aligns the layers to each other.'}</p>
    </div>
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
  // Arrow-key stepping in a field repeats quickly; those repeats share one undo step.
  const set = (patch: Partial<LayerTransform>, label: string) =>
    dispatch(cmd.coalescing(cmd.updateTransforms(zoneId, { [layer.id]: patch }, label), `${label}:${Object.keys(patch).join()}:${layer.id}`));
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
      <AlignBar toPrintArea />
    </Section>
  );
}

function TextSection({ layer, content }: { layer: ArtworkLayer; content: TextContent }) {
  const zoneId = useStudio((s) => s.activeZoneId);
  const dispatch = useStudio((s) => s.dispatch);
  const kit = useBrandKit();
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

  /**
   * Text changes keep the cap height and let the width follow, like a design tool.
   * Curving keeps the width and lets the height follow the arc.
   */
  const update = (patch: Partial<TextContent>, label: string, gesture?: string) => {
    const next = { ...content, ...patch };
    const affectsShape = ['value', 'fontFamily', 'fontWeight', 'italic', 'letterSpacingEm', 'lineHeight', 'curveDeg'].some((key) => key in patch);
    const aspect = textAspect(next);
    const curveChange = 'curveDeg' in patch || (isCurved(next) !== isCurved(content));
    const transform = !affectsShape
      ? undefined
      : curveChange
        ? { heightMm: layer.transform.widthMm / aspect }
        : { widthMm: layer.transform.heightMm * aspect };
    const name = patch.value !== undefined ? patch.value.split('\n')[0].slice(0, 40) || 'Text' : undefined;
    const command = cmd.updateLayer(zoneId, layer.id, { content: patch, transform, name }, label);
    dispatch(gesture ? cmd.coalescing(command, `${gesture}:${layer.id}`) : command);
  };
  const commitText = () => draft !== content.value && update({ value: draft }, 'Edit text');
  const multiline = content.value.includes('\n');
  const brandFonts = (kit?.fonts ?? []).filter((f) => ARTWORK_FONTS.some((a) => a.family === f));

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
          {brandFonts.length ? (
            <optgroup label={`${kit?.name ?? 'Brand'} fonts`}>
              {brandFonts.map((f) => (
                <option key={`brand-${f}`} value={f}>
                  {f}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="All fonts">
            {ARTWORK_FONTS.map((f) => (
              <option key={f.family} value={f.family}>
                {f.family}
                {f.note ? ` (${f.note})` : ''}
              </option>
            ))}
          </optgroup>
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
      <ColorField label="Colour" value={content.fill} onChange={(fill) => update({ fill }, 'Text colour')} swatches={kit?.colors} />
      <div className="grid grid-cols-[52px_1fr] items-center gap-2">
        <span className="label">Align</span>
        <div className="seg w-fit" role="group" aria-label="Text alignment">
          {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => (
            <button key={a} aria-pressed={content.align === a} onClick={() => update({ align: a }, 'Align text')} aria-label={`Align ${a}`} disabled={isCurved(content)}>
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[52px_1fr] items-center gap-2">
        <label htmlFor={`curve-${layer.id}`} className="label">
          Curve
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`curve-${layer.id}`}
            type="range"
            min={-180}
            max={180}
            step={5}
            disabled={multiline}
            value={multiline ? 0 : content.curveDeg}
            onChange={(e) => update({ curveDeg: Number(e.target.value) }, 'Curve text', 'curve')}
            className="min-w-0 flex-1 accent-[var(--accent)]"
            aria-valuetext={`${content.curveDeg} degrees`}
          />
          <span className="num w-10 text-right text-xs text-fg-2">{multiline ? 'n/a' : `${content.curveDeg}°`}</span>
        </div>
      </div>
      {multiline ? <p className="text-xs text-fg-3">Curves work on single-line text.</p> : null}
      <NumberField label="Spacing" suffix="em" decimals={2} step={0.01} min={-0.2} max={1} value={content.letterSpacingEm} onCommit={(v) => update({ letterSpacingEm: v }, 'Letter spacing')} />
      {multiline ? (
        <NumberField label="Leading" decimals={2} step={0.05} min={0.6} max={3} value={content.lineHeight} onCommit={(v) => update({ lineHeight: v }, 'Line height')} />
      ) : null}
      <ColorField label="Outline" value={content.strokeColor ?? '#FFFFFF'} onChange={(strokeColor) => update({ strokeColor, strokeWidthMm: content.strokeWidthMm || 1 }, 'Outline colour')} swatches={kit?.colors} />
      <NumberField label="Outline" suffix="mm" decimals={1} step={0.5} min={0} max={20} value={content.strokeWidthMm ?? 0} onCommit={(v) => update({ strokeWidthMm: v, strokeColor: content.strokeColor ?? '#FFFFFF' }, 'Outline width')} />
    </Section>
  );
}

function ShapeSection({ layer, content }: { layer: ArtworkLayer; content: ShapeContent }) {
  const zoneId = useStudio((s) => s.activeZoneId);
  const dispatch = useStudio((s) => s.dispatch);
  const kit = useBrandKit();
  const update = (patch: Partial<ShapeContent>, label: string) => dispatch(cmd.updateLayer(zoneId, layer.id, { content: patch }, label));
  return (
    <Section title="Shape">
      <ColorField label="Fill" value={content.fill} onChange={(fill) => update({ fill }, 'Shape colour')} swatches={kit?.colors} />
      {content.shape === 'rect' ? (
        <NumberField label="Corners" suffix="mm" decimals={1} min={0} max={500} value={content.cornerRadiusMm} onCommit={(v) => update({ cornerRadiusMm: v }, 'Corner radius')} />
      ) : null}
      <ColorField label="Outline" value={content.strokeColor ?? '#000000'} onChange={(strokeColor) => update({ strokeColor, strokeWidthMm: content.strokeWidthMm || 1 }, 'Outline colour')} swatches={kit?.colors} />
      <NumberField label="Outline" suffix="mm" decimals={1} step={0.5} min={0} max={50} value={content.strokeWidthMm ?? 0} onCommit={(v) => update({ strokeWidthMm: v, strokeColor: content.strokeColor ?? '#000000' }, 'Outline width')} />
    </Section>
  );
}

function BackgroundRemoval({ layer }: { layer: ArtworkLayer }) {
  const zoneId = useStudio((s) => s.activeZoneId);
  const dispatch = useStudio((s) => s.dispatch);
  const [open, setOpen] = useState(false);
  const [tolerance, setTolerance] = useState(40);
  const [everywhere, setEverywhere] = useState(false);
  const [busy, setBusy] = useState(false);
  if (layer.content.kind !== 'image' || layer.content.mime === 'image/svg+xml') return null;
  const content = layer.content;

  const apply = async () => {
    setBusy(true);
    try {
      // Always work from the untouched original, so repeated attempts don't degrade the image.
      const sourceId = content.originalAssetId ?? content.assetId;
      const img = await loadAssetImage(sourceId);
      const original = await getAsset(sourceId);
      const result = await removeBackground(img, { tolerance, mode: everywhere ? 'everywhere' : 'edges' });
      if (result.removed < 0.001) {
        toast(`Nothing matched the background colour ${result.background}. Raise the tolerance and try again.`);
        return;
      }
      const base = (original?.name ?? layer.name).replace(/\.[a-z0-9]+$/i, '');
      const asset = await importImageFile(new File([result.blob], `${base} (no background).png`, { type: 'image/png' }));
      await loadAssetImage(asset.id);
      dispatch(cmd.updateLayer(zoneId, layer.id, { content: { assetId: asset.id, mime: 'image/png', originalAssetId: sourceId } }, 'Remove background'));
      toast(`Removed ${Math.round(result.removed * 100)}% of the image (${result.background}). The original is kept.`, 'success');
      setOpen(false);
    } catch (error) {
      toast(error instanceof AssetError ? error.message : 'The background could not be removed from this image.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!content.originalAssetId) return;
    const original = await getAsset(content.originalAssetId);
    if (!original) return toast('The original image is no longer on this device.', 'error');
    if (!getLoadedImage(original.id)) await loadAssetImage(original.id);
    dispatch(cmd.updateLayer(zoneId, layer.id, { content: { assetId: original.id, mime: original.mime, originalAssetId: undefined } }, 'Restore original image'));
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button className="btn btn-outline flex-1 px-2 text-xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Eraser size={14} /> Remove background
        </button>
        {content.originalAssetId ? (
          <button className="btn btn-outline flex-1 px-2 text-xs" onClick={restore}>
            <RotateCcw size={14} /> Restore original
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-2 rounded-lg border border-line p-3">
          <p className="text-xs text-fg-2">Clears the solid colour around your artwork. It runs on this device and keeps the original.</p>
          <label className="grid grid-cols-[64px_1fr_32px] items-center gap-2 text-xs">
            <span className="text-fg-2">Tolerance</span>
            <input type="range" min={5} max={120} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} className="accent-[var(--accent)]" />
            <span className="num text-right">{tolerance}</span>
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Also clear enclosed areas, like the inside of an O
          </label>
          <button className="btn btn-primary w-full text-xs" onClick={apply} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />} Apply
          </button>
        </div>
      ) : null}
    </div>
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
      <BackgroundRemoval layer={layer} />
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

function MultiSelection({ count, layers }: { count: number; layers: ArtworkLayer[] }) {
  const zone = useStudio((s) => s.document?.zones[s.activeZoneId]);
  const ids = layers.map((l) => l.id);
  const units = zone ? selectionUnits(zone, ids) : [];
  const groupIds = new Set(layers.map((l) => l.groupId).filter(Boolean));
  const isOneGroup = groupIds.size === 1 && layers.every((l) => l.groupId);
  return (
    <div>
      <Section title={isOneGroup ? `Group of ${count} layers` : `${count} layers selected`}>
        <AlignBar toPrintArea={units.length === 1} />
        <div className="flex gap-2">
          <button className="btn btn-outline flex-1 px-2 text-xs" disabled={units.length < 3} onClick={() => distributeSelection('horizontal')} title="Equal horizontal gaps (3 or more)">
            <AlignHorizontalDistributeCenter size={14} /> Space across
          </button>
          <button className="btn btn-outline flex-1 px-2 text-xs" disabled={units.length < 3} onClick={() => distributeSelection('vertical')} title="Equal vertical gaps (3 or more)">
            <AlignVerticalDistributeCenter size={14} /> Space down
          </button>
        </div>
        <div className="flex gap-2">
          {isOneGroup ? (
            <button className="btn btn-outline flex-1" onClick={ungroupSelection} title="Ungroup (Ctrl+Shift+G)">
              <Ungroup size={14} /> Ungroup
            </button>
          ) : (
            <button className="btn btn-outline flex-1" onClick={groupSelection} title="Group (Ctrl+G)">
              <Group size={14} /> Group
            </button>
          )}
          <button className="btn btn-outline flex-1" onClick={duplicateSelection}>
            <Copy size={14} /> Duplicate
          </button>
          <button className="btn btn-outline flex-none px-3 text-danger" onClick={deleteSelection} aria-label="Delete selected layers">
            <Trash2 size={14} />
          </button>
        </div>
      </Section>
    </div>
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
  if (layers.length > 1) return <MultiSelection count={layers.length} layers={layers} />;

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
          <button className="btn btn-outline flex-1 px-2 text-xs" disabled={index === zone.orderedLayerIds.length - 1} onClick={() => dispatch(cmd.reorderLayer(zone.zoneId, layer.id, zone.orderedLayerIds.length))}>
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
