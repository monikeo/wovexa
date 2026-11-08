/**
 * Built-in graphics: bold, print-friendly vector marks drawn for WOVEXA, free to use on any
 * product. Each is SVG path data in a 0–100 box (even-odd fill), placed as an editable shape
 * layer so its colour, gradient, pattern and outline stay editable and it prints sharp at any size.
 */
export interface Graphic {
  id: string;
  name: string;
  category: 'badges' | 'sport' | 'symbols' | 'nature';
  /** Width ÷ height of the box it is designed for. */
  aspect: number;
  path: string;
}

function starburst(points: number, inner: number) {
  const parts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : 50;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    parts.push(`${i ? 'L' : 'M'}${(50 + Math.cos(a) * r).toFixed(1)} ${(50 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `${parts.join(' ')} Z`;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number) => `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;

export const GRAPHICS: Graphic[] = [
  { id: 'shield', name: 'Shield', category: 'badges', aspect: 0.9, path: 'M50 2 L94 16 C94 58 78 82 50 98 C22 82 6 58 6 16 Z' },
  { id: 'crest', name: 'Crest outline', category: 'badges', aspect: 0.9, path: 'M50 2 L94 16 C94 58 78 82 50 98 C22 82 6 58 6 16 Z M50 12 L84 23 C84 56 72 75 50 88 C28 75 16 56 16 23 Z' },
  { id: 'ring', name: 'Badge ring', category: 'badges', aspect: 1, path: `${ellipse(50, 50, 48, 48)} ${ellipse(50, 50, 36, 36)}` },
  { id: 'banner', name: 'Banner', category: 'badges', aspect: 3, path: 'M0 30 L14 30 L14 20 L86 20 L86 30 L100 30 L90 50 L100 70 L86 70 L86 80 L14 80 L14 70 L0 70 L10 50 Z' },
  { id: 'burst', name: 'Starburst', category: 'badges', aspect: 1, path: starburst(16, 38) },
  { id: 'chevron', name: 'Chevrons', category: 'badges', aspect: 1.4, path: 'M2 30 L50 2 L98 30 L98 46 L50 18 L2 46 Z M2 66 L50 38 L98 66 L98 82 L50 54 L2 82 Z' },
  { id: 'trophy', name: 'Trophy', category: 'sport', aspect: 1, path: 'M24 6 L76 6 L76 14 L94 14 C94 34 84 44 72 46 C68 56 60 62 56 64 L56 78 L70 78 L70 92 L30 92 L30 78 L44 78 L44 64 C40 62 32 56 28 46 C16 44 6 34 6 14 L24 14 Z M14 20 C14 30 20 36 26 38 C24 32 24 26 24 20 Z M86 20 L76 20 C76 26 76 32 74 38 C80 36 86 30 86 20 Z' },
  { id: 'bolt', name: 'Lightning', category: 'sport', aspect: 0.7, path: 'M58 2 L18 56 L44 56 L36 98 L82 40 L55 40 L66 2 Z' },
  { id: 'wings', name: 'Wing', category: 'sport', aspect: 1.6, path: 'M2 60 C20 20 60 8 98 10 C80 18 70 24 64 30 C78 30 88 32 94 36 C76 40 66 44 60 48 C70 50 78 54 82 58 C60 62 40 66 2 60 Z' },
  { id: 'arrow', name: 'Arrow', category: 'symbols', aspect: 1.6, path: 'M2 40 L62 40 L62 18 L98 50 L62 82 L62 60 L2 60 Z' },
  { id: 'crown', name: 'Crown', category: 'symbols', aspect: 1.25, path: 'M8 78 L4 26 L28 48 L50 14 L72 48 L96 26 L92 78 Z M8 86 L92 86 L92 96 L8 96 Z' },
  { id: 'sparkle', name: 'Sparkle', category: 'symbols', aspect: 1, path: 'M50 0 C54 34 66 46 100 50 C66 54 54 66 50 100 C46 66 34 54 0 50 C34 46 46 34 50 0 Z' },
  { id: 'check', name: 'Tick', category: 'symbols', aspect: 1.2, path: 'M8 54 L22 40 L40 58 L80 14 L94 28 L40 86 Z' },
  { id: 'plus', name: 'Cross', category: 'symbols', aspect: 1, path: 'M38 4 L62 4 L62 38 L96 38 L96 62 L62 62 L62 96 L38 96 L38 62 L4 62 L4 38 L38 38 Z' },
  { id: 'flame', name: 'Flame', category: 'nature', aspect: 0.75, path: 'M50 2 C62 22 82 34 82 60 C82 82 66 98 50 98 C34 98 18 84 18 62 C18 46 28 36 34 26 C36 40 42 46 48 48 C46 32 46 16 50 2 Z' },
  { id: 'drop', name: 'Drop', category: 'nature', aspect: 0.75, path: 'M50 2 C66 28 84 46 84 66 C84 84 68 98 50 98 C32 98 16 84 16 66 C16 46 34 28 50 2 Z' },
  { id: 'mountain', name: 'Mountains', category: 'nature', aspect: 1.5, path: 'M2 92 L34 28 L50 54 L66 32 L98 92 Z' },
  { id: 'wave', name: 'Wave', category: 'nature', aspect: 2, path: 'M0 70 C15 40 35 40 50 60 C65 80 85 80 100 50 L100 100 L0 100 Z' },
  { id: 'paw', name: 'Paw', category: 'nature', aspect: 1, path: `M50 98 C30 98 22 84 26 72 C30 60 42 56 50 56 C58 56 70 60 74 72 C78 84 70 98 50 98 Z ${ellipse(18, 48, 10, 13)} ${ellipse(38, 24, 10, 13)} ${ellipse(62, 24, 10, 13)} ${ellipse(82, 48, 10, 13)}` },
];

export const GRAPHIC_CATEGORIES: { id: Graphic['category']; label: string }[] = [
  { id: 'badges', label: 'Badges' },
  { id: 'sport', label: 'Sport' },
  { id: 'symbols', label: 'Symbols' },
  { id: 'nature', label: 'Nature' },
];

export function getGraphic(id: string) {
  return GRAPHICS.find((g) => g.id === id);
}
