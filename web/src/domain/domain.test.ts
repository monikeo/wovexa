import { describe, expect, it } from 'vitest';
import * as cmd from './commands';
import { createDocument, createImageLayer, createTextLayer } from './factory';
import { TEE_CLASSIC } from './garments';
import { rotatedBounds } from './geometry';
import { applyCommand, emptyHistory, redo, undo } from './history';
import { effectiveDpi, runPreflight, summarize } from './preflight';
import { migrateDesignDocument, parseDesignDocument } from './schema';

const front = TEE_CLASSIC.zones.front;

function docWithText() {
  const doc = createDocument({ projectId: 'p1', title: 'Test tee' });
  const layer = createTextLayer(front, 'WOVEXA');
  const r = applyCommand(doc, emptyHistory(), cmd.addLayer('front', layer));
  return { doc: r.document, history: r.history, layer };
}

describe('design document schema', () => {
  it('accepts a freshly created document', () => {
    const doc = createDocument({ projectId: 'p1', title: 'Test tee' });
    expect(parseDesignDocument(doc).ok).toBe(true);
  });

  it('survives a JSON round trip with every layer intact', () => {
    const { doc } = docWithText();
    const parsed = parseDesignDocument(JSON.parse(JSON.stringify(doc)));
    expect(parsed.ok && parsed.document).toEqual(doc);
  });

  it('rejects a layer that is ordered but missing', () => {
    const { doc } = docWithText();
    const broken = structuredClone(doc);
    broken.zones.front.orderedLayerIds.push('ghost');
    const parsed = parseDesignDocument(broken);
    expect(parsed.ok).toBe(false);
  });

  it('rejects unknown schema versions instead of guessing', () => {
    const { doc } = docWithText();
    expect(migrateDesignDocument({ ...doc, schemaVersion: 99 }).ok).toBe(false);
  });

  it('rejects malformed colours', () => {
    const doc = createDocument({ projectId: 'p1', title: 'Test tee' });
    doc.colorways[0].parts.body = 'red';
    expect(parseDesignDocument(doc).ok).toBe(false);
  });
});

describe('commands and history', () => {
  it('undoes and redoes a move exactly', () => {
    const { doc, history, layer } = docWithText();
    const moved = applyCommand(doc, history, cmd.updateTransforms('front', { [layer.id]: { centerXmm: 42.5 } }));
    expect(moved.document.zones.front.layers[layer.id].transform.centerXmm).toBe(42.5);

    const back = undo(moved.document, moved.history);
    expect(back.document).toEqual(doc);

    const again = redo(back.document, back.history);
    expect(again.document).toEqual(moved.document);
  });

  it('does not record no-op commands', () => {
    const { doc, history, layer } = docWithText();
    const same = applyCommand(doc, history, cmd.updateTransforms('front', { [layer.id]: { centerXmm: layer.transform.centerXmm } }));
    expect(same.changed).toBe(false);
    expect(same.history.past).toHaveLength(history.past.length);
  });

  it('clears redo after a new edit', () => {
    const { doc, history, layer } = docWithText();
    const a = applyCommand(doc, history, cmd.updateLayer('front', layer.id, { name: 'A' }));
    const u = undo(a.document, a.history);
    const b = applyCommand(u.document, u.history, cmd.updateLayer('front', layer.id, { name: 'B' }));
    expect(b.history.future).toHaveLength(0);
  });

  it('duplicates directly above the source with a fresh id', () => {
    const { doc, history, layer } = docWithText();
    const r = applyCommand(doc, history, cmd.duplicateLayers('front', { [layer.id]: 'copy-1' }));
    const zone = r.document.zones.front;
    expect(zone.orderedLayerIds).toEqual([layer.id, 'copy-1']);
    expect(zone.layers['copy-1'].transform.centerXmm).toBe(layer.transform.centerXmm + 6);
    expect(parseDesignDocument(r.document).ok).toBe(true);
  });

  it('reorders and deletes while keeping the document valid', () => {
    const { doc, history, layer } = docWithText();
    const second = createTextLayer(front, 'Second');
    let r = applyCommand(doc, history, cmd.addLayer('front', second));
    r = applyCommand(r.document, r.history, cmd.reorderLayer('front', second.id, 0));
    expect(r.document.zones.front.orderedLayerIds).toEqual([second.id, layer.id]);
    r = applyCommand(r.document, r.history, cmd.removeLayers('front', [layer.id]));
    expect(r.document.zones.front.orderedLayerIds).toEqual([second.id]);
    expect(parseDesignDocument(r.document).ok).toBe(true);
  });

  it('never removes the last colourway', () => {
    const doc = createDocument({ projectId: 'p1', title: 'Test tee' });
    let r = applyCommand(doc, emptyHistory(), cmd.removeColorway(doc.colorways[1].id));
    r = applyCommand(r.document, r.history, cmd.removeColorway(doc.colorways[2].id));
    r = applyCommand(r.document, r.history, cmd.removeColorway(doc.colorways[0].id));
    expect(r.document.colorways).toHaveLength(1);
  });
});

describe('geometry', () => {
  it('computes rotated bounds', () => {
    const b = rotatedBounds({ centerXmm: 50, centerYmm: 50, widthMm: 100, heightMm: 20, rotationDeg: 90 });
    expect(b.width).toBeCloseTo(20);
    expect(b.height).toBeCloseTo(100);
    expect(b.x).toBeCloseTo(40);
  });
});

describe('preflight', () => {
  const image = (w: number, h: number) =>
    createImageLayer(front, { id: 'a1', width: w, height: h, mime: 'image/png', name: 'art.png' });

  it('computes DPI from source pixels and placed millimetres', () => {
    const layer = image(2000, 2000);
    layer.transform.widthMm = 254; // 10 in
    layer.transform.heightMm = 254;
    expect(effectiveDpi(layer)?.min).toBeCloseTo(200);
  });

  it('flags low resolution as an error with an exact fix', () => {
    const doc = createDocument({ projectId: 'p1', title: 'Test tee' });
    const layer = image(600, 600);
    layer.transform.widthMm = 254;
    layer.transform.heightMm = 254;
    const r = applyCommand(doc, emptyHistory(), cmd.addLayer('front', layer));
    const issue = runPreflight(r.document).find((i) => i.code === 'low_dpi');
    expect(issue?.severity).toBe('error');
    expect(issue?.fix).toContain('101.6 mm'); // 600 px / 150 dpi = 4 in
  });

  it('reports overflow with a direction and distance', () => {
    const { doc, history, layer } = docWithText();
    const r = applyCommand(doc, history, cmd.updateTransforms('front', {
      [layer.id]: { centerXmm: front.printableWidthMm - layer.transform.widthMm / 2 + 8 },
    }));
    const issue = runPreflight(r.document).find((i) => i.code === 'out_of_bounds');
    expect(issue?.message).toContain('8 mm past the right edge');
    expect(issue?.fix).toBe('Move 8 mm left');
  });

  it('treats SVG sources as resolution independent', () => {
    const layer = createImageLayer(front, { id: 'v1', width: 40, height: 40, mime: 'image/svg+xml', name: 'logo.svg' });
    expect(effectiveDpi(layer)).toBeNull();
  });

  it('says so when the design is empty', () => {
    const doc = createDocument({ projectId: 'p1', title: 'Empty' });
    const issues = runPreflight(doc);
    expect(issues.map((i) => i.code)).toEqual(['empty_design']);
    expect(summarize(issues)).toEqual({ errors: 0, warnings: 0 });
  });

  it('flags print methods the zone does not support', () => {
    const { doc, history } = docWithText();
    const r = applyCommand(doc, history, cmd.setPrintMethod('front', 'EMBROIDERY'));
    const ok = runPreflight(r.document).some((i) => i.code === 'method_unsupported');
    expect(ok).toBe(false);
    const s = applyCommand(r.document, r.history, cmd.setPrintMethod('left_sleeve', 'SUBLIMATION'));
    const withLayer = applyCommand(s.document, s.history, cmd.addLayer('left_sleeve', createTextLayer(TEE_CLASSIC.zones.left_sleeve, 'W')));
    expect(runPreflight(withLayer.document).some((i) => i.code === 'method_unsupported')).toBe(true);
  });
});
