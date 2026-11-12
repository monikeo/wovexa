import { describe, expect, it } from 'vitest';
import { fitLines, inkOn, SOCIAL_FORMATS } from './social';

/** A stand-in for canvas measuring: every character half the font size wide. */
const measure = (text: string, size: number) => text.length * size * 0.5;

describe('marketing image layout', () => {
  it('keeps the largest size the words fit at, on as few lines as allowed', () => {
    expect(fitLines(measure, 'NIGHT SHIFT', 1000, 100, 40, 2)).toEqual({ lines: ['NIGHT SHIFT'], size: 100 });
    // Too wide for one line at 100: two lines at the same size.
    expect(fitLines(measure, 'NIGHT SHIFT TEE', 600, 100, 40, 2)).toEqual({ lines: ['NIGHT SHIFT', 'TEE'], size: 100 });
    // One line allowed: the size comes down until it fits.
    const one = fitLines(measure, 'NIGHT SHIFT TEE', 600, 100, 40, 1);
    expect(one.lines).toEqual(['NIGHT SHIFT TEE']);
    expect(one.size).toBeLessThan(100);
    expect(measure(one.lines[0], one.size)).toBeLessThanOrEqual(600);
  });

  it('ends with an ellipsis when even the smallest size is too long', () => {
    const out = fitLines(measure, 'A VERY LONG HEADLINE THAT WILL NOT FIT ANYWHERE', 200, 60, 40, 1);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].endsWith('…')).toBe(true);
    expect(measure(out.lines[0], 40)).toBeLessThanOrEqual(200);
    expect(fitLines(measure, '   ', 200, 60, 40, 2).lines).toEqual([]);
  });

  it('picks words that read on the backdrop', () => {
    expect(inkOn('#F6F5F2')).toBe('#14161B');
    expect(inkOn('#23262E')).toBe('#FFFFFF');
    expect(inkOn('#2B59FF')).toBe('#FFFFFF');
  });

  it('offers the sizes each place posts at', () => {
    expect(SOCIAL_FORMATS.find((f) => f.id === 'post')).toMatchObject({ w: 1080, h: 1350 });
    expect(SOCIAL_FORMATS.find((f) => f.id === 'story')).toMatchObject({ w: 1080, h: 1920 });
    expect(new Set(SOCIAL_FORMATS.map((f) => f.id)).size).toBe(SOCIAL_FORMATS.length);
  });
});
