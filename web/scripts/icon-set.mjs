// Writes src/lib/icons/lucide-set.ts: one import per icon in the icon library's catalogue
// (src/lib/icons/catalog.ts), so the app bundles just those icons and loads them only when the
// icon panel opens. Run after changing the catalogue: npm run icon-set
// Needs Node 22.18 or later (it reads the catalogue's TypeScript as it is).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_NAMES } from '../src/lib/icons/catalog.ts';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = join(web, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons');
const missing = ICON_NAMES.filter((name) => !existsSync(join(iconDir, `${name}.mjs`)));
if (missing.length) {
  console.error(`Not in this version of lucide-react: ${missing.join(', ')}`);
  process.exit(1);
}
// A renamed icon's old name is kept as a module that only re-exports the new one, without its drawing.
const renamed = ICON_NAMES.flatMap((name) => {
  const source = readFileSync(join(iconDir, `${name}.mjs`), 'utf8');
  if (source.includes('__iconData')) return [];
  const to = /from '\.\/([a-z0-9-]+)\.mjs'/.exec(source)?.[1];
  return [`${name} (now ${to ?? 'renamed'})`];
});
if (renamed.length) {
  console.error(`Old names of renamed icons; use the new names in the catalogue: ${renamed.join(', ')}`);
  process.exit(1);
}
const id = (name) => `i_${name.replace(/-/g, '_')}`;
const lines = [
  '// Written by scripts/icon-set.mjs from the catalogue in ./catalog.ts. Run `npm run icon-set` after changing it; don’t edit by hand.',
  '// Icons: Lucide, ISC licence (https://lucide.dev/license); some icons are from Feather, MIT licence.',
  "import type { IconData } from './icon-shape';",
  ...ICON_NAMES.map((name) => `import * as ${id(name)} from 'lucide-react/icons/${name}';`),
  '',
  '/** Each lucide-react icon module also exports its drawing as `__iconData`. */',
  'const data = (m: object) => (m as unknown as { __iconData: IconData }).__iconData;',
  '',
  'export const ICON_DATA: Readonly<Record<string, IconData>> = {',
  ...ICON_NAMES.map((name) => `  '${name}': data(${id(name)}),`),
  '};',
  '',
];
writeFileSync(join(web, 'src', 'lib', 'icons', 'lucide-set.ts'), lines.join('\n'), 'utf8');
console.log(`Wrote ${ICON_NAMES.length} icons to src/lib/icons/lucide-set.ts`);
