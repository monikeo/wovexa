/**
 * Self-contained HTML tech sheet for the production package (spec FAC-01…05): garment,
 * colourways with colour values, every print zone with its file, size, method and placement,
 * fonts, inks, team sizes, production notes, bill of materials and QA checklist. Images are
 * linked by their path inside the package, so it opens straight from the unzipped folder.
 */
import { partColor, PRINT_METHOD_LABELS, sizeChart, sizeLabel, type GarmentModel, type GarmentSize } from '@/domain/garments';
import type { DesignDocument, ZoneId } from '@/domain/schema';
import type { Ink } from './separations';
import { placementText, revisionText } from './proof';

export interface TechSheetInput {
  doc: DesignDocument;
  model: GarmentModel;
  size: GarmentSize;
  fabricLabel: string;
  approval: string;
  /** v3, r12 or a design ID (see revisionLabel). */
  revision: string;
  contentHash: string;
  dpi: number;
  zones: { zoneId: ZoneId; file: string; widthPx: number; heightPx: number; dpi: number; flat?: string; inks?: Ink[]; separationFiles?: string[] }[];
  colorwayFlats: Record<string, string[]>;
  mockups: Record<string, string[]>;
  fonts: { family: string; weights: number[]; source: string; licence: string; file?: string }[];
  issues: { severity: string; message: string; zoneId?: string }[];
  team?: { people: number; sizes: { size: string; count: number }[]; file: string };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0');
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** Naive, uncalibrated CMYK, as a starting point for the printer's own conversion. */
export function approxCmyk(hex: string): [number, number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 100];
  const f = (v: number) => Math.round(((1 - v - k) / (1 - k)) * 100);
  return [f(r), f(g), f(b), Math.round(k * 100)];
}

function swatch(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  const [c, m, y, k] = approxCmyk(hex);
  return `<span class="sw" style="background:${esc(hex)}"></span><span class="mono">${esc(hex.toUpperCase())}</span><span class="muted"> RGB ${r} ${g} ${b} · ≈CMYK ${c} ${m} ${y} ${k}</span>`;
}

export function buildTechSheet(input: TechSheetInput): string {
  const { doc, model, size, fabricLabel } = input;
  const date = new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
  const zoneRows = input.zones
    .map((z) => {
      const spec = model.zones[z.zoneId];
      if (!spec) return '';
      const zone = doc.zones[z.zoneId];
      const layers = zone.orderedLayerIds
        .map((id) => zone.layers[id])
        .filter((l) => l?.visible)
        .map((l) => {
          const c = l.content;
          const what =
            c.kind === 'text'
              ? `Text “${esc(c.value)}”, ${esc(c.fontFamily)} ${c.fontWeight}${c.italic ? ' italic' : ''}, ${esc(c.fill)}`
              : c.kind === 'image'
                ? `Image${c.repeat ? ', repeated' : ''}${c.mask ? `, ${c.mask} mask` : ''}`
                : `Shape (${esc(c.shape)}), ${esc(c.fill)}`;
          return `<li>${esc(l.name)}: ${what}, ${Math.round(l.transform.widthMm)} × ${Math.round(l.transform.heightMm)} mm${l.style.finish !== 'flat_ink' ? `, ${esc(l.style.finish.replace('_', ' '))} finish` : ''}</li>`;
        })
        .join('');
      const inks = z.inks?.length
        ? `<p class="small">Screen inks: ${z.inks.map((i) => `<span class="sw" style="background:${i.hex}"></span>${i.hex} (${Math.round(i.share * 100)}%)`).join('  ')}</p><p class="small muted">Films: ${(z.separationFiles ?? []).map(esc).join(', ')}</p>`
        : '';
      return `<section class="zone">
  <div class="zone-img">${z.flat ? `<img src="${esc(z.flat)}" alt="${esc(spec.label)} placement">` : ''}</div>
  <div>
    <h3>${esc(spec.label)}</h3>
    <table class="kv">
      <tr><th>Method</th><td>${esc(PRINT_METHOD_LABELS[zone.printMethod])}</td></tr>
      <tr><th>Print area</th><td>${spec.printableWidthMm} × ${spec.printableHeightMm} mm, safe inset ${spec.safeInsetMm} mm</td></tr>
      <tr><th>Placement</th><td>${esc(placementText(spec))}</td></tr>
      <tr><th>Print file</th><td><a href="${esc(z.file)}">${esc(z.file)}</a><br><span class="muted">${z.widthPx} × ${z.heightPx} px at ${z.dpi} dpi, transparent PNG, sRGB</span></td></tr>
    </table>
    <ul class="layers">${layers || '<li class="muted">No visible artwork</li>'}</ul>
    ${inks}
  </div>
</section>`;
    })
    .join('\n');

  const colourways = doc.colorways
    .map(
      (c) => `<section class="cw">
  <h3>${esc(c.name)}${c.id === doc.activeColorwayId ? ' <span class="pill">Main</span>' : ''}</h3>
  <table class="kv">${model.colorParts.map(({ part, label }) => `<tr><th>${esc(label)}</th><td>${swatch(partColor(c, part))}</td></tr>`).join('')}</table>
  ${c.surfaces && Object.values(c.surfaces).some(Boolean) ? `<p class="small">All-over fabric print on ${Object.entries(c.surfaces).filter(([, s]) => s).map(([p, s]) => `${esc(p)} (${esc(s!.kind)})`).join(', ')}. Produce by sublimation or on printed fabric.</p>` : ''}
  <div class="thumbs">${[...(input.mockups[c.id] ?? []), ...(input.colorwayFlats[c.id] ?? [])].map((src) => `<img src="${esc(src)}" alt="">`).join('')}</div>
</section>`,
    )
    .join('\n');

  const bom = doc.production.bom
    .map((b) => `<tr><td>${esc(b.component)}</td><td>${esc(b.description)}</td><td>${esc(b.supplierRef)}</td><td>${esc(b.colour)}</td><td>${esc(b.quantity)}</td><td>${b.confirmed ? 'Confirmed' : '<span class="warn">To confirm</span>'}</td></tr>`)
    .join('');
  const qa = doc.production.qa.map((q) => `<li>${q.checked ? '☑' : '☐'} ${esc(q.label)}</li>`).join('');
  const fonts = input.fonts.map((f) => `<tr><td>${esc(f.family)}</td><td>${f.weights.join(', ')}</td><td>${esc(f.source)}</td><td>${esc(f.licence)}${f.file ? `<br><span class="muted">${esc(f.file)}</span>` : ''}</td></tr>`).join('');
  const issues = input.issues.length ? `<ul>${input.issues.map((i) => `<li class="${i.severity === 'error' ? 'warn' : ''}">${esc(i.message)}</li>`).join('')}</ul>` : '<p>No open issues at export.</p>';
  const team = input.team
    ? `<h2>Team order</h2><p>${input.team.people} personalised garments. Roster and file list: <a href="${esc(input.team.file)}">${esc(input.team.file)}</a></p><table class="grid"><tr><th>Size</th>${input.team.sizes.map((s) => `<td>${esc(s.size)}</td>`).join('')}</tr><tr><th>Quantity</th>${input.team.sizes.map((s) => `<td>${s.count}</td>`).join('')}</tr></table>`
    : '';

  // Points of measure for every size: the sample size is marked, ordered sizes show quantities.
  const chart = sizeChart(model);
  const cm = (mm: number | undefined) => (mm === undefined ? '–' : (mm / 10).toFixed(mm % 10 ? 1 : 0));
  const ordered = new Map((input.team?.sizes ?? []).map((s) => [s.size, s.count]));
  const measurements = `<h2>Measurements</h2>
  <p class="small muted">Finished garment in centimetres, measured flat. ${chart.columns.map((c) => `${esc(c.label)}: ${esc(c.hint.toLowerCase())}`).join('. ')}. Tolerance ±1 cm on chest and length, ±0.5 cm on sleeve.${model.calibrated ? '' : ' Graded from a standard size chart; confirm against the factory block.'}</p>
  <table class="grid"><tr><th>Size</th>${chart.columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}${ordered.size ? '<th>Quantity</th>' : ''}</tr>${chart.rows
    .map(
      (r) =>
        `<tr${r.code === size.code ? ' class="sel"' : ''}><td>${esc(r.label)}${r.code === size.code ? ' <span class="pill">Sample</span>' : ''}</td>${chart.columns.map((c) => `<td>${cm(r.values[c.key])}</td>`).join('')}${ordered.size ? `<td>${ordered.get(r.code) ?? ''}</td>` : ''}</tr>`,
    )
    .join('')}</table>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}, tech sheet ${esc(input.revision)}</title>
<style>
  :root { --ink:#14151a; --muted:#6b6f7b; --line:#dadce2; --accent:#2b59ff; --warn:#b42318; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: var(--ink); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", "Noto Sans Khmer", "Noto Sans KR", "Noto Sans SC", sans-serif; }
  main { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 28px; line-height: 1.15; margin: 4px 0 6px; }
  h2 { font-size: 18px; margin: 36px 0 12px; padding-top: 12px; border-top: 1px solid var(--line); }
  h3 { font-size: 15px; margin: 0 0 8px; }
  .brand { font-weight: 800; letter-spacing: .02em; }
  .muted { color: var(--muted); } .small { font-size: 12.5px; } .warn { color: var(--warn); }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 99px; background: #eef2ff; color: var(--accent); font-size: 11px; vertical-align: middle; }
  .sw { display: inline-block; width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--line); vertical-align: -2px; margin-right: 6px; }
  table { border-collapse: collapse; width: 100%; }
  .kv th { text-align: left; font-weight: 500; color: var(--muted); width: 120px; padding: 3px 12px 3px 0; vertical-align: top; }
  .kv td { padding: 3px 0; }
  .grid th, .grid td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; }
  .grid tr.sel td { background: #eef2ff; font-weight: 600; }
  .zone { display: grid; grid-template-columns: 260px 1fr; gap: 20px; padding: 16px 0; border-bottom: 1px solid var(--line); }
  .zone-img img { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px; background: #f6f7f9; }
  .layers { margin: 10px 0 0; padding-left: 18px; font-size: 13px; }
  .cw { padding: 14px 0; border-bottom: 1px solid var(--line); }
  .thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .thumbs img { height: 150px; border: 1px solid var(--line); border-radius: 8px; background: #f6f7f9; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 6px 24px; margin-top: 14px; }
  @media (max-width: 640px) { .zone { grid-template-columns: 1fr; } }
  @media print { main { padding: 0; } h2 { break-before: auto; } .zone, .cw { break-inside: avoid; } a { color: inherit; } }
</style>
</head>
<body>
<main>
  <div class="brand">WOVEXA</div>
  <h1>${esc(doc.title)}</h1>
  <div class="muted">Tech sheet, ${esc(revisionText(input.revision).toLowerCase())} · ${esc(date)} · ${esc(input.approval)}</div>
  <div class="meta">
    <div><span class="muted">Garment</span><br>${esc(model.name)}${model.calibrated ? '' : ' <span class="muted">(preview pattern, confirm with the factory block)</span>'}</div>
    <div><span class="muted">Size</span><br>${esc(sizeLabel(model, size))}</div>
    <div><span class="muted">Fabric</span><br>${esc(fabricLabel)}</div>
    <div><span class="muted">Print files</span><br>${input.dpi} dpi, true size</div>
  </div>

  <h2>Print zones</h2>
  ${zoneRows || '<p class="muted">No artwork in this design.</p>'}

  <h2>Colourways</h2>
  <p class="small muted">Screen values for reference. CMYK is a rough, uncalibrated guide; match colours to a physical swatch or lab dip.</p>
  ${colourways}

  ${team}

  ${measurements}

  <h2>Fonts</h2>
  ${fonts ? `<table class="grid"><tr><th>Family</th><th>Weights</th><th>Source</th><th>Licence</th></tr>${fonts}</table>` : '<p class="muted">No text in this design.</p>'}

  <h2>Open issues at export</h2>
  ${issues}

  <h2>Construction notes</h2>
  <p>${esc(doc.production.constructionNotes || 'None given.').replace(/\n/g, '<br>')}</p>
  ${doc.production.factoryContact ? `<p class="small"><span class="muted">Factory contact:</span> ${esc(doc.production.factoryContact)}</p>` : ''}

  <h2>Bill of materials</h2>
  <table class="grid"><tr><th>Component</th><th>Description</th><th>Supplier ref</th><th>Colour</th><th>Quantity</th><th>Status</th></tr>${bom}</table>

  <h2>Sample QA checklist</h2>
  <ul>${qa}</ul>

  <p class="small muted" style="margin-top:40px">Content hash ${esc(input.contentHash)}. Every file's SHA-256 is in manifest.json. Puff, embroidery and metallic finishes appear only as simulations in previews; print files contain flat artwork.</p>
</main>
</body>
</html>
`;
}
