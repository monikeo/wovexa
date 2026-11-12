import { describe, expect, it } from 'vitest';
import { newPace, paceFrame, type Pace } from './adaptive-dpr';

/** Frames every `every` ms for `forMs`, from `start`; the verdicts given along the way. */
function run(p: Pace, start: number, every: number, forMs: number) {
  const verdicts: string[] = [];
  for (let t = start; t <= start + forMs; t += every) {
    const v = paceFrame(p, t);
    if (v) verdicts.push(v);
  }
  return verdicts;
}

describe('adaptive resolution', () => {
  it('never reads the pauses between edits as slow frames', () => {
    const p = newPace();
    // An edit every 300 ms (typing in split view) and one every few seconds, a frame each, for a minute.
    expect(run(p, 0, 300, 30_000)).toEqual([]);
    expect(run(p, 40_000, 4000, 60_000)).toEqual([]);
    // Two frames per edit (a texture, then the settle) don't make a run either.
    const verdicts: string[] = [];
    for (let t = 200_000; t < 260_000; t += 250) for (const dt of [0, 16]) verdicts.push(paceFrame(p, t + dt) ?? '');
    expect(verdicts.filter(Boolean)).toEqual([]);
    expect(p.low).toBe(false);
  });

  it('drops the pixel ratio when moving frames are slow, and brings it back when they are smooth', () => {
    const p = newPace();
    // Orbiting at 25 fps: slow within about a second.
    expect(run(p, 0, 40, 1500)).toEqual(['slow']);
    expect(p.low).toBe(true);
    // A pause, then 60 fps orbiting: restored after about two seconds of it.
    expect(run(p, 5000, 1000 / 60, 3000)).toEqual(['smooth']);
    expect(p.low).toBe(false);
  });

  it('a pause in the middle of a run starts a fresh one', () => {
    const p = newPace();
    // 450 ms of 25 fps, a pause, 450 ms more: neither run is long enough to judge.
    expect(run(p, 0, 40, 450)).toEqual([]);
    expect(run(p, 2000, 40, 450)).toEqual([]);
    expect(p.slow).toBe(0);
  });

  it('settles after flipping back and forth a few times', () => {
    const p = newPace();
    const flips: string[] = [];
    for (let round = 0; round < 6; round++) {
      flips.push(...run(p, round * 20_000, 40, 1500));
      flips.push(...run(p, round * 20_000 + 5000, 1000 / 60, 3000));
    }
    expect(flips).toEqual(['slow', 'smooth', 'slow', 'smooth']);
  });
});
