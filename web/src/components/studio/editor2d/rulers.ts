/**
 * Rulers for the 2D editor (spec ED2-01): ticks in millimetres or inches measured from the
 * top-left of the print area, with the selection extent and pointer position marked.
 */
export const RULER_SIZE = 20;

const MM_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500];
const IN_STEPS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 5, 10];

export interface RulerState {
  /** CSS px per mm. */
  zoom: number;
  /** CSS px offset of the print area origin along this axis. */
  offset: number;
  units: 'mm' | 'in';
  /** Selection extent in mm along this axis. */
  selection: [number, number] | null;
  pointer: number | null;
  /** Guides across this axis, in mm: marked on the ruler, where they can be dragged or double-clicked away. */
  guides?: number[];
  colors: { bg: string; fg: string; line: string; accent: string };
}

/** Guide colour: a cyan that reads on light and dark fabric alike. */
export const GUIDE_COLOR = '#00A3FF';
/** How near (CSS px) a press on the ruler must be to a guide's mark to pick it up. */
export const GUIDE_GRAB_PX = 6;

function label(value: number, units: 'mm' | 'in') {
  if (units === 'mm') return String(Math.round(value));
  const v = Math.round(value * 100) / 100;
  return String(v).replace(/^0\./, '.').replace(/^-0\./, '-.');
}

export function drawRuler(canvas: HTMLCanvasElement, axis: 'x' | 'y', s: RulerState) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const length = (axis === 'x' ? canvas.width : canvas.height) / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (axis === 'y') {
    // Draw the vertical ruler in the same orientation as the horizontal one.
    ctx.translate(RULER_SIZE, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.clearRect(0, 0, length, RULER_SIZE);
  ctx.fillStyle = s.colors.bg;
  ctx.fillRect(0, 0, length, RULER_SIZE);

  const unitMm = s.units === 'in' ? 25.4 : 1;
  const pxPerUnit = s.zoom * unitMm;
  const steps = s.units === 'in' ? IN_STEPS : MM_STEPS;
  const major = steps.find((step) => step * pxPerUnit >= 56) ?? steps[steps.length - 1];
  const minor = major / (s.units === 'in' ? 4 : major === 2 || major === 20 || major === 200 ? 4 : 5);
  const toPx = (units: number) => s.offset + units * pxPerUnit;

  if (s.selection) {
    const a = toPx(s.selection[0] / unitMm);
    const b = toPx(s.selection[1] / unitMm);
    ctx.fillStyle = s.colors.accent;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(Math.min(a, b), 0, Math.abs(b - a), RULER_SIZE);
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = s.colors.fg;
  ctx.fillStyle = s.colors.fg;
  ctx.lineWidth = 1;
  ctx.font = '9px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  const first = Math.floor(((0 - s.offset) / pxPerUnit) / minor) * minor;
  const last = (length - s.offset) / pxPerUnit;
  ctx.beginPath();
  for (let i = 0, t = first; t <= last && i < 2000; i++, t = first + i * minor) {
    const x = Math.round(toPx(t)) + 0.5;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    const h = isMajor ? 9 : minor * pxPerUnit >= 6 ? 4 : 0;
    if (!h) continue;
    ctx.moveTo(x, RULER_SIZE);
    ctx.lineTo(x, RULER_SIZE - h);
    if (isMajor) ctx.fillText(label(t, s.units), x + 3, 2);
  }
  ctx.stroke();

  // Guide marks: small triangles pointing into the artboard.
  ctx.fillStyle = GUIDE_COLOR;
  for (const g of s.guides ?? []) {
    const x = toPx(g / unitMm);
    ctx.beginPath();
    ctx.moveTo(x - 5, RULER_SIZE - 7);
    ctx.lineTo(x + 5, RULER_SIZE - 7);
    ctx.lineTo(x, RULER_SIZE);
    ctx.closePath();
    ctx.fill();
  }

  if (s.pointer !== null) {
    const x = Math.round(toPx(s.pointer / unitMm)) + 0.5;
    ctx.strokeStyle = s.colors.accent;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, RULER_SIZE);
    ctx.stroke();
  }

  ctx.strokeStyle = s.colors.line;
  ctx.beginPath();
  ctx.moveTo(0, RULER_SIZE - 0.5);
  ctx.lineTo(length, RULER_SIZE - 0.5);
  ctx.stroke();
}
