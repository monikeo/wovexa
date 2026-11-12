import { describe, expect, it } from 'vitest';
import { TEE_CLASSIC } from '@/domain/garments';
import { nestOffThread } from './marker-compare';
import { DEFAULT_MARKER, markerNestOptions, markerPieces, orderSets } from './marker-layout';
import { nest } from './nesting';
import { parseRoster } from './roster';

describe('nesting off the main thread', () => {
  const { sets } = orderSets(TEE_CLASSIC, 'M', parseRoster('size\nS\nM\nL\n'));
  const { pieces } = markerPieces(TEE_CLASSIC, sets, 'high');
  const opts = markerNestOptions(DEFAULT_MARKER);

  it('gives the same marker as nesting here (where there is no worker, it nests here)', async () => {
    const off = await nestOffThread(pieces, opts);
    const here = nest(pieces, opts);
    expect(off.lengthMm).toBeCloseTo(here.lengthMm, 6);
    expect(off.sections.map((s) => s.placements.map((p) => p.id))).toEqual(here.sections.map((s) => s.placements.map((p) => p.id)));
    expect(off.strategy).toBe(here.strategy);
  });

  it('stops at once when the export was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(nestOffThread(pieces, opts, controller.signal)).rejects.toThrow('Export cancelled');
  });
});
