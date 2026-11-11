/**
 * How much a design can hold (the limits its schema accepts), checked as each edit is applied: an
 * edit that would go past one is refused with the reason, instead of leaving a design that can't
 * be saved or opened again. Pure; cheap enough to run on every edit (it only counts).
 */
import type { DesignDocument } from './schema';

export const LIMITS = {
  /** Layers on one print zone or design area. */
  layers: 200,
  /** Layers in one lockup. */
  lockupLayers: 60,
  /** Layers placed across seams. */
  projections: 50,
  areas: 24,
  lockups: 40,
  /** Characters in one text layer. */
  textChars: 500,
  /** Characters of path data in one shape (combined shapes and drawn paths). */
  pathChars: 120_000,
  /** Characters of path data text can run along. */
  textPathChars: 20_000,
} as const;

/** The first limit the design is past, as a sentence to show, or null when it is within them all. */
export function limitProblem(doc: Pick<DesignDocument, 'zones' | 'areas' | 'lockups' | 'projections'>): string | null {
  for (const zone of Object.values(doc.zones)) if (zone.orderedLayerIds.length > LIMITS.layers) return `A print area holds up to ${LIMITS.layers} layers.`;
  const areas = doc.areas;
  if (areas && areas.orderedIds.length > LIMITS.areas) return `A design holds up to ${LIMITS.areas} design areas.`;
  for (const area of Object.values(areas?.items ?? {})) if (area.orderedLayerIds.length > LIMITS.layers) return `${area.name} holds up to ${LIMITS.layers} layers.`;
  const lockups = doc.lockups;
  if (lockups && lockups.orderedIds.length > LIMITS.lockups) return `A design holds up to ${LIMITS.lockups} lockups.`;
  for (const lockup of Object.values(lockups?.items ?? {})) if (lockup.orderedLayerIds.length > LIMITS.lockupLayers) return `A lockup holds up to ${LIMITS.lockupLayers} layers.`;
  if (doc.projections.orderedLayerIds.length > LIMITS.projections) return `A design holds up to ${LIMITS.projections} layers across seams.`;
  return null;
}
