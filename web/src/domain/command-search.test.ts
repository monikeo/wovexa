import { describe, expect, it } from 'vitest';
import { commandScore, searchCommands } from './command-search';

const items = [
  { label: 'Add text', keywords: 'type words' },
  { label: 'Add rectangle', keywords: 'rect box square' },
  { label: 'Undo', keywords: 'back ctrl z' },
  { label: 'Go to Left sleeve', keywords: 'zone artboard' },
  { label: 'Export vector files', keywords: 'svg print' },
  { label: 'Wear 3D model: Hoodie1', keywords: 'library glb' },
];
const labels = (q: string) => searchCommands(items, q).map((i) => i.label);

describe('command search', () => {
  it('finds by name, by start of a word and by keyword', () => {
    expect(labels('undo')[0]).toBe('Undo');
    expect(labels('rect')[0]).toBe('Add rectangle');
    expect(labels('svg')[0]).toBe('Export vector files');
    expect(labels('sleeve')[0]).toBe('Go to Left sleeve');
    expect(labels('hoodie')[0]).toBe('Wear 3D model: Hoodie1');
  });

  it('forgives missing letters and needs every word', () => {
    expect(labels('vctr')[0]).toBe('Export vector files');
    expect(labels('hodie')).toEqual(['Wear 3D model: Hoodie1']);
    expect(labels('add box')).toEqual(['Add rectangle']);
    expect(labels('zzz')).toEqual([]);
  });

  it('does not match letters strewn across different words', () => {
    // h…o…o…d spread over "Go to Left sleeve zone artboard" is not a hood.
    expect(labels('hood')).toEqual(['Wear 3D model: Hoodie1']);
    expect(labels('gtl')).toEqual([]);
  });

  it('ranks a whole word above the start of a longer one', () => {
    const sizes = [{ label: 'Size: K2 (kids 2)' }, { label: 'Size: M' }, { label: 'Size: S' }];
    expect(searchCommands(sizes, 'size: s')[0].label).toBe('Size: S');
    expect(searchCommands(sizes, 'size m')[0].label).toBe('Size: M');
    expect(searchCommands(sizes, 'kids')[0].label).toBe('Size: K2 (kids 2)');
  });

  it('keeps the list in order with no query and ranks the start of a name first', () => {
    expect(labels('')).toEqual(items.map((i) => i.label));
    expect(commandScore('add', items[0])).toBeGreaterThan(commandScore('text', items[0]));
  });
});
