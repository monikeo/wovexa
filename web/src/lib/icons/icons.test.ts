import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocument } from '@/domain/factory';
import { TEE_CLASSIC } from '@/domain/garments';
import { LIMITS } from '@/domain/limits';
import { flattenSubpath, parsePath } from '@/domain/path-edit';
import { shapeContentSchema, type ArtworkLayer, type LayerStack } from '@/domain/schema';
import { Defs, shapeSvg, zoneSvg } from '@/lib/export/svg-artwork';
import { iconsSection } from '@/lib/export/tech-sheet';
import { drawLayerContent } from '@/lib/render/zone-renderer';
import { buildIconIndex, CATALOGUE_ICONS, ICON_CATEGORIES, iconLabel, searchIconIndex } from './catalog';
import { ICON_LICENCE_FILE, iconLicenceText, iconsUsed } from './credits';
import { elementPath, ICON_MAX_LINE_MM, ICON_PLACE_SHARE, ICON_STROKE_UNITS, iconLayer, iconShape, type IconData } from './icon-shape';
import { iconData, ICON_NAMES, searchIcons } from './library';
import { ICON_LICENCE_SUMMARY, LUCIDE_LICENCE, LUCIDE_VERSION } from './lucide-licence';

const web = join(__dirname, '..', '..', '..');

describe('icon library catalogue', () => {
  it('holds all of Lucide, the catalogue’s garment picks first, each icon once', () => {
    for (const c of ICON_CATEGORIES) expect(new Set(c.icons).size, c.label).toBe(c.icons.length);
    expect(ICON_NAMES.length).toBeGreaterThan(1900);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    // Every pick is in this version of Lucide (a rename there would drop it).
    for (const name of CATALOGUE_ICONS) expect(iconData(name), name).toBeDefined();
    expect(ICON_NAMES.slice(0, CATALOGUE_ICONS.length)).toEqual(CATALOGUE_ICONS);
    expect(iconData('not-an-icon')).toBeUndefined();
    expect(iconData('constructor')).toBeUndefined();
  });

  it('names icons as people say them', () => {
    expect(iconLabel('flag-triangle-right')).toBe('Flag triangle right');
    expect(iconLabel('music-2')).toBe('Music');
    expect(iconLabel('x')).toBe('X');
    expect(iconLabel('face-slightly-smiling')).toBe('Smiling face');
  });

  it('finds icons by the start of their name, and the plainest name first', () => {
    expect(searchIcons('troph')[0]).toBe('trophy');
    expect(searchIcons('ice cream')[0]).toBe('ice-cream-cone');
    const stars = searchIcons('star');
    expect(stars[0]).toBe('star');
    expect(stars).toContain('star-half');
    expect(searchIcons('arrow up')[0]).toBe('arrow-up');
    expect(searchIcons('zzqx')).toEqual([]);
  });

  it('finds icons by Lucide’s own tags, beyond the catalogue’s picks', () => {
    // "tournament" is only one of Lucide's tags for the trophy.
    expect(searchIcons('tournament')).toContain('trophy');
    // Bells aren't among the picks; their tags still find them.
    expect(CATALOGUE_ICONS).not.toContain('bell');
    expect(searchIcons('notification')).toContain('bell');
    expect(searchIcons('bell')[0]).toBe('bell');
  });

  it('puts the garment picks ahead, and finds them by everyday words and the names Lucide used to give them', () => {
    expect(searchIcons('fire')[0]).toBe('flame');
    expect(searchIcons('music').slice(0, 2)).toEqual(['eighth-notes', 'eighth-note']);
    expect(searchIcons('smile')[0]).toBe('face-slightly-smiling');
  });

  it('browses and searches a category', () => {
    const animals = ICON_CATEGORIES.find((c) => c.id === 'animals')!.icons;
    expect(searchIcons('', 'animals')).toEqual([...animals]);
    expect(searchIcons('  ', 'shapes')).toEqual([...ICON_CATEGORIES.find((c) => c.id === 'shapes')!.icons]);
    // A category's name finds its icons.
    expect(searchIcons('animals')).toEqual(expect.arrayContaining([...animals]));
    expect(searchIcons('star', 'nature')).toEqual(['star']);
  });

  it('ranks names over everyday words over tags over categories', () => {
    const index = buildIconIndex(['cup-soda', 'trophy', 'goblet', 'bell'], { goblet: ['cup', 'wine'], bell: ['ring'] });
    // The trophy is a pick with "cup" as an everyday word; the goblet only has it as a tag.
    expect(searchIconIndex(index, 'cup')).toEqual(['cup-soda', 'trophy', 'goblet']);
    expect(searchIconIndex(index, 'ring')).toEqual(['bell']);
    // Every word typed must match.
    expect(searchIconIndex(index, 'cup wine')).toEqual(['goblet']);
    // Picks first, then the rest of the set by name.
    expect(index.names).toEqual(['trophy', 'cup-soda', 'bell', 'goblet']);
  });
});

describe('icons as line shapes', () => {
  it('draws every kind of element lucide uses as path data', () => {
    expect(elementPath(['circle', { cx: 12, cy: 12, r: 3 }])).toMatch(/^M9 12A3 3/);
    expect(elementPath(['line', { x1: '2', y1: '4', x2: '22', y2: '4' }])).toBe('M2 4L22 4');
    expect(elementPath(['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }])).toContain('A2 2');
    expect(elementPath(['polyline', { points: '22 7 13.5 15.5 8.5 10.5 2 17' }])).toMatch(/^M22 7L13\.5 15\.5/);
    expect(elementPath(['polygon', { points: '12 2 22 22 2 22' }])).toMatch(/Z$/);
    expect(elementPath(['ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }])).toContain('A9 3');
    expect(elementPath(['defs', {}])).toBe('');
  });

  it('turns an icon into one path over its own extent, in the 0–100 box shapes use', () => {
    // A ring and a line beside it.
    const icon: IconData = { name: 'test', node: [['circle', { cx: 6, cy: 12, r: 4 }], ['line', { x1: 14, y1: 12, x2: 22, y2: 12 }]] };
    const shape = iconShape(icon)!;
    expect(shape.box.x).toBeCloseTo(2, 1);
    expect(shape.box.w).toBeCloseTo(20, 1);
    expect(shape.box.h).toBeCloseTo(8, 1);
    const subs = parsePath(shape.path);
    expect(subs).toHaveLength(2);
    for (const s of subs) for (const n of s.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(-0.01);
      expect(n.x).toBeLessThanOrEqual(100.01);
    }
    expect(iconShape({ name: 'nothing', node: [] })).toBeNull();
  });

  it('reads a path that opens with a relative move from its own start, as SVG does', () => {
    // Two short strokes, each its own path starting "m": joined as text, the second would be moved by the first.
    const icon: IconData = { name: 'ticks', node: [['path', { d: 'm2.5 21.5 1.4-1.4' }], ['path', { d: 'm20.1 3.9 1.4-1.4' }]] };
    const shape = iconShape(icon)!;
    expect(shape.box.x).toBeCloseTo(2.5, 5);
    expect(shape.box.x + shape.box.w).toBeCloseTo(21.5, 5);
    expect(shape.box.y).toBeCloseTo(2.5, 5);
    expect(shape.box.y + shape.box.h).toBeCloseTo(21.5, 5);
  });

  it('converts every icon in Lucide to a printable path on its grid, and places each one', () => {
    const zone = { printableWidthMm: 300, printableHeightMm: 400 };
    for (const name of ICON_NAMES) {
      const icon = iconData(name)!;
      const shape = iconShape(icon);
      expect(shape, name).not.toBeNull();
      expect(shape!.path.length, name).toBeGreaterThan(10);
      expect(shape!.path.length, name).toBeLessThan(LIMITS.pathChars);
      // Lucide draws within its 24-unit grid.
      expect(shape!.box.x, name).toBeGreaterThan(-1);
      expect(shape!.box.y, name).toBeGreaterThan(-1);
      expect(shape!.box.x + shape!.box.w, name).toBeLessThan(25);
      expect(shape!.box.y + shape!.box.h, name).toBeLessThan(25);
      // Placed, even a dot or a dash keeps a line the line width field can take, and no icon outgrows a graphic.
      const layer = iconLayer(zone, icon, iconLabel(name), '#000000')!;
      const line = layer.content.kind === 'shape' ? layer.content.strokeWidthMm! : 0;
      expect(line, name).toBeGreaterThanOrEqual(0.3);
      expect(line, name).toBeLessThanOrEqual(ICON_MAX_LINE_MM);
      expect(Math.max(layer.transform.widthMm, layer.transform.heightMm) + line, name).toBeLessThanOrEqual(135.1);
    }
  });
});

describe('an icon placed as a layer', () => {
  const zone = { printableWidthMm: 300, printableHeightMm: 400 };
  // The trophy: six separate paths (the cup, its handles, the stem and the base line).
  const trophy = iconData('trophy')!;
  const layer = iconLayer(zone, trophy, 'Trophy', '#14151A')!;
  const content = layer.content.kind === 'shape' ? layer.content : null;

  it('keeps every piece of the icon in one outline-only path, with round ends', () => {
    expect(content).not.toBeNull();
    const pieces = trophy.node.flatMap((el) => parsePath(elementPath(el))).length;
    expect(pieces).toBeGreaterThanOrEqual(trophy.node.length);
    expect(parsePath(content!.path!)).toHaveLength(pieces);
    expect(content).toMatchObject({ kind: 'shape', shape: 'path', fill: '#14151A', hollow: true, roundCaps: true, icon: { set: 'lucide', name: 'trophy' } });
    expect(content!.graphicId).toBeUndefined();
    expect(layer.name).toBe('Trophy icon');
    // It saves as any shape does.
    expect(shapeContentSchema.safeParse(content).success).toBe(true);
  });

  it('is scaled to the size it is placed at, in the icon’s own proportions, its line as heavy as the icon draws it', () => {
    const shape = iconShape(trophy)!;
    const t = layer.transform;
    const mmPerUnit = t.widthMm / shape.box.w;
    expect(t.heightMm / shape.box.h).toBeCloseTo(mmPerUnit, 6);
    expect(t.widthMm / t.heightMm).toBeCloseTo(shape.box.w / shape.box.h, 6);
    // Its ink (the drawing and the line round it) lands as library graphics do: 45% of the print area's shorter side, in the middle.
    expect((Math.max(shape.box.w, shape.box.h) + ICON_STROKE_UNITS) * mmPerUnit).toBeCloseTo(300 * ICON_PLACE_SHARE, 6);
    expect([t.centerXmm, t.centerYmm]).toEqual([150, 200]);
    // Lucide's 2-unit line, to the tenth of a millimetre.
    expect(Math.abs(content!.strokeWidthMm! - ICON_STROKE_UNITS * mmPerUnit)).toBeLessThanOrEqual(0.05 + 1e-9);
    // Every point of the icon lands where the icon puts it, scaled: the path fills the layer's box edge to edge.
    const points = parsePath(content!.path!).flatMap((s) => flattenSubpath(s, 0.01));
    const xs = points.map(([x]) => (x / 100) * t.widthMm);
    const ys = points.map(([, y]) => (y / 100) * t.heightMm);
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    expect(Math.max(...xs)).toBeCloseTo(t.widthMm, 1);
    expect(Math.min(...ys)).toBeCloseTo(0, 1);
    expect(Math.max(...ys)).toBeCloseTo(t.heightMm, 1);
    // The base line ("M4 22h16") is 16 units long, so 16 × mm-per-unit on the garment.
    const base = parsePath(content!.path!).find((s) => s.nodes.length === 2 && Math.abs(s.nodes[0].y - s.nodes[1].y) < 1e-6)!;
    expect((Math.abs(base.nodes[1].x - base.nodes[0].x) / 100) * t.widthMm).toBeCloseTo(16 * mmPerUnit, 3);
  });

  it('draws with round ends and round corners in the SVG print file, which credits it and carries its licence', () => {
    const svg = shapeSvg(content!, layer.transform.widthMm, layer.transform.heightMm, new Defs(10));
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain(`stroke-width="${content!.strokeWidthMm}"`);
    const file = zoneSvg({ orderedLayerIds: [layer.id], layers: { [layer.id]: layer } } as LayerStack, 300, 400, { dpi: 300, title: 'Front' }).svg;
    expect(file).toContain('stroke-linejoin="round" stroke-linecap="round"');
    expect(file).toMatch(/<desc>[^<]*Lucide icons \(lucide\.dev\): trophy\./);
    expect(file).toContain('<metadata id="lucide-licence">ISC License');
    expect(file).toContain('Copyright (c) 2013-present Cole Bemis');
    // A file without icons carries no licence.
    expect(zoneSvg({ orderedLayerIds: [], layers: {} } as unknown as LayerStack, 300, 400, { dpi: 300, title: 'Back' }).svg).not.toContain('<metadata');
  });

  describe('in the 2D view and the PNG and PDF print files', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('strokes with round ends and round corners at the layer’s line width', () => {
      // The canonical renderer draws all of them; here with a context that records each stroke.
      vi.stubGlobal('Path2D', class { addPath() {} });
      vi.stubGlobal('DOMMatrix', class { translate() { return this; } scale() { return this; } });
      const strokes: Record<string, unknown>[] = [];
      const state: Record<string, unknown> = { lineJoin: 'miter', lineCap: 'butt', lineWidth: 1 };
      const ctx = new Proxy(state, { get: (target, key) => (key === 'stroke' ? () => strokes.push({ ...target }) : key in target ? target[key as string] : () => undefined) });
      const pxPerMm = 4;
      expect(drawLayerContent(ctx as unknown as CanvasRenderingContext2D, layer, layer.transform.widthMm * pxPerMm, layer.transform.heightMm * pxPerMm, pxPerMm)).toBe(true);
      expect(strokes).toHaveLength(1);
      expect(strokes[0]).toMatchObject({ lineJoin: 'round', lineCap: 'round', lineWidth: content!.strokeWidthMm! * pxPerMm, strokeStyle: '#14151A' });
    });
  });
});

describe('icon credits in export packages', () => {
  it('lists the icons a design prints, on any side, once outlined too, and not the hidden ones', () => {
    const doc = createDocument({ projectId: 'p', title: 'Icons' });
    const put = (zoneId: 'front' | 'back', layer: ArtworkLayer) => {
      doc.zones[zoneId].layers[layer.id] = layer;
      doc.zones[zoneId].orderedLayerIds.push(layer.id);
    };
    const front = TEE_CLASSIC.zones.front!;
    put('front', iconLayer(front, iconData('star')!, 'Star', '#000000')!);
    put('back', iconLayer(TEE_CLASSIC.zones.back!, iconData('trophy')!, 'Trophy', '#000000')!);
    put('front', { ...iconLayer(front, iconData('skull')!, 'Skull', '#000000')!, visible: false });
    // Outlined into a filled shape, an icon is still credited.
    const outlined = iconLayer(front, iconData('anchor')!, 'Anchor', '#000000')!;
    if (outlined.content.kind === 'shape') outlined.content = { kind: 'shape', shape: 'path', fill: '#000000', cornerRadiusMm: 0, path: 'M0 0L100 0L100 100Z', icon: outlined.content.icon };
    put('front', outlined);
    expect(iconsUsed(doc)).toEqual(['anchor', 'star', 'trophy']);
    expect(iconsUsed(createDocument({ projectId: 'p', title: 'Plain' }))).toEqual([]);
  });

  it('writes the licence file and the tech sheet’s icon credits', () => {
    const text = iconLicenceText(['star', 'trophy'], { version: LUCIDE_VERSION, summary: ICON_LICENCE_SUMMARY, text: LUCIDE_LICENCE });
    expect(text).toContain(`Lucide icons (https://lucide.dev), version ${LUCIDE_VERSION}: star, trophy.`);
    expect(text).toContain(ICON_LICENCE_SUMMARY[1]);
    expect(text).toContain('ISC License');
    expect(text).toContain('Copyright (c) 2013-present Cole Bemis');
    // Windows line ends throughout, as the package's README has.
    expect(text.split('\r\n').length).toBe(text.split('\n').length);
    const html = iconsSection({ names: ['star', '<script>'], version: LUCIDE_VERSION, file: ICON_LICENCE_FILE });
    expect(html).toContain('<h2>Icons</h2>');
    expect(html).toContain(`href="${ICON_LICENCE_FILE}"`);
    expect(html).toContain('star, &lt;script&gt;');
  });
});

describe('icon licence', () => {
  const plain = (s: string) => s.replace(/\r\n/g, '\n');

  it('ships Lucide’s licence word for word, for the version installed', () => {
    const pkg = JSON.parse(readFileSync(join(web, 'node_modules', 'lucide-static', 'package.json'), 'utf8'));
    expect(LUCIDE_VERSION).toBe(pkg.version);
    expect(plain(LUCIDE_LICENCE)).toBe(plain(readFileSync(join(web, 'node_modules', 'lucide-static', 'LICENSE'), 'utf8')));
    // ISC for Lucide, MIT for the icons drawn from Feather.
    expect(LUCIDE_LICENCE).toContain('ISC License');
    expect(LUCIDE_LICENCE).toContain('The MIT License (MIT) (for the icons listed above)');
  });

  it('is in the third-party notices too', () => {
    const notices = plain(readFileSync(join(web, 'THIRD_PARTY_NOTICES.md'), 'utf8'));
    expect(notices).toContain(plain(LUCIDE_LICENCE).trim());
    expect(notices).toContain(`lucide-static ${LUCIDE_VERSION}`);
  });
});
