import { describe, expect, it } from 'vitest';
import { graphemes, letterInks } from './letter-colors';

describe('letter colours', () => {
  it('run across the letters in turn and repeat, skipping spaces', () => {
    expect(letterInks(['GO TEAM'], ['R', 'W'])).toEqual([['R', 'W', null, 'R', 'W', 'R', 'W']]);
  });

  it('carry on from one line to the next', () => {
    expect(letterInks(['AB', 'CD'], ['1', '2', '3'])).toEqual([
      ['1', '2'],
      ['3', '1'],
    ]);
  });

  it('keep an accent or a Khmer vowel sign with its letter', () => {
    // "é" written as e + combining accent, and Khmer ក + ា, are one letter each.
    expect(graphemes('café')).toHaveLength(4);
    expect(graphemes('កា')).toHaveLength(1);
    expect(letterInks(['éកា'], ['R', 'W'])).toEqual([['R', 'W']]);
  });
});
