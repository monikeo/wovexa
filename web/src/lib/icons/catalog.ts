/**
 * The icon library's catalogue: Lucide's line icons (lucide.dev, ISC licence; some drawn from
 * Feather, MIT), every one of them searchable by its name and Lucide's own tags, with the ones
 * that suit garments (sport, nature, music, food, places, symbols) picked out into categories and
 * listed first. Names are Lucide's own. Pure: the icon data itself is loaded with the panel
 * (./library.ts), so none of this is in the studio's start-up bundle.
 */

export interface IconCategory {
  id: string;
  label: string;
  icons: readonly string[];
}

export const ICON_CATEGORIES: readonly IconCategory[] = [
  {
    id: 'sport',
    label: 'Sport',
    icons: ['trophy', 'medal', 'award', 'dumbbell', 'biceps-flexed', 'bike', 'volleyball', 'goal', 'target', 'timer', 'flag', 'flag-triangle-right', 'footprints', 'mountain', 'tent', 'sailboat', 'swords', 'shield', 'crown', 'zap'],
  },
  {
    id: 'nature',
    label: 'Nature',
    icons: ['sun', 'moon', 'star', 'cloud', 'cloud-rain', 'cloud-lightning', 'snowflake', 'rainbow', 'sunrise', 'sunset', 'waves-horizontal', 'wind', 'droplet', 'leaf', 'sprout', 'flower', 'flower-2', 'clover', 'tree-pine', 'trees', 'tree-palm', 'mountain-snow', 'feather', 'shell', 'cherry', 'apple', 'grape', 'citrus'],
  },
  {
    id: 'animals',
    label: 'Animals',
    icons: ['bird', 'fish', 'cat', 'dog', 'rabbit', 'squirrel', 'turtle', 'bug', 'paw-print', 'bone', 'fish-symbol', 'origami'],
  },
  {
    id: 'music',
    label: 'Music and party',
    icons: ['eighth-notes', 'eighth-note', 'sixteenth-notes', 'headphones', 'mic', 'mic-vocal', 'guitar', 'drum', 'piano', 'radio', 'disc-3', 'audio-waveform', 'party-popper', 'gift', 'cake', 'sparkles'],
  },
  {
    id: 'food',
    label: 'Food and drink',
    icons: ['coffee', 'cup-soda', 'beer', 'wine', 'martini', 'pizza', 'hamburger', 'sandwich', 'croissant', 'donut', 'cookie', 'ice-cream-cone', 'popcorn', 'candy', 'lollipop', 'egg-fried', 'carrot', 'banana', 'wheat', 'soup', 'utensils', 'chef-hat', 'beef', 'vegan'],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icons: ['heart', 'star', 'sparkle', 'flame', 'infinity', 'skull', 'ghost', 'anchor', 'key', 'lock', 'eye', 'gem', 'crown', 'badge', 'badge-check', 'shield-check', 'check', 'x', 'plus', 'asterisk', 'hash', 'at-sign', 'atom', 'dna', 'brain', 'orbit', 'puzzle', 'hourglass', 'magnet', 'lightbulb'],
  },
  {
    id: 'shapes',
    label: 'Shapes',
    icons: ['circle', 'square', 'triangle', 'hexagon', 'octagon', 'pentagon', 'diamond', 'spade', 'club', 'cone', 'cylinder', 'pyramid', 'torus', 'dice-5'],
  },
  {
    id: 'travel',
    label: 'Travel and places',
    icons: ['plane', 'car', 'car-front', 'bus', 'train-front', 'tram-front', 'ship', 'motorbike', 'truck', 'tractor', 'helicopter', 'rocket', 'map', 'map-pin', 'compass', 'globe', 'earth', 'navigation', 'castle', 'landmark', 'house', 'ferris-wheel'],
  },
  {
    id: 'tech',
    label: 'Tech and tools',
    icons: ['cpu', 'code', 'terminal', 'gamepad-2', 'joystick', 'monitor', 'smartphone', 'camera', 'wifi', 'bot', 'satellite', 'drone', 'telescope', 'microscope', 'hammer', 'wrench', 'pickaxe', 'axe', 'scissors', 'paintbrush'],
  },
  {
    id: 'people',
    label: 'Faces and hands',
    icons: ['face-slightly-smiling', 'face-grinning', 'face-slightly-frowning', 'face-neutral', 'face-angry', 'face-expressionless', 'hand', 'hand-metal', 'thumbs-up', 'handshake', 'hand-heart', 'heart-handshake', 'person-standing', 'baby'],
  },
  {
    id: 'arrows',
    label: 'Arrows',
    icons: ['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'arrow-up-right', 'chevron-up', 'chevrons-right', 'move', 'repeat', 'refresh-cw', 'trending-up', 'trending-down'],
  },
];

/** The catalogue's picks once each, in its order: they lead the full list. */
export const CATALOGUE_ICONS: readonly string[] = [...new Set(ICON_CATEGORIES.flatMap((c) => c.icons))];

/** Names that say it better than Lucide's own, for the icons whose names describe the drawing. */
const LABELS: Readonly<Record<string, string>> = {
  'waves-horizontal': 'Waves',
  'eighth-notes': 'Music notes',
  'eighth-note': 'Music note',
  'sixteenth-notes': 'Sixteenth notes',
  'face-slightly-smiling': 'Smiling face',
  'face-grinning': 'Grinning face',
  'face-slightly-frowning': 'Frowning face',
  'face-neutral': 'Neutral face',
  'face-angry': 'Angry face',
  'face-expressionless': 'Blank face',
};

/** More words people search for, including the names these icons had before Lucide renamed them. */
const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  'waves-horizontal': ['waves', 'sea', 'water', 'surf'],
  'eighth-notes': ['music', 'notes', 'song'],
  'eighth-note': ['music', 'note', 'song'],
  'sixteenth-notes': ['music', 'notes', 'beat'],
  'face-slightly-smiling': ['smile', 'happy', 'emoji'],
  'face-grinning': ['laugh', 'grin', 'happy', 'emoji'],
  'face-slightly-frowning': ['frown', 'sad', 'emoji'],
  'face-neutral': ['meh', 'emoji'],
  'face-angry': ['angry', 'mad', 'emoji'],
  'face-expressionless': ['annoyed', 'blank', 'emoji'],
  trophy: ['cup', 'winner', 'champion'],
  medal: ['winner', 'champion'],
  volleyball: ['ball', 'beach'],
  dumbbell: ['gym', 'fitness', 'weights'],
  'biceps-flexed': ['gym', 'fitness', 'strong', 'muscle'],
  heart: ['love'],
  flame: ['fire', 'hot'],
  zap: ['lightning', 'bolt', 'energy'],
  skull: ['death', 'pirate'],
  'paw-print': ['pet', 'dog', 'cat'],
  'tree-palm': ['beach', 'tropical'],
  'ice-cream-cone': ['dessert'],
  'gamepad-2': ['games', 'controller'],
};

/** An icon's name as people say it: "flag-triangle-right" is "Flag triangle right", "flower-2" is "Flower". */
export function iconLabel(name: string): string {
  if (Object.hasOwn(LABELS, name)) return LABELS[name];
  const words = name.split('-').filter((w) => !/^\d+$/.test(w));
  const text = (words.length ? words : [name]).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Words in a search, a tag or a label: lower case, split at spaces, commas, hyphens and underscores. */
const wordsOf = (text: string) => text.toLowerCase().split(/[\s,_-]+/).filter(Boolean);

/** Joining words that would find half the library on their own. */
const FILLER = new Set(['a', 'an', 'and', 'the', 'of', 'or', 'to', 'in', 'on', 'with', 'for']);

/** How closely a word describes an icon: its name (or the name it's shown by), then everyday words, then Lucide's tags, then its category. */
const NAME = 0;
const WORD = 1;
const TAG = 2;
const CATEGORY = 3;

/** How far ahead a catalogue pick goes: its everyday word ranks with another icon's name ("fire" finds the flame first). */
const PICK_LEAD = 2;

interface IndexEntry {
  name: string;
  /** Its search words, lower case, each once at its closest rank. */
  words: string[];
  ranks: number[];
  /** Fewer words in a name make the plainer match: "star" before "star-half". */
  nameWords: number;
  /** One of the catalogue's picks, made for garments. */
  pick: boolean;
  order: number;
}

export interface IconIndex {
  /** Every icon in the set: the catalogue's picks first, in its order, then the rest by name. */
  names: readonly string[];
  entries: ReadonlyMap<string, IndexEntry>;
  /** Each category's icons that are in the set. */
  categories: ReadonlyMap<string, readonly string[]>;
}

/**
 * The search index of an icon set: `setNames` are the icons it has (Lucide's, about two thousand),
 * `tags` the words Lucide gives each. Catalogue picks the set doesn't have are left out.
 */
export function buildIconIndex(setNames: readonly string[], tags: Readonly<Record<string, readonly string[]>> = {}): IconIndex {
  const inSet = new Set(setNames);
  const picks = CATALOGUE_ICONS.filter((n) => inSet.has(n));
  const picked = new Set(picks);
  const names = [...picks, ...[...setNames].filter((n) => !picked.has(n)).sort()];
  const categoriesOf = new Map<string, string[]>();
  for (const c of ICON_CATEGORIES) for (const n of c.icons) categoriesOf.set(n, [...(categoriesOf.get(n) ?? []), c.label]);
  const entries = new Map<string, IndexEntry>();
  names.forEach((name, order) => {
    const best = new Map<string, number>();
    const add = (words: string[], rank: number) => {
      for (const w of words) if ((best.get(w) ?? Infinity) > rank) best.set(w, rank);
    };
    const own = name.split('-').filter(Boolean);
    add(own, NAME);
    add(wordsOf(iconLabel(name)), NAME);
    for (const k of Object.hasOwn(KEYWORDS, name) ? KEYWORDS[name] : []) add(wordsOf(k), WORD);
    for (const t of Object.hasOwn(tags, name) ? tags[name] : []) add(wordsOf(t).filter((w) => !FILLER.has(w)), TAG);
    for (const label of categoriesOf.get(name) ?? []) add(wordsOf(label).filter((w) => !FILLER.has(w)), CATEGORY);
    entries.set(name, { name, words: [...best.keys()], ranks: [...best.values()], nameWords: own.length, pick: picked.has(name), order });
  });
  const categories = new Map(ICON_CATEGORIES.map((c) => [c.id, c.icons.filter((n) => inSet.has(n))] as const));
  return { names, entries, categories };
}

/**
 * Icons with a word starting with each word typed (in their name, label, everyday words, Lucide's
 * tags or category), the closest first: a name that is the search, then names with the word,
 * then everyday words, tags and categories, whole words before beginnings of words, the
 * catalogue's garment picks a step ahead, plainer names before longer ones. An empty search lists
 * the category, or every icon.
 */
export function searchIconIndex(index: IconIndex, query: string, categoryId: string | null = null): string[] {
  const pool = categoryId ? (index.categories.get(categoryId) ?? []) : index.names;
  const terms = wordsOf(query);
  if (!terms.length) return [...pool];
  const whole = terms.join('-');
  const found: { entry: IndexEntry; score: number }[] = [];
  for (const name of pool) {
    const entry = index.entries.get(name);
    if (!entry) continue;
    let score = 0;
    for (const t of terms) {
      let best = Infinity;
      for (let i = 0; i < entry.words.length && best > 0; i++) {
        const w = entry.words[i];
        // An exact word beats a word that only starts with what was typed, at each rank.
        if (w.startsWith(t)) best = Math.min(best, entry.ranks[i] * 2 + (w.length === t.length ? 0 : 1));
      }
      if (best === Infinity) {
        score = -1;
        break;
      }
      score += best;
    }
    if (score < 0) continue;
    found.push({ entry, score: score - (name === whole ? 1 : 0) - (entry.pick ? PICK_LEAD : 0) });
  }
  found.sort((a, b) => a.score - b.score || a.entry.nameWords - b.entry.nameWords || a.entry.order - b.entry.order);
  return found.map((f) => f.entry.name);
}
