import { describe, expect, it } from 'vitest';
import * as cmd from './commands';
import { createDocument, createImageLayer, createTextLayer } from './factory';
import { TEE_CLASSIC } from './garments';
import { documentHash } from './hash';
import { applyCommand, emptyHistory, undo } from './history';
import { runPreflight } from './preflight';
import { artworkAsProjected, projectedAsArtwork, projectedLayers } from './projected';
import { migrateDesignDocument, parseDesignDocument, SCHEMA_VERSION, type DesignDocument, type ProjectedLayer, type ProjectorSpec } from './schema';

const front = TEE_CLASSIC.zones.front!;
/** Over the wearer's left shoulder, facing forward and up. */
const SHOULDER: ProjectorSpec = { point: [190, 700, 60], normal: [0.3, 0.55, 0.78], up: [0, 0.8, -0.56] };

function apply(doc: DesignDocument, ...commands: cmd.Command[]) {
  let history = emptyHistory();
  for (const c of commands) ({ document: doc, history } = applyCommand(doc, history, c));
  return { doc, history };
}

function projectedText(name = 'Crest'): ProjectedLayer {
  return artworkAsProjected(createTextLayer(front, name), SHOULDER);
}

describe('schema v4: projected layers', () => {
  it('upgrades a v3 document with an empty list and leaves its artwork alone', () => {
    const doc = createDocument({ projectId: 'p1', title: 'Old' });
    const text = createTextLayer(front, 'HELLO');
    doc.zones.front.layers[text.id] = text;
    doc.zones.front.orderedLayerIds.push(text.id);
    const v3 = JSON.parse(JSON.stringify(doc));
    delete v3.projections;
    v3.schemaVersion = 3;
    const result = migrateDesignDocument(v3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(3);
    expect(result.document.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.document.projections).toEqual({ orderedLayerIds: [], layers: {} });
    expect(result.document.zones).toEqual(doc.zones);
  });

  it('keeps an approval: an upgrade with no projected artwork hashes the same', async () => {
    const doc = createDocument({ projectId: 'p1', title: 'Approved' });
    const before = await documentHash(doc);
    const v3 = JSON.parse(JSON.stringify(doc));
    delete v3.projections;
    v3.schemaVersion = 3;
    const upgraded = migrateDesignDocument(v3);
    expect(upgraded.ok && (await documentHash(upgraded.document))).toBe(before);
    // Projected artwork is content: adding it changes the hash.
    const withArt = apply(doc, cmd.addProjectedLayer(projectedText())).doc;
    expect(await documentHash(withArt)).not.toBe(before);
  });

  it('validates projectors and the stacking list', () => {
    const doc = apply(createDocument({ projectId: 'p1', title: 'P' }), cmd.addProjectedLayer(projectedText())).doc;
    expect(parseDesignDocument(doc).ok).toBe(true);
    const id = doc.projections.orderedLayerIds[0];
    const noNormal = structuredClone(doc);
    noNormal.projections.layers[id].projector.normal = [0, 0, 0];
    expect(parseDesignDocument(noNormal).ok).toBe(false);
    const unordered = structuredClone(doc);
    unordered.projections.orderedLayerIds = [];
    expect(parseDesignDocument(unordered).ok).toBe(false);
    const nan = structuredClone(doc);
    nan.projections.layers[id].projector.point = [Number.NaN, 0, 0];
    expect(parseDesignDocument(nan).ok).toBe(false);
  });

  it('keeps content and size when moving between a zone and the garment', () => {
    const text = createTextLayer(front, 'ACROSS');
    text.transform.rotationDeg = 12;
    text.transform.flipX = true;
    const projected = artworkAsProjected(text, SHOULDER);
    expect(projected.transform).toEqual({ widthMm: text.transform.widthMm, heightMm: text.transform.heightMm, rotationDeg: 12, flipX: true, flipY: false });
    expect('centerXmm' in projected.transform).toBe(false);
    const back = projectedAsArtwork(projected, { xMm: 80, yMm: 60 });
    expect(back.content).toEqual(text.content);
    expect(back.transform).toEqual({ ...text.transform, centerXmm: 80, centerYmm: 60 });
  });
});

describe('projected layer commands', () => {
  it('wraps zone artwork across seams and back as single undo steps', () => {
    const base = createDocument({ projectId: 'p1', title: 'W' });
    const text = createTextLayer(front, 'WRAP');
    const added = apply(base, cmd.addLayer('front', text)).doc;
    const { doc, history } = apply(added, cmd.wrapAcrossSeams('front', text.id, artworkAsProjected(text, SHOULDER)));
    expect(doc.zones.front.orderedLayerIds).toEqual([]);
    expect(doc.projections.orderedLayerIds).toEqual([text.id]);
    expect(doc.projections.layers[text.id].projector).toEqual(SHOULDER);
    expect(parseDesignDocument(doc).ok).toBe(true);
    expect(history.past.at(-1)?.label).toBe('Wrap across seams');
    expect(undo(doc, history).document).toEqual(added);

    const back = { ...projectedAsArtwork(doc.projections.layers[text.id], { xMm: 120, yMm: 90 }) };
    const returned = apply(doc, cmd.returnToZone(text.id, 'back', back)).doc;
    expect(returned.projections.orderedLayerIds).toEqual([]);
    expect(returned.zones.back.layers[text.id].transform.centerXmm).toBe(120);
    expect(parseDesignDocument(returned).ok).toBe(true);
  });

  it('moves, resizes and turns a projected layer, ignoring zone positions', () => {
    const layer = projectedText();
    const moved: ProjectorSpec = { point: [0, 400, 150], normal: [0, 0, 1], up: [0, 1, 0] };
    const { doc, history } = apply(
      createDocument({ projectId: 'p1', title: 'M' }),
      cmd.addProjectedLayer(layer),
      cmd.updateProjectedLayer(layer.id, { projector: moved }, 'Move on garment'),
      cmd.updateProjectedLayer(layer.id, { transform: { widthMm: 150, rotationDeg: -20, centerXmm: 99 } }, 'Resize'),
    );
    const out = doc.projections.layers[layer.id];
    expect(out.projector).toEqual(moved);
    expect(out.transform.widthMm).toBe(150);
    expect(out.transform.rotationDeg).toBe(-20);
    expect('centerXmm' in out.transform).toBe(false);
    expect(parseDesignDocument(doc).ok).toBe(true);
    expect(undo(doc, history).document.projections.layers[layer.id].projector).toEqual(moved);
  });

  it('duplicates, reorders and deletes projected layers', () => {
    const a = projectedText('A');
    const b = projectedText('B');
    let doc = apply(createDocument({ projectId: 'p1', title: 'S' }), cmd.addProjectedLayer(a), cmd.addProjectedLayer(b)).doc;
    doc = apply(doc, cmd.duplicateProjectedLayer(a.id, 'a2')).doc;
    expect(doc.projections.orderedLayerIds).toEqual([a.id, 'a2', b.id]);
    expect(doc.projections.layers.a2.name).toBe('A copy');
    doc = apply(doc, cmd.reorderProjectedLayer(a.id, 5)).doc;
    expect(doc.projections.orderedLayerIds).toEqual(['a2', b.id, a.id]);
    doc = apply(doc, cmd.removeProjectedLayers(['a2', b.id])).doc;
    expect(projectedLayers(doc).map((l) => l.id)).toEqual([a.id]);
    expect(parseDesignDocument(doc).ok).toBe(true);
  });

  it('restores projected layers with a snapshot', () => {
    const base = apply(createDocument({ projectId: 'p1', title: 'R' }), cmd.addProjectedLayer(projectedText())).doc;
    const edited = apply(base, cmd.removeProjectedLayers(base.projections.orderedLayerIds)).doc;
    const restored = apply(edited, cmd.restoreSnapshot(base)).doc;
    expect(restored.projections).toEqual(base.projections);
  });
});

describe('preflight for projected layers', () => {
  it('says artwork across seams needs sublimation or cut-and-sew', () => {
    const layer = projectedText();
    const doc = apply(createDocument({ projectId: 'p1', title: 'F' }), cmd.addProjectedLayer(layer)).doc;
    const issues = runPreflight(doc);
    const seam = issues.find((i) => i.code === 'cross_seam');
    expect(seam?.projectionId).toBe(layer.id);
    expect(seam?.message).toMatch(/sublimation or cut-and-sew/);
    // It is artwork: the design is no longer empty.
    expect(issues.some((i) => i.code === 'empty_design')).toBe(false);
  });

  it('checks resolution, text size and finishes that sublimation can’t print', () => {
    const image = createImageLayer(front, { id: 'a1', width: 300, height: 300, mime: 'image/png', name: 'small.png' });
    image.transform.widthMm = image.transform.heightMm = 200;
    const img = artworkAsProjected(image, SHOULDER);
    const tiny = projectedText('tiny');
    tiny.transform.heightMm = 2;
    const puff = projectedText('puff');
    puff.style.finish = 'puff';
    const hidden = projectedText('hidden');
    hidden.visible = false;
    const doc = apply(createDocument({ projectId: 'p1', title: 'C' }), ...[img, tiny, puff, hidden].map((l) => cmd.addProjectedLayer(l))).doc;
    const issues = runPreflight(doc);
    expect(issues.find((i) => i.projectionId === img.id && i.code === 'low_dpi')?.severity).toBe('error');
    expect(issues.find((i) => i.projectionId === tiny.id && i.code === 'small_text')?.severity).toBe('warning');
    expect(issues.find((i) => i.projectionId === puff.id && i.code === 'flat_finish')?.severity).toBe('warning');
    expect(issues.some((i) => i.projectionId === hidden.id)).toBe(false);
  });
});
