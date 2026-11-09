/**
 * Content hashing for version snapshots and approvals (spec §29.5 step 7, EXP-05).
 * The hash covers design content only: the server revision counter is excluded, so the
 * same design always hashes the same wherever it was saved.
 */
import { V3_ZONES, type DesignDocument } from './schema';

/** JSON with object keys sorted at every level, so equal content always serializes identically. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Approvals began in format 2, so hashes always use 2 as the format version. */
const HASH_FORMAT = 2;

/**
 * A format upgrade must not change the hash of unchanged content: the format version is
 * fixed, and zones and projected layers added by an upgrade are left out while they hold no
 * artwork. So a design approved before an upgrade is still approved after it.
 */
function hashable(doc: DesignDocument) {
  const zones: Record<string, unknown> = { ...doc.zones };
  for (const zoneId of V3_ZONES) if (!doc.zones[zoneId]?.orderedLayerIds.length) delete zones[zoneId];
  const { projections, ...rest } = doc;
  return { ...rest, revision: 0, schemaVersion: HASH_FORMAT, zones, ...(projections?.orderedLayerIds.length ? { projections } : {}) };
}

export function documentHash(doc: DesignDocument): Promise<string> {
  return sha256Text(canonicalJson(hashable(doc)));
}
