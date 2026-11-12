/**
 * The icon library's catalogue: line icons from Lucide (lucide.dev, ISC licence; some drawn from
 * Feather, MIT), chosen for garments (sport, nature, music, food, places, symbols) rather than
 * app controls, in categories. Names are Lucide's own. Kept free of imports, so the script that
 * writes the icon set (scripts/icon-set.mjs) can read it as it is.
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

/** Every icon in the library once, in catalogue order. */
export const ICON_NAMES: readonly string[] = [...new Set(ICON_CATEGORIES.flatMap((c) => c.icons))];

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
  if (LABELS[name]) return LABELS[name];
  const words = name.split('-').filter((w) => !/^\d+$/.test(w));
  const text = (words.length ? words : [name]).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Icons that have a word starting with each word typed, in their name, label, search words or
 * category, in catalogue order. An empty search lists the category (or everything).
 */
export function searchIcons(query: string, categoryId: string | null = null): string[] {
  const pool = categoryId ? (ICON_CATEGORIES.find((c) => c.id === categoryId)?.icons ?? []) : ICON_NAMES;
  const terms = query.toLowerCase().split(/[\s,-]+/).filter(Boolean);
  if (!terms.length) return [...pool];
  const categoriesOf = (name: string) => ICON_CATEGORIES.filter((c) => c.icons.includes(name)).map((c) => c.label.toLowerCase());
  return pool.filter((name) => {
    const words = [...name.split('-'), ...iconLabel(name).toLowerCase().split(/\s+/), ...(KEYWORDS[name] ?? []), ...categoriesOf(name).flatMap((l) => l.split(/\s+/))];
    return terms.every((t) => words.some((w) => w.startsWith(t)));
  });
}
