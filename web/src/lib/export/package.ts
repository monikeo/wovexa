/**
 * Production package (spec §15, EXP-04…10, FAC-01…06): one ZIP with everything a factory or
 * print shop needs, built from the saved document.
 *
 *   print/                 true-size transparent PNGs with their dpi written into the file
 *   print/separations/     screen-print films, one per ink, with registration marks
 *   team/                  personalised print files per person, roster and size breakdown
 *   flats/                 placement drawings per colourway
 *   mockups/               3D product images per colourway
 *   cut-and-sew/           every pattern piece with its all-over print and bleed
 *   marker/                every piece of the order nested on the fabric roll, in roll lengths
 *   proof.pdf              two-page client proof with an approval line
 *   tech-sheet.html        the full spec, linking to the files above
 *   colourways.csv         every colour part as HEX, RGB and approximate CMYK
 *   manifest.json          machine-readable index with SHA-256 for every file
 */
import { getGarment, getSize, partColor, PRINT_METHOD_LABELS, zoneSpecOrFirst, type ZoneSpec } from '@/domain/garments';
import { documentHash } from '@/domain/hash';
import { runPreflight } from '@/domain/preflight';
import { describeAreaPlacement, designAreas } from '@/domain/areas';
import { projectionsAsZone } from '@/domain/projected';
import type { Colorway, DesignArea, DesignDocument, ZoneId } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from '@/lib/assets';
import { canvasToBlob, sha256Hex } from '@/lib/download';
import { findFont } from '@/lib/fonts';
import { getFont } from '@/lib/local-db';
import { ensureFonts, layoutText, renderZoneArtwork } from '@/lib/render/zone-renderer';
import { renderZoneSketch } from '@/lib/thumbnail';
import { fileSafe, formatName, isoDate, revisionLabel } from './naming';
import { pngBlobWithDpi } from './png-dpi';
import { renderCutAndSew } from './cut-and-sew';
import { buildMarker, type MarkerSummary } from './marker';
import { DEFAULT_MARKER, type MarkerSettings } from './marker-layout';
import { buildProofPdf, placementText, type ProofInput } from './proof';
import { personalise, personalisedAreas, personalisedZones, sizeBreakdown, toCsv, type Roster } from './roster';
import { buildSeparations, type Ink } from './separations';
import { approxCmyk, buildTechSheet, hexToRgb, type TechSheetInput } from './tech-sheet';
import { zoneSvg } from './svg-artwork';
import { ZipWriter } from './zip';

export interface PackageOptions {
  dpi: number;
  /** File-name template for print files (see naming.ts). */
  naming: string;
  include: {
    print: boolean;
    separations: boolean;
    flats: boolean;
    mockups: boolean;
    proof: boolean;
    techSheet: boolean;
    /** Every pattern piece with its all-over print, for sublimation (main colourway). */
    cutAndSew?: boolean;
    /** Every piece of the order nested on the fabric roll, printed at true size (main colourway). */
    marker?: boolean;
    /** The garment as a GLB 3D model (main colourway). */
    model?: boolean;
    /** Each print file again as SVG: text and shapes as vector, photos and raster effects as placed images. */
    vector?: boolean;
  };
  colorways: 'active' | 'all';
  /** The order: one garment per row in its size; names and numbers personalise prints. */
  roster?: Roster | null;
  marker?: MarkerSettings;
}

export interface ProductShot {
  view: string;
  label: string;
  canvas: HTMLCanvasElement;
}

export interface ProductRenderOptions {
  /** No backdrop, so the garment can be cropped and placed on a page. */
  transparent?: boolean;
  width?: number;
  height?: number;
}

export interface PackageContext {
  /** 3D product images for one colourway. Absent when the 3D view is closed. */
  renderProducts?: (colorwayId: string, opts?: ProductRenderOptions) => Promise<ProductShot[]>;
  /** The garment as a 3D model in the main colourway. Absent when the 3D view is closed. */
  renderModel?: () => Promise<Blob>;
  approval: { label: string; status: 'approved' | 'changed-since-approval' | 'draft'; versionNumber?: number | null; hash?: string | null };
  signal?: AbortSignal;
  onProgress?: (label: string, fraction: number) => void;
}

export interface PackageFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface PackageResult {
  blob: Blob;
  fileName: string;
  files: PackageFile[];
  warnings: string[];
  /** v3, r12 or a design ID: see revisionLabel. */
  revision: string;
  marker?: MarkerSummary;
}

/** Progress units the marker counts for: nesting, printing pieces and writing roll lengths take a while. */
const MARKER_STEPS = 8;

/** Fonts the print files use and where they come from, so the factory can check licensing (spec AST-07). */
export async function fontsUsed(doc: DesignDocument) {
  const seen = new Map<string, { family: string; weights: number[]; source: string; licence: string; file?: string }>();
  for (const zone of [...Object.values(doc.zones), projectionsAsZone(doc), ...designAreas(doc)]) {
    for (const layer of Object.values(zone.layers)) {
      const c = layer.content;
      if (c.kind !== 'text' || !layer.visible) continue;
      const key = c.fontAssetId ?? c.fontFamily;
      const entry = seen.get(key) ?? { family: c.fontFamily, weights: [], source: '', licence: '' };
      if (!entry.weights.includes(c.fontWeight)) entry.weights.push(c.fontWeight);
      if (!entry.source) {
        if (c.fontAssetId) {
          const stored = await getFont(c.fontAssetId);
          entry.source = 'Uploaded to WOVEXA';
          entry.licence = stored?.licenseNote || 'Uploader confirmed they may use this font for print';
          entry.file = stored?.fileName;
        } else {
          entry.source = findFont(c.fontFamily) ? 'Google Fonts' : 'Unknown';
          entry.licence = findFont(c.fontFamily) ? 'SIL Open Font License 1.1' : 'Not confirmed';
        }
      }
      seen.set(key, entry);
    }
  }
  return [...seen.values()];
}

/** Images and fonts every zone, projected layer and colourway needs, loaded before anything is drawn. */
export async function prepareDocument(doc: DesignDocument, zones: ZoneId[]) {
  const ids = new Set<string>();
  const projected = projectionsAsZone(doc);
  const stacks = [...zones.map((z) => doc.zones[z]), projected, ...designAreas(doc)];
  for (const zone of stacks) for (const l of Object.values(zone.layers)) if (l.content.kind === 'image') ids.add(l.content.assetId);
  for (const c of doc.colorways) for (const s of Object.values(c.surfaces ?? {})) if (s?.kind === 'image') ids.add(s.assetId);
  await Promise.all([...ids].filter((id) => !getLoadedImage(id)).map((id) => loadAssetImage(id).catch(() => null)));
  await ensureFonts(stacks);
}

export function zonesWithArtwork(doc: DesignDocument): ZoneId[] {
  const model = getGarment(doc.garment.modelId);
  return model.zoneOrder.filter((z) => doc.zones[z].orderedLayerIds.some((id) => doc.zones[z].layers[id]?.visible));
}

/** Design areas that print: shown, with at least one visible layer. Each is a print file of its own. */
export function areasWithArtwork(doc: DesignDocument): DesignArea[] {
  return designAreas(doc).filter((a) => a.visible && a.orderedLayerIds.some((id) => a.layers[id]?.visible));
}

/** Relative luminance below this reads as a dark garment that needs a white underbase. */
const DARK = 0.42;
function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const release = (c: HTMLCanvasElement) => {
  c.width = 0;
  c.height = 0;
};

/**
 * Personalised text keeps the designed letter height and its natural proportions, like jersey
 * lettering: a short name is narrower than the placeholder box, a long one shrinks to fit its
 * width. The text stays anchored by its alignment, along the layer's rotation.
 */
export function fitPersonalisedText(person: DesignDocument, original: DesignDocument) {
  const stacks = [
    ...(Object.keys(person.zones) as ZoneId[]).map((z) => [person.zones[z], original.zones[z]] as const),
    ...designAreas(person).map((a) => [a, original.areas?.items[a.id]] as const),
  ];
  for (const [zone, originalStack] of stacks) {
    for (const [id, layer] of Object.entries(zone.layers)) {
      const before = originalStack?.layers[id];
      if (layer.content.kind !== 'text' || before?.content.kind !== 'text' || before.content.value === layer.content.value) continue;
      const m = layoutText(layer.content);
      if (!m.width || !m.height) continue;
      const aspect = m.width / m.height;
      const t = layer.transform;
      let h = t.heightMm;
      let w = h * aspect;
      if (w > t.widthMm) {
        w = t.widthMm;
        h = w / aspect;
      }
      const shift = layer.content.align === 'left' ? -(t.widthMm - w) / 2 : layer.content.align === 'right' ? (t.widthMm - w) / 2 : 0;
      const a = (t.rotationDeg * Math.PI) / 180;
      t.centerXmm += shift * Math.cos(a);
      t.centerYmm += shift * Math.sin(a);
      t.widthMm = w;
      t.heightMm = h;
    }
  }
  return person;
}

/** Placement drawings of the given zones for one colourway; zones with artwork show their print area. */
async function renderFlats(doc: DesignDocument, colorway: Colorway, size: number, zoneList: ZoneId[]) {
  const withArt = zonesWithArtwork(doc);
  const out: { zoneId: ZoneId; canvas: HTMLCanvasElement }[] = [];
  for (const zoneId of zoneList) out.push({ zoneId, canvas: await renderZoneSketch(doc, zoneId, size, { printArea: withArt.includes(zoneId), colorwayId: colorway.id }) });
  return out;
}

/**
 * The two-page client proof. Uses 3D product images when given, otherwise front and back
 * flats for up to four colourways.
 */
async function makeProof(doc: DesignDocument, colorways: Colorway[], products: ProofInput['products'], approval: string, roster: Roster | null, rev: string) {
  const model = getGarment(doc.garment.modelId);
  const size = getSize(model, doc.garment.sizeCode);
  const fabric = model.fabricPresets.find((f) => f.id === doc.garment.fabricPresetId) ?? model.fabricPresets[0];
  const zones = zonesWithArtwork(doc);
  const own: HTMLCanvasElement[] = [];
  let rows = products;
  if (!rows.length) {
    rows = [];
    const views = model.zoneOrder.filter((z) => z === 'front' || z === 'back');
    for (const c of colorways.slice(0, 4)) {
      const flats = await renderFlats(doc, c, 900, views);
      own.push(...flats.map((f) => f.canvas));
      rows.push({ colorway: c, images: flats.map((f) => ({ label: zoneSpecOrFirst(model, f.zoneId).label, canvas: f.canvas })) });
    }
  }
  const placements: ProofInput['placements'] = [];
  for (const zoneId of zones.slice(0, 6)) {
    const spec = zoneSpecOrFirst(model, zoneId);
    placements.push({
      label: spec.label,
      method: PRINT_METHOD_LABELS[doc.zones[zoneId].printMethod],
      widthMm: spec.printableWidthMm,
      heightMm: spec.printableHeightMm,
      where: placementText(spec),
      sketch: await renderZoneSketch(doc, zoneId, 900, { printArea: true }),
      art: renderZoneArtwork(doc.zones[zoneId], spec.printableWidthMm, spec.printableHeightMm, 72).canvas,
    });
  }
  // Design areas sit on the 3D garment: their artwork, with where they go in words.
  for (const area of areasWithArtwork(doc).slice(0, Math.max(0, 6 - placements.length))) {
    placements.push({
      label: area.name,
      method: PRINT_METHOD_LABELS[area.printMethod],
      widthMm: area.widthMm,
      heightMm: area.heightMm,
      where: describeAreaPlacement(area),
      sketch: null,
      art: renderZoneArtwork(area, area.widthMm, area.heightMm, 72).canvas,
    });
  }
  const blob = await buildProofPdf({
    doc,
    model,
    size,
    fabricLabel: fabric.label,
    products: rows,
    placements,
    approval,
    revision: rev,
    team: roster ? { people: roster.rows.length, sizes: sizeBreakdown(roster) } : undefined,
  });
  for (const p of placements) {
    if (p.sketch) release(p.sketch);
    release(p.art);
  }
  own.forEach(release);
  return { blob, fileName: `${fileSafe(doc.title) || 'design'}_proof_${rev}.pdf` };
}

/** The label that names exports of this design: v3 when approved, r12 when synced, else a design ID. */
export async function designRevision(doc: DesignDocument, approval: PackageContext['approval']) {
  return revisionLabel(doc.revision, await documentHash(doc), approval.status === 'approved' ? approval.versionNumber : null);
}

/** Just the client proof, as a PDF, for sending to a customer for approval. */
export async function buildClientProof(doc: DesignDocument, opts: { colorways: 'active' | 'all'; roster?: Roster | null }, ctx: PackageContext) {
  const active = doc.colorways.find((c) => c.id === doc.activeColorwayId) ?? doc.colorways[0];
  const colorways = opts.colorways === 'all' ? doc.colorways : [active];
  ctx.onProgress?.('Loading images and fonts', 0.05);
  await prepareDocument(doc, zonesWithArtwork(doc));
  const products: ProofInput['products'] = [];
  if (ctx.renderProducts) {
    for (const [i, c] of colorways.slice(0, 4).entries()) {
      abortIfNeeded(ctx.signal);
      ctx.onProgress?.(`Product images, ${c.name}`, 0.1 + (0.6 * i) / Math.min(4, colorways.length));
      const shots = await ctx.renderProducts(c.id, { transparent: true, width: 720, height: 900 });
      products.push({ colorway: c, images: shots.map((s) => ({ label: s.label, canvas: s.canvas })) });
    }
  }
  abortIfNeeded(ctx.signal);
  ctx.onProgress?.('Laying out the proof', 0.8);
  const roster = opts.roster?.rows.length && personalisedZones(doc).length ? opts.roster : null;
  const proof = await makeProof(doc, colorways, products, ctx.approval.label, roster, await designRevision(doc, ctx.approval));
  for (const row of products) for (const img of row.images) release(img.canvas);
  return proof;
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

export async function buildProductionPackage(doc: DesignDocument, opts: PackageOptions, ctx: PackageContext): Promise<PackageResult> {
  const model = getGarment(doc.garment.modelId);
  const size = getSize(model, doc.garment.sizeCode);
  const fabric = model.fabricPresets.find((f) => f.id === doc.garment.fabricPresetId) ?? model.fabricPresets[0];
  const active = doc.colorways.find((c) => c.id === doc.activeColorwayId) ?? doc.colorways[0];
  const colorways = opts.colorways === 'all' ? doc.colorways : [active];
  const zones = zonesWithArtwork(doc);
  const printedAreas = areasWithArtwork(doc);
  const roster = opts.roster?.rows.length ? opts.roster : null;
  const teamZones = roster ? personalisedZones(doc).filter((z) => zones.includes(z)) : [];
  const teamAreas = roster ? personalisedAreas(doc) : [];
  const screenZones = opts.include.separations ? zones.filter((z) => doc.zones[z].printMethod === 'SCREEN_PRINT') : [];
  const zip = new ZipWriter();
  const files: PackageFile[] = [];
  const warnings: string[] = [];
  const date = isoDate();
  const contentHash = await documentHash(doc);
  const rev = revisionLabel(doc.revision, contentHash, ctx.approval.status === 'approved' ? ctx.approval.versionNumber : null);

  // Progress: one unit per file-producing step.
  const total =
    1 +
    zones.length +
    printedAreas.length +
    screenZones.length +
    (roster && (teamZones.length || teamAreas.length) ? roster.rows.length : 0) +
    (opts.include.flats ? colorways.length : 0) +
    (opts.include.mockups ? colorways.length : 0) +
    (opts.include.proof ? 2 : 0) +
    (opts.include.techSheet ? 1 : 0) +
    (opts.include.cutAndSew ? 1 : 0) +
    (opts.include.marker ? MARKER_STEPS : 0) +
    (opts.include.model ? 1 : 0) +
    (opts.include.vector ? zones.length + printedAreas.length : 0);
  let done = 0;
  // Vector print files: their fonts are noted once for the printer.
  const vectorFonts = new Set<string>();
  const addVector = async (stack: Parameters<typeof zoneSvg>[0], widthMm: number, heightMm: number, label: string, name: string) => {
    step(`Vector print file, ${label}`);
    const art = zoneSvg(stack, widthMm, heightMm, { dpi: opts.dpi, title: `${doc.title}, ${label}` });
    art.fonts.forEach((f) => vectorFonts.add(f));
    const file = await add(`print/vector/${name}.svg`, art.svg, 'image/svg+xml');
    outputs.push({ zone: label, filename: file, format: 'svg', physicalWidthMm: widthMm, physicalHeightMm: heightMm, liveTextFonts: art.fonts, placedImages: art.rasterLayers, sha256: files[files.length - 1].sha256 });
  };
  const step = (label: string) => {
    abortIfNeeded(ctx.signal);
    ctx.onProgress?.(label, Math.min(0.99, done / total));
    done++;
  };
  const add = async (path: string, data: Blob | string, type = 'text/plain;charset=utf-8') => {
    const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
    const stored = await zip.add(path, blob);
    files.push({ path: stored, bytes: blob.size, sha256: await sha256Hex(blob) });
    return stored;
  };
  const nameFor = (zoneId: ZoneId, spec: ZoneSpec, dpi: number, extra: Record<string, string | number> = {}) =>
    formatName(opts.naming, {
      project: doc.title,
      zone: zoneId,
      colorway: active.name,
      size: doc.garment.sizeCode,
      method: PRINT_METHOD_LABELS[doc.zones[zoneId].printMethod],
      w: spec.printableWidthMm,
      h: spec.printableHeightMm,
      dpi,
      rev,
      date,
      ...extra,
    });

  step('Loading images and fonts');
  await prepareDocument(doc, zones);

  // ---- Print files and screen-print films ----
  const zoneRecords: TechSheetInput['zones'] = [];
  const outputs: Record<string, unknown>[] = [];
  const darkGarment = colorways.some((c) => luminance(c.parts.body) < DARK);
  const inksByZone: Partial<Record<ZoneId, Ink[]>> = {};
  for (const zoneId of zones) {
    const spec = zoneSpecOrFirst(model, zoneId);
    step(`Print file, ${spec.label}`);
    const { canvas, dpi } = renderZoneArtwork(doc.zones[zoneId], spec.printableWidthMm, spec.printableHeightMm, opts.dpi);
    if (dpi < opts.dpi) warnings.push(`${spec.label} was exported at ${dpi} dpi to stay within the browser's image size limit.`);
    const name = nameFor(zoneId, spec, dpi);
    const record: TechSheetInput['zones'][number] = { zoneId, file: '', widthPx: canvas.width, heightPx: canvas.height, dpi };
    if (opts.include.print) {
      const blob = await pngBlobWithDpi(await canvasToBlob(canvas), dpi);
      record.file = await add(`print/${name}.png`, blob);
      outputs.push({
        zone: zoneId,
        filename: record.file,
        format: 'png',
        colorSpace: 'sRGB',
        physicalWidthMm: spec.printableWidthMm,
        physicalHeightMm: spec.printableHeightMm,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        dpi,
        printMethod: doc.zones[zoneId].printMethod,
        placement: placementText(spec),
        finishes: [...new Set(doc.zones[zoneId].orderedLayerIds.map((id) => doc.zones[zoneId].layers[id].style.finish))],
        sha256: files[files.length - 1].sha256,
      });
    }
    if (screenZones.includes(zoneId)) {
      step(`Screen films, ${spec.label}`);
      const set = buildSeparations(canvas, dpi, { label: `${doc.title} · ${spec.label} · ${rev}`, underbase: darkGarment });
      inksByZone[zoneId] = set.inks;
      record.inks = set.inks;
      record.separationFiles = [];
      for (const plate of set.plates) {
        const blob = await pngBlobWithDpi(await canvasToBlob(plate.canvas), dpi);
        record.separationFiles.push(await add(`print/separations/${fileSafe(spec.label.toLowerCase())}/${plate.file}.png`, blob));
        release(plate.canvas);
      }
      if (set.tonal) warnings.push(`${spec.label} has gradients or photo tones. The films print them as flat ink; ask your printer for halftone separations.`);
      if (set.inks.length > 6) warnings.push(`${spec.label} needs ${set.inks.length} screens. Most presses take 6 to 8; fewer colours cost less.`);
    }
    release(canvas);
    zoneRecords.push(record);
    if (opts.include.vector) await addVector(doc.zones[zoneId], spec.printableWidthMm, spec.printableHeightMm, spec.label, nameFor(zoneId, spec, opts.dpi));
  }

  // ---- Design areas: a print file each, at its own size, with where it goes in words ----
  for (const area of printedAreas) {
    step(`Print file, ${area.name}`);
    const { canvas, dpi } = renderZoneArtwork(area, area.widthMm, area.heightMm, opts.dpi);
    if (dpi < opts.dpi) warnings.push(`${area.name} was exported at ${dpi} dpi to stay within the browser's image size limit.`);
    if (opts.include.print) {
      const name = formatName(opts.naming, {
        project: doc.title,
        zone: fileSafe(area.name.toLowerCase()),
        colorway: active.name,
        size: doc.garment.sizeCode,
        method: PRINT_METHOD_LABELS[area.printMethod],
        w: Math.round(area.widthMm),
        h: Math.round(area.heightMm),
        dpi,
        rev,
        date,
      });
      const blob = await pngBlobWithDpi(await canvasToBlob(canvas), dpi);
      const file = await add(`print/areas/${name}.png`, blob);
      outputs.push({
        zone: area.name,
        designArea: true,
        filename: file,
        format: 'png',
        colorSpace: 'sRGB',
        physicalWidthMm: area.widthMm,
        physicalHeightMm: area.heightMm,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        dpi,
        printMethod: area.printMethod,
        placement: describeAreaPlacement(area),
        finishes: [...new Set(area.orderedLayerIds.map((id) => area.layers[id]?.style.finish).filter(Boolean))],
        sha256: files[files.length - 1].sha256,
      });
    }
    release(canvas);
    if (opts.include.vector) {
      const name = formatName(opts.naming, { project: doc.title, zone: fileSafe(area.name.toLowerCase()), colorway: active.name, size: doc.garment.sizeCode, method: PRINT_METHOD_LABELS[area.printMethod], w: Math.round(area.widthMm), h: Math.round(area.heightMm), dpi: opts.dpi, rev, date });
      await addVector(area, area.widthMm, area.heightMm, area.name, `areas/${name}`);
    }
  }
  if (vectorFonts.size) warnings.push(`The SVG print files keep text as live text in ${[...vectorFonts].join(', ')}. The printer needs these fonts installed, or the text outlined.`);

  // ---- Team order: one print set per person ----
  let teamFile: string | undefined;
  if (roster) {
    if (!teamZones.length && !teamAreas.length) {
      // A roster of sizes alone is an order for the marker; names and numbers need a placeholder to print.
      if (roster.fields.some((f) => f !== 'size')) warnings.push('Names and numbers were not printed: add {name} or {number} to a text layer to personalise them.');
    } else {
      const listing: (string | number)[][] = [['#', ...roster.fields, 'files']];
      for (let i = 0; i < roster.rows.length; i++) {
        const row = roster.rows[i];
        step(`Team file ${i + 1} of ${roster.rows.length}`);
        const person = personalise(doc, row);
        await ensureFonts([...teamZones.map((z) => person.zones[z]), ...designAreas(person)]);
        fitPersonalisedText(person, doc);
        const folder = `team/${String(i + 1).padStart(3, '0')}${row.name ? `_${fileSafe(row.name)}` : ''}${row.number ? `_${fileSafe(row.number)}` : ''}`;
        const made: string[] = [];
        for (const zoneId of teamZones) {
          const spec = zoneSpecOrFirst(model, zoneId);
          const { canvas, dpi } = renderZoneArtwork(person.zones[zoneId], spec.printableWidthMm, spec.printableHeightMm, opts.dpi);
          const blob = await pngBlobWithDpi(await canvasToBlob(canvas), dpi);
          made.push(await add(`${folder}/${nameFor(zoneId, spec, dpi, { name: row.name ?? '', number: row.number ?? '' })}.png`, blob));
          release(canvas);
        }
        // A name or number in a design area (on the hood, down a sleeve): its own file per person.
        for (const area of teamAreas) {
          const own = person.areas?.items[area.id];
          if (!own) continue;
          const { canvas, dpi } = renderZoneArtwork(own, own.widthMm, own.heightMm, opts.dpi);
          const blob = await pngBlobWithDpi(await canvasToBlob(canvas), dpi);
          const name = formatName(opts.naming, { project: doc.title, zone: fileSafe(own.name.toLowerCase()), colorway: active.name, size: doc.garment.sizeCode, method: PRINT_METHOD_LABELS[own.printMethod], w: Math.round(own.widthMm), h: Math.round(own.heightMm), dpi, rev, date, name: row.name ?? '', number: row.number ?? '' });
          made.push(await add(`${folder}/${name}.png`, blob));
          release(canvas);
        }
        listing.push([i + 1, ...roster.fields.map((f) => row[f] ?? ''), made.join(' ')]);
      }
      teamFile = await add('team/roster.csv', toCsv(listing), 'text/csv;charset=utf-8');
      const sizes = sizeBreakdown(roster);
      if (sizes.length) await add('team/sizes.csv', toCsv([['size', 'quantity'], ...sizes.map((s) => [s.size, s.count])]), 'text/csv;charset=utf-8');
    }
  }

  // ---- Placement flats per colourway ----
  const colorwayFlats: Record<string, string[]> = {};
  const flatZones = zones.length ? zones : model.zoneOrder.slice(0, 1);
  if (opts.include.flats) {
    for (const c of colorways) {
      step(`Placement drawings, ${c.name}`);
      colorwayFlats[c.id] = [];
      for (const flat of await renderFlats(doc, c, 1400, flatZones)) {
        const path = await add(`flats/${fileSafe(c.name)}/${flat.zoneId}.png`, await canvasToBlob(flat.canvas));
        colorwayFlats[c.id].push(path);
        const record = zoneRecords.find((z) => z.zoneId === flat.zoneId);
        if (record && c.id === active.id) record.flat = path;
        release(flat.canvas);
      }
    }
  }

  // ---- Product images ----
  const mockups: Record<string, string[]> = {};
  const proofProducts: ProofInput['products'] = [];
  if (opts.include.mockups) {
    if (!ctx.renderProducts) warnings.push('Product images were skipped: open the 3D or Split view to include them.');
    else {
      for (const [i, c] of colorways.entries()) {
        step(`Product images, ${c.name}`);
        const shots = await ctx.renderProducts(c.id);
        mockups[c.id] = [];
        for (const shot of shots) {
          mockups[c.id].push(await add(`mockups/${fileSafe(c.name)}/${shot.view}.jpg`, await canvasToBlob(shot.canvas, 'image/jpeg', 0.92)));
          release(shot.canvas);
        }
        // The proof shows up to four colourways, cut out on a transparent background.
        if (opts.include.proof && i < 4) {
          const cutouts = await ctx.renderProducts(c.id, { transparent: true, width: 720, height: 900 });
          proofProducts.push({ colorway: c, images: cutouts.map((s) => ({ label: s.label, canvas: s.canvas })) });
        }
      }
    }
  }

  // ---- Cut-and-sew panels and the 3D model (main colourway) ----
  if (opts.include.cutAndSew) {
    step('Cut-and-sew panels');
    const pieces = renderCutAndSew(doc, active, `${doc.title} · ${active.name} · size ${doc.garment.sizeCode} · ${rev}`);
    for (const [i, piece] of pieces.entries()) {
      await add(`cut-and-sew/${fileSafe(active.name)}/${String(i + 1).padStart(2, '0')}-${piece.id}.png`, await pngBlobWithDpi(await canvasToBlob(piece.canvas), piece.dpi));
      release(piece.canvas);
    }
  }
  let marker: MarkerSummary | undefined;
  if (opts.include.marker) {
    step('Fabric marker');
    const start = done - 1;
    const made = await buildMarker(doc, active, roster, opts.marker ?? DEFAULT_MARKER, {
      caption: `${doc.title} · ${active.name} · ${rev}`,
      personalZones: teamZones,
      personalise: teamZones.length
        ? async (row) => {
            const person = personalise(doc, row);
            await ensureFonts(teamZones.map((z) => person.zones[z]));
            return fitPersonalisedText(person, doc);
          }
        : undefined,
      signal: ctx.signal,
      onProgress: (label, fraction) => ctx.onProgress?.(label, Math.min(0.99, (start + fraction * MARKER_STEPS) / total)),
    });
    for (const f of made.files) await add(f.path, f.blob);
    warnings.push(...made.warnings);
    marker = made.summary;
    done = start + MARKER_STEPS;
  }
  if (opts.include.model) {
    step('3D model');
    if (!ctx.renderModel) warnings.push('The 3D model was skipped: open the 3D or Split view to include it.');
    else await add(`3d/${fileSafe(doc.title) || 'garment'}_${fileSafe(active.name)}.glb`, await ctx.renderModel());
  }

  // ---- Client proof ----
  if (opts.include.proof) {
    step('Client proof');
    const proof = await makeProof(doc, colorways, proofProducts, ctx.approval.label, roster && (teamZones.length || teamAreas.length) ? roster : null, rev);
    step('Client proof');
    await add(proof.fileName, proof.blob);
  }
  for (const row of proofProducts) for (const img of row.images) release(img.canvas);

  // ---- Colour specification ----
  const colourRows: (string | number)[][] = [['colourway', 'part', 'hex', 'r', 'g', 'b', 'c', 'm', 'y', 'k']];
  for (const c of doc.colorways) {
    for (const { part, label } of model.colorParts) {
      const hex = partColor(c, part).toUpperCase();
      colourRows.push([c.name, label, hex, ...hexToRgb(hex), ...approxCmyk(hex)]);
    }
  }
  await add('colourways.csv', toCsv(colourRows), 'text/csv;charset=utf-8');

  const fonts = await fontsUsed(doc);
  const issues = runPreflight(doc)
    .filter((i) => i.severity !== 'info')
    .map(({ severity, code, zoneId, layerId, message }) => ({ severity, code, zoneId, layerId, message }));

  if (opts.include.techSheet) {
    step('Tech sheet');
    await add(
      'tech-sheet.html',
      buildTechSheet({
        doc,
        model,
        size,
        fabricLabel: fabric.label,
        approval: ctx.approval.label,
        revision: rev,
        contentHash,
        dpi: opts.dpi,
        zones: zoneRecords,
        colorwayFlats,
        mockups,
        fonts,
        issues,
        team: teamFile && roster ? { people: roster.rows.length, sizes: sizeBreakdown(roster), file: teamFile } : undefined,
        marker,
      }),
      'text/html;charset=utf-8',
    );
  }

  await add(
    'README.txt',
    [
      `${doc.title}, production package ${rev}`,
      `Made with WOVEXA on ${date}. ${ctx.approval.label}.`,
      '',
      'print/              Print files: transparent PNG at true physical size. The resolution is written into each file,',
      '                    so it opens at the right size in RIP and design software.',
      screenZones.length ? 'print/separations/  Screen-print films, one per ink (black = ink), with registration marks in a 15 mm margin.' : null,
      opts.include.vector ? 'print/vector/       The same print files as SVG at true size (1 unit = 1 mm): text and shapes as vector, photos and' : null,
      opts.include.vector ? '                    raster effects as placed images. For screen-print films, vinyl cutting and embroidery digitising.' : null,
      teamFile ? 'team/               One folder per person with their personalised print files, roster.csv and sizes.csv.' : null,
      opts.include.flats ? 'flats/              Placement drawings for each colourway, with the print area outlined.' : null,
      Object.keys(mockups).length ? 'mockups/            Product images for each colourway.' : null,
      opts.include.cutAndSew ? 'cut-and-sew/        Every pattern piece with its all-over print and any artwork across seams (split at each seam), 10 mm bleed and a dashed cut line, for sublimation.' : null,
      opts.include.cutAndSew ? '                    Not mirrored: set mirroring for transfer paper in your RIP.' : null,
      marker
        ? `marker/             Every piece of the order nested on a ${marker.rollWidthMm / 10} cm roll at true size (${marker.dpi} dpi), in ${marker.lengths.length} roll ${marker.lengths.length === 1 ? 'length' : 'lengths'}:`
        : null,
      marker
        ? `                    ${(marker.lengthMm / 1000).toFixed(2)} m of fabric, ${Math.round(marker.utilisation * 100)}% used. Pieces keep the grain along the roll${marker.allowTurn ? ' and turn 180° at most' : ''}.`
        : null,
      marker ? `                    marker-plan.png shows the layout; marker-pieces.csv lists every piece and where it lies.` : null,
      marker && marker.format === 'pdf' ? '                    PDF cut lines are also CutContour vector paths for print-and-cut RIPs.' : null,
      marker ? '                    Not mirrored: set mirroring for transfer paper in your RIP.' : null,
      opts.include.model && ctx.renderModel ? '3d/                 The garment as a GLB 3D model, in metres, for viewers, Blender and AR.' : null,
      opts.include.proof ? '*_proof_*.pdf       Client proof with an approval line.' : null,
      opts.include.techSheet ? 'tech-sheet.html     Full specification. Open it in any browser from the unzipped folder.' : null,
      'colourways.csv      Every colour part as HEX, RGB and approximate CMYK.',
      'manifest.json       Machine-readable index of this package with the SHA-256 of every file.',
      '',
      'Screen colours are sRGB previews; CMYK values are approximate. Confirm colour, placement and print method',
      'with a physical sample before bulk production. Puff, embroidery and metallic effects appear only in previews;',
      'print files contain flat artwork.',
      warnings.length ? `\nNotes from this export:\n${warnings.map((w) => `- ${w}`).join('\n')}` : null,
    ]
      .filter((l) => l !== null)
      .join('\r\n'),
  );

  step('Manifest');
  const manifest = {
    packageVersion: 2,
    generator: 'WOVEXA web',
    generatedAt: new Date().toISOString(),
    projectId: doc.projectId,
    documentId: doc.id,
    title: doc.title,
    revision: doc.revision,
    designLabel: rev,
    contentHash,
    approval: { status: ctx.approval.status, versionNumber: ctx.approval.versionNumber ?? null, contentHash: ctx.approval.hash ?? null },
    garment: { ...doc.garment, modelName: model.name, calibrated: model.calibrated, sizeLabel: model.category === 'uniform' ? `${size.code} cm` : size.code, fabric: fabric.label },
    units: 'mm',
    settings: { dpi: opts.dpi, naming: opts.naming, colorways: opts.colorways, include: opts.include },
    colorways: doc.colorways,
    outputs,
    separations: Object.fromEntries(Object.entries(inksByZone).map(([z, inks]) => [z, inks])),
    team: roster && (teamZones.length || teamAreas.length) ? { people: roster.rows.length, fields: roster.fields, zones: teamZones, areas: teamAreas.map((a) => a.name), sizes: sizeBreakdown(roster) } : null,
    marker: marker ?? null,
    fonts,
    preflight: issues,
    production: {
      constructionNotes: doc.production.constructionNotes,
      factoryContact: doc.production.factoryContact,
      billOfMaterials: doc.production.bom,
      qaChecklist: doc.production.qa,
    },
    warnings,
    files,
    notes: 'Screen colours are sRGB previews. Puff, embroidery and metallic finishes are shown as simulations in previews only; print files contain flat artwork. Confirm colour, placement and print method with a physical proof before production.',
  };
  await zip.add('manifest.json', JSON.stringify(manifest, null, 2));
  ctx.onProgress?.('Finishing the ZIP', 1);
  return { blob: zip.finish(), fileName: `${fileSafe(doc.title) || 'wovexa'}_production_${rev}.zip`, files, warnings, revision: rev, marker };
}
