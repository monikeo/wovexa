/**
 * The icon library as the panel uses it: every Lucide icon's drawing and Lucide's own search tags
 * (from lucide-static, pinned), indexed with the catalogue. Imported only when the icon panel first
 * opens (about 150 kB compressed), so none of it weighs on the studio's start-up.
 */
import iconNodes from 'lucide-static/icon-nodes.json';
import iconTags from 'lucide-static/tags.json';
import { buildIconIndex, searchIconIndex } from './catalog';
import type { IconData, IconElement } from './icon-shape';

export { ICON_CATEGORIES, iconLabel } from './catalog';
export { ICON_LICENCE_SUMMARY, LUCIDE_LICENCE, LUCIDE_VERSION } from './lucide-licence';

const NODES = iconNodes as unknown as Readonly<Record<string, readonly IconElement[]>>;
const INDEX = buildIconIndex(Object.keys(NODES), iconTags as unknown as Readonly<Record<string, readonly string[]>>);

/** Every icon: the catalogue's picks first, then the rest of Lucide's set by name. */
export const ICON_NAMES = INDEX.names;

/** An icon's drawing as Lucide ships it, or undefined for a name the set doesn't have. */
export function iconData(name: string): IconData | undefined {
  const node = Object.hasOwn(NODES, name) ? NODES[name] : undefined;
  return node ? { name, node } : undefined;
}

/** Icons matching a search, the closest first, within a category when one is chosen. */
export function searchIcons(query: string, categoryId: string | null = null): string[] {
  return searchIconIndex(INDEX, query, categoryId);
}
