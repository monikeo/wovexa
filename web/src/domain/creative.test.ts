import { describe, expect, it } from 'vitest';
import * as cmd from './commands';
import { createDocument, createImageLayer, createShapeLayer, createTextLayer } from './factory';
import { TEE_CLASSIC } from './garments';
import { normalizeDeg, scaleRotateAbout } from './geometry';
import { applyCommand, emptyHistory, undo } from './history';
import { effectiveDpi } from './preflight';
import { DEFAULT_SCENE, SCENE_PRESETS, sceneOf, toneOf, TONES } from './scene';
import { parseDesignDocument, type DesignDocument } from './schema';

const front = TEE_CLASSIC.zones.front!;

function withLayers(...layers: ReturnType<typeof createTextLayer>[]) {
  const doc = createDocument({ projectId: 'p', title: 'Creative' });
  for (const l of layers) {
    doc.zones.front.layers[l.id] = l;
    doc.zones.front.orderedLayerIds.push(l.id);
  }
  return doc;
}

function run(doc: DesignDocument, ...commands: cmd.Command[]) {
  let history = emptyHistory();
  for (const c of commands) ({ document: doc, history } = applyCommand(doc, history, c));
  return { doc, history };
}

describe('direct manipulation maths', () => {
  const t = (cx: number, cy: number, w = 20, h = 10, r = 0) => ({ centerXmm: cx, centerYmm: cy, widthMm: w, heightMm: h, rotationDeg: r });

  it('scales one layer about its own centre', () => {
    const out = scaleRotateAbout({ a: t(100, 50) }, 2, 0);
    expect(out.a).toMatchObject({ centerXmm: 100, centerYmm: 50, widthMm: 40, heightMm: 20 });
  });

  it('turns a selection as one rigid unit', () => {
    const out = scaleRotateAbout({ a: t(0, 0, 10, 10), b: t(20, 0, 10, 10) }, 1, 90);
    // Centre of the pair is (10, 0); a quarter turn puts a above it and b below.
    expect(out.a.centerXmm).toBeCloseTo(10, 6);
    expect(out.a.centerYmm).toBeCloseTo(-10, 6);
    expect(out.b.centerYmm).toBeCloseTo(10, 6);
    expect(out.a.rotationDeg).toBe(90);
  });

  it('never shrinks a layer below the minimum size', () => {
    const out = scaleRotateAbout({ a: t(0, 0, 10, 4) }, 0.01, 0, 2);
    expect(out.a.heightMm).toBeCloseTo(2, 6);
    expect(out.a.widthMm).toBeCloseTo(5, 6);
  });

  it('folds angles into [-180, 180)', () => {
    expect(normalizeDeg(190)).toBe(-170);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(360)).toBe(0);
  });
});

describe('creative fields in the v2 document', () => {
  it('accepts text effects, new shapes, image adjustments, repeats, distress and a scene', () => {
    const text = createTextLayer(front, 'WAVE');
    Object.assign(text.content, {
      wave: 40,
      shadow: { color: '#000000', offsetXmm: 2, offsetYmm: 2, blurMm: 0 },
      fillStyle: { kind: 'gradient', to: '#2B59FF', angleDeg: 90 },
    });
    text.style.distress = { amount: 0.4, scaleMm: 6, seed: 12 };
    const star = createShapeLayer(front, 'star');
    star.content = { ...star.content, kind: 'shape', fillStyle: { kind: 'pattern', pattern: 'dots', color2: '#FFFFFF', scaleMm: 8, angleDeg: 0 } } as typeof star.content;
    const image = createImageLayer(front, { id: 'asset-1', width: 1200, height: 800, mime: 'image/png', name: 'logo.png' });
    Object.assign(image.content, {
      adjust: { brightness: 110, contrast: 100, saturation: 0, hue: 0, grayscale: true, invert: false, threshold: 128 },
      repeat: { mode: 'half-drop', tileWidthMm: 40, spacingMm: 4, rotationDeg: 15, offsetXmm: 0, offsetYmm: 0 },
    });
    const doc = withLayers(text, star, createShapeLayer(front, 'heart'), createShapeLayer(front, 'line'), image);
    doc.scene = { ...DEFAULT_SCENE, presetId: 'dark', cameras: [{ id: 'c1', name: 'Hero', position: [1, 0.3, 2], target: [0, 0, 0], fovDeg: 22 }] };
    const parsed = parseDesignDocument(JSON.parse(JSON.stringify(doc)));
    expect(parsed.ok).toBe(true);
  });

  it('rejects out-of-range creative values', () => {
    const star = createShapeLayer(front, 'star');
    (star.content as { points?: number }).points = 2;
    expect(parseDesignDocument(withLayers(star)).ok).toBe(false);
    const image = createImageLayer(front, { id: 'a', width: 10, height: 10, mime: 'image/png', name: 'x' });
    Object.assign(image.content, { repeat: { mode: 'grid', tileWidthMm: 1, spacingMm: 0, rotationDeg: 0, offsetXmm: 0, offsetYmm: 0 } });
    expect(parseDesignDocument(withLayers(image)).ok).toBe(false);
  });

  it('documents without the new fields still parse and use the default scene', () => {
    const doc = createDocument({ projectId: 'p', title: 'Plain' });
    expect(parseDesignDocument(doc).ok).toBe(true);
    expect(sceneOf(doc)).toEqual(DEFAULT_SCENE);
  });

  it('creates lines as thin rounded bars and stars with five points', () => {
    const line = createShapeLayer(front, 'line');
    expect(line.transform.heightMm).toBe(4);
    expect(line.content).toMatchObject({ shape: 'line', cornerRadiusMm: 2 });
    expect(createShapeLayer(front, 'star').content).toMatchObject({ points: 5, innerRatio: 0.45 });
  });
});

describe('creative commands', () => {
  it('removes optional style fields when patched with undefined, and undo restores them', () => {
    const text = createTextLayer(front, 'WORN');
    text.style.distress = { amount: 0.5, scaleMm: 6, seed: 3 };
    const start = withLayers(text);
    const { doc, history } = run(start, cmd.updateLayer('front', text.id, { style: { distress: undefined } }, 'No wear'));
    expect('distress' in doc.zones.front.layers[text.id].style).toBe(false);
    expect(undo(doc, history).document.zones.front.layers[text.id].style.distress).toEqual({ amount: 0.5, scaleMm: 6, seed: 3 });
  });

  it('keeps saved views, replacing one with the same id and capping the list at 12', () => {
    let doc = createDocument({ projectId: 'p', title: 'Views' });
    for (let i = 0; i < 14; i++) {
      doc = run(doc, cmd.addCameraBookmark(sceneOf(doc), { id: `v${i}`, name: `View ${i}`, position: [0, 0, 2], target: [0, 0, 0], fovDeg: 28 })).doc;
    }
    expect(doc.scene!.cameras).toHaveLength(12);
    expect(doc.scene!.cameras[0].id).toBe('v2');
    doc = run(doc, cmd.addCameraBookmark(sceneOf(doc), { id: 'v5', name: 'Renamed', position: [1, 0, 2], target: [0, 0, 0], fovDeg: 30 })).doc;
    expect(doc.scene!.cameras.filter((c) => c.id === 'v5')).toHaveLength(1);
    expect(doc.scene!.cameras.at(-1)!.name).toBe('Renamed');
    doc = run(doc, cmd.removeCameraBookmark('v5')).doc;
    expect(doc.scene!.cameras.some((c) => c.id === 'v5')).toBe(false);
  });

  it('changes scene settings without touching saved views', () => {
    let doc = createDocument({ projectId: 'p', title: 'Scene' });
    doc = run(doc, cmd.addCameraBookmark(sceneOf(doc), { id: 'v', name: 'Hero', position: [0, 0, 2], target: [0, 0, 0], fovDeg: 28 })).doc;
    doc = run(doc, cmd.updateScene(sceneOf(doc), { exposure: 1.4, presetId: 'dark' })).doc;
    expect(doc.scene).toMatchObject({ exposure: 1.4, presetId: 'dark' });
    expect(doc.scene!.cameras).toHaveLength(1);
  });

  it('keeps older scenes in true colour and stores a chosen tone', () => {
    expect(toneOf(DEFAULT_SCENE)).toBe('neutral');
    let doc = createDocument({ projectId: 'p', title: 'Tone' });
    doc = run(doc, cmd.updateScene(sceneOf(doc), { tone: 'agx' })).doc;
    expect(toneOf(sceneOf(doc))).toBe('agx');
    expect(parseDesignDocument(JSON.parse(JSON.stringify(doc))).ok).toBe(true);
  });

  it('gives every look a tone, so choosing one is predictable', () => {
    for (const preset of SCENE_PRESETS) expect(TONES.some((t) => t.id === preset.defaults.tone)).toBe(true);
  });
});

describe('print checks for repeat patterns', () => {
  it('measures resolution per tile, not per layer box', () => {
    const image = createImageLayer(front, { id: 'a', width: 600, height: 600, mime: 'image/png', name: 'tile' });
    image.transform.widthMm = 300;
    image.transform.heightMm = 400;
    // 600 px over 400 mm of height is the limiting axis: 38 dpi.
    expect(Math.round(effectiveDpi(image)!.min)).toBe(38);
    Object.assign(image.content, { repeat: { mode: 'grid', tileWidthMm: 50.8, spacingMm: 0, rotationDeg: 0, offsetXmm: 0, offsetYmm: 0 } });
    expect(Math.round(effectiveDpi(image)!.min)).toBe(300);
  });
});
