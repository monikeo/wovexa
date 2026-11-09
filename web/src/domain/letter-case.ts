/** Letter case for text layers: capitals, Title Case or lower case, by each language's own rules. */
export type LetterCase = 'upper' | 'title' | 'lower';

export function changeCase(value: string, to: LetterCase) {
  if (to === 'upper') return value.toLocaleUpperCase();
  if (to === 'lower') return value.toLocaleLowerCase();
  // A letter after a space, hyphen, apostrophe, quote or bracket starts a word.
  return value.toLocaleLowerCase().replace(/(^|[\s\-'’"(])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toLocaleUpperCase());
}

/** Whether text is already in a case (and the case means something: not digits or a caseless script). */
export function isCase(value: string, to: LetterCase) {
  const other: LetterCase = to === 'upper' ? 'lower' : 'upper';
  return value === changeCase(value, to) && value !== changeCase(value, other);
}
