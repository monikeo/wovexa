/**
 * Print checks that need the browser (spec PRT-03, AST-07), on top of the pure ones in
 * domain/preflight:
 * - Seam clearance: a layer's real ink (not its box, so a PNG's empty margin never counts) is
 *   drawn at 1 px/mm and laid over the same band along seams, edges and trims the artboard's seam
 *   guide shows. Ink in the band is a warning.
 * - Font coverage: each letter is looked up in the font's own character list (its Google Fonts
 *   subsets, or the character map inside an uploaded file), then measured as a second opinion.
 *   Letters it doesn't draw, apart from the Khmer, Korean and Chinese that WOVEXA's script fonts
 *   draw on purpose, print in a stand-in font: a warning.
 * Results are cached per layer, so an edit re-checks only what changed. Anything that can't be
 * checked yet (an image or font still loading) is left out and `pending` says to look again.
 */
import { deepLayers } from '@/domain/lockups';
import { getGarment, getSize, zoneSpecOrFirst, type ZoneSpec } from '@/domain/garments';
import { DEFAULT_PREFLIGHT, runPreflight, type PreflightIssue, type PreflightOptions, type Severity } from '@/domain/preflight';
import type { ArtboardId, ArtworkLayer, DesignDocument, LayerStack, TextContent } from '@/domain/schema';
import { SEAM_CLEARANCE_MM, seamEdges, sketchForZone } from '@/components/studio/editor2d/flat-sketch';
import { fontFileCoverage, inRanges, mergeRanges, parseUnicodeRange, type Ranges } from '@/lib/font-coverage';
import { findFont, loadFontStylesheets, scriptFallbacks } from '@/lib/fonts';
import { getFont } from '@/lib/local-db';
import { drawZone } from '@/lib/render/zone-renderer';

/** Pixels per millimetre the seam check draws at: plenty to see ink in a 20 mm band. */
const PPM = 1;
/** Ink in the band below this (mm²) is a hairline or an anti-aliased edge, not a problem. */
const MIN_INK_MM2 = 6;

const canUseCanvas = () => typeof document !== 'undefined';

function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Small bounded caches: the oldest entries go first. */
function remember<V>(map: Map<string, V>, key: string, value: V, max: number) {
  map.set(key, value);
  if (map.size > max) map.delete(map.keys().next().value!);
}

// ---- Seam clearance ----

const bands = new Map<string, HTMLCanvasElement>();
const inkInBand = new Map<string, number>();

/** The seam clearance band over a print area, as opaque pixels. */
function bandFor(key: string, model: ReturnType<typeof getGarment>, spec: ZoneSpec, scale: number) {
  const hit = bands.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(spec.printableWidthMm * PPM, spec.printableHeightMm * PPM);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(PPM, PPM);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2 * SEAM_CLEARANCE_MM;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const pts of seamEdges(sketchForZone(model, spec, scale))) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  remember(bands, key, canvas, 24);
  return canvas;
}

/** Square millimetres of a layer's ink inside the band, or null while its images load. */
function inkInside(layer: ArtworkLayer, band: HTMLCanvasElement): number | null {
  const canvas = makeCanvas(band.width, band.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const one: LayerStack = { orderedLayerIds: [layer.id], layers: { [layer.id]: layer } };
  if (!drawZone(ctx, one, { pxPerMm: PPM })) return null;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(band, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let inked = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 64) inked++;
  canvas.width = 0;
  canvas.height = 0;
  return inked / (PPM * PPM);
}

export function seamIssues(doc: DesignDocument): { issues: PreflightIssue[]; pending: boolean } {
  const issues: PreflightIssue[] = [];
  let pending = false;
  if (!canUseCanvas()) return { issues, pending };
  const model = getGarment(doc.garment.modelId);
  const size = getSize(model, doc.garment.sizeCode);
  for (const zoneId of model.zoneOrder) {
    const zone = doc.zones[zoneId];
    const spec = model.zones[zoneId] ? zoneSpecOrFirst(model, zoneId) : undefined;
    if (!zone || !spec) continue;
    // A clipped layer only shows inside its base, which is checked itself.
    const layers = zone.orderedLayerIds.map((id) => zone.layers[id]).filter((l): l is ArtworkLayer => !!l?.visible && !l.clip);
    if (!layers.length) continue;
    const bandKey = `${model.id}|${size.code}|${zoneId}`;
    let band: HTMLCanvasElement;
    try {
      band = bandFor(bandKey, model, spec, size.scale);
    } catch {
      continue;
    }
    for (const layer of layers) {
      const key = `${bandKey}|${layer.id}|${JSON.stringify([layer.transform, layer.content, layer.style])}`;
      let mm2 = inkInBand.get(key);
      if (mm2 === undefined) {
        let measured: number | null = null;
        try {
          measured = inkInside(layer, band);
        } catch {
          measured = 0;
        }
        if (measured === null) {
          pending = true;
          continue;
        }
        mm2 = measured;
        remember(inkInBand, key, mm2, 600);
      }
      if (mm2 <= MIN_INK_MM2) continue;
      issues.push({
        id: `${layer.id}:seam`,
        zoneId,
        layerId: layer.id,
        severity: 'warning',
        code: 'seam_clearance',
        message: `Runs within ${SEAM_CLEARANCE_MM} mm of a seam, edge or trim, where the print can come out uneven or crack`,
        fix: 'Move it clear of the seams (turn on the seam clearance guide under the artboard to see them), or make it smaller',
      });
    }
  }
  return { issues, pending };
}

// ---- Font coverage ----

let measureCtx: CanvasRenderingContext2D | null = null;
const glyphs = new Map<string, boolean>();
const unquote = (family: string) => family.replace(/^['"]|['"]$/g, '');

/** Whether a face of `family` is loaded on the page: without one, measuring it says nothing. */
function familyLoaded(family: string) {
  let loaded = false;
  document.fonts.forEach((face) => {
    if (!loaded && face.status === 'loaded' && unquote(face.family) === family) loaded = true;
  });
  return loaded;
}

/**
 * Whether a loaded `family` draws `ch` itself: measured with two different stand-ins after it, a
 * real glyph measures the same both ways. Only a second opinion: a letter neither stand-in has
 * falls to the same system font both ways and passes, so the font's own character list comes first.
 */
function measuresAsOwn(family: string, weight: number, italic: boolean, ch: string): boolean {
  const key = `${family}|${weight}|${italic}|${ch}`;
  const hit = glyphs.get(key);
  if (hit !== undefined) return hit;
  measureCtx ??= makeCanvas(1, 1).getContext('2d');
  const ctx = measureCtx!;
  const face = `${italic ? 'italic ' : ''}${weight} 48px "${family.replace(/"/g, '')}"`;
  ctx.font = `${face}, monospace`;
  const a = ctx.measureText(ch).width;
  ctx.font = `${face}, serif`;
  const b = ctx.measureText(ch).width;
  const has = Math.abs(a - b) < 0.05;
  remember(glyphs, key, has, 4000);
  return has;
}

/** The characters a family's faces on the page declare (Google Fonts subsets), cached until faces change. */
const declared = { size: -1, byFamily: new Map<string, Ranges | null>() };
function declaredRanges(family: string): Ranges | null {
  if (declared.size !== document.fonts.size) {
    declared.size = document.fonts.size;
    declared.byFamily.clear();
  }
  if (declared.byFamily.has(family)) return declared.byFamily.get(family)!;
  const parts: (readonly [number, number])[] = [];
  let found = false;
  document.fonts.forEach((face) => {
    if (unquote(face.family) !== family) return;
    found = true;
    parts.push(...parseUnicodeRange(face.unicodeRange || 'U+0-10FFFF'));
  });
  const ranges = found ? mergeRanges(parts) : null;
  declared.byFamily.set(family, ranges);
  return ranges;
}

/** Uploaded fonts' character maps, read once from this device's font library. */
const uploadedMaps = new Map<string, Ranges | 'unreadable' | 'reading'>();
function uploadedRanges(assetId: string): Ranges | 'unreadable' | null {
  const hit = uploadedMaps.get(assetId);
  if (hit === 'reading') return null;
  if (hit) return hit;
  uploadedMaps.set(assetId, 'reading');
  void getFont(assetId)
    .then(async (font) => (font ? ((await fontFileCoverage(await font.blob.arrayBuffer())) ?? 'unreadable') : 'unreadable'))
    .catch(() => 'unreadable' as const)
    .then((ranges) => remember(uploadedMaps, assetId, ranges, 60));
  return null;
}

/** When a catalogue family's stylesheet was first asked for: it gets a while to arrive, then the check gives up. */
const sheetAsked = new Map<string, number>();
const SHEET_PATIENCE_MS = 10_000;

/**
 * How to tell whether a text layer's font draws a letter itself. Null while that can't be told
 * yet (a stylesheet or font file still loading); undefined when it never can on this device.
 */
function coverageOf(c: TextContent): ((ch: string) => boolean) | null | undefined {
  const family = c.fontFamily.replace(/"/g, '');
  const font = `${c.italic ? 'italic ' : ''}${c.fontWeight} 48px "${family}"`;
  const faceLoaded = (ch: string) => {
    try {
      return document.fonts.check(font, ch);
    } catch {
      return false;
    }
  };
  // Measure only with the font's face for that letter loaded; until then trust its character list.
  const measured = (ch: string) => !faceLoaded(ch) || measuresAsOwn(family, c.fontWeight, c.italic, ch);
  if (c.fontAssetId) {
    const ranges = uploadedRanges(c.fontAssetId);
    if (ranges === null) return null;
    if (ranges !== 'unreadable') return (ch) => inRanges(ranges, ch.codePointAt(0)!);
    return familyLoaded(family) ? measured : undefined;
  }
  const ranges = declaredRanges(family);
  if (!ranges) {
    if (!findFont(family)) return undefined;
    const since = sheetAsked.get(family) ?? Date.now();
    if (!sheetAsked.has(family)) sheetAsked.set(family, since);
    void loadFontStylesheets([family]);
    return Date.now() - since < SHEET_PATIENCE_MS ? null : undefined;
  }
  return (ch) => inRanges(ranges, ch.codePointAt(0)!) && measured(ch);
}

/** Letters worth checking: not spaces, joiners or combining marks (they sit on a letter that is checked). */
const checkable = (ch: string) => /[\p{L}\p{N}\p{P}\p{S}]/u.test(ch) && !/\p{M}/u.test(ch);
/** Khmer, Korean and Chinese (with CJK punctuation) print in WOVEXA's own script fonts on purpose. */
const scriptLetter = (ch: string) => scriptFallbacks(ch).length > 0 || /[　-〿＀-￯]/u.test(ch);

/** The letters of a text layer its font doesn't draw; null while that can't be told yet. */
export function missingGlyphs(c: TextContent): string[] | null {
  if (!canUseCanvas() || !document.fonts) return [];
  const letters = [...new Set(Array.from(c.value))].filter((ch) => checkable(ch) && !scriptLetter(ch));
  if (!letters.length) return [];
  const has = coverageOf(c);
  if (has === null) return null;
  if (!has) return [];
  return letters.filter((ch) => !has(ch));
}

function glyphIssue(c: TextContent, missing: string[], zoneId: ArtboardId, ids: { layerId?: string; projectionId?: string }, label?: string): PreflightIssue {
  const shown = missing.slice(0, 6).map((ch) => `“${ch}”`).join(', ') + (missing.length > 6 ? ` and ${missing.length - 6} more` : '');
  return {
    id: `${ids.layerId ?? ids.projectionId}:${label ?? ''}:glyphs`,
    zoneId,
    ...ids,
    severity: 'warning',
    code: 'missing_glyphs',
    message: `${label ? `${label}: ` : ''}${c.fontFamily} doesn’t have ${shown}, so ${missing.length === 1 ? 'it prints' : 'they print'} in a stand-in font`,
    fix: missing.length === 1 ? 'Choose a font that has it, or change that letter' : 'Choose a font that has them, or change those letters',
  };
}

export function fontIssues(doc: DesignDocument): { issues: PreflightIssue[]; pending: boolean } {
  const issues: PreflightIssue[] = [];
  let pending = false;
  if (!canUseCanvas()) return { issues, pending };
  const check = (layer: Pick<ArtworkLayer, 'visible' | 'content' | 'name'>, zoneId: ArtboardId, ids: { layerId?: string; projectionId?: string }) => {
    if (!layer.visible) return;
    const texts = layer.content.kind === 'lockup' ? deepLayers({ layers: layer.content.layers }) : [layer];
    for (const t of texts) {
      if (t.content.kind !== 'text' || !t.content.value.trim()) continue;
      let missing: string[] | null;
      try {
        missing = missingGlyphs(t.content);
      } catch {
        missing = [];
      }
      if (missing === null) pending = true;
      else if (missing.length) issues.push(glyphIssue(t.content, missing, zoneId, ids, t === layer ? undefined : t.name));
    }
  };
  const model = getGarment(doc.garment.modelId);
  for (const zoneId of model.zoneOrder) {
    const zone = doc.zones[zoneId];
    if (zone) for (const id of zone.orderedLayerIds) if (zone.layers[id]) check(zone.layers[id], zoneId, { layerId: id });
  }
  for (const area of Object.values(doc.areas?.items ?? {})) {
    for (const id of area.orderedLayerIds) if (area.layers[id]) check(area.layers[id], area.id as ArtboardId, { layerId: id });
  }
  for (const id of doc.projections.orderedLayerIds) {
    const p = doc.projections.layers[id];
    if (p) check(p, 'front', { projectionId: id });
  }
  return { issues, pending };
}

// ---- Everything together ----

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Every print check, the pure ones and the browser's, most serious first; `pending` while an image or font is still loading. */
export function fullPreflight(doc: DesignDocument, opts: PreflightOptions = DEFAULT_PREFLIGHT): { issues: PreflightIssue[]; pending: boolean } {
  const seams = seamIssues(doc);
  const fonts = fontIssues(doc);
  const issues = [...runPreflight(doc, opts), ...seams.issues, ...fonts.issues].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return { issues, pending: seams.pending || fonts.pending };
}
