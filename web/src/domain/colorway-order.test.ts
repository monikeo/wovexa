import { describe, expect, it } from 'vitest';
import { reorderColorway } from './commands';
import { createDocument } from './factory';

describe('colourway order', () => {
  it('moves a colourway up or down the list, clamped to its ends', () => {
    const doc = createDocument({ projectId: 'p', title: 'Order' });
    const names = () => doc.colorways.map((c) => c.name);
    const start = names();
    expect(start.length).toBeGreaterThanOrEqual(3);
    reorderColorway(doc.colorways[2].id, 0).recipe(doc);
    expect(names()).toEqual([start[2], start[0], start[1], ...start.slice(3)]);
    reorderColorway(doc.colorways[0].id, 99).recipe(doc);
    expect(names().at(-1)).toBe(start[2]);
    // An unknown colourway changes nothing.
    const before = names();
    reorderColorway('nope', 0).recipe(doc);
    expect(names()).toEqual(before);
  });
});
