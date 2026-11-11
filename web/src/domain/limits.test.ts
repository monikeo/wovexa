import { describe, expect, it } from 'vitest';
import * as cmd from './commands';
import { createDocument, createShapeLayer } from './factory';
import { getGarment, zoneSpecOrFirst } from './garments';
import { applyCommand, emptyHistory } from './history';
import { LIMITS, limitProblem } from './limits';
import { parseDesignDocument } from './schema';

const spec = () => zoneSpecOrFirst(getGarment('tee-classic'), 'front');

describe('design limits', () => {
  it('refuses the edit that would go past a limit, with the reason, and keeps the design as it was', () => {
    let d = createDocument({ projectId: 'p1', title: 'Full', colorwayIndex: 0 });
    const layers = Array.from({ length: LIMITS.layers }, () => createShapeLayer(spec(), 'rect'));
    const filled = applyCommand(d, emptyHistory(), cmd.addLayers('front', layers, 'Fill'));
    expect(filled.changed).toBe(true);
    d = filled.document;
    expect(limitProblem(d)).toBeNull();
    expect(parseDesignDocument(d).ok).toBe(true);
    const over = applyCommand(d, filled.history, cmd.addLayer('front', createShapeLayer(spec(), 'star')));
    expect(over.changed).toBe(false);
    expect(over.refused).toBe('A print area holds up to 200 layers.');
    expect(over.document).toBe(d);
  });

  it('lets a design already past a limit be edited back within it', () => {
    const d = createDocument({ projectId: 'p1', title: 'Old', colorwayIndex: 0 });
    const layers = Array.from({ length: LIMITS.layers + 2 }, () => createShapeLayer(spec(), 'rect'));
    for (const l of layers) {
      d.zones.front.layers[l.id] = l;
      d.zones.front.orderedLayerIds.push(l.id);
    }
    expect(limitProblem(d)).not.toBeNull();
    const fewer = applyCommand(d, emptyHistory(), cmd.removeLayers('front', [layers[0].id]));
    expect(fewer.changed).toBe(true);
  });
});
