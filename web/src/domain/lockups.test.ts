import { describe, expect, it } from 'vitest';
import * as cmd from './commands';
import { artboardOf } from './areas';
import { createDocument, createShapeLayer, createTextLayer } from './factory';
import { getGarment, zoneSpecOrFirst } from './garments';
import { applyCommand, emptyHistory, redo, undo, type History } from './history';
import { boardFit, detachedLayers, kitLockupStatus, lockupForKit, lockupFromKit, lockupFromLayers, newPlacement, placementsOf, type Placement } from './lockups';
import { runPreflight } from './preflight';
import { checkDocumentInvariants, parseDesignDocument, type ArtworkLayer, type DesignDocument, type LockupId } from './schema';
import { personalise, personalisedZones } from '@/lib/export/roster';

const spec = () => zoneSpecOrFirst(getGarment('tee-classic'), 'front');

/** A front with a red square at (50, 60) and a word at (90, 60), made into one lockup placed where they were. */
function withLockup() {
  let d: DesignDocument = createDocument({ projectId: 'p1', title: 'Lockups', colorwayIndex: 0 });
  let h: History = emptyHistory();
  const run = (c: cmd.Command) => {
    const r = applyCommand(d, h, c);
    d = r.document;
    h = r.history;
  };
  const square = createShapeLayer(spec(), 'rect');
  Object.assign(square.transform, { centerXmm: 50, centerYmm: 60, widthMm: 20, heightMm: 20 });
  const word = createTextLayer(spec(), 'CLUB');
  Object.assign(word.transform, { centerXmm: 90, centerYmm: 60, widthMm: 40, heightMm: 10 });
  run(cmd.addLayer('front', square));
  run(cmd.addLayer('front', word));
  const made = lockupFromLayers([square, word], { id: 'lockup_crest' as LockupId, name: 'Crest', placementId: 'place-1' })!;
  run(cmd.makeLockup('front', [square.id, word.id], made.lockup, made.placement));
  return { get d() { return d; }, get h() { return h; }, run, square, word, lockupId: made.lockup.id as LockupId };
}

const placement = (d: DesignDocument, zone: 'front' | 'back', id: string) => d.zones[zone].layers[id] as Placement;

describe('reusable lockups', () => {
  it('makes a lockup of layers: the board fits round them and one placement takes their place', () => {
    const t = withLockup();
    const lockup = t.d.lockups!.items[t.lockupId];
    // The square spans x 40–60 and the word 70–110; both span y 50–70 at most.
    expect(lockup.widthMm).toBeCloseTo(70);
    expect(lockup.heightMm).toBeCloseTo(20);
    expect(lockup.layers[t.square.id].transform.centerXmm).toBeCloseTo(10);
    expect(t.d.zones.front.orderedLayerIds).toEqual(['place-1']);
    const p = placement(t.d, 'front', 'place-1');
    expect(p.transform).toMatchObject({ centerXmm: 75, centerYmm: 60 });
    expect(p.transform.widthMm).toBeCloseTo(70);
    expect(p.content.orderedLayerIds).toEqual([t.square.id, t.word.id]);
    expect(checkDocumentInvariants(t.d)).toEqual([]);
    expect(parseDesignDocument(JSON.parse(JSON.stringify(t.d))).ok).toBe(true);
  });

  it('edits once on its board and every placement follows, in the same undo step', () => {
    const t = withLockup();
    const lockup = t.d.lockups!.items[t.lockupId];
    t.run(cmd.addLayer('back', newPlacement(lockup, 'place-2', { cx: 100, cy: 100, maxW: 300, maxH: 300 })));
    t.run(cmd.updateLayer(t.lockupId, t.word.id, { content: { value: 'UNITED' } }, 'Edit text'));
    const words = (d: DesignDocument) => [placement(d, 'front', 'place-1'), placement(d, 'back', 'place-2')].map((p) => (p.content.layers[t.word.id].content as { value: string }).value);
    expect(words(t.d)).toEqual(['UNITED', 'UNITED']);
    // One undo takes the lockup and both placements back together.
    const back = undo(t.d, t.h);
    expect(words(back.document)).toEqual(['CLUB', 'CLUB']);
    expect(back.document.lockups!.items[t.lockupId].layers[t.word.id].content).toMatchObject({ value: 'CLUB' });
    expect(words(redo(back.document, back.history).document)).toEqual(['UNITED', 'UNITED']);
    expect(placementsOf(t.d, t.lockupId)).toHaveLength(2);
  });

  it('follows layers added to and removed from the lockup, and its new name', () => {
    const t = withLockup();
    const star = createShapeLayer(spec(), 'star');
    Object.assign(star.transform, { centerXmm: 35, centerYmm: 10, widthMm: 10, heightMm: 10 });
    t.run(cmd.addLayer(t.lockupId, star));
    t.run(cmd.removeLayers(t.lockupId, [t.square.id]));
    t.run(cmd.renameLockup(t.lockupId, 'Club crest'));
    const p = placement(t.d, 'front', 'place-1');
    expect(p.content.orderedLayerIds).toEqual([t.word.id, star.id]);
    expect(Object.keys(p.content.layers).sort()).toEqual([t.word.id, star.id].sort());
    expect(p.content.name).toBe('Club crest');
    // A placement still named after the lockup takes its new name.
    expect(p.name).toBe('Club crest');
  });

  it('detaches a placement into its layers exactly where they print, turned and scaled with it', () => {
    const t = withLockup();
    const p = structuredClone(placement(t.d, 'front', 'place-1'));
    // Twice the size, a quarter turn clockwise, about (150, 200).
    Object.assign(p.transform, { centerXmm: 150, centerYmm: 200, widthMm: 140, heightMm: 40, rotationDeg: 90 });
    let n = 0;
    const layers = detachedLayers(p, () => `d${++n}`, 'g1');
    const square = layers[0];
    // The square sat 25 mm left of the lockup's centre: twice that, turned a quarter, is 50 mm up.
    expect(square.transform.centerXmm).toBeCloseTo(150);
    expect(square.transform.centerYmm).toBeCloseTo(150);
    expect(square.transform.widthMm).toBeCloseTo(40);
    expect(square.transform.rotationDeg).toBeCloseTo(90);
    expect(layers.map((l) => l.groupId)).toEqual(['g1', 'g1']);
    t.run(cmd.detachPlacement('front', 'place-1', layers));
    expect(t.d.zones.front.orderedLayerIds).toEqual(['d1', 'd2']);
    expect(placementsOf(t.d, t.lockupId)).toHaveLength(0);
    // Unused now, the lockup can go.
    t.run(cmd.removeLockup(t.lockupId));
    expect(t.d.lockups).toBeUndefined();
  });

  it('keeps a lockup that is still placed', () => {
    const t = withLockup();
    t.run(cmd.removeLockup(t.lockupId));
    expect(t.d.lockups?.items[t.lockupId]).toBeDefined();
  });

  it('fits the board round its artwork after editing, and nothing on the garment moves', () => {
    const t = withLockup();
    const before = detachedLayers(placement(t.d, 'front', 'place-1'), (l) => l.id, '');
    // Drag the word 30 mm right, past the board's edge.
    const word = artboardOf(t.d, t.lockupId)!.layers[t.word.id];
    t.run(cmd.updateTransforms(t.lockupId, { [t.word.id]: { centerXmm: word.transform.centerXmm + 30 } }));
    expect(boardFit(t.d.lockups!.items[t.lockupId])).not.toBeNull();
    t.run(cmd.fitLockupBoard(t.lockupId));
    const lockup = t.d.lockups!.items[t.lockupId];
    expect(lockup.widthMm).toBeCloseTo(100);
    expect(boardFit(lockup)).toBeNull();
    const after = detachedLayers(placement(t.d, 'front', 'place-1'), (l) => l.id, '');
    // The square is exactly where it was; the word is the 30 mm further right it was dragged.
    expect(after[0].transform.centerXmm).toBeCloseTo(before[0].transform.centerXmm);
    expect(after[0].transform.centerYmm).toBeCloseTo(before[0].transform.centerYmm);
    expect(after[1].transform.centerXmm).toBeCloseTo(before[1].transform.centerXmm + 30);
  });

  it('personalises names inside a placement, and checks its layers at the size they print', () => {
    const t = withLockup();
    t.run(cmd.updateLayer(t.lockupId, t.word.id, { content: { value: '{name}' } }, 'Edit text'));
    expect(personalisedZones(t.d)).toContain('front');
    const person = personalise(t.d, { name: 'SOK' });
    const p = person.zones.front.layers['place-1'] as ArtworkLayer;
    expect(p.content.kind === 'lockup' && p.content.layers[t.word.id].content).toMatchObject({ value: 'SOK' });
    // Shrunk to a tenth, the word inside is about a millimetre tall: too small to print.
    t.run(cmd.updateTransforms('front', { 'place-1': { widthMm: 7, heightMm: 2 } }));
    expect(runPreflight(t.d).some((i) => i.layerId === 'place-1' && i.code === 'small_text')).toBe(true);
  });
});

describe('lockups kept in brand kits', () => {
  it('saves without the design’s note, and comes back into another design as the same lockup, noting the kit version', () => {
    const t = withLockup();
    t.run(cmd.markLockupKit(t.lockupId, { kitId: 'kit-1', savedAt: 1000 }));
    const saved = lockupForKit(t.d.lockups!.items[t.lockupId]);
    expect(saved.kit).toBeUndefined();
    expect(t.d.lockups!.items[t.lockupId].kit).toEqual({ kitId: 'kit-1', savedAt: 1000 });
    const placed = lockupFromKit({ lockup: saved, savedAt: 1000 }, 'kit-1');
    expect(placed.id).toBe(t.lockupId);
    expect(placed.kit).toEqual({ kitId: 'kit-1', savedAt: 1000 });
    // Changing the copy never reaches back into the kit's.
    placed.layers[t.word.id].name = 'Changed';
    expect(saved.layers[t.word.id].name).not.toBe('Changed');
  });

  it('tells how the design’s copy compares with the kit’s', () => {
    const t = withLockup();
    t.run(cmd.markLockupKit(t.lockupId, { kitId: 'kit-1', savedAt: 1000 }));
    const kitVersion = { lockup: lockupForKit(t.d.lockups!.items[t.lockupId]), savedAt: 1000 };
    expect(kitLockupStatus(t.d, kitVersion)).toBe('same');
    expect(kitLockupStatus(createDocument({ projectId: 'p2', title: 'Other', colorwayIndex: 0 }), kitVersion)).toBe('absent');
    // Board guides are an editing aid, not the lockup.
    t.run(cmd.setGuides(t.lockupId, { x: [10], y: [] }));
    expect(kitLockupStatus(t.d, kitVersion)).toBe('same');
    t.run(cmd.updateLayer(t.lockupId, t.word.id, { content: { value: 'UNITED' } }, 'Edit text'));
    expect(kitLockupStatus(t.d, kitVersion)).toBe('changed-here');
    // A version saved to the kit later is newer than the one this design came from.
    expect(kitLockupStatus(t.d, { ...kitVersion, savedAt: 2000 })).toBe('kit-newer');
  });

  it('updates from the kit in one undo step: every placement follows, keeping its centre and scale', () => {
    const t = withLockup();
    t.run(cmd.addLayer('back', newPlacement(t.d.lockups!.items[t.lockupId], 'place-2', { cx: 100, cy: 100, maxW: 35, maxH: 35 })));
    const before = placement(t.d, 'back', 'place-2').transform;
    // The kit's version: the word changed and the board twice as tall.
    const kitLockup = lockupForKit(t.d.lockups!.items[t.lockupId]);
    kitLockup.heightMm *= 2;
    (kitLockup.layers[t.word.id].content as { value: string }).value = 'UNITED';
    t.run(cmd.replaceLockup(lockupFromKit({ lockup: kitLockup, savedAt: 5000 }, 'kit-1')));
    const front = placement(t.d, 'front', 'place-1');
    const back = placement(t.d, 'back', 'place-2');
    for (const p of [front, back]) expect((p.content.layers[t.word.id].content as { value: string }).value).toBe('UNITED');
    expect(back.transform.centerXmm).toBe(before.centerXmm);
    expect(back.transform.widthMm).toBeCloseTo(before.widthMm);
    expect(back.transform.heightMm).toBeCloseTo(before.heightMm * 2);
    expect(t.d.lockups!.items[t.lockupId].kit).toEqual({ kitId: 'kit-1', savedAt: 5000 });
    expect(checkDocumentInvariants(t.d)).toEqual([]);
    expect(parseDesignDocument(JSON.parse(JSON.stringify(t.d))).ok).toBe(true);
    const back2 = undo(t.d, t.h).document;
    expect((placement(back2, 'front', 'place-1').content.layers[t.word.id].content as { value: string }).value).toBe('CLUB');
    expect(placement(back2, 'back', 'place-2').transform.heightMm).toBeCloseTo(before.heightMm);
  });
});
