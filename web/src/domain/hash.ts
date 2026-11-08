/**
 * Content hashing for version snapshots and approvals (spec §29.5 step 7, EXP-05).
 * The hash covers design content only: the server revision counter is excluded, so the
 * same design always hashes the same wherever it was saved.
 */
import type { DesignDocument } from './schema';

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

export function documentHash(doc: DesignDocument): Promise<string> {
  return sha256Text(canonicalJson({ ...doc, revision: 0 }));
}
