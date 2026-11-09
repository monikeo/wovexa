import { describe, expect, it } from 'vitest';
import { changeCase, isCase } from './letter-case';

describe('letter case', () => {
  it('turns text to capitals, title case or lower case', () => {
    expect(changeCase('Phnom penh tigers', 'upper')).toBe('PHNOM PENH TIGERS');
    expect(changeCase('PHNOM PENH tigers', 'title')).toBe('Phnom Penh Tigers');
    expect(changeCase("o'neil x-ray (team)", 'title')).toBe("O'Neil X-Ray (Team)");
    expect(changeCase('WOVEXA\nTEAM', 'lower')).toBe('wovexa\nteam');
  });

  it('knows which case text is in, and that digits and Khmer have none', () => {
    expect(isCase('CHAMPIONS', 'upper')).toBe(true);
    expect(isCase('Champions', 'upper')).toBe(false);
    expect(isCase('Champions', 'title')).toBe(true);
    expect(isCase('champions', 'lower')).toBe(true);
    expect(isCase('2026', 'upper')).toBe(false);
    expect(isCase('ខ្មែរ', 'lower')).toBe(false);
  });
});
