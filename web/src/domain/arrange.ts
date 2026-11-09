/**
 * Alignment and distribution (spec ED2-08). Grouped layers are treated as one unit so a
 * group keeps its internal arrangement. Pure functions: callers turn the result into an
 * updateTransforms command.
 */
import { normalizeDeg, rotatedBounds, type Rect } from './geometry';
import type { ArtworkLayer, LayerStack, LayerTransform } from './schema';

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';
export type Changes = Record<string, Partial<LayerTransform>>;

export function unionBounds(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Selected layers gathered into movable units: one unit per group, one per ungrouped layer. Locked layers are skipped. */
export function selectionUnits(zone: LayerStack, ids: string[]): ArtworkLayer[][] {
  const units = new Map<string, ArtworkLayer[]>();
  for (const id of zone.orderedLayerIds) {
    const layer = zone.layers[id];
    if (!layer || layer.locked || !ids.includes(id)) continue;
    const key = layer.groupId ? `g:${layer.groupId}` : `l:${id}`;
    units.set(key, [...(units.get(key) ?? []), layer]);
  }
  return [...units.values()];
}

const boundsOf = (unit: ArtworkLayer[]) => unionBounds(unit.map((l) => rotatedBounds(l.transform)));

function shift(unit: ArtworkLayer[], dx: number, dy: number, out: Changes) {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
  for (const l of unit) out[l.id] = { centerXmm: l.transform.centerXmm + dx, centerYmm: l.transform.centerYmm + dy };
}

/**
 * Align units to a target rectangle: the print area when one unit is selected,
 * otherwise the bounds of the whole selection.
 */
export function alignUnits(units: ArtworkLayer[][], mode: AlignMode, printArea: Rect): Changes {
  const out: Changes = {};
  if (!units.length) return out;
  const target = units.length === 1 ? printArea : unionBounds(units.map(boundsOf));
  for (const unit of units) {
    const b = boundsOf(unit);
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = target.x - b.x;
    if (mode === 'hcenter') dx = target.x + target.width / 2 - (b.x + b.width / 2);
    if (mode === 'right') dx = target.x + target.width - (b.x + b.width);
    if (mode === 'top') dy = target.y - b.y;
    if (mode === 'vcenter') dy = target.y + target.height / 2 - (b.y + b.height / 2);
    if (mode === 'bottom') dy = target.y + target.height - (b.y + b.height);
    shift(unit, dx, dy, out);
  }
  return out;
}

/** Equal gaps between three or more units; the outermost two stay where they are. */
export function distributeUnits(units: ArtworkLayer[][], axis: DistributeAxis): Changes {
  const out: Changes = {};
  if (units.length < 3) return out;
  const items = units.map((unit) => ({ unit, b: boundsOf(unit) }));
  const pos = (r: Rect) => (axis === 'horizontal' ? r.x : r.y);
  const size = (r: Rect) => (axis === 'horizontal' ? r.width : r.height);
  items.sort((a, b) => pos(a.b) - pos(b.b));
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const span = pos(last) + size(last) - pos(first);
  const occupied = items.reduce((sum, i) => sum + size(i.b), 0);
  const gap = (span - occupied) / (items.length - 1);
  let cursor = pos(first) + size(first) + gap;
  for (const item of items.slice(1, -1)) {
    const delta = cursor - pos(item.b);
    shift(item.unit, axis === 'horizontal' ? delta : 0, axis === 'vertical' ? delta : 0, out);
    cursor += size(item.b) + gap;
  }
  return out;
}

/** All ids in the same group as any of `ids`, so selecting one member selects the group. */
export function expandToGroups(zone: LayerStack, ids: string[]): string[] {
  const groups = new Set(ids.map((id) => zone.layers[id]?.groupId).filter(Boolean));
  if (!groups.size) return ids;
  const expanded = new Set(ids);
  for (const id of zone.orderedLayerIds) {
    const g = zone.layers[id]?.groupId;
    if (g && groups.has(g)) expanded.add(id);
  }
  return zone.orderedLayerIds.filter((id) => expanded.has(id));
}

/** Step and repeat: copies in a row, in a grid, or round a circle (spec ED2-08). */
export interface CopyPlan {
  mode: 'row' | 'grid' | 'circle';
  /** How many in all, the original included. */
  count: number;
  /** Space between neighbours in a row or grid, mm. */
  gapMm: number;
  /** Circle radius, mm, to each copy's centre. */
  radiusMm: number;
  /** Round a circle, turn each copy to face out, like the numbers on a clock. */
  turn: boolean;
}

export const MAX_COPIES = 48;

/**
 * Where each of the `count` items goes, the original first: the arrangement is centred where the
 * original was (a circle's centre, a row's or grid's middle), so it stays where the person put it.
 */
export function arrangeCopies(t: LayerTransform, plan: CopyPlan): Pick<LayerTransform, 'centerXmm' | 'centerYmm' | 'rotationDeg'>[] {
  const n = Math.max(2, Math.min(MAX_COPIES, Math.round(plan.count)));
  const cx = t.centerXmm;
  const cy = t.centerYmm;
  const out: Pick<LayerTransform, 'centerXmm' | 'centerYmm' | 'rotationDeg'>[] = [];
  if (plan.mode === 'circle') {
    // From the top, clockwise.
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * Math.PI) / n;
      const turn = plan.turn ? (i * 360) / n : 0;
      out.push({ centerXmm: cx + plan.radiusMm * Math.sin(a), centerYmm: cy - plan.radiusMm * Math.cos(a), rotationDeg: normalizeDeg(t.rotationDeg + turn) });
    }
    return out;
  }
  const cols = plan.mode === 'row' ? n : Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const stepX = t.widthMm + plan.gapMm;
  const stepY = t.heightMm + plan.gapMm;
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // The last row of a grid that doesn't fill is centred too.
    const inRow = row === rows - 1 ? n - row * cols : cols;
    out.push({ centerXmm: cx + (col - (inRow - 1) / 2) * stepX, centerYmm: cy + (row - (rows - 1) / 2) * stepY, rotationDeg: t.rotationDeg });
  }
  return out;
}
