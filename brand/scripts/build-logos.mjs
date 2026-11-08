// WOVEXA logo generator.
// Builds every logo SVG in brand/logo from one set of geometry, so the symbol,
// wordmark and lockups can never drift apart. Run: node brand/scripts/build-logos.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'logo');
mkdirSync(OUT, { recursive: true });

export const COLORS = { ink: '#000000', paper: '#FFFFFF', blue: '#2B59FF' };

// ---------------------------------------------------------------------------
// Symbol: two interlaced V strokes on a 64-unit grid (bounds x 4..60, y 10..54).
// Stroke horizontal width 8, centrelines 8→24→40 and 24→40→56.
// The right arm of the first V passes over the left arm of the second; the
// under-stroke is split with a 2.4-unit horizontal gap (≈2.25 perpendicular).
// ---------------------------------------------------------------------------
export const SYMBOL_POLYGONS = [
  // Second V, upper fragment of its left arm (above the crossing)
  [[20, 10], [28, 10], [30.8, 17.7], [26.8, 28.7]],
  // Second V, lower fragment of its left arm plus its whole right arm
  [[37.2, 35.3], [40, 43], [52, 10], [60, 10], [44, 54], [36, 54], [33.2, 46.3]],
  // First V, drawn whole: it is the over-stroke
  [[4, 10], [12, 10], [24, 43], [36, 10], [44, 10], [28, 54], [20, 54]],
];
export const SYMBOL_BOX = { x: 4, y: 10, w: 56, h: 44 };

// ---------------------------------------------------------------------------
// Wordmark: geometric capitals, cap height 40, flat terminals.
// ---------------------------------------------------------------------------
const H = 40;
const S = 5.6; // stem and bar thickness

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
// Diagonal stroke from a top span to a bottom span, both of horizontal width tw.
const diag = (xTop, xBottom, tw) => [[xTop, 0], [xTop + tw, 0], [xBottom + tw, H], [xBottom, H]];

function letterW() {
  const tw = 6, r = (52 - tw) / 4; // equal run on all four strokes
  const c = [0, r, 2 * r, 3 * r, 4 * r]; // left edges of top/bottom spans
  return {
    width: 52,
    polys: [diag(c[0], c[1], tw), diag(c[2], c[1], tw), diag(c[2], c[3], tw), diag(c[4], c[3], tw)],
  };
}
function letterO() {
  const R = 20.6, t = 6.0;
  return { width: 2 * R, circle: { cx: R, cy: H / 2, r: R, inner: R - t } };
}
function letterV() {
  const tw = 6.2, w = 34, mid = w / 2 - tw / 2;
  return { width: w, polys: [diag(0, mid, tw), diag(w - tw, mid, tw)] };
}
function letterE() {
  const w = 28;
  return {
    width: w,
    polys: [rect(0, 0, S, H), rect(0, 0, w, S), rect(0, H / 2 - S / 2, w - 3, S), rect(0, H - S, w, S)],
  };
}
function letterX() {
  const tw = 7, w = 34;
  return { width: w, polys: [diag(0, w - tw, tw), diag(w - tw, 0, tw)] };
}
function letterA() {
  const tw = 6.2, w = 36, apex = w / 2 - tw / 2;
  const barTop = 24.5, barMid = barTop + S / 2;
  // Centrelines of each leg at the bar's mid height, so the bar ends stay inside the legs.
  const t = barMid / H;
  const leftC = apex + tw / 2 + (0 - apex) * t;
  const rightC = apex + tw / 2 + (w - tw - apex) * t;
  return {
    width: w,
    polys: [diag(apex, 0, tw), diag(apex, w - tw, tw), rect(leftC, barTop, rightC - leftC, S)],
  };
}

const LETTERS = [letterW(), letterO(), letterV(), letterE(), letterX(), letterA()];
const GAPS = [10, 9, 11, 10, 7]; // optical spacing after W, O, V, E, X

const fmt = (n) => Number(n.toFixed(3)).toString();
const polyPath = (pts, dx = 0, dy = 0) =>
  'M' + pts.map(([x, y]) => `${fmt(x + dx)} ${fmt(y + dy)}`).join('L') + 'Z';
// Circle as two arcs; inner ring drawn counter-clockwise so evenodd/nonzero both punch a hole.
const ringPath = ({ cx, cy, r, inner }, dx) => {
  const x = cx + dx;
  return (
    `M${fmt(x - r)} ${fmt(cy)}a${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(-2 * r)} 0Z` +
    `M${fmt(x - inner)} ${fmt(cy)}a${fmt(inner)} ${fmt(inner)} 0 1 0 ${fmt(2 * inner)} 0a${fmt(inner)} ${fmt(inner)} 0 1 0 ${fmt(-2 * inner)} 0Z`
  );
};

function wordmarkPath() {
  let x = 0;
  const parts = [];
  LETTERS.forEach((L, i) => {
    if (L.polys) L.polys.forEach((p) => parts.push(polyPath(p, x)));
    if (L.circle) parts.push(ringPath(L.circle, x));
    x += L.width + (GAPS[i] ?? 0);
  });
  return { d: parts.join(''), width: x };
}

export const WORDMARK = wordmarkPath(); // cap height 40, overshoot 0.6 above/below for O
export const SYMBOL_PATH = SYMBOL_POLYGONS.map((p) => polyPath(p)).join('');

// ---------------------------------------------------------------------------
// SVG writers
// ---------------------------------------------------------------------------
const svg = (viewBox, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}">` +
  `<title>${title}</title>${body}</svg>\n`;

function write(name, content) {
  writeFileSync(join(OUT, name), content, 'utf8');
  console.log('wrote', name);
}

const symbolBody = (fill, dx = 0, dy = 0, scale = 1) =>
  `<path fill="${fill}" fill-rule="evenodd" transform="translate(${fmt(dx)} ${fmt(dy)}) scale(${fmt(scale)})" d="${SYMBOL_PATH}"/>`;
const wordBody = (fill, dx, dy, scale) =>
  `<path fill="${fill}" fill-rule="nonzero" transform="translate(${fmt(dx)} ${fmt(dy)}) scale(${fmt(scale)})" d="${WORDMARK.d}"/>`;

// Symbol, tight to its bounds
for (const [suffix, fill] of [['black', COLORS.ink], ['white', COLORS.paper]]) {
  write(`wovexa-symbol-${suffix}.svg`, svg(`4 10 56 44`, symbolBody(fill), 'WOVEXA'));
}

// Wordmark
const WM_H = 41.2; // includes O overshoot
for (const [suffix, fill] of [['black', COLORS.ink], ['white', COLORS.paper]]) {
  write(
    `wovexa-wordmark-${suffix}.svg`,
    svg(`0 0 ${fmt(WORDMARK.width)} ${WM_H}`, wordBody(fill, 0, 0.6, 1), 'WOVEXA'),
  );
}

// Horizontal lockup: symbol height 44, wordmark cap height 22, gap 18
{
  const capScale = 22 / H;
  const gap = 18;
  const wordX = SYMBOL_BOX.w + gap;
  const width = wordX + WORDMARK.width * capScale;
  for (const [suffix, fill] of [['black', COLORS.ink], ['white', COLORS.paper]]) {
    const body =
      symbolBody(fill, -SYMBOL_BOX.x, -SYMBOL_BOX.y) + wordBody(fill, wordX, (44 - 22) / 2, capScale);
    write(`wovexa-lockup-horizontal-${suffix}.svg`, svg(`0 0 ${fmt(width)} 44`, body, 'WOVEXA'));
  }
}

// Stacked lockup: wordmark 128 wide, centred under the symbol, gap 16
{
  const wordW = 128;
  const scale = wordW / WORDMARK.width;
  const width = Math.max(wordW, SYMBOL_BOX.w);
  const symX = (width - SYMBOL_BOX.w) / 2;
  const wordY = SYMBOL_BOX.h + 16;
  const height = wordY + WM_H * scale;
  for (const [suffix, fill] of [['black', COLORS.ink], ['white', COLORS.paper]]) {
    const body =
      symbolBody(fill, symX - SYMBOL_BOX.x, -SYMBOL_BOX.y) +
      wordBody(fill, (width - wordW) / 2, wordY + 0.6 * scale, scale);
    write(`wovexa-lockup-stacked-${suffix}.svg`, svg(`0 0 ${fmt(width)} ${fmt(height)}`, body, 'WOVEXA'));
  }
}

// App icons: 512 square. Rounded for general use; full-bleed for maskable PWA icons.
function appIcon(bg, fg, rounded) {
  const size = 512;
  const scale = 5.2; // symbol 291 x 229, inside the maskable 80% safe circle
  const dx = (size - SYMBOL_BOX.w * scale) / 2 - SYMBOL_BOX.x * scale;
  const dy = (size - SYMBOL_BOX.h * scale) / 2 - SYMBOL_BOX.y * scale;
  const radius = rounded ? 112 : 0;
  return svg(
    `0 0 ${size} ${size}`,
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` + symbolBody(fg, dx, dy, scale),
    'WOVEXA',
  );
}
write('wovexa-app-icon-black.svg', appIcon(COLORS.ink, COLORS.paper, true));
write('wovexa-app-icon-blue.svg', appIcon(COLORS.blue, COLORS.paper, true));
write('wovexa-app-icon-maskable.svg', appIcon(COLORS.ink, COLORS.paper, false));

// Favicon: symbol on a black rounded square, 64 grid
write(
  'wovexa-favicon.svg',
  svg(`0 0 64 64`, `<rect width="64" height="64" rx="14" fill="${COLORS.ink}"/>` + symbolBody(COLORS.paper), 'WOVEXA'),
);

// Geometry export for the web app (React components use the same paths)
writeFileSync(
  join(OUT, 'geometry.json'),
  JSON.stringify(
    { symbol: { viewBox: '4 10 56 44', d: SYMBOL_PATH }, wordmark: { viewBox: `0 0 ${fmt(WORDMARK.width)} ${WM_H}`, d: WORDMARK.d, translateY: 0.6 } },
    null,
    2,
  ) + '\n',
);
console.log('wrote geometry.json');
