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
  Dices,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  Frame,
  Group,
  Italic,
  Link2,
  Link2Off,
  Loader2,
  Maximize2,
  Move,
  RotateCcw,
  Shirt,
  Trash2,
  Ungroup,
} from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { selectionUnits, type AlignMode } from '@/domain/arrange';
import * as cmd from '@/domain/commands';
import { checkLayer, checkProjectedLayer, DEFAULT_PREFLIGHT, effectiveDpi } from '@/domain/preflight';
import { projectedAsArtwork } from '@/domain/projected';
import { isAreaId, type ArtworkLayer, type DesignArea, type ImageAdjust, type ImageContent, type ImageRepeat, type LayerStyle, type LayerTransform, type ProjectedLayer, type ProjectedTransform, type ShapeContent, type TextContent } from '@/domain/schema';
import { AssetError, getLoadedImage, importImageFile, loadAssetImage } from '@/lib/assets';
import { ARTWORK_FONTS, fontWeights, loadFontStylesheets } from '@/lib/fonts';
import { extractPalette, removeBackground, type PaletteColour } from '@/lib/image-ops';
import { getAsset } from '@/lib/local-db';
import { usePreference } from '@/lib/preferences';
import { DEFAULT_REPEAT, effectiveDistress, isCurved, isNeutralAdjust, isWarped, NEUTRAL_ADJUST, textAspect } from '@/lib/render/zone-renderer';
import { ColorField, NumberField, toast } from '@/components/ui/primitives';
import { useActiveArtboard, useActiveZoneSpec, useStudio } from '@/stores/studio-store';
import { alignSelection, deleteSelection, distributeSelection, duplicateSelection, groupSelection, placementsFor, placeSelection, ungroupSelection } from './actions';
import { useBrandKit } from './brand-context';
import { FontPicker } from './FontPicker';
import { AreaPanel } from './AreaPanel';
import { GarmentPanel } from './GarmentPanel';
import { FillControls, RangeField } from './inspector-controls';
import { IssueItem } from './PreflightPanel';
import { deleteProjection, duplicateProjection, returnProjectionToZone, showOnGarment, wrapSelectionAcrossSeams } from './projection-actions';

const nearestOf = (weights: number[], weight: number) => weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0]);

/** Whether the inspected layer sits on a print zone (the default) or on the garment across seams. */
const OnGarmentContext = createContext(false);

/** The command that edits the inspected layer, wherever it lives. */
function useLayerEdit() {
  const zoneId = useStudio((s) => s.activeZoneId);
  const onGarment = useContext(OnGarmentContext);
  return (layerId: string, patch: cmd.LayerPatch, label: string) => (onGarment ? cmd.updateProjectedLayer(layerId, patch, label) : cmd.updateLayer(zoneId, layerId, patch, label));
}

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

/** Standard placements for the zone (left chest, full front, below collar…), keeping proportions. */
function PlacementBar() {
  const spec = useActiveZoneSpec();
  const placements = placementsFor(spec);
  return (
    <div>
      <span className="label">Place</span>
      <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Standard placements">
        {placements.map((p) => (
          <button key={p.id} className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-fg-2 hover:border-line-strong hover:text-fg" onClick={() => placeSelection(p)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

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
      <PlacementBar />
    </Section>
  );
}

/** One-tap looks for type: font, spacing, outline, shadow and path together. */
const TEXT_STYLES: { id: string; label: string; font: string; apply: (c: TextContent, multiline: boolean) => Partial<TextContent> }[] = [
  {
    id: 'varsity',
    label: 'Varsity',
    font: 'Graduate',
    apply: (c) => {
      const dark = parseInt(c.fill.slice(1, 3), 16) * 0.3 + parseInt(c.fill.slice(3, 5), 16) * 0.59 + parseInt(c.fill.slice(5, 7), 16) * 0.11 < 128;
      return { fontFamily: 'Graduate', fontAssetId: undefined, fontWeight: 400, italic: false, letterSpacingEm: 0.04, strokeColor: dark ? '#FFFFFF' : '#111111', strokeWidthMm: 1.4, shadow: { color: dark ? '#C8102E' : '#0B1F4B', offsetXmm: 1.6, offsetYmm: 1.6, blurMm: 0 } };
    },
  },
  { id: 'arch', label: 'College arch', font: 'Graduate', apply: (_, multi) => ({ fontFamily: 'Graduate', fontAssetId: undefined, fontWeight: 400, italic: false, letterSpacingEm: 0.06, curveDeg: multi ? 0 : 38, wave: undefined }) },
  { id: 'athletic', label: 'Athletic', font: 'Bebas Neue', apply: () => ({ fontFamily: 'Bebas Neue', fontAssetId: undefined, fontWeight: 400, italic: false, letterSpacingEm: 0.08, strokeWidthMm: 0, shadow: undefined }) },
  { id: 'retro', label: 'Retro', font: 'Shrikhand', apply: () => ({ fontFamily: 'Shrikhand', fontAssetId: undefined, fontWeight: 400, italic: false, letterSpacingEm: 0, strokeWidthMm: 0, shadow: { color: '#E85D04', offsetXmm: 1.8, offsetYmm: 1.8, blurMm: 0 } }) },
  { id: 'script', label: 'Script', font: 'Pacifico', apply: () => ({ fontFamily: 'Pacifico', fontAssetId: undefined, fontWeight: 400, italic: false, letterSpacingEm: 0, strokeWidthMm: 0, shadow: undefined }) },
  { id: 'stencil', label: 'Stencil', font: 'Black Ops One', apply: () => ({ fontFamily: 'Black Ops One', fontAssetId: undefined, fontWeight: 400, italic: false, letterSpacingEm: 0.03, strokeWidthMm: 0, shadow: undefined }) },
  { id: 'wave', label: 'Wave', font: 'Rubik Mono One', apply: (_, multi) => ({ fontFamily: 'Rubik Mono One', fontAssetId: undefined, fontWeight: 400, italic: false, letterSpacingEm: 0, curveDeg: 0, wave: multi ? undefined : 45 }) },
  { id: 'dojang', label: '태권도', font: 'Black Han Sans', apply: () => ({ fontFamily: 'Black Han Sans', fontAssetId: undefined, fontWeight: 400, italic: false, letterSpacingEm: 0.02, strokeWidthMm: 0, shadow: undefined }) },
  { id: 'khmer', label: 'ខ្មែរ', font: 'Moul', apply: () => ({ fontFamily: 'Moul', fontAssetId: undefined, fontWeight: 400, italic: false, letterSpacingEm: 0, strokeWidthMm: 0, shadow: undefined }) },
];

function TextStyles({ content, onApply }: { content: TextContent; onApply: (patch: Partial<TextContent>, label: string) => void }) {
  useEffect(() => {
    void loadFontStylesheets(TEXT_STYLES.map((s) => s.font));
  }, []);
  const multiline = content.value.includes('\n');
  return (
    <div>
      <span className="label">Style</span>
      <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Text styles">
        {TEXT_STYLES.map((s) => (
          <button
            key={s.id}
            className="rounded-lg border border-line px-2.5 py-1 text-[13px] leading-5 hover:border-line-strong hover:bg-hover"
            style={{ fontFamily: `"${s.font}", var(--font-sans)` }}
            title={`${s.label} style`}
            aria-label={`${s.label} style`}
            onClick={() => onApply(s.apply(content, multiline), `Text style: ${s.label}`)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TextSection({ layer, content }: { layer: ArtworkLayer; content: TextContent }) {
  const edit = useLayerEdit();
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
   * Curving or waving keeps the width and lets the height follow the path.
   */
  const update = (patch: Partial<TextContent>, label: string, gesture?: string) => {
    const next = { ...content, ...patch };
    const affectsShape = ['value', 'fontFamily', 'fontWeight', 'italic', 'letterSpacingEm', 'lineHeight', 'curveDeg', 'wave', 'fontAssetId'].some((key) => key in patch);
    const aspect = textAspect(next);
    const pathChange = 'curveDeg' in patch || 'wave' in patch || isWarped(next) !== isWarped(content);
    const transform = !affectsShape
      ? undefined
      : pathChange
        ? { heightMm: layer.transform.widthMm / aspect }
        : { widthMm: layer.transform.heightMm * aspect };
    const name = patch.value !== undefined ? patch.value.split('\n')[0].slice(0, 40) || 'Text' : undefined;
    const command = edit(layer.id, { content: patch, transform, name }, label);
    dispatch(gesture ? cmd.coalescing(command, `${gesture}:${layer.id}`) : command);
  };
  const commitText = () => draft !== content.value && update({ value: draft }, 'Edit text');
  const multiline = content.value.includes('\n');
  const brandFonts = (kit?.fonts ?? []).filter((f) => ARTWORK_FONTS.some((a) => a.family === f));
  const weights = content.fontAssetId ? [400, 700] : fontWeights(content.fontFamily);
  const shadow = content.shadow;

  return (
    <>
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
      <TextStyles content={content} onApply={(patch, label) => update(patch, label)} />
      <FontPicker
        family={content.fontFamily}
        fontAssetId={content.fontAssetId}
        sample={content.value}
        brandFonts={brandFonts}
        onChange={(f) => update({ fontFamily: f.family, fontAssetId: f.fontAssetId, fontWeight: nearestOf(f.weights, content.fontWeight) }, 'Change font')}
      />
      <label className="grid grid-cols-[52px_1fr] items-center gap-2">
        <span className="label">Weight</span>
        <div className="flex gap-2">
          <select className="field" value={nearestOf(weights, content.fontWeight)} onChange={(e) => update({ fontWeight: Number(e.target.value) }, 'Change weight')}>
            {weights.map((w) => (
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
      <RangeField
        label="Wave"
        value={isCurved(content) || multiline ? 0 : (content.wave ?? 0)}
        min={-100}
        max={100}
        step={5}
        format={(v) => `${v}%`}
        disabled={multiline || isCurved(content)}
        onChange={(v) => update({ wave: v || undefined }, 'Wave text', 'wave')}
      />
      {multiline ? <p className="text-xs text-fg-3">Curve and wave work on single-line text.</p> : isCurved(content) ? <p className="text-xs text-fg-3">Set the curve to 0° to use a wave.</p> : null}
      <NumberField label="Spacing" suffix="em" decimals={2} step={0.01} min={-0.2} max={1} value={content.letterSpacingEm} onCommit={(v) => update({ letterSpacingEm: v }, 'Letter spacing')} />
      {multiline ? (
        <NumberField label="Leading" decimals={2} step={0.05} min={0.6} max={3} value={content.lineHeight} onCommit={(v) => update({ lineHeight: v }, 'Line height')} />
      ) : null}
    </Section>
    <Section title="Fill and effects">
      <FillControls fill={content.fill} fillStyle={content.fillStyle} swatches={kit?.colors} onChange={(patch, label, gesture) => update(patch, label, gesture)} />
      <ColorField label="Outline" value={content.strokeColor ?? '#FFFFFF'} onChange={(strokeColor) => update({ strokeColor, strokeWidthMm: content.strokeWidthMm || 1 }, 'Outline colour')} swatches={kit?.colors} />
      <NumberField label="Outline" suffix="mm" decimals={1} step={0.5} min={0} max={20} value={content.strokeWidthMm ?? 0} onCommit={(v) => update({ strokeWidthMm: v, strokeColor: content.strokeColor ?? '#FFFFFF' }, 'Outline width')} />
      <label className="flex items-center gap-2 pt-1 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--accent)]"
          checked={!!shadow}
          onChange={(e) => update({ shadow: e.target.checked ? { color: '#000000', offsetXmm: 1.5, offsetYmm: 1.5, blurMm: 0 } : undefined }, e.target.checked ? 'Add text shadow' : 'Remove text shadow')}
        />
        Shadow
      </label>
      {shadow ? (
        <>
          <ColorField label="Shadow" value={shadow.color} onChange={(color) => update({ shadow: { ...shadow, color } }, 'Shadow colour')} swatches={kit?.colors} />
          <RangeField label="Across" value={shadow.offsetXmm} min={-20} max={20} step={0.5} format={(v) => `${v} mm`} onChange={(offsetXmm) => update({ shadow: { ...shadow, offsetXmm } }, 'Shadow offset', 'shadow-x')} />
          <RangeField label="Down" value={shadow.offsetYmm} min={-20} max={20} step={0.5} format={(v) => `${v} mm`} onChange={(offsetYmm) => update({ shadow: { ...shadow, offsetYmm } }, 'Shadow offset', 'shadow-y')} />
          <RangeField label="Blur" value={shadow.blurMm} min={0} max={10} step={0.5} format={(v) => `${v} mm`} onChange={(blurMm) => update({ shadow: { ...shadow, blurMm } }, 'Shadow blur', 'shadow-blur')} />
          <p className="text-[11px] text-fg-3">A hard shadow (no blur) is a classic varsity drop; it prints as part of the artwork.</p>
        </>
      ) : null}
    </Section>
    </>
  );
}

function ShapeSection({ layer, content }: { layer: ArtworkLayer; content: ShapeContent }) {
  const edit = useLayerEdit();
  const dispatch = useStudio((s) => s.dispatch);
  const kit = useBrandKit();
  const update = (patch: Partial<ShapeContent>, label: string, gesture?: string) => {
    const command = edit(layer.id, { content: patch }, label);
    dispatch(gesture ? cmd.coalescing(command, `${gesture}:${layer.id}`) : command);
  };
  return (
    <Section title="Shape">
      <FillControls fill={content.fill} fillStyle={content.fillStyle} swatches={kit?.colors} onChange={(patch, label, gesture) => update(patch, label, gesture)} />
      {content.shape === 'rect' || content.shape === 'line' ? (
        <NumberField label="Corners" suffix="mm" decimals={1} min={0} max={500} value={content.cornerRadiusMm} onCommit={(v) => update({ cornerRadiusMm: v }, 'Corner radius')} />
      ) : null}
      {content.shape === 'star' || content.shape === 'polygon' ? (
        <RangeField
          label={content.shape === 'star' ? 'Points' : 'Sides'}
          value={content.points ?? (content.shape === 'star' ? 5 : 6)}
          min={3}
          max={24}
          onChange={(points) => update({ points }, content.shape === 'star' ? 'Star points' : 'Polygon sides', 'points')}
        />
      ) : null}
      {content.shape === 'star' ? (
        <RangeField label="Inner" value={Math.round((content.innerRatio ?? 0.45) * 100)} min={10} max={95} format={(v) => `${v}%`} onChange={(v) => update({ innerRatio: v / 100 }, 'Star depth', 'inner')} />
      ) : null}
      <ColorField label="Outline" value={content.strokeColor ?? '#000000'} onChange={(strokeColor) => update({ strokeColor, strokeWidthMm: content.strokeWidthMm || 1 }, 'Outline colour')} swatches={kit?.colors} />
      <NumberField label="Outline" suffix="mm" decimals={1} step={0.5} min={0} max={50} value={content.strokeWidthMm ?? 0} onCommit={(v) => update({ strokeWidthMm: v, strokeColor: content.strokeColor ?? '#000000' }, 'Outline width')} />
    </Section>
  );
}

function BackgroundRemoval({ layer }: { layer: ArtworkLayer }) {
  const edit = useLayerEdit();
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
      dispatch(edit(layer.id, { content: { assetId: asset.id, mime: 'image/png', originalAssetId: sourceId } }, 'Remove background'));
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
    dispatch(edit(layer.id, { content: { assetId: original.id, mime: original.mime, originalAssetId: undefined } }, 'Restore original image'));
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

/** Crop shapes for photos and logos (badges, patches, profile cut-outs). */
const IMAGE_MASKS: { id: NonNullable<ImageContent['mask']> | 'none'; label: string; icon: string }[] = [
  { id: 'none', label: 'Full', icon: 'M3 3h18v18H3z' },
  { id: 'circle', label: 'Circle', icon: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z' },
  { id: 'rounded', label: 'Rounded', icon: 'M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5z' },
  { id: 'hexagon', label: 'Hexagon', icon: 'M12 2l8.7 5v10L12 22l-8.7-5V7z' },
  { id: 'shield', label: 'Shield', icon: 'M12 2l9 3c0 9-3.5 14-9 17C6.5 19 3 14 3 5z' },
  { id: 'star', label: 'Star', icon: 'M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7.3L12 17.8 5.7 21.5l1.7-7.3L2 9.5l7.1-.6z' },
  { id: 'heart', label: 'Heart', icon: 'M12 21s-9-5.6-9-12a5 5 0 0 1 9-3a5 5 0 0 1 9 3c0 6.4-9 12-9 12z' },
];

function ImageSection({ layer }: { layer: ArtworkLayer }) {
  const edit = useLayerEdit();
  const dispatch = useStudio((s) => s.dispatch);
  if (layer.content.kind !== 'image') return null;
  const dpi = effectiveDpi(layer);
  const c = layer.content;
  const at300 = { widthMm: (c.naturalWidthPx / 300) * 25.4, heightMm: (c.naturalHeightPx / 300) * 25.4 };
  return (
    <>
      <Section title="Image">
        <dl className="grid grid-cols-2 gap-y-1 text-[13px]">
          <dt className="text-fg-2">Source</dt>
          <dd className="num text-right">
            {c.naturalWidthPx} × {c.naturalHeightPx} px
          </dd>
          <dt className="text-fg-2">Prints at</dt>
          <dd className="num text-right font-semibold">{dpi ? `${Math.round(dpi.min)} dpi` : 'Vector, any size'}</dd>
        </dl>
        {dpi && !c.repeat ? (
          <button className="btn btn-outline w-full text-xs" onClick={() => dispatch(edit(layer.id, { transform: at300 }, 'Size for 300 dpi'))}>
            Size for 300 dpi ({Math.round(at300.widthMm)} mm wide)
          </button>
        ) : null}
        {!c.repeat ? (
          <div>
            <span className="label">Shape</span>
            <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Image shape">
              {IMAGE_MASKS.map((m) => (
                <button
                  key={m.id}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs font-medium text-fg-2 hover:border-line-strong hover:text-fg aria-pressed:border-[var(--accent)] aria-pressed:text-fg"
                  aria-pressed={(c.mask ?? 'none') === m.id}
                  onClick={() => dispatch(edit(layer.id, { content: { mask: m.id === 'none' ? undefined : m.id } }, m.id === 'none' ? 'Remove image shape' : `Image shape: ${m.label.toLowerCase()}`))}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden className="flex-none">
                    <path d={m.icon} fill="currentColor" fillRule="evenodd" />
                  </svg>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <BackgroundRemoval layer={layer} />
        <ImagePalette content={c} />
      </Section>
      <ImageAdjustments layer={layer} content={c} />
      <RepeatSection layer={layer} content={c} />
    </>
  );
}

/** Non-destructive adjustments (spec ED2-10, AST-05). The original pixels are never changed. */
function ImageAdjustments({ layer, content }: { layer: ArtworkLayer; content: ImageContent }) {
  const edit = useLayerEdit();
  const dispatch = useStudio((s) => s.dispatch);
  const a = content.adjust ?? NEUTRAL_ADJUST;
  const set = (patch: Partial<ImageAdjust>, label: string, gesture?: string) => {
    const next = { ...a, ...patch };
    const command = edit(layer.id, { content: { adjust: isNeutralAdjust(next) ? undefined : next } }, label);
    dispatch(gesture ? cmd.coalescing(command, `adjust-${gesture}:${layer.id}`) : command);
  };
  return (
    <Section title="Adjust">
      <RangeField label="Bright" value={a.brightness} min={0} max={200} format={(v) => `${v}%`} onChange={(v) => set({ brightness: v }, 'Brightness', 'brightness')} />
      <RangeField label="Contrast" value={a.contrast} min={0} max={200} format={(v) => `${v}%`} onChange={(v) => set({ contrast: v }, 'Contrast', 'contrast')} />
      <RangeField label="Saturate" value={a.saturation} min={0} max={200} format={(v) => `${v}%`} onChange={(v) => set({ saturation: v }, 'Saturation', 'saturation')} disabled={a.grayscale} />
      <RangeField label="Hue" value={a.hue} min={-180} max={180} step={5} format={(v) => `${v}°`} onChange={(v) => set({ hue: v }, 'Hue', 'hue')} />
      <RangeField label="1-colour" value={a.threshold ?? 0} min={0} max={255} format={(v) => (v ? String(v) : 'Off')} onChange={(v) => set({ threshold: v || undefined }, 'One-colour threshold', 'threshold')} />
      <div className="flex flex-wrap items-center gap-3 pt-1 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={a.grayscale} onChange={(e) => set({ grayscale: e.target.checked }, 'Greyscale')} />
          Greyscale
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={a.invert} onChange={(e) => set({ invert: e.target.checked }, 'Invert')} />
          Invert
        </label>
        {content.adjust ? (
          <button className="btn btn-ghost ml-auto min-h-8 px-2 text-xs" onClick={() => dispatch(edit(layer.id, { content: { adjust: undefined } }, 'Reset adjustments'))}>
            <RotateCcw size={13} /> Reset
          </button>
        ) : null}
      </div>
      {a.threshold ? <p className="text-[11px] text-fg-3">One-colour turns the image into solid black and white, ready for a single screen. Remove the white with background removal.</p> : null}
    </Section>
  );
}

const REPEAT_MODES: { id: ImageRepeat['mode']; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'half-drop', label: 'Half-drop' },
  { id: 'brick', label: 'Brick' },
  { id: 'mirror', label: 'Mirror' },
];

/** Repeat pattern (spec ED2-11, TYP-05): tile the image across the layer box, clipped to it. */
function RepeatSection({ layer, content }: { layer: ArtworkLayer; content: ImageContent }) {
  const zoneId = useStudio((s) => s.activeZoneId);
  const onGarment = useContext(OnGarmentContext);
  const edit = useLayerEdit();
  const dispatch = useStudio((s) => s.dispatch);
  const spec = useActiveZoneSpec();
  const r = content.repeat;
  const set = (patch: Partial<ImageRepeat>, label: string, gesture?: string) => {
    const command = edit(layer.id, { content: { repeat: { ...(r ?? DEFAULT_REPEAT), ...patch } } }, label);
    dispatch(gesture ? cmd.coalescing(command, `repeat-${gesture}:${layer.id}`) : command);
  };
  return (
    <Section title="Repeat pattern">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--accent)]"
          checked={!!r}
          onChange={(e) =>
            dispatch(
              edit(
                layer.id,
                { content: { repeat: e.target.checked ? { ...DEFAULT_REPEAT, tileWidthMm: Math.max(5, Math.round(Math.min(layer.transform.widthMm, layer.transform.heightMm) / 3)) } : undefined } },
                e.target.checked ? 'Repeat as pattern' : 'Stop repeating',
              ),
            )
          }
        />
        Repeat this image as a pattern
      </label>
      {r ? (
        <>
          <div className="grid grid-cols-[52px_1fr] items-center gap-2">
            <span className="label">Layout</span>
            <div className="seg w-fit" role="group" aria-label="Repeat layout">
              {REPEAT_MODES.map((m) => (
                <button key={m.id} aria-pressed={r.mode === m.id} onClick={() => set({ mode: m.id }, `Repeat: ${m.label}`)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <RangeField label="Tile" value={r.tileWidthMm} min={5} max={300} format={(v) => `${v} mm`} onChange={(v) => set({ tileWidthMm: v }, 'Tile size', 'tile')} />
          <RangeField label="Gap" value={r.spacingMm} min={0} max={100} format={(v) => `${v} mm`} onChange={(v) => set({ spacingMm: v }, 'Tile spacing', 'gap')} />
          <RangeField label="Angle" value={r.rotationDeg} min={-180} max={180} step={5} format={(v) => `${v}°`} onChange={(v) => set({ rotationDeg: v }, 'Pattern angle', 'angle')} />
          <RangeField label="Shift X" value={r.offsetXmm} min={-150} max={150} format={(v) => `${v} mm`} onChange={(v) => set({ offsetXmm: v }, 'Pattern offset', 'offx')} />
          <RangeField label="Shift Y" value={r.offsetYmm} min={-150} max={150} format={(v) => `${v} mm`} onChange={(v) => set({ offsetYmm: v }, 'Pattern offset', 'offy')} />
          {onGarment ? null : (
            <button
              className="btn btn-outline w-full text-xs"
              onClick={() =>
                dispatch(
                  cmd.updateTransforms(zoneId, { [layer.id]: { centerXmm: spec.printableWidthMm / 2, centerYmm: spec.printableHeightMm / 2, widthMm: spec.printableWidthMm, heightMm: spec.printableHeightMm, rotationDeg: 0 } }, 'Fill print area'),
                )
              }
            >
              <Maximize2 size={14} /> Fill the print area
            </button>
          )}
          <p className="text-[11px] text-fg-3">The pattern is clipped to the layer box. Print resolution is checked per tile.</p>
        </>
      ) : null}
    </Section>
  );
}

/** Dominant colours (spec AST-08): suggestions to reuse, not verified ink matches. */
function ImagePalette({ content }: { content: ImageContent }) {
  const [palette, setPalette] = useState<PaletteColour[] | null>(null);
  const [forAsset, setForAsset] = useState(content.assetId);
  if (forAsset !== content.assetId) {
    setForAsset(content.assetId);
    setPalette(null);
  }
  const analyse = async () => {
    const img = getLoadedImage(content.assetId) ?? (await loadAssetImage(content.assetId));
    setPalette(extractPalette(img));
  };
  if (!palette) {
    return (
      <button className="btn btn-ghost w-full justify-start px-2 text-xs" onClick={() => void analyse()}>
        Find the colours in this image
      </button>
    );
  }
  return (
    <div>
      <p className="label mb-1.5">Colours in this image (tap to copy)</p>
      <div className="flex flex-wrap gap-1.5">
        {palette.map((p) => (
          <button
            key={p.hex}
            className="touch-hit-square flex h-7 items-center gap-1.5 rounded-md border border-line px-1.5 text-[11px]"
            title={`${p.hex}, about ${Math.round(p.share * 100)}% of the image`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(p.hex);
                toast(`Copied ${p.hex}.`, 'success');
              } catch {
                toast(p.hex);
              }
            }}
          >
            <span className="h-4 w-4 rounded-sm border border-line" style={{ background: p.hex }} aria-hidden />
            <span className="font-mono">{p.hex}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const FINISHES: { id: LayerStyle['finish']; label: string; note: string }[] = [
  { id: 'flat_ink', label: 'Flat ink', note: 'Standard print.' },
  { id: 'puff', label: 'Puff', note: 'Raised relief, simulated in 3D. Print files stay flat.' },
  { id: 'embroidery', label: 'Embroidery', note: 'Stitched look, simulated in 3D. Needs digitizing for production.' },
  { id: 'metallic', label: 'Metallic foil', note: 'Foil sheen, simulated in 3D. Print files stay flat.' },
  { id: 'distressed', label: 'Distressed', note: 'Worn texture. It removes ink, so it prints.' },
  { id: 'cracked', label: 'Cracked plastisol', note: 'Fine cracks like a vintage print after many washes. The cracks remove ink, so they print.' },
];

/** Finish preview (spec ED3-08, TYP-06) and seeded distress (spec TYP-08). */
/** Finishes a sublimated (dyed-in) print can have: it can wear and crack, but not rise, stitch or shine. */
const DYED_FINISHES: LayerStyle['finish'][] = ['flat_ink', 'distressed', 'cracked'];

function FinishControls({ layer }: { layer: ArtworkLayer }) {
  const edit = useLayerEdit();
  const onGarment = useContext(OnGarmentContext);
  const dispatch = useStudio((s) => s.dispatch);
  const distress = effectiveDistress(layer);
  const setStyle = (style: Partial<LayerStyle>, label: string, gesture?: string) => {
    const command = edit(layer.id, { style }, label);
    dispatch(gesture ? cmd.coalescing(command, `${gesture}:${layer.id}`) : command);
  };
  const withAmount = (amount: number) => ({ ...(distress ?? { scaleMm: 6, seed: Math.floor(Math.random() * 100000) }), amount });
  const finishes = onGarment ? FINISHES.filter((f) => DYED_FINISHES.includes(f.id) || f.id === layer.style.finish) : FINISHES;
  return (
    <>
      <label className="grid grid-cols-[52px_1fr] items-center gap-2">
        <span className="label">Finish</span>
        <select className="field" value={layer.style.finish} onChange={(e) => setStyle({ finish: e.target.value as LayerStyle['finish'] }, 'Finish')}>
          {finishes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[11px] text-fg-3">{FINISHES.find((f) => f.id === layer.style.finish)?.note}</p>
      <RangeField label="Worn" value={Math.round((distress?.amount ?? 0) * 100)} min={0} max={100} format={(v) => (v ? `${v}%` : 'Off')} onChange={(v) => setStyle({ distress: withAmount(v / 100) }, 'Distress amount', 'distress')} />
      {distress ? (
        <>
          <RangeField label="Grain" value={distress.scaleMm} min={1} max={30} step={0.5} format={(v) => `${v} mm`} onChange={(v) => setStyle({ distress: { ...distress, scaleMm: v } }, 'Distress grain', 'grain')} />
          <button className="btn btn-ghost min-h-8 px-2 text-xs" onClick={() => setStyle({ distress: { ...distress, seed: (distress.seed + 7919) % 2147483647 } }, 'New distress pattern')}>
            <Dices size={14} /> New wear pattern
          </button>
        </>
      ) : null}
    </>
  );
}

function AppearanceSection({ layer }: { layer: ArtworkLayer }) {
  const edit = useLayerEdit();
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
        onCommit={(v) => dispatch(edit(layer.id, { style: { opacity: v / 100 } }, 'Opacity'))}
      />
      <label className="grid grid-cols-[52px_1fr] items-center gap-2">
        <span className="label">Blend</span>
        <select
          className="field"
          value={layer.style.blendMode}
          onChange={(e) => dispatch(edit(layer.id, { style: { blendMode: e.target.value as ArtworkLayer['style']['blendMode'] } }, 'Blend mode'))}
        >
          <option value="normal">Normal</option>
          <option value="multiply">Multiply</option>
          <option value="screen">Screen</option>
          <option value="overlay">Overlay</option>
        </select>
      </label>
      <FinishControls layer={layer} />
    </Section>
  );
}

function MultiSelection({ count, layers }: { count: number; layers: ArtworkLayer[] }) {
  const zone = useActiveArtboard();
  const ids = layers.map((l) => l.id);
  const units = zone ? selectionUnits(zone, ids) : [];
  const groupIds = new Set(layers.map((l) => l.groupId).filter(Boolean));
  const isOneGroup = groupIds.size === 1 && layers.every((l) => l.groupId);
  return (
    <div>
      <Section title={isOneGroup ? `Group of ${count} layers` : `${count} layers selected`}>
        <AlignBar toPrintArea={units.length === 1} />
        <PlacementBar />
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
      <WrapSection count={count} />
    </div>
  );
}

/** Lift zone artwork onto the 3D garment so it can run across seams. */
function WrapSection({ count }: { count: number }) {
  return (
    <Section title="Across seams">
      <p className="text-xs text-fg-2">
        Put {count === 1 ? 'it' : 'them'} on the 3D garment to run over the shoulder or round a side seam. Prints by sublimation or cut-and-sew, not in this zone’s print file.
      </p>
      <button className="btn btn-outline w-full text-xs" onClick={wrapSelectionAcrossSeams}>
        <Shirt size={14} /> Wrap across seams
      </button>
    </Section>
  );
}

/** Size, turn and mirroring of projected artwork, and where it goes next. */
function ProjectionPlacement({ layer }: { layer: ProjectedLayer }) {
  const dispatch = useStudio((s) => s.dispatch);
  const units = usePreference('units');
  const [linked, setLinked] = useState(true);
  const k = units === 'in' ? 1 / 25.4 : 1;
  const decimals = units === 'in' ? 2 : 1;
  const t = layer.transform;
  const set = (patch: Partial<ProjectedTransform>, label: string) =>
    dispatch(cmd.coalescing(cmd.updateProjectedLayer(layer.id, { transform: patch }, label), `${label}:${Object.keys(patch).join()}:${layer.id}`));
  const setSize = (dim: 'widthMm' | 'heightMm', mm: number) => {
    if (!linked) return set({ [dim]: mm }, 'Resize');
    const ratio = t.widthMm / t.heightMm;
    set(dim === 'widthMm' ? { widthMm: mm, heightMm: mm / ratio } : { heightMm: mm, widthMm: mm * ratio }, 'Resize');
  };
  return (
    <Section title="On the garment">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
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
      <p className="text-[11px] text-fg-3">
        Sized on the cloth at its centre. Drag it on the 3D garment in Place mode, over the shoulder or round a side seam. It fades out where the cloth turns away and never prints on the inside.
      </p>
      <div className="flex gap-2">
        <button className="btn btn-outline flex-1 px-2 text-xs" onClick={showOnGarment} title="Show the 3D garment in Place mode">
          <Move size={14} /> Place on garment
        </button>
        <button className="btn btn-outline flex-1 px-2 text-xs" onClick={() => returnProjectionToZone(layer.id)} title="Put it back on the print zone under its centre">
          <Frame size={14} /> Back to zone
        </button>
      </div>
    </Section>
  );
}

/** Artwork across seams: the same content, style and checks as a zone layer, placed on the garment itself. */
const NO_IDS: string[] = [];

function ProjectionInspector({ layer }: { layer: ProjectedLayer }) {
  const dispatch = useStudio((s) => s.dispatch);
  const order = useStudio((s) => s.document?.projections.orderedLayerIds) ?? NO_IDS;
  const art = useMemo(() => projectedAsArtwork(layer), [layer]);
  const issues = checkProjectedLayer(layer, DEFAULT_PREFLIGHT).filter((i) => i.code !== 'cross_seam');
  const index = order.indexOf(layer.id);
  return (
    <OnGarmentContext.Provider value>
      <div className="flex items-center gap-2 px-4 pb-1 pt-3">
        <input
          key={`${layer.id}:${layer.name}`}
          className="field h-9 flex-1 font-semibold"
          defaultValue={layer.name}
          aria-label="Layer name"
          onBlur={(e) => e.target.value.trim() && e.target.value !== layer.name && dispatch(cmd.updateProjectedLayer(layer.id, { name: e.target.value.trim() }, 'Rename layer'))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <button className="icon-btn" onClick={() => duplicateProjection(layer.id)} aria-label="Duplicate layer" title="Duplicate (Ctrl+D)">
          <Copy size={15} />
        </button>
        <button className="icon-btn text-danger" onClick={() => deleteProjection(layer.id)} aria-label="Delete layer" title="Delete">
          <Trash2 size={15} />
        </button>
      </div>
      <p className="px-4 pb-2 text-xs text-fg-2">Across seams: printed by sublimation or as cut-and-sew panels.</p>
      {layer.locked ? <p className="px-4 pb-2 text-xs text-fg-2">This layer is locked. Unlock it in the layer list to move it.</p> : null}
      {issues.length ? (
        <div className="mx-2 mb-1">
          {issues.map((i) => (
            <IssueItem key={i.id} issue={i} />
          ))}
        </div>
      ) : null}
      <ProjectionPlacement layer={layer} />
      {art.content.kind === 'text' ? <TextSection key={layer.id} layer={art} content={art.content} /> : null}
      {art.content.kind === 'shape' ? <ShapeSection layer={art} content={art.content} /> : null}
      {art.content.kind === 'image' ? <ImageSection layer={art} /> : null}
      <AppearanceSection layer={art} />
      <Section title="Arrange">
        <div className="flex gap-2">
          <button className="btn btn-outline flex-1 px-2 text-xs" disabled={index === order.length - 1} onClick={() => dispatch(cmd.reorderProjectedLayer(layer.id, order.length))}>
            <ArrowUpToLine size={14} /> To front
          </button>
          <button className="btn btn-outline flex-1 px-2 text-xs" disabled={index === 0} onClick={() => dispatch(cmd.reorderProjectedLayer(layer.id, 0))}>
            <ArrowDownToLine size={14} /> To back
          </button>
        </div>
      </Section>
    </OnGarmentContext.Provider>
  );
}

export function Inspector() {
  const zone = useActiveArtboard();
  const zoneId = useStudio((s) => s.activeZoneId);
  const selectedIds = useStudio((s) => s.selectedLayerIds);
  const projection = useStudio((s) => (s.selectedProjectionId ? s.document?.projections.layers[s.selectedProjectionId] : undefined));
  const dispatch = useStudio((s) => s.dispatch);
  const spec = useActiveZoneSpec();
  const layers = useMemo(() => (zone ? selectedIds.map((id) => zone.layers[id]).filter(Boolean) : []), [zone, selectedIds]);

  if (!zone) return null;
  if (projection) return <ProjectionInspector layer={projection} />;
  if (layers.length === 0) {
    // A design area being designed on, nothing in it selected: its own settings, then the garment's.
    return isAreaId(zoneId) && 'id' in zone ? (
      <>
        <AreaPanel area={zone as DesignArea} />
        <GarmentPanel />
      </>
    ) : (
      <GarmentPanel />
    );
  }
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
          onBlur={(e) => e.target.value.trim() && e.target.value !== layer.name && dispatch(cmd.updateLayer(zoneId, layer.id, { name: e.target.value.trim() }, 'Rename layer'))}
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
      <WrapSection count={1} />
      <Section title="Arrange">
        <div className="flex gap-2">
          <button className="btn btn-outline flex-1 px-2 text-xs" disabled={index === zone.orderedLayerIds.length - 1} onClick={() => dispatch(cmd.reorderLayer(zoneId, layer.id, zone.orderedLayerIds.length))}>
            <ArrowUpToLine size={14} /> To front
          </button>
          <button className="btn btn-outline flex-1 px-2 text-xs" disabled={index === 0} onClick={() => dispatch(cmd.reorderLayer(zoneId, layer.id, 0))}>
            <ArrowDownToLine size={14} /> To back
          </button>
        </div>
      </Section>
    </div>
  );
}
