import { describe, expect, it } from 'vitest';
import { LIMITS } from '@/domain/limits';
import { parsePath } from '@/domain/path-edit';
import { ICON_CATEGORIES, ICON_NAMES, iconLabel, searchIcons } from './catalog';
import { elementPath, iconShape, type IconData } from './icon-shape';
import { ICON_DATA } from './lucide-set';

describe('icon library catalogue', () => {
  it('lists each icon once per category, and the generated set holds exactly the catalogue', () => {
    for (const c of ICON_CATEGORIES) expect(new Set(c.icons).size, c.label).toBe(c.icons.length);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    expect(ICON_NAMES.length).toBeGreaterThan(150);
    expect(Object.keys(ICON_DATA).sort()).toEqual([...ICON_NAMES].sort());
  });

  it('names icons as people say them', () => {
    expect(iconLabel('flag-triangle-right')).toBe('Flag triangle right');
    expect(iconLabel('music-2')).toBe('Music');
    expect(iconLabel('x')).toBe('X');
  });

  it('finds icons by the start of any word in their name or category', () => {
    expect(searchIcons('troph')).toEqual(['trophy']);
    expect(searchIcons('ice cream')).toEqual(['ice-cream-cone']);
    // A category's name finds its icons.
    expect(searchIcons('animals')).toEqual([...ICON_CATEGORIES.find((c) => c.id === 'animals')!.icons]);
    // Within a category only, and nothing for a word no icon has.
    expect(searchIcons('star', 'nature')).toEqual(['star']);
    expect(searchIcons('quasar')).toEqual([]);
    // The words people use, and the names Lucide used to give these icons.
    expect(searchIcons('smile')).toEqual(['face-slightly-smiling']);
    expect(searchIcons('notes')).toEqual(['eighth-notes', 'sixteenth-notes']);
    expect(iconLabel('face-slightly-smiling')).toBe('Smiling face');
    expect(searchIcons('  ', 'shapes')).toEqual([...ICON_CATEGORIES.find((c) => c.id === 'shapes')!.icons]);
  });
});

describe('icons as line shapes', () => {
  it('draws every kind of element lucide uses as path data', () => {
    expect(elementPath(['circle', { cx: 12, cy: 12, r: 3 }])).toMatch(/^M9 12A3 3/);
    expect(elementPath(['line', { x1: '2', y1: '4', x2: '22', y2: '4' }])).toBe('M2 4L22 4');
    expect(elementPath(['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }])).toContain('A2 2');
    expect(elementPath(['polyline', { points: '22 7 13.5 15.5 8.5 10.5 2 17' }])).toMatch(/^M22 7L13\.5 15\.5/);
    expect(elementPath(['polygon', { points: '12 2 22 22 2 22' }])).toMatch(/Z$/);
    expect(elementPath(['ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }])).toContain('A9 3');
    expect(elementPath(['defs', {}])).toBe('');
  });

  it('turns an icon into one path over its own extent, in the 0–100 box shapes use', () => {
    // A ring and a line beside it.
    const icon: IconData = { name: 'test', node: [['circle', { cx: 6, cy: 12, r: 4 }], ['line', { x1: 14, y1: 12, x2: 22, y2: 12 }]] };
    const shape = iconShape(icon)!;
    expect(shape.box.x).toBeCloseTo(2, 1);
    expect(shape.box.w).toBeCloseTo(20, 1);
    expect(shape.box.h).toBeCloseTo(8, 1);
    const subs = parsePath(shape.path);
    expect(subs).toHaveLength(2);
    for (const s of subs) for (const n of s.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(-0.01);
      expect(n.x).toBeLessThanOrEqual(100.01);
    }
    expect(iconShape({ name: 'nothing', node: [] })).toBeNull();
  });

  it('reads a path that opens with a relative move from its own start, as SVG does', () => {
    // Two short strokes, each its own path starting "m": joined as text, the second would be moved by the first.
    const icon: IconData = { name: 'ticks', node: [['path', { d: 'm2.5 21.5 1.4-1.4' }], ['path', { d: 'm20.1 3.9 1.4-1.4' }]] };
    const shape = iconShape(icon)!;
    expect(shape.box.x).toBeCloseTo(2.5, 5);
    expect(shape.box.x + shape.box.w).toBeCloseTo(21.5, 5);
    expect(shape.box.y).toBeCloseTo(2.5, 5);
    expect(shape.box.y + shape.box.h).toBeCloseTo(21.5, 5);
  });

  it('converts every icon in the library to a printable path on its grid', () => {
    for (const name of ICON_NAMES) {
      const shape = iconShape(ICON_DATA[name]);
      expect(shape, name).not.toBeNull();
      expect(shape!.path.length, name).toBeGreaterThan(10);
      expect(shape!.path.length, name).toBeLessThan(LIMITS.pathChars);
      // Lucide draws within its 24-unit grid.
      expect(shape!.box.x, name).toBeGreaterThan(-1);
      expect(shape!.box.y, name).toBeGreaterThan(-1);
      expect(shape!.box.x + shape!.box.w, name).toBeLessThan(25);
      expect(shape!.box.y + shape!.box.h, name).toBeLessThan(25);
      expect(shape!.box.w * shape!.box.h, name).toBeGreaterThan(4);
    }
  });
});
