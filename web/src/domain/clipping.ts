/**
 * Clipping (spec ED2-05): a layer marked `clip` shows only where the layer under it has ink, like a
 * photo inside lettering or a texture inside a shape. Clipped layers stacked together all clip to the
 * first unclipped layer below them, their base, as in other design tools. A clipped layer with
 * nothing under it draws as usual.
 */

interface ClipStack {
  orderedLayerIds: string[];
  layers: Record<string, { clip?: boolean } | undefined>;
}

/** A base layer and the layers clipped to it, bottom first. */
export interface ClipRun {
  id: string;
  clipped: string[];
}

/** The stack, bottom first, as base layers each carrying the layers clipped to it. */
export function clipRuns(stack: ClipStack): ClipRun[] {
  const runs: ClipRun[] = [];
  for (const id of stack.orderedLayerIds) {
    const layer = stack.layers[id];
    if (!layer) continue;
    const last = runs[runs.length - 1];
    if (layer.clip && last) last.clipped.push(id);
    else runs.push({ id, clipped: [] });
  }
  return runs;
}

/** For each clipped layer, the base it is cut to. */
export function clipBases(stack: ClipStack): Record<string, string> {
  const bases: Record<string, string> = {};
  for (const run of clipRuns(stack)) for (const id of run.clipped) bases[id] = run.id;
  return bases;
}
