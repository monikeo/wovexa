/**
 * Marketing images (spec EXP-11): the product render laid out for where it gets posted (a feed
 * post, a story, a wide post, a pin, a shop banner), with a headline, a line under it, a price or
 * call to action and the brand, and a presentation board (a line sheet) with the front, the back,
 * each colourway and the details a buyer asks about. Drawn on a canvas from renders the 3D view
 * makes on a transparent background. Browser only.
 */

export interface SocialFormat {
  id: string;
  label: string;
  w: number;
  h: number;
  hint: string;
}

export const SOCIAL_FORMATS: SocialFormat[] = [
  { id: 'post', label: 'Feed post', w: 1080, h: 1350, hint: 'Instagram and Facebook feed, 4:5' },
  { id: 'square', label: 'Square', w: 1080, h: 1080, hint: 'Square posts and marketplaces, 1:1' },
  { id: 'story', label: 'Story', w: 1080, h: 1920, hint: 'Stories, reels and TikTok covers, 9:16' },
  { id: 'wide', label: 'Wide post', w: 1600, h: 900, hint: 'X, LinkedIn and YouTube, 16:9' },
  { id: 'pin', label: 'Pin', w: 1000, h: 1500, hint: 'Pinterest, 2:3' },
  { id: 'banner', label: 'Shop banner', w: 1920, h: 640, hint: 'Web shop and email header, 3:1' },
];

export interface SocialCopy {
  headline: string;
  subline: string;
  /** A price or a call to action, in a pill; none when empty. */
  tag: string;
  /** The brand or shop name, small at the top; none when empty. */
  brand: string;
}

export interface SocialStyle {
  /** 'light' or 'dark' backdrop. */
  tone: 'light' | 'dark';
  /** The pill's colour (a brand colour). */
  accent: string;
  /** The headline's font family (loaded already). */
  font: string;
}

const luminance = (hex: string) => {
  const v = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return (0.3 * ((v >> 16) & 255) + 0.59 * ((v >> 8) & 255) + 0.11 * (v & 255)) / 255;
};

/** Near-black or near-white, whichever reads on `background`. */
export function inkOn(background: string) {
  return luminance(background) > 0.55 ? '#14161B' : '#FFFFFF';
}

/**
 * Words broken into at most `maxLines` lines no wider than `maxW`, at the largest size from `size`
 * down to `minSize` where they fit (the last line ends with an ellipsis if even that is too long).
 */
export function fitLines(measure: (text: string, size: number) => number, text: string, maxW: number, size: number, minSize: number, maxLines: number): { lines: string[]; size: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], size };
  for (let s = size; s >= minSize; s = Math.floor(s * 0.92)) {
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, s) <= maxW || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines && lines.every((l) => measure(l, s) <= maxW)) return { lines, size: s };
    if (s === minSize) break;
  }
  // Still too long at the smallest size: keep what fits and end with an ellipsis.
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, minSize) <= maxW) line = next;
    else {
      lines.push(line || word);
      line = line ? word : '';
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  const last = lines.length - 1;
  while (last >= 0 && lines[last].length > 1 && measure(`${lines[last]}…`, minSize) > maxW) lines[last] = lines[last].slice(0, -1);
  if (last >= 0 && lines.join(' ') !== words.join(' ')) lines[last] = `${lines[last].replace(/\s+$/, '')}…`;
  return { lines: lines.slice(0, maxLines), size: minSize };
}

const BACKDROPS = { light: ['#F6F5F2', '#E7E5E0'], dark: ['#23262E', '#121419'] } as const;

/**
 * A render scaled to fit a box, centred across it and never stretched (its own contact shadow
 * comes with it), at the top, middle or bottom of the box's height. Returns where it landed.
 */
function placeProduct(ctx: CanvasRenderingContext2D, shot: HTMLCanvasElement, x: number, y: number, w: number, h: number, valign: 'top' | 'middle' | 'bottom' = 'middle') {
  const k = Math.min(w / shot.width, h / shot.height);
  const dw = shot.width * k;
  const dh = shot.height * k;
  const at = { x: x + (w - dw) / 2, y: valign === 'top' ? y : valign === 'bottom' ? y + h - dh : y + (h - dh) / 2, w: dw, h: dh };
  ctx.drawImage(shot, at.x, at.y, at.w, at.h);
  return at;
}

/** A transparent render cut to what is in it (the garment and its shadow), with `pad` (a share of its size) round it. */
export function trimShot(shot: HTMLCanvasElement, bounds: { x: number; y: number; w: number; h: number } | null, pad = 0.03): HTMLCanvasElement {
  if (!bounds) return shot;
  const m = Math.round(Math.max(bounds.w, bounds.h) * pad);
  const x = Math.max(0, bounds.x - m);
  const y = Math.max(0, bounds.y - m);
  const w = Math.min(shot.width - x, bounds.w + 2 * m);
  const h = Math.min(shot.height - y, bounds.h + 2 * m);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(shot, x, y, w, h, 0, 0, w, h);
  return out;
}

function backdrop(ctx: CanvasRenderingContext2D, w: number, h: number, tone: SocialStyle['tone']) {
  const [top, bottom] = BACKDROPS[tone];
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * The words of a marketing image in a column `w` wide from (x, y), top down; returns where they
 * end. With `dry`, only measured, for placing them first.
 */
function drawCopy(ctx: CanvasRenderingContext2D, copy: SocialCopy, style: SocialStyle, x: number, y: number, w: number, unit: number, align: CanvasTextAlign, dry = false): number {
  const ink = inkOn(BACKDROPS[style.tone][0]);
  const measure = (font: string) => (text: string, size: number) => {
    ctx.font = font.replace('{s}', String(size));
    return ctx.measureText(text).width;
  };
  const ax = align === 'center' ? x + w / 2 : x;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  let at = y;
  if (copy.headline.trim()) {
    const headFont = `800 {s}px "${style.font}", "Archivo", system-ui, sans-serif`;
    const fit = fitLines(measure(headFont), copy.headline.toUpperCase(), w, Math.round(unit * 1.15), Math.round(unit * 0.5), 2);
    ctx.font = headFont.replace('{s}', String(fit.size));
    ctx.fillStyle = ink;
    for (const line of fit.lines) {
      if (!dry) ctx.fillText(line, ax, at);
      at += fit.size * 1.02;
    }
    at += unit * 0.2;
  }
  if (copy.subline.trim()) {
    const subFont = `500 {s}px "Archivo", system-ui, sans-serif`;
    const fit = fitLines(measure(subFont), copy.subline, w, Math.round(unit * 0.42), Math.round(unit * 0.28), 2);
    ctx.font = subFont.replace('{s}', String(fit.size));
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.78;
    for (const line of fit.lines) {
      if (!dry) ctx.fillText(line, ax, at);
      at += fit.size * 1.3;
    }
    ctx.globalAlpha = 1;
    at += unit * 0.25;
  }
  if (copy.tag.trim()) {
    const size = Math.round(unit * 0.4);
    ctx.font = `700 ${size}px "Archivo", system-ui, sans-serif`;
    const text = copy.tag.trim().slice(0, 40);
    const tw = Math.min(w, ctx.measureText(text).width + size * 1.6);
    const th = size * 1.9;
    const left = align === 'center' ? x + (w - tw) / 2 : x;
    if (!dry) {
      ctx.fillStyle = style.accent;
      ctx.beginPath();
      ctx.roundRect(left, at, tw, th, th / 2);
      ctx.fill();
      ctx.fillStyle = inkOn(style.accent);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, left + tw / 2, at + th / 2, tw - size);
      ctx.textAlign = align;
      ctx.textBaseline = 'top';
    }
    at += th;
  }
  return at;
}

/** One marketing image: the product (front, and the back beside it where there's room) with the words. */
export function composeSocial(format: SocialFormat, shots: { front: HTMLCanvasElement; back?: HTMLCanvasElement }, copy: SocialCopy, style: SocialStyle): HTMLCanvasElement {
  const { w, h } = format;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  backdrop(ctx, w, h, style.tone);
  const ink = inkOn(BACKDROPS[style.tone][0]);
  const pad = Math.round(Math.min(w, h) * 0.07);
  const unit = Math.min(w, h) * 0.085;
  if (copy.brand.trim()) {
    ctx.font = `700 ${Math.round(unit * 0.32)}px "Archivo", system-ui, sans-serif`;
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.7;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(copy.brand.trim().toUpperCase().slice(0, 40), pad, pad);
    ctx.globalAlpha = 1;
  }
  if (w / h >= 1.4) {
    // Wide: words on the left, centred in the height; the garment (its back behind it) on the right.
    const textW = w * 0.42;
    const textUnit = unit * (h / w < 0.45 ? 1.25 : 1);
    const copyTop = pad + unit * 0.9;
    const textH = drawCopy(ctx, copy, style, pad, copyTop, textW - pad, textUnit, 'left', true) - copyTop;
    drawCopy(ctx, copy, style, pad, Math.max(copyTop, (h - textH) / 2), textW - pad, textUnit, 'left');
    const area = { x: textW, y: pad * 0.5, w: w - textW - pad * 0.5, h: h - pad };
    if (shots.back) {
      placeProduct(ctx, shots.back, area.x + area.w * 0.32, area.y, area.w * 0.68, area.h * 0.9);
      placeProduct(ctx, shots.front, area.x, area.y + area.h * 0.1, area.w * 0.68, area.h * 0.9);
    } else placeProduct(ctx, shots.front, area.x, area.y, area.w, area.h);
    return canvas;
  }
  // Tall or square: the garment above, the words centred under it.
  const copyH = unit * (copy.tag.trim() ? 4.1 : 3.2) - (copy.subline.trim() ? 0 : unit * 0.9);
  const top = copy.brand.trim() ? pad + unit * 0.7 : pad * 0.6;
  const productH = h - copyH - top - pad;
  // Seated just above the words, so the two read as one; any room left goes above.
  placeProduct(ctx, shots.front, pad * 0.5, top, w - pad, productH, 'bottom');
  drawCopy(ctx, copy, style, pad, top + productH + unit * 0.2, w - pad * 2, unit, 'center');
  return canvas;
}

export interface BoardColorway {
  name: string;
  /** The garment in this colourway, from the front. */
  shot: HTMLCanvasElement;
  /** Its main fabric colour, for the swatch. */
  hex: string;
}

/**
 * A presentation board (a line sheet), 2400 × 1600: the title, the front and back large, each
 * colourway small with its swatch, and the details (fabric, sizes, prints) a buyer asks about.
 */
export function composeBoard(opts: { title: string; brand: string; front: HTMLCanvasElement; back?: HTMLCanvasElement; colorways: BoardColorway[]; details: [string, string][]; style: SocialStyle }): HTMLCanvasElement {
  const W = 2400;
  const H = 1600;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  backdrop(ctx, W, H, opts.style.tone);
  const ink = inkOn(BACKDROPS[opts.style.tone][0]);
  const pad = 90;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = ink;
  if (opts.brand.trim()) {
    ctx.globalAlpha = 0.7;
    ctx.font = '700 30px "Archivo", system-ui, sans-serif';
    ctx.fillText(opts.brand.trim().toUpperCase().slice(0, 50), pad, pad);
    ctx.globalAlpha = 1;
  }
  const measure = (text: string, size: number) => {
    ctx.font = `800 ${size}px "${opts.style.font}", "Archivo", system-ui, sans-serif`;
    return ctx.measureText(text).width;
  };
  const head = fitLines(measure, opts.title.toUpperCase(), 1400, 96, 48, 1);
  ctx.font = `800 ${head.size}px "${opts.style.font}", "Archivo", system-ui, sans-serif`;
  ctx.fillText(head.lines[0] ?? '', pad, pad + 50);
  // Front and back, large, each named just under it.
  const viewsTop = 300;
  const viewH = 1000;
  const viewW = 640;
  const views = [{ shot: opts.front, label: 'Front', x: pad }, ...(opts.back ? [{ shot: opts.back, label: 'Back', x: pad + viewW + 40 }] : [])];
  ctx.font = '600 26px "Archivo", system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const v of views) {
    const at = placeProduct(ctx, v.shot, v.x, viewsTop, viewW, viewH);
    ctx.globalAlpha = 0.65;
    ctx.fillText(v.label, at.x + at.w / 2, at.y + at.h + 18);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
  // Colourways and details on the right.
  const rightX = pad + viewW * 2 + 120;
  const rightW = W - rightX - pad;
  ctx.font = '700 30px "Archivo", system-ui, sans-serif';
  ctx.fillText(opts.colorways.length > 1 ? `${opts.colorways.length} colourways` : 'Colourway', rightX, viewsTop);
  const cols = Math.min(3, Math.max(1, opts.colorways.length));
  const cellW = (rightW - (cols - 1) * 24) / cols;
  const cellH = Math.min(300, cellW * 1.15);
  opts.colorways.slice(0, 6).forEach((c, i) => {
    const cx = rightX + (i % cols) * (cellW + 24);
    const cy = viewsTop + 60 + Math.floor(i / cols) * (cellH + 70);
    placeProduct(ctx, c.shot, cx, cy, cellW, cellH);
    ctx.fillStyle = c.hex;
    ctx.beginPath();
    ctx.arc(cx + 16, cy + cellH + 30, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.font = '600 24px "Archivo", system-ui, sans-serif';
    ctx.fillText(c.name.slice(0, 28), cx + 40, cy + cellH + 17, cellW - 44);
  });
  const rows = Math.ceil(Math.min(6, opts.colorways.length) / cols);
  let y = viewsTop + 60 + rows * (cellH + 70) + 40;
  ctx.font = '700 30px "Archivo", system-ui, sans-serif';
  ctx.fillText('Details', rightX, y);
  y += 56;
  for (const [label, value] of opts.details) {
    if (y > H - pad - 30) break;
    ctx.globalAlpha = 0.6;
    ctx.font = '600 24px "Archivo", system-ui, sans-serif';
    ctx.fillText(label, rightX, y);
    ctx.globalAlpha = 1;
    ctx.font = '500 24px "Archivo", system-ui, sans-serif';
    ctx.fillText(value, rightX + 220, y, rightW - 220);
    y += 42;
  }
  return canvas;
}
