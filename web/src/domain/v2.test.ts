import { describe, expect, it } from 'vitest';
import { alignUnits, distributeUnits, expandToGroups, selectionUnits } from './arrange';
import * as cmd from './commands';
import { diffDocuments } from './diff';
import { createDocument, createShapeLayer, createTextLayer } from './factory';
import { TEE_CLASSIC } from './garments';
import { rotatedBounds } from './geometry';
import { canonicalJson, documentHash } from './hash';
import { applyCommand, emptyHistory, undo } from './history';
import { runPreflight } from './preflight';
import { migrateDesignDocument, migrateV1toV2, parseDesignDocument, type DesignDocument } from './schema';
import { BUILT_IN_TEMPLATES, instantiateTemplate } from './templates';

const front = TEE_CLASSIC.zones.front;
const area = { x: 0, y: 0, width: front.printableWidthMm, height: front.printableHeightMm };

function apply(doc: DesignDocument, ...commands: cmd.Command[]) {
  let history = emptyHistory();
  for (const c of commands) ({ document: doc, history } = applyCommand(doc, history, c));
  return { doc, history };
}

function shapeAt(x: number, y: number, size = 20, name = 'S') {
  const l = createShapeLayer(front, 'rect');
  l.name = name;
  l.transform = { ...l.transform, centerXmm: x, centerYmm: y, widthMm: size, heightMm: size };
  return l;
}

/** A v1 document as the first release stored it. */
function v1Document() {
  const v2 = createDocument({ projectId: 'p1', title: 'Old tee' });
  const text = createTextLayer(front, 'HELLO');
  v2.zones.front.layers[text.id] = text;
  v2.zones.front.orderedLayerIds.push(text.id);
  const v1 = JSON.parse(JSON.stringify(v2));
  v1.schemaVersion = 1;
  delete v1.production;
  delete v1.zones.front.layers[text.id].content.curveDeg;
  v1.notes = 'Double-needle hem';
  return v1;
}

describe('schema v2 migration', () => {
  it('upgrades a v1 document and keeps its notes as construction notes', () => {
    const result = migrateDesignDocument(v1Document());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migratedFrom).toBe(1);
    expect(result.document.schemaVersion).toBe(2);
    expect(result.document.production.constructionNotes).toBe('Double-needle hem');
    expect(result.document.production.bom.every((r) => !r.confirmed)).toBe(true);
    const text = Object.values(result.document.zones.front.layers)[0];
    expect(text.content.kind === 'text' && text.content.curveDeg).toBe(0);
  });

  it('is deterministic', () => {
    const v1 = v1Document();
    expect(migrateV1toV2(v1)).toEqual(migrateV1toV2(v1));
  });

  it('leaves current documents untouched and refuses newer formats', () => {
    const doc = createDocument({ projectId: 'p1', title: 'New' });
    const same = migrateDesignDocument(doc);
    expect(same.ok && same.migratedFrom).toBe(undefined);
    expect(migrateDesignDocument({ ...doc, schemaVersion: 3 }).ok).toBe(false);
  });
});

describe('arrange', () => {
  it('aligns several units to the selection bounds', () => {
    const a = shapeAt(50, 50);
    const b = shapeAt(120, 90, 40);
    const changes = alignUnits([[a], [b]], 'left', area);
    expect(changes[a.id]).toBeUndefined(); // already the leftmost
    expect(changes[b.id]?.centerXmm).toBeCloseTo(60); // left edge 40 + half width 20
  });

  it('aligns a single unit to the print area', () => {
    const a = shapeAt(50, 50);
    expect(alignUnits([[a]], 'hcenter', area)[a.id]?.centerXmm).toBeCloseTo(front.printableWidthMm / 2);
    expect(alignUnits([[a]], 'bottom', area)[a.id]?.centerYmm).toBeCloseTo(front.printableHeightMm - 10);
  });

  it('distributes with equal gaps and keeps the outer units fixed', () => {
    const a = shapeAt(20, 50);
    const b = shapeAt(40, 50);
    const c = shapeAt(220, 50);
    const changes = distributeUnits([[a], [b], [c]], 'horizontal');
    expect(changes[a.id]).toBeUndefined();
    expect(changes[c.id]).toBeUndefined();
    expect(changes[b.id]?.centerXmm).toBeCloseTo(120);
  });

  it('moves a group as one unit', () => {
    const doc = createDocument({ projectId: 'p1', title: 'G' });
    const a = shapeAt(40, 40);
    const b = shapeAt(80, 40);
    const { doc: grouped } = apply(doc, cmd.addLayer('front', a), cmd.addLayer('front', b), cmd.groupLayers('front', [a.id, b.id], 'g1'));
    const zone = grouped.zones.front;
    const units = selectionUnits(zone, [a.id, b.id]);
    expect(units).toHaveLength(1);
    const changes = alignUnits(units, 'left', area);
    expect(changes[a.id]?.centerXmm).toBeCloseTo(10);
    expect(changes[b.id]?.centerXmm).toBeCloseTo(50);
    expect(expandToGroups(zone, [b.id])).toEqual([a.id, b.id]);
  });
});

describe('group commands', () => {
  it('gathers members into one block at the topmost member and keeps the document valid', () => {
    const doc = createDocument({ projectId: 'p1', title: 'G' });
    const [a, b, c] = [shapeAt(10, 10, 5, 'a'), shapeAt(20, 20, 5, 'b'), shapeAt(30, 30, 5, 'c')];
    const { doc: d } = apply(doc, cmd.addLayer('front', a), cmd.addLayer('front', b), cmd.addLayer('front', c), cmd.groupLayers('front', [a.id, c.id], 'g1'));
    expect(d.zones.front.orderedLayerIds).toEqual([b.id, a.id, c.id]);
    expect(parseDesignDocument(d).ok).toBe(true);
  });

  it('moves groups past neighbours as a block', () => {
    const doc = createDocument({ projectId: 'p1', title: 'G' });
    const [a, b, c] = [shapeAt(10, 10, 5, 'a'), shapeAt(20, 20, 5, 'b'), shapeAt(30, 30, 5, 'c')];
    const { doc: d } = apply(doc, cmd.addLayer('front', a), cmd.addLayer('front', b), cmd.addLayer('front', c), cmd.groupLayers('front', [a.id, b.id], 'g1'), cmd.moveLayerBy('front', a.id, 1));
    expect(d.zones.front.orderedLayerIds).toEqual([c.id, a.id, b.id]);
    const { doc: e } = apply(d, cmd.reorderLayer('front', b.id, 0));
    expect(e.zones.front.orderedLayerIds).toEqual([a.id, b.id, c.id]);
  });

  it('duplicates a whole group as a new group, and a lone member as ungrouped', () => {
    const doc = createDocument({ projectId: 'p1', title: 'G' });
    const [a, b] = [shapeAt(10, 10, 5, 'a'), shapeAt(20, 20, 5, 'b')];
    const { doc: d } = apply(doc, cmd.addLayer('front', a), cmd.addLayer('front', b), cmd.groupLayers('front', [a.id, b.id], 'g1'));
    const whole = apply(d, cmd.duplicateLayers('front', { [a.id]: 'a2', [b.id]: 'b2' })).doc.zones.front;
    expect(whole.layers.a2.groupId).toBe('g-a2');
    expect(whole.layers.b2.groupId).toBe('g-a2');
    expect(whole.orderedLayerIds).toEqual([a.id, b.id, 'a2', 'b2']);
    const lone = apply(d, cmd.duplicateLayers('front', { [a.id]: 'a3' })).doc.zones.front;
    expect(lone.layers.a3.groupId).toBeUndefined();
  });

  it('ungroups every member of the group', () => {
    const doc = createDocument({ projectId: 'p1', title: 'G' });
    const [a, b] = [shapeAt(10, 10, 5, 'a'), shapeAt(20, 20, 5, 'b')];
    const { doc: d } = apply(doc, cmd.addLayer('front', a), cmd.addLayer('front', b), cmd.groupLayers('front', [a.id, b.id], 'g1'), cmd.ungroupLayers('front', [a.id]));
    expect(Object.values(d.zones.front.layers).every((l) => !l.groupId)).toBe(true);
  });
});

describe('production commands', () => {
  it('edits, confirms and removes bill-of-materials rows, undoably', () => {
    const doc = createDocument({ projectId: 'p1', title: 'P' });
    const row = doc.production.bom[0];
    const { doc: d, history } = apply(doc, cmd.updateBomItem(row.id, { supplierRef: 'JX-180', confirmed: true }), cmd.removeBomItem(doc.production.bom[1].id));
    expect(d.production.bom[0]).toMatchObject({ supplierRef: 'JX-180', confirmed: true });
    expect(d.production.bom).toHaveLength(doc.production.bom.length - 1);
    expect(undo(d, history).document.production.bom).toHaveLength(doc.production.bom.length);
  });

  it('restores a snapshot as a new edit that can be undone', () => {
    const base = createDocument({ projectId: 'p1', title: 'Base' });
    const edited = apply(base, cmd.addLayer('front', shapeAt(50, 50)), cmd.renameDocument('Edited')).doc;
    const { doc: restored, history } = apply(edited, cmd.restoreSnapshot(base));
    expect(restored.title).toBe('Base');
    expect(restored.zones.front.orderedLayerIds).toHaveLength(0);
    expect(restored.id).toBe(edited.id);
    expect(undo(restored, history).document).toEqual(edited);
  });
});

describe('history coalescing', () => {
  it('merges rapid repeats of one gesture into a single undo step', () => {
    const doc = createDocument({ projectId: 'p1', title: 'C' });
    const a = shapeAt(50, 50);
    let r = applyCommand(doc, emptyHistory(), cmd.addLayer('front', a), 0);
    const added = r.document;
    for (let i = 1; i <= 5; i++) {
      r = applyCommand(r.document, r.history, cmd.coalescing(cmd.updateTransforms('front', { [a.id]: { centerXmm: 50 + i } }, 'Nudge'), `nudge:${a.id}`), i * 100);
    }
    expect(r.history.past).toHaveLength(2);
    expect(r.document.zones.front.layers[a.id].transform.centerXmm).toBe(55);
    expect(undo(r.document, r.history).document).toEqual(added);
  });

  it('starts a new step after a pause', () => {
    const doc = createDocument({ projectId: 'p1', title: 'C' });
    const a = shapeAt(50, 50);
    let r = applyCommand(doc, emptyHistory(), cmd.addLayer('front', a), 0);
    r = applyCommand(r.document, r.history, cmd.coalescing(cmd.updateTransforms('front', { [a.id]: { centerXmm: 51 } }), 'k'), 100);
    r = applyCommand(r.document, r.history, cmd.coalescing(cmd.updateTransforms('front', { [a.id]: { centerXmm: 52 } }), 'k'), 5000);
    expect(r.history.past).toHaveLength(3);
  });
});

describe('diff', () => {
  it('describes moves, additions and removals in words', () => {
    const base = createDocument({ projectId: 'p1', title: 'D' });
    const a = shapeAt(50, 50, 20, 'Logo');
    const b = shapeAt(80, 80, 20, 'Badge');
    const before = apply(base, cmd.addLayer('front', a), cmd.addLayer('front', b)).doc;
    const after = apply(before, cmd.updateTransforms('front', { [a.id]: { centerXmm: 58, centerYmm: 47 } }), cmd.removeLayers('front', [b.id]), cmd.setGarmentSize('L')).doc;
    const texts = diffDocuments(before, after).map((c) => c.text);
    expect(texts).toContain('Logo: moved 8.0 mm right, 3.0 mm up');
    expect(texts).toContain('Removed Badge');
    expect(texts).toContain('Size M → L');
  });

  it('reports nothing for identical documents', () => {
    const doc = createDocument({ projectId: 'p1', title: 'Same' });
    expect(diffDocuments(doc, structuredClone(doc))).toEqual([]);
  });
});

describe('hash', () => {
  it('ignores key order and the server revision, but not content', async () => {
    const doc = createDocument({ projectId: 'p1', title: 'H' });
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    const h1 = await documentHash(doc);
    expect(await documentHash({ ...doc, revision: 7 })).toBe(h1);
    expect(await documentHash({ ...doc, title: 'Other' })).not.toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('built-in templates', () => {
  it.each(BUILT_IN_TEMPLATES.map((t) => [t.name, t] as const))('%s is a valid, print-ready document', (_, def) => {
    const doc = instantiateTemplate(def, 'p-template');
    expect(parseDesignDocument(doc).ok).toBe(true);
    expect(runPreflight(doc).filter((i) => i.severity === 'error')).toEqual([]);
    for (const zone of Object.values(doc.zones)) {
      for (const id of zone.orderedLayerIds) {
        const b = rotatedBounds(zone.layers[id].transform);
        expect(b.width).toBeGreaterThan(0);
      }
    }
  });

  it('uses the colourway the template asks for', () => {
    const jersey = BUILT_IN_TEMPLATES.find((t) => t.id === 'team-jersey')!;
    const doc = instantiateTemplate(jersey, 'p1');
    expect(doc.colorways.find((c) => c.id === doc.activeColorwayId)?.name).toBe('Deep navy');
  });
});
