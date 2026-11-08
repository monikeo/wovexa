/**
 * File-name templates for exports (spec EXP-08). Tokens in braces are replaced; everything else
 * is kept, then the name is made safe for every file system. Unicode letters (Khmer, Korean,
 * Chinese titles) are kept, unlike URL slugs.
 */
export const NAME_TOKENS = [
  { token: 'project', hint: 'Project title' },
  { token: 'zone', hint: 'Print zone, e.g. front' },
  { token: 'colorway', hint: 'Colourway name' },
  { token: 'size', hint: 'Garment size' },
  { token: 'method', hint: 'Print method' },
  { token: 'w', hint: 'Print width in mm' },
  { token: 'h', hint: 'Print height in mm' },
  { token: 'dpi', hint: 'Resolution' },
  { token: 'rev', hint: 'Approved version (v3), synced revision (r12) or design ID' },
  { token: 'date', hint: 'Export date, YYYY-MM-DD' },
  { token: 'name', hint: 'Roster name (team orders)' },
  { token: 'number', hint: 'Roster number (team orders)' },
] as const;

export type NameToken = (typeof NAME_TOKENS)[number]['token'];
export type NameValues = Partial<Record<NameToken, string | number>>;

export const DEFAULT_PRINT_NAME = '{project}_{zone}_{w}x{h}mm_{dpi}dpi_{rev}';

/**
 * Which design a file came from: the approved version when the design is approved, the synced
 * revision when there is one, otherwise the first characters of the content hash, which change
 * whenever the design does.
 */
export function revisionLabel(revision: number, contentHash: string, approvedVersion?: number | null) {
  if (approvedVersion) return `v${approvedVersion}`;
  if (revision > 0) return `r${revision}`;
  return contentHash.replace(/[^0-9a-f]/gi, '').slice(0, 6).toLowerCase() || 'draft';
}

/** A file-name fragment: no separators or reserved characters, spaces as hyphens. */
export function fileSafe(text: string) {
  return text
    .normalize('NFC')
    .replace(/[<>:"/\\|?*,;\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
}

/** Fill a template. Unknown tokens are dropped; the result is never empty. */
export function formatName(template: string, values: NameValues, fallback = 'wovexa') {
  const filled = template.replace(/\{([a-z]+)\}/gi, (_, key: string) => {
    const value = values[key.toLowerCase() as NameToken];
    return value === undefined || value === '' ? '' : fileSafe(String(value));
  });
  const cleaned = fileSafe(filled)
    .replace(/[_-]{2,}/g, (m) => m[0])
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

/** Tokens a template uses that are not known, for a gentle warning in the UI. */
export function unknownTokens(template: string) {
  const known = new Set<string>(NAME_TOKENS.map((t) => t.token));
  return [...template.matchAll(/\{([a-z]+)\}/gi)].map((m) => m[1].toLowerCase()).filter((t) => !known.has(t));
}

export function isoDate(date = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
