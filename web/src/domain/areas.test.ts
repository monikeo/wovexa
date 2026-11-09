import { describe, expect, it } from 'vitest';
import { applyCommand, emptyHistory, undo } from './history';
import * as cmd from './commands';
import { areaSpec, artboardOf, artboardSpec, createArea, describeAreaPlacement, designAreas, hasArtboard, newAreaId, nextAreaName } from './areas';
import { createDocument, createTextLayer } from './factory';
import { getGarment } from './garments';
import { runPreflight } from './preflight';
import { checkDocumentInvariants, isAreaId, parseDesignDocument, type AreaId, type DesignDocument } from './schema';
import { displayName, garmentKind, groupLibrary, guessStyle, isLibraryPath, summarizeGlb, type LibraryModel } from './model-library';
import { diffDocuments } from './diff';
import { designPlaceholders, personalise, personalisedAreas } from '@/lib/export/roster';

const doc = () => createDocument({ projectId: 'p1', title: 'Areas', colorwayIndex: 0 });
const front = { point: [0, 520, 140] as [number, number, number], normal: [0, 0, 1] as [number, number, number], up: [0, 1, 0] as [number, number, number] };

function withArea(d: DesignDocument, name = 'Area 1') {
  const area = createArea({ id: newAreaId(), name, projector: front, widthMm: 150, heightMm: 90 });
  const r = applyCommand(d, emptyHistory(), cmd.addArea(area));
  return { d: r.document, h: r.history, id: area.id as AreaId };
}

describe('design areas', () => {
  it('adds an area anywhere, valid as a document and undoable', () => {
    const { d, h, id } = withArea(doc());
    expect(isAreaId(id)).toBe(true);
    expect(designAreas(d).map((a) => a.name)).toEqual(['Area 1']);
    expect(checkDocumentInvariants(d)).toEqual([]);
    expect(parseDesignDocument(JSON.parse(JSON.stringify(d))).ok).toBe(true);
    expect(nextAreaName(d)).toBe('Area 2');
    expect(designAreas(undo(d, h).document)).toHaveLength(0);
  });

  it('takes layers like a zone: the same commands add, move, restack and delete them', () => {
    const { d: d0, id } = withArea(doc());
    const model = getGarment(d0.garment.modelId);
    const spec = artboardSpec(model, d0, id);
    expect(spec.areaId).toBe(id);
    expect(spec.printableWidthMm).toBe(150);
    const layer = createTextLayer(spec, 'HOOD');
    let d = applyCommand(d0, emptyHistory(), cmd.addLayer(id, layer)).document;
    expect(artboardOf(d, id)?.orderedLayerIds).toEqual([layer.id]);
    d = applyCommand(d, emptyHistory(), cmd.updateTransforms(id, { [layer.id]: { centerXmm: 40 } })).document;
    expect(artboardOf(d, id)?.layers[layer.id].transform.centerXmm).toBe(40);
    // The front zone is untouched.
    expect(d.zones.front.orderedLayerIds).toHaveLength(0);
    d = applyCommand(d, emptyHistory(), cmd.removeLayers(id, [layer.id])).document;
    expect(artboardOf(d, id)?.orderedLayerIds).toEqual([]);
  });

  it('moves, scales with its artwork, duplicates and deletes', () => {
    const { d: d0, id } = withArea(doc());
    const spec = areaSpec(designAreas(d0)[0]);
    const layer = createTextLayer(spec, 'A');
    let d = applyCommand(d0, emptyHistory(), cmd.addLayer(id, layer)).document;
    const before = artboardOf(d, id)!.layers[layer.id].transform;
    d = applyCommand(d, emptyHistory(), cmd.scaleArea(id, 2)).document;
    const area = d.areas!.items[id];
    expect(area.widthMm).toBe(300);
    expect(area.layers[layer.id].transform.widthMm).toBeCloseTo(before.widthMm * 2);
    d = applyCommand(d, emptyHistory(), cmd.updateArea(id, { projector: { ...front, point: [120, 600, 90] } })).document;
    expect(d.areas!.items[id].projector.point[0]).toBe(120);
    const copy = newAreaId();
    d = applyCommand(d, emptyHistory(), cmd.duplicateArea(id, copy, { [layer.id]: 'copy-1' }, front, 'Area 1 copy')).document;
    expect(designAreas(d).map((a) => a.name)).toEqual(['Area 1', 'Area 1 copy']);
    expect(d.areas!.items[copy].orderedLayerIds).toEqual(['copy-1']);
    expect(checkDocumentInvariants(d)).toEqual([]);
    d = applyCommand(d, emptyHistory(), cmd.removeArea(id)).document;
    expect(hasArtboard(getGarment(d.garment.modelId), d, id)).toBe(false);
    expect(hasArtboard(getGarment(d.garment.modelId), d, copy)).toBe(true);
  });

  it('is checked before printing and described for the factory', () => {
    const { d: d0, id } = withArea(doc());
    const layer = createTextLayer(areaSpec(designAreas(d0)[0]), 'TINY');
    layer.transform.heightMm = 1;
    const d = applyCommand(d0, emptyHistory(), cmd.addLayer(id, layer)).document;
    const issues = runPreflight(d).filter((i) => i.zoneId === id);
    expect(issues.some((i) => i.code === 'small_text')).toBe(true);
    expect(describeAreaPlacement(d.areas!.items[id])).toMatch(/150 × 90 mm on the front, centre 520 mm above the hem, centred/);
  });
});

describe('design areas across the system', () => {
  it('show in version comparisons: added, moved, resized and their artwork', () => {
    const { d: d0, id } = withArea(doc());
    const base = applyCommand(d0, emptyHistory(), cmd.addLayer(id, createTextLayer(areaSpec(designAreas(d0)[0]), 'HOOD'))).document;
    expect(diffDocuments(doc(), base).map((c) => c.text)).toEqual(expect.arrayContaining(['Added design area Area 1, 150 × 90 mm', 'Added HOOD']));
    let next = applyCommand(base, emptyHistory(), cmd.updateArea(id, { projector: { ...front, point: [0, 700, 100] }, widthMm: 200 })).document;
    next = applyCommand(next, emptyHistory(), cmd.updateArea(id, { printMethod: 'EMBROIDERY' })).document;
    const changes = diffDocuments(base, next);
    expect(changes).toEqual([{ area: 'Area 1', kind: 'changed', text: 'Design area moved on the garment; resized to 200 × 90 mm; print method Embroidery' }]);
    const removed = applyCommand(next, emptyHistory(), cmd.removeArea(id)).document;
    expect(diffDocuments(next, removed)).toEqual([{ area: 'Area 1', kind: 'removed', text: 'Removed design area Area 1' }]);
  });

  it('personalise names and numbers placed in design areas', () => {
    const { d: d0, id } = withArea(doc());
    const layer = createTextLayer(areaSpec(designAreas(d0)[0]), '{name}');
    const d = applyCommand(d0, emptyHistory(), cmd.addLayer(id, layer)).document;
    expect(designPlaceholders(d)).toEqual(['name']);
    expect(personalisedAreas(d).map((a) => a.id)).toEqual([id]);
    const person = personalise(d, { name: 'Sokha' });
    const text = person.areas!.items[id].layers[layer.id].content;
    expect(text.kind === 'text' && text.value).toBe('Sokha');
    // The original is untouched.
    const original = d.areas!.items[id].layers[layer.id].content;
    expect(original.kind === 'text' && original.value).toBe('{name}');
  });
});

describe('3D model library', () => {
  it('names a model after its file and reads its style from the name', () => {
    expect(displayName('Hoodie_Black.glb')).toBe('Hoodie Black');
    expect(guessStyle('Hoodie1.glb')).toBe('hoodie-pullover');
    expect(guessStyle('LongSleeve1.glb')).toBe('tee-long');
    expect(guessStyle('TaekwondoDobok.glb')).toBe('taekwondo-dobok');
    expect(guessStyle('TShirtLowPoly1.glb')).toBe('tee-classic');
    expect(guessStyle('Basketball_Kit.glb')).toBe('jersey-basketball');
  });

  it('serves plain paths in the folder and its subfolders, never outside it', () => {
    expect(isLibraryPath('Hoodie1.glb')).toBe(true);
    expect(isLibraryPath('Hoodies/Hoodie1.glb')).toBe(true);
    expect(isLibraryPath('Tops/Hoodies/Hoodie1.glb')).toBe(true);
    expect(isLibraryPath('Hoodies/Hoodie1.front.png')).toBe(true);
    expect(isLibraryPath('Hoodie1.back.svg')).toBe(true);
    expect(isLibraryPath('a/b/c/Hoodie1.glb')).toBe(false);
    expect(isLibraryPath('../package.json')).toBe(false);
    expect(isLibraryPath('../Hoodie1.glb')).toBe(false);
    expect(isLibraryPath('.hidden/Hoodie1.glb')).toBe(false);
    expect(isLibraryPath('Hoodie1.png')).toBe(false);
    expect(isLibraryPath('Hoodies\\Hoodie1.glb')).toBe(false);
    expect(displayName('Hoodies/Hoodie_Black.glb')).toBe('Hoodie Black');
    expect(guessStyle('Hoodies/Model7.glb')).toBe('hoodie-pullover');
    expect(guessStyle('Uniforms/Dobok.glb')).toBe('taekwondo-dobok');
  });

  it('groups models by folder first, then by the kind of garment their names say', () => {
    const m = (file: string, folder: string | null = null): LibraryModel => {
      const styleId = guessStyle(file);
      return { file, name: displayName(file), folder, category: folder ?? garmentKind(file, styleId), bytes: 1, version: '1', triangles: 1, styleId, credit: null, views: {} };
    };
    expect(garmentKind('MenShirt.glb', 'tee-classic')).toBe('Shirts');
    expect(garmentKind('Shirt2.glb', 'tee-classic')).toBe('Shirts');
    expect(garmentKind('TShirt1.glb', 'tee-classic')).toBe('T-shirts');
    expect(garmentKind('T_Shirt.glb', 'tee-classic')).toBe('T-shirts');
    expect(garmentKind('Hoodie1.glb', 'hoodie-pullover')).toBe('Hoodies and sweatshirts');
    expect(garmentKind('TaekwondoDobok.glb', 'taekwondo-dobok')).toBe('Uniforms');
    const groups = groupLibrary([m('TShirt2.glb'), m('Hoodie1.glb'), m('TShirt10.glb'), m('Club/Kit.glb', 'Club'), m('MenShirt.glb'), m('TShirt1.glb')]);
    expect(groups.map((g) => g.category)).toEqual(['Club', 'T-shirts', 'Shirts', 'Hoodies and sweatshirts']);
    expect(groups[1].models.map((x) => x.name)).toEqual(['TShirt1', 'TShirt2', 'TShirt10']);
  });

  it('counts triangles and reads the credit from a GLB’s JSON alone', () => {
    const json = {
      asset: { version: '2.0', extras: { title: 'T', author: 'A', license: 'CC-BY-4.0' } },
      accessors: [{ count: 300 }, { count: 600 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      nodes: [{ mesh: 0 }, { mesh: 0 }],
    };
    expect(summarizeGlb(json)).toEqual({ triangles: 400, credit: { title: 'T', author: 'A', license: 'CC-BY-4.0' } });
  });
});
