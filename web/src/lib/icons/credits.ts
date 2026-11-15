/**
 * Credits for the library icons in a design (spec §38: the source and licence of every icon are
 * documented): which Lucide icons its printed layers draw, and the licence file an export package
 * carries for them.
 */
import { designAreas } from '@/domain/areas';
import { projectionsAsZone } from '@/domain/projected';
import type { ArtworkLayer, DesignDocument, LayerStack } from '@/domain/schema';

/** Where an export package keeps the icons' licence. */
export const ICON_LICENCE_FILE = 'licences/lucide-icons.txt';

function collect(stacks: readonly Pick<LayerStack, 'layers'>[]): string[] {
  const names = new Set<string>();
  const visit = (layer: ArtworkLayer) => {
    if (!layer.visible) return;
    if (layer.content.kind === 'lockup') for (const inner of Object.values(layer.content.layers)) visit(inner);
    else if (layer.content.kind === 'shape' && layer.content.icon) names.add(layer.content.icon.name);
  };
  for (const stack of stacks) for (const layer of Object.values(stack.layers)) visit(layer);
  return [...names].sort();
}

/** Lucide's names for the icons one print area's visible layers draw (inside lockups too), sorted. */
export function stackIcons(stack: Pick<LayerStack, 'layers'>): string[] {
  return collect([stack]);
}

/**
 * Lucide's names for the icons a design's visible layers draw, sorted: in print areas, design
 * areas, across seams and inside lockups, and still once outlined or combined into other shapes.
 */
export function iconsUsed(doc: DesignDocument): string[] {
  return collect([...Object.values(doc.zones), projectionsAsZone(doc), ...designAreas(doc)]);
}

/** An export package's icon licence file: which icons the design uses, what the licences allow, and the licence word for word. */
export function iconLicenceText(names: readonly string[], licence: { version: string; summary: readonly string[]; text: string }): string {
  return [
    'Icons in this design',
    '',
    `Lucide icons (https://lucide.dev), version ${licence.version}: ${names.join(', ')}.`,
    '',
    ...licence.summary,
    '',
    '-'.repeat(72),
    '',
    licence.text.trim(),
    '',
  ]
    .join('\n')
    .replace(/\r?\n/g, '\r\n');
}
