import { describe, expect, it } from 'vitest';
import { cleanLabel, filterProjects, foldersAndTags, mergeTags, MAX_TAG_CHARS, MAX_TAGS, NO_FOLDER, type ProjectMeta } from './local-db';

const project = (id: string, title: string, folder?: string, tags?: string[]): ProjectMeta => ({
  id,
  title,
  folder,
  tags,
  garmentModelId: 'tee-classic',
  bodyColor: '#FFFFFF',
  layerCount: 1,
  createdAt: 0,
  updatedAt: 0,
  serverRevision: 0,
  syncState: 'local',
});

const all = [
  project('a', 'Home kit', 'FC United', ['2027', 'Approved']),
  project('b', 'Away kit', 'FC United', ['2027']),
  project('c', 'Staff polo', 'Tigers', ['approved']),
  project('d', 'Sketch'),
];

describe('project folders and tags', () => {
  it('tidies names and keeps them within their length', () => {
    expect(cleanLabel('  Spring   2027 ', 60)).toBe('Spring 2027');
    expect(cleanLabel('   ', 60)).toBe('');
    expect(cleanLabel('x'.repeat(80), MAX_TAG_CHARS)).toHaveLength(MAX_TAG_CHARS);
  });

  it('treats tags that differ only in case as one, removes any case, and caps how many', () => {
    expect(mergeTags(['Approved'], ['approved', ' Rush ', ''])).toEqual(['Approved', 'Rush']);
    expect(mergeTags(['Approved', 'Rush'], [], ['APPROVED'])).toEqual(['Rush']);
    expect(mergeTags([], Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(MAX_TAGS);
  });

  it('lists folders with their counts and every tag once, in name order', () => {
    const { folders, tags } = foldersAndTags(all);
    expect(folders).toEqual([
      { name: 'FC United', count: 2 },
      { name: 'Tigers', count: 1 },
    ]);
    expect(tags).toEqual(['2027', 'Approved']);
  });

  it('filters by folder, unfiled, tags (all of them, any case) and a search of titles, folders and tags', () => {
    const ids = (f: Partial<Parameters<typeof filterProjects>[1]>) => filterProjects(all, { query: '', folder: null, tags: [], ...f }).map((p) => p.id);
    expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ folder: 'FC United' })).toEqual(['a', 'b']);
    expect(ids({ folder: NO_FOLDER })).toEqual(['d']);
    expect(ids({ tags: ['APPROVED'] })).toEqual(['a', 'c']);
    expect(ids({ tags: ['approved', '2027'] })).toEqual(['a']);
    expect(ids({ query: 'tig' })).toEqual(['c']);
    expect(ids({ query: 'kit', folder: 'FC United', tags: ['approved'] })).toEqual(['a']);
  });
});
