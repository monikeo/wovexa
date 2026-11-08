// Copies the brand SVGs into public/brand and rasterizes PWA icons from them.
// Run after changing the logo: node scripts/build-icons.mjs  (uses sharp, installed with Next.js)
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const logo = join(web, '..', 'brand', 'logo');
const brandOut = join(web, 'public', 'brand');
const iconOut = join(web, 'public', 'icons');
mkdirSync(brandOut, { recursive: true });
mkdirSync(iconOut, { recursive: true });

for (const file of [
  'wovexa-favicon.svg',
  'wovexa-symbol-black.svg',
  'wovexa-symbol-white.svg',
  'wovexa-lockup-horizontal-black.svg',
  'wovexa-lockup-horizontal-white.svg',
  'wovexa-app-icon-black.svg',
]) {
  copyFileSync(join(logo, file), join(brandOut, file));
}

const render = (src, size, out) =>
  sharp(join(logo, src), { density: Math.ceil((72 * size) / 512) * 2 })
    .resize(size, size)
    .png()
    .toFile(join(iconOut, out));

await Promise.all([
  render('wovexa-app-icon-black.svg', 192, 'icon-192.png'),
  render('wovexa-app-icon-black.svg', 512, 'icon-512.png'),
  render('wovexa-app-icon-maskable.svg', 512, 'icon-maskable-512.png'),
  render('wovexa-app-icon-maskable.svg', 180, 'apple-touch-icon.png'),
]);
console.log('Icons written to public/icons and public/brand');
