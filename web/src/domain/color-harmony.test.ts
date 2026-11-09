import { describe, expect, it } from 'vitest';
import { anchorHue, colourName, contrastRatio, designInks, hexToHsl, hslToHex, inkContrast, readability, suggestColorways, type Ink } from './color-harmony';
import { createDocument, createShapeLayer, createTextLayer } from './factory';

const WHITE_TEE = { body: '#F4F4F1', sleeves: '#F4F4F1', collar: '#F4F4F1', stitching: '#E2E2DD' };
const NAVY_TEE = { body: '#1C2740', sleeves: '#1C2740', collar: '#1C2740', stitching: '#2A3654' };
const hex = /^#[0-9A-F]{6}$/;

describe('colour maths', () => {
  it('converts between hex and HSL both ways', () => {
    expect(hexToHsl('#FF0000')).toEqual({ h: 0, s: 1, l: 0.5 });
    for (const c of ['#1F4FB8', '#B3122E', '#2F4A3A', '#D8C7A8', '#16161A']) expect(hslToHex(hexToHsl(c))).toBe(c);
  });

  it('measures contrast like WCAG', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#1F4FB8', '#1F4FB8')).toBe(1);
    expect(readability(4.5)).toBe('good');
    expect(readability(2)).toBe('fair');
    expect(readability(1.1)).toBe('poor');
  });

  it('names fabric colours plainly', () => {
    expect(colourName('#1C2740')).toBe('navy');
    expect(colourName('#F4F4F1')).toBe('white');
    expect(colourName('#16161A')).toBe('black');
    expect(colourName('#2F4A3A')).toBe('forest');
    expect(colourName('#B3122E')).toBe('red');
    expect(colourName('#A9AAAD')).toBe('grey');
    expect(colourName('#D0D2D6')).toBe('silver');
    expect(colourName('#EDE8DD')).toBe('bone');
    expect(colourName('#D8C7A8')).toBe('sand');
  });
});

describe('colourway ideas', () => {
  it('turns around the garment colour, or the artwork when the garment is neutral', () => {
    expect(Math.round(anchorHue('#1C2740', []))).toBe(Math.round(hexToHsl('#1C2740').h));
    expect(Math.round(anchorHue('#F4F4F1', ['#000000', '#E63973']))).toBe(Math.round(hexToHsl('#E63973').h));
    // Near-black navy is black on a garment, not a hue to build on.
    expect(Math.round(anchorHue('#F4F4F1', ['#111827', '#F59E0B']))).toBe(Math.round(hexToHsl('#F59E0B').h));
    expect(Math.round(anchorHue('#F4F4F1', [], ['#10B5A6']))).toBe(Math.round(hexToHsl('#10B5A6').h));
    expect(anchorHue('#F4F4F1', ['#FFFFFF'])).toBe(220);
  });

  it('offers six full colourways in fabric colours, never the current one', () => {
    const ideas = suggestColorways(NAVY_TEE, []);
    expect(ideas.map((i) => i.kind)).toEqual(['tonal', 'complementary', 'analogous', 'triadic', 'split', 'two-tone']);
    for (const idea of ideas) {
      for (const c of Object.values(idea.parts)) expect(c).toMatch(hex);
      expect(idea.name.length).toBeGreaterThan(4);
      expect(idea.weakest).toBeUndefined();
      expect(idea.parts.body).not.toBe(NAVY_TEE.body);
      // Not neon: dyed-fabric saturation.
      expect(hexToHsl(idea.parts.body).s).toBeLessThan(0.7);
    }
    // The complementary body sits opposite navy on the wheel: an orange.
    const comp = ideas.find((i) => i.kind === 'complementary')!;
    const dh = Math.abs(hexToHsl(comp.parts.body).h - hexToHsl(NAVY_TEE.body).h);
    expect(Math.min(dh, 360 - dh)).toBeGreaterThan(170);
  });

  it('chooses fabric depths the artwork reads on', () => {
    const white: Ink[] = [{ hex: '#FFFFFF', name: 'Team name', part: 'body' }];
    for (const idea of suggestColorways(WHITE_TEE, white, { brand: ['#1F4FB8'] })) {
      expect(idea.weakest?.ink.name).toBe('Team name');
      expect(readability(idea.weakest!.ratio)).toBe('good');
    }
    const black: Ink[] = [{ hex: '#000000', name: 'Logo', part: 'body' }];
    for (const idea of suggestColorways(NAVY_TEE, black)) expect(idea.weakest!.ratio).toBeGreaterThanOrEqual(3);
  });

  it('scores each ink against the fabric it is printed on', () => {
    // A white sleeve print on two-tone sleeves is checked against the sleeve colour, not the body.
    const inks: Ink[] = [{ hex: '#FFFFFF', name: 'Sleeve number', part: 'sleeves' }];
    const twoTone = suggestColorways(WHITE_TEE, inks).find((i) => i.kind === 'two-tone')!;
    expect(twoTone.weakest!.ratio).toBeCloseTo(contrastRatio('#FFFFFF', twoTone.parts.sleeves), 5);
  });

  it('builds on a reference photo: its own colourway first, harmonies around its main colour', () => {
    // A photo mostly teal, with orange and a lot of white that is no hue to build on.
    const photo = ['#FFFFFF', '#1A8C8C', '#E8772E'];
    const ideas = suggestColorways(WHITE_TEE, [], { reference: photo });
    expect(ideas[0].kind).toBe('photo');
    expect(ideas[0].name.startsWith('Photo match ')).toBe(true);
    const near = (a: string, b: string) => {
      const d = Math.abs(hexToHsl(a).h - hexToHsl(b).h);
      return Math.min(d, 360 - d) < 4;
    };
    expect(near(ideas[0].parts.body, '#1A8C8C')).toBe(true);
    expect(near(ideas[0].parts.collar, '#E8772E')).toBe(true);
    const comp = ideas.find((i) => i.kind === 'complementary')!;
    expect(near(comp.parts.collar, '#1A8C8C')).toBe(true);
    // The photo outranks the garment's own colour as what the harmonies turn around.
    expect(Math.round(anchorHue('#1C2740', [], [], photo))).toBe(Math.round(hexToHsl('#1A8C8C').h));
    expect(suggestColorways(WHITE_TEE, [], { reference: ['#FFFFFF', '#000000'] })[0].kind).toBe('tonal');
  });

  it('gives the same ideas for the same input, and new ones for another variant', () => {
    const a = suggestColorways(NAVY_TEE, [], { variant: 0 });
    expect(suggestColorways(NAVY_TEE, [], { variant: 0 })).toEqual(a);
    const b = suggestColorways(NAVY_TEE, [], { variant: 1 });
    expect(b.map((i) => i.parts.body)).not.toEqual(a.map((i) => i.parts.body));
  });

  it('reads the inks from the artwork, biggest first, with the part each sits on', () => {
    const doc = createDocument({ projectId: 'p', title: 'Inks' });
    const zone = { printableWidthMm: 300, printableHeightMm: 400 };
    const big = createShapeLayer(zone, 'rect');
    big.name = 'Panel';
    if (big.content.kind === 'shape') {
      big.content.fill = '#e63973';
      big.content.strokeColor = '#000000';
      big.content.strokeWidthMm = 2;
    }
    const small = createTextLayer({ printableWidthMm: 80, printableHeightMm: 40 }, '7');
    small.name = 'Number';
    if (small.content.kind === 'text') small.content.fill = '#FFFFFF';
    if (small.content.kind === 'text') {
      // A hairline outline doesn't hold the edge on fabric, so it doesn't count.
      small.content.strokeColor = '#000000';
      small.content.strokeWidthMm = 0.3;
    }
    const hidden = createShapeLayer(zone, 'star');
    hidden.visible = false;
    doc.zones.front.layers[big.id] = big;
    doc.zones.left_sleeve.layers[small.id] = small;
    doc.zones.front.layers[hidden.id] = hidden;
    doc.zones.front.orderedLayerIds.push(big.id, hidden.id);
    doc.zones.left_sleeve.orderedLayerIds.push(small.id);
    const inks = designInks(doc);
    expect(inks).toEqual([
      { hex: '#E63973', name: 'Panel', part: 'body', outline: '#000000' },
      { hex: '#FFFFFF', name: 'Number', part: 'sleeves' },
    ]);
  });

  it('lets a bold outline carry a faint fill', () => {
    const amber = { hex: '#F59E0B', name: 'Your text', part: 'body' as const };
    const pale = '#F4F4F1';
    expect(readability(inkContrast(amber, pale))).toBe('fair');
    expect(readability(inkContrast({ ...amber, outline: '#1E3A8A' }, pale))).toBe('good');
    // A gradient is as faint as its faintest end.
    expect(inkContrast({ ...amber, hex: '#1E3A8A', also: ['#F59E0B'] }, pale)).toBeCloseTo(contrastRatio('#F59E0B', pale), 5);
  });

  it('keeps a uniform’s pants with the body and its belt as it was', () => {
    const dobok = { body: '#F7F7F4', sleeves: '#F7F7F4', collar: '#16161A', stitching: '#E2E2DD', pants: '#F7F7F4', belt: '#16161A' };
    for (const idea of suggestColorways(dobok, [], { brand: ['#B3122E'] })) {
      expect(idea.parts.pants).toBe(idea.parts.body);
      expect(idea.parts.belt).toBe('#16161A');
    }
  });
});
