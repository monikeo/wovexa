/**
 * Team orders: names and numbers. A roster pasted from a spreadsheet personalises every text
 * layer that contains a {name}, {number} or other {column} placeholder, giving one set of print
 * files per person, plus a size breakdown for production.
 */
import type { DesignDocument, ZoneId } from '@/domain/schema';

export interface Roster {
  fields: string[];
  rows: Record<string, string>[];
}

const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/gi;
const SIZE_VALUE = /^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-6]xl|\d{2,3}(cm)?)$/i;

function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && !cur.trim()) quoted = true;
    else if (ch === delimiter) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const fieldKey = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'field';

/**
 * Parse a pasted roster: tab, comma or semicolon separated, with or without a header row. Without
 * a header, columns are recognised by their values: numbers, sizes, then names.
 */
export function parseRoster(text: string): Roster {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim());
  if (!lines.length) return { fields: [], rows: [] };
  const sample = lines[0];
  const delimiter = sample.includes('\t') ? '\t' : sample.split(';').length > sample.split(',').length ? ';' : ',';
  const table = lines.map((l) => splitLine(l, delimiter));
  const width = Math.max(...table.map((r) => r.length));
  const first = table[0].map((c) => c.toLowerCase());
  const header = first.some((c) => ['name', 'number', 'no', 'size', 'player', 'first name', 'last name'].includes(c));

  let fields: string[];
  let body: string[][];
  if (header) {
    fields = table[0].map((c) => {
      const k = fieldKey(c);
      return k === 'no' || k === 'num' || k === 'jersey' ? 'number' : k === 'player' ? 'name' : k;
    });
    body = table.slice(1);
  } else {
    body = table;
    fields = [];
    const used = new Set<string>();
    for (let col = 0; col < width; col++) {
      const values = body.map((r) => r[col] ?? '').filter(Boolean);
      let field: string;
      if (!used.has('number') && values.length && values.every((v) => /^\d{1,3}$/.test(v))) field = 'number';
      else if (!used.has('size') && values.length && values.every((v) => SIZE_VALUE.test(v))) field = 'size';
      else if (!used.has('name')) field = 'name';
      else field = `field${col + 1}`;
      used.add(field);
      fields.push(field);
    }
  }
  while (fields.length < width) fields.push(`field${fields.length + 1}`);
  const rows = body
    .map((r) => Object.fromEntries(fields.map((f, i) => [f, (r[i] ?? '').trim()])))
    .filter((row) => Object.values(row).some(Boolean));
  return { fields, rows };
}

/** Placeholder names used by the design's text layers, lower case, in order of first use. */
export function designPlaceholders(doc: DesignDocument): string[] {
  const out: string[] = [];
  for (const zone of Object.values(doc.zones)) {
    for (const id of zone.orderedLayerIds) {
      const c = zone.layers[id]?.content;
      if (c?.kind !== 'text') continue;
      for (const m of c.value.matchAll(PLACEHOLDER)) {
        const key = m[1].toLowerCase();
        if (!out.includes(key)) out.push(key);
      }
    }
  }
  return out;
}

/** Zones whose artwork changes per person. */
export function personalisedZones(doc: DesignDocument): ZoneId[] {
  return (Object.keys(doc.zones) as ZoneId[]).filter((z) =>
    Object.values(doc.zones[z].layers).some((l) => l.content.kind === 'text' && new RegExp(PLACEHOLDER.source, 'i').test(l.content.value)),
  );
}

export function fillPlaceholders(text: string, row: Record<string, string>) {
  return text.replace(PLACEHOLDER, (match, key: string) => row[key.toLowerCase()] ?? match);
}

/** A copy of the design with every placeholder filled from one roster row. */
export function personalise(doc: DesignDocument, row: Record<string, string>): DesignDocument {
  const next = structuredClone(doc);
  for (const zone of Object.values(next.zones)) {
    for (const layer of Object.values(zone.layers)) {
      if (layer.content.kind === 'text') layer.content.value = fillPlaceholders(layer.content.value, row);
    }
  }
  return next;
}

/** How many of each size the roster orders, in a sensible size order. */
export function sizeBreakdown(roster: Roster): { size: string; count: number }[] {
  if (!roster.fields.includes('size')) return [];
  const order = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', '2xl', 'xxxl', '3xl', '4xl', '5xl', '6xl'];
  const counts = new Map<string, number>();
  for (const row of roster.rows) {
    const size = (row.size || 'Unspecified').toUpperCase();
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  const rank = (s: string) => {
    const i = order.indexOf(s.toLowerCase());
    if (i >= 0) return i;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? 100 + n : 1000;
  };
  return [...counts].map(([size, count]) => ({ size, count })).sort((a, b) => rank(a.size) - rank(b.size));
}

/** CSV text with quoting where needed. */
export function toCsv(rows: (string | number)[][]) {
  return rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\r\n') + '\r\n';
}
