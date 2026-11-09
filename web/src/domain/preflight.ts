/**
 * Print preflight (spec §10, PRT-02/03/05). Pure functions over the canonical document.
 * DPI thresholds are configurable heuristics, not universal print standards.
 */
import { areaSpec, designAreas } from './areas';
import { getGarment, PRINT_METHOD_LABELS, type ZoneSpec } from './garments';
import { mmToInch, overflow, rotatedBounds, roundMm } from './geometry';
import { projectedAsArtwork, projectedLayers } from './projected';
import { ZONE_IDS, type AreaId, type ArtboardId, type ArtworkLayer, type DesignDocument, type ImageContent, type PrintMethod, type ProjectedLayer } from './schema';

export type Severity = 'error' | 'warning' | 'info';

export interface PreflightIssue {
  id: string;
  /** The zone or design area the issue belongs to; issues about projected layers or the whole design use 'front'. */
  zoneId: ArtboardId;
  layerId?: string;
  /** Set when the issue is about a projected (cross-seam) layer rather than a zone layer. */
  projectionId?: string;
  severity: Severity;
  code:
    | 'out_of_bounds'
    | 'safe_margin'
    | 'low_dpi'
    | 'marginal_dpi'
    | 'small_text'
    | 'method_unsupported'
    | 'embroidery_raster'
    | 'zone_unavailable'
    | 'allover_print'
    | 'cross_seam'
    | 'flat_finish'
    | 'empty_design';
  message: string;
  /** Action-oriented resolution, only when it can be computed exactly. */
  fix?: string;
}

export interface PreflightOptions {
  goodDpi: number;
  minimumDpi: number;
}

export const DEFAULT_PREFLIGHT: PreflightOptions = { goodDpi: 250, minimumDpi: 150 };

const MIN_TEXT_HEIGHT_MM: Record<PrintMethod, number> = {
  DTG: 3,
  DTF: 3,
  SCREEN_PRINT: 3,
  HEAT_TRANSFER: 4,
  PUFF_PRINT: 6,
  SUBLIMATION: 2.5,
  EMBROIDERY: 5,
};

/** Effective print resolution of an image layer at its placed size (per tile for repeat patterns). */
export function effectiveDpi(layer: ArtworkLayer): { x: number; y: number; min: number } | null {
  const c = layer.content;
  if (c.kind !== 'image') return null;
  if (c.mime === 'image/svg+xml') return null; // vector source: resolution independent
  // A crop prints only its own pixels, spread over the whole box.
  const { w: pw, h: ph } = shownPixels(c);
  const widthMm = c.repeat ? c.repeat.tileWidthMm : layer.transform.widthMm;
  const heightMm = c.repeat ? (c.repeat.tileWidthMm * ph) / pw : layer.transform.heightMm;
  const x = pw / mmToInch(widthMm);
  const y = ph / mmToInch(heightMm);
  return { x, y, min: Math.min(x, y) };
}

/** The pixels an image layer shows: its crop's, else the whole image's. */
export function shownPixels(c: Pick<ImageContent, 'naturalWidthPx' | 'naturalHeightPx' | 'crop'>) {
  return { w: c.naturalWidthPx * (c.crop?.w ?? 1), h: c.naturalHeightPx * (c.crop?.h ?? 1) };
}

/** Largest width (mm) an image (or one repeat tile) can be printed at while staying at `dpi`. */
export function maxWidthAtDpi(layer: ArtworkLayer, dpi: number): number | null {
  if (layer.content.kind !== 'image') return null;
  const { w: pw, h: ph } = shownPixels(layer.content);
  if (layer.content.repeat) return (pw / dpi) * 25.4;
  const byWidth = (pw / dpi) * 25.4;
  const byHeight = (ph / dpi) * 25.4 * (layer.transform.widthMm / layer.transform.heightMm);
  return Math.min(byWidth, byHeight);
}

function describeOverflow(o: ReturnType<typeof overflow>): { message: string; fix: string } | null {
  const sides: [keyof typeof o, string, string][] = [
    ['left', 'left', 'right'],
    ['right', 'right', 'left'],
    ['top', 'top', 'down'],
    ['bottom', 'bottom', 'up'],
  ];
  const worst = sides.filter(([k]) => o[k] > 0.5).sort((a, b) => o[b[0]] - o[a[0]]);
  if (!worst.length) return null;
  const [key, edge, direction] = worst[0];
  const amount = roundMm(o[key]);
  return {
    message: `Extends ${amount} mm past the ${edge} edge of the print area`,
    fix: worst.length > 1 ? 'Scale it down to fit inside the print area' : `Move ${amount} mm ${direction}`,
  };
}

export function checkLayer(layer: ArtworkLayer, zone: ZoneSpec, method: PrintMethod, opts: PreflightOptions): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const base = { zoneId: zone.id, layerId: layer.id };
  const bounds = rotatedBounds(layer.transform);
  const area = { x: 0, y: 0, width: zone.printableWidthMm, height: zone.printableHeightMm };

  const out = describeOverflow(overflow(bounds, area));
  if (out) {
    issues.push({ ...base, id: `${layer.id}:bounds`, severity: 'error', code: 'out_of_bounds', ...out });
  } else {
    const inset = zone.safeInsetMm;
    const safe = { x: inset, y: inset, width: area.width - 2 * inset, height: area.height - 2 * inset };
    const s = overflow(bounds, safe);
    if (Math.max(s.left, s.right, s.top, s.bottom) > 0.5) {
      issues.push({
        ...base,
        id: `${layer.id}:safe`,
        severity: 'warning',
        code: 'safe_margin',
        message: `Inside the ${inset} mm safe margin, where trimming and placement drift can clip it`,
      });
    }
  }

  const dpi = effectiveDpi(layer);
  if (dpi) {
    const shown = Math.round(dpi.min);
    const sizeIt = layer.content.kind === 'image' && layer.content.repeat ? 'make each tile' : 'print it';
    if (dpi.min < opts.minimumDpi) {
      const maxW = maxWidthAtDpi(layer, opts.minimumDpi);
      issues.push({
        ...base,
        id: `${layer.id}:dpi`,
        severity: 'error',
        code: 'low_dpi',
        message: `Prints at ${shown} dpi, below the ${opts.minimumDpi} dpi minimum`,
        fix: maxW ? `Use a larger source image, or ${sizeIt} at most ${roundMm(maxW)} mm wide` : undefined,
      });
    } else if (dpi.min < opts.goodDpi) {
      const maxW = maxWidthAtDpi(layer, opts.goodDpi);
      issues.push({
        ...base,
        id: `${layer.id}:dpi`,
        severity: 'warning',
        code: 'marginal_dpi',
        message: `Prints at ${shown} dpi; edges may look soft`,
        fix: maxW ? `For ${opts.goodDpi} dpi, ${sizeIt} at most ${roundMm(maxW)} mm wide` : undefined,
      });
    }
  }

  if (layer.content.kind === 'text') {
    const lines = Math.max(1, layer.content.value.split('\n').length);
    const lineHeightMm = layer.transform.heightMm / lines / layer.content.lineHeight;
    const min = MIN_TEXT_HEIGHT_MM[method];
    if (lineHeightMm < min) {
      issues.push({
        ...base,
        id: `${layer.id}:text`,
        severity: 'warning',
        code: 'small_text',
        message: `Text is about ${roundMm(lineHeightMm)} mm tall; ${PRINT_METHOD_LABELS[method].toLowerCase()} needs at least ${min} mm`,
        fix: `Scale the text up by ${Math.ceil((min / lineHeightMm - 1) * 100)}%`,
      });
    }
  }

  if (method === 'EMBROIDERY' && layer.content.kind === 'image' && layer.content.mime !== 'image/svg+xml') {
    issues.push({
      ...base,
      id: `${layer.id}:embroidery`,
      severity: 'warning',
      code: 'embroidery_raster',
      message: 'Photos and raster images must be digitized before they can be embroidered',
      fix: 'Use a simple vector logo, or plan for digitizing',
    });
  }

  return issues;
}

const RAISED_FINISH: Partial<Record<ArtworkLayer['style']['finish'], string>> = { puff: 'Puff', embroidery: 'Embroidery', metallic: 'Metallic foil' };

/**
 * Checks for artwork projected across seams. A DTG or screen-print zone file holds one flat
 * print area, so it can't carry artwork that runs over a seam: projected layers are printed on
 * the fabric before sewing, by sublimation or as cut-and-sew panels, and preflight says so.
 */
export function checkProjectedLayer(layer: ProjectedLayer, opts: PreflightOptions = DEFAULT_PREFLIGHT): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const base = { zoneId: 'front' as const, projectionId: layer.id };
  issues.push({
    ...base,
    id: `${layer.id}:cross-seam`,
    severity: 'info',
    code: 'cross_seam',
    message: 'Runs across seams, so it needs sublimation or cut-and-sew. Zone print files (DTG, screen print) can’t carry it',
    fix: 'Export the cut-and-sew panels for the fabric printer, or move it back to a print zone',
  });
  const art = projectedAsArtwork(layer);
  const dpi = effectiveDpi(art);
  if (dpi && dpi.min < opts.goodDpi) {
    const low = dpi.min < opts.minimumDpi;
    const maxW = maxWidthAtDpi(art, low ? opts.minimumDpi : opts.goodDpi);
    issues.push({
      ...base,
      id: `${layer.id}:dpi`,
      severity: low ? 'error' : 'warning',
      code: low ? 'low_dpi' : 'marginal_dpi',
      message: low ? `Prints at ${Math.round(dpi.min)} dpi, below the ${opts.minimumDpi} dpi minimum` : `Prints at ${Math.round(dpi.min)} dpi; edges may look soft`,
      fix: maxW ? `${low ? 'Use a larger source image, or print' : `For ${opts.goodDpi} dpi, print`} it at most ${roundMm(maxW)} mm wide` : undefined,
    });
  }
  if (layer.content.kind === 'text') {
    const lines = Math.max(1, layer.content.value.split('\n').length);
    const lineHeightMm = layer.transform.heightMm / lines / layer.content.lineHeight;
    const min = MIN_TEXT_HEIGHT_MM.SUBLIMATION;
    if (lineHeightMm < min) {
      issues.push({
        ...base,
        id: `${layer.id}:text`,
        severity: 'warning',
        code: 'small_text',
        message: `Text is about ${roundMm(lineHeightMm)} mm tall; sublimation needs at least ${min} mm`,
        fix: `Scale the text up by ${Math.ceil((min / lineHeightMm - 1) * 100)}%`,
      });
    }
  }
  const raised = RAISED_FINISH[layer.style.finish];
  if (raised) {
    issues.push({
      ...base,
      id: `${layer.id}:finish`,
      severity: 'warning',
      code: 'flat_finish',
      message: `${raised} can’t be printed into the fabric across seams; it prints as flat colour`,
      fix: 'Choose flat ink, or move it back to a print zone for that finish',
    });
  }
  return issues;
}

export function runPreflight(doc: DesignDocument, opts: PreflightOptions = DEFAULT_PREFLIGHT): PreflightIssue[] {
  const model = getGarment(doc.garment.modelId);
  const issues: PreflightIssue[] = [];
  let visibleLayers = 0;

  for (const zoneId of ZONE_IDS) {
    const zone = doc.zones[zoneId];
    const spec = model.zones[zoneId];
    const layers = zone.orderedLayerIds.map((id) => zone.layers[id]).filter((l) => l && l.visible);
    if (!spec) {
      // Artwork kept from another garment style, on a zone this one doesn't have.
      if (layers.length) {
        issues.push({
          id: `${zoneId}:unavailable`,
          zoneId,
          severity: 'error',
          code: 'zone_unavailable',
          message: `The ${model.shortName.toLowerCase()} has no ${zoneId.replace('_', ' ')}: ${layers.length} layer${layers.length === 1 ? '' : 's'} there won't be printed`,
          fix: 'Switch back to a garment with this zone, or rebuild the artwork on another zone',
        });
      }
      continue;
    }
    visibleLayers += layers.length;
    if (layers.length && !spec.methods.includes(zone.printMethod)) {
      issues.push({
        id: `${zoneId}:method`,
        zoneId,
        severity: 'error',
        code: 'method_unsupported',
        message: `${PRINT_METHOD_LABELS[zone.printMethod]} isn't available on the ${spec.label.toLowerCase()} of this garment`,
        fix: `Switch to ${PRINT_METHOD_LABELS[spec.methods[0]]}`,
      });
    }
    for (const layer of layers) issues.push(...checkLayer(layer, spec, zone.printMethod, opts));
  }

  for (const layer of projectedLayers(doc)) {
    if (!layer.visible) continue;
    visibleLayers++;
    issues.push(...checkProjectedLayer(layer, opts));
  }

  // Design areas print like zones of their own size, by their own method.
  for (const area of designAreas(doc)) {
    if (!area.visible) continue;
    const spec = areaSpec(area);
    const layers = area.orderedLayerIds.map((id) => area.layers[id]).filter((l) => l && l.visible);
    visibleLayers += layers.length;
    for (const layer of layers) {
      issues.push(...checkLayer(layer, spec, area.printMethod, opts).map((i) => ({ ...i, id: `${area.id}:${i.id}`, zoneId: area.id as AreaId, message: `${area.name}: ${i.message}` })));
    }
  }

  const colorway = doc.colorways.find((c) => c.id === doc.activeColorwayId) ?? doc.colorways[0];
  const printed = Object.keys(colorway?.surfaces ?? {});
  if (printed.length) {
    issues.push({
      id: 'doc:allover',
      zoneId: 'front',
      severity: 'info',
      code: 'allover_print',
      message: `All-over print on ${printed.join(' and ')}: made by sublimation or printed fabric, quoted separately from zone prints`,
    });
  }

  if (visibleLayers === 0) {
    issues.push({ id: 'doc:empty', zoneId: 'front', severity: 'info', code: 'empty_design', message: 'No artwork yet. Add text or an image to start.' });
  }

  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function summarize(issues: PreflightIssue[]) {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
  };
}
