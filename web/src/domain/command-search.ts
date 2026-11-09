/**
 * Finding commands by what people type: forgiving of order within a word and of missing
 * letters, strongest for the start of a name. Pure, so it is tested without the studio.
 */

export interface Searchable {
  label: string;
  /** Other words it answers to ("rect" for Rectangle, "undo" for Undo). */
  keywords?: string;
}

/** How well one word of the query matches the text: 0 for no match, higher is better. */
function wordScore(word: string, text: string): number {
  // A whole word of the text ("s" in "Size: S") beats the start of a longer one ("size"), and
  // the name's first word beats the others.
  const bare = word.replace(/[^\p{L}\p{N}]+/gu, '');
  const whole = bare ? text.split(/[^\p{L}\p{N}]+/u).filter(Boolean).indexOf(bare) : -1;
  if (whole === 0) return 120;
  if (whole > 0) return 110 - Math.min(9, whole);
  const at = text.indexOf(word);
  if (at === 0) return 100;
  if (at > 0) {
    // At the start of a word beats the middle of one.
    return /[\s\-:/(]/.test(text[at - 1]) ? 80 - Math.min(20, at / 4) : 55 - Math.min(20, at / 4);
  }
  // Letters in order within one word, from its first letter ("vctr" finds "vector", "hodie"
  // finds "hoodie"): weaker, and weaker the more it skips. Letters strewn across words are no match.
  let best = 0;
  for (const w of text.split(/[\s\-:/(),.]+/)) {
    if (w.length < word.length || w[0] !== word[0]) continue;
    let i = 0;
    let gaps = 0;
    let last = -1;
    let found = true;
    for (const ch of word) {
      const next = w.indexOf(ch, i);
      if (next < 0) {
        found = false;
        break;
      }
      if (last >= 0) gaps += next - last - 1;
      last = next;
      i = next + 1;
    }
    if (found) best = Math.max(best, Math.max(1, 30 - gaps * 3));
  }
  return best;
}

/** A command's score for a query (every word must match), 0 when it doesn't. */
export function commandScore(query: string, item: Searchable): number {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const label = item.label.toLowerCase();
  const all = `${label} ${(item.keywords ?? '').toLowerCase()}`;
  let total = 0;
  for (const w of words) {
    // A word found in the name counts more than one found only in the keywords.
    const s = Math.max(wordScore(w, label) * 1.2, wordScore(w, all));
    if (!s) return 0;
    total += s;
  }
  return total;
}

/** The commands matching a query, best first; with no query, all of them in their own order. */
export function searchCommands<T extends Searchable>(items: readonly T[], query: string): T[] {
  if (!query.trim()) return [...items];
  return items
    .map((item, i) => ({ item, i, score: commandScore(query, item) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.item);
}
