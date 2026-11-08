/**
 * Print preflight (spec §10, PRT-02/03/05). Pure functions over the canonical document.
 * DPI thresholds are configurable heuristics, not universal print standards.
 */
import { getGarment, PRINT_METHOD_LABELS, type ZoneSpec } from './garments';
import { mmToInch, overflow, rotatedBounds, roundMm } from './geometry';
import { ZONE_IDS, type ArtworkLayer, type DesignDocument, type PrintMethod, type ZoneId } from './schema';

export type Severity = 'error' | 'warning' | 'info';

export interface PreflightIssue {
  id: string;
  zoneId: ZoneId;
  layerId?: string;
  severity: Severity;
  code:
    | 'out_of_bounds'
    | 'safe_margin'
    | 'low_dpi'
    | 'marginal_dpi'
    | 'small_text'
    | 'method_unsupported'
    | 'embroidery_raster'
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

/** Effective print resolution of an image layer at its placed size. */
export function effectiveDpi(layer: ArtworkLayer): { x: number; y: number; min: number } | null {
  if (layer.content.kind !== 'image') return null;
  if (layer.content.mime === 'image/svg+xml') return null; // vector source: resolution independent
  const x = layer.content.naturalWidthPx / mmToInch(layer.transform.widthMm);
  const y = layer.content.naturalHeightPx / mmToInch(layer.transform.heightMm);
  return { x, y, min: Math.min(x, y) };
}

/** Largest width (mm) an image can be printed at while staying at `dpi`. */
export function maxWidthAtDpi(layer: ArtworkLayer, dpi: number): number | null {
  if (layer.content.kind !== 'image') return null;
  const byWidth = (layer.content.naturalWidthPx / dpi) * 25.4;
  const byHeight = (layer.content.naturalHeightPx / dpi) * 25.4 * (layer.transform.widthMm / layer.transform.heightMm);
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
    if (dpi.min < opts.minimumDpi) {
      const maxW = maxWidthAtDpi(layer, opts.minimumDpi);
      issues.push({
        ...base,
        id: `${layer.id}:dpi`,
        severity: 'error',
        code: 'low_dpi',
        message: `Prints at ${shown} dpi, below the ${opts.minimumDpi} dpi minimum`,
        fix: maxW ? `Use a larger source image, or print it at most ${roundMm(maxW)} mm wide` : undefined,
      });
    } else if (dpi.min < opts.goodDpi) {
      const maxW = maxWidthAtDpi(layer, opts.goodDpi);
      issues.push({
        ...base,
        id: `${layer.id}:dpi`,
        severity: 'warning',
        code: 'marginal_dpi',
        message: `Prints at ${shown} dpi; edges may look soft`,
        fix: maxW ? `For ${opts.goodDpi} dpi, print it at most ${roundMm(maxW)} mm wide` : undefined,
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

export function runPreflight(doc: DesignDocument, opts: PreflightOptions = DEFAULT_PREFLIGHT): PreflightIssue[] {
  const model = getGarment(doc.garment.modelId);
  const issues: PreflightIssue[] = [];
  let visibleLayers = 0;

  for (const zoneId of ZONE_IDS) {
    const zone = doc.zones[zoneId];
    const spec = model.zones[zoneId];
    const layers = zone.orderedLayerIds.map((id) => zone.layers[id]).filter((l) => l && l.visible);
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
