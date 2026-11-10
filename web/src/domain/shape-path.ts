/**
 * Shapes as SVG path data, exactly as the renderer draws them: used by vector print files, by
 * editing a shape's points, and by combining shapes. Pure, in millimetres.
 */
import type { ShapeContent } from './schema';

const n = (x: number) => String(Math.round(x * 1000) / 1000);

/** Parameters each path command takes. */
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/**
 * Path data scaled and moved (x·sx + tx, y·sy + ty), every command kept: so an outline drawn on
 * it keeps one width, which a scaled `transform` would stretch.
 */
export function transformPathData(d: string, sx: number, sy: number, tx: number, ty: number): string {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let cmd = '';
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/[A-Za-z]/.test(tok)) {
      cmd = tok;
      i++;
      if (cmd.toLowerCase() === 'z') {
        out.push(cmd);
        continue;
      }
    } else if (!cmd) {
      i++;
      continue;
    }
    const lower = cmd.toLowerCase();
    const arity = ARITY[lower];
    const args = tokens.slice(i, i + arity).map(Number);
    if (args.length < arity || args.some((x) => !Number.isFinite(x))) break;
    i += arity;
    const rel = cmd === lower;
    const X = (x: number) => (rel ? x * sx : x * sx + tx);
    const Y = (y: number) => (rel ? y * sy : y * sy + ty);
    let p: number[];
    if (lower === 'h') p = [X(args[0])];
    else if (lower === 'v') p = [Y(args[0])];
    else if (lower === 'a') p = [Math.abs(args[0] * sx), Math.abs(args[1] * sy), args[2], args[3], sx * sy < 0 ? 1 - args[4] : args[4], X(args[5]), Y(args[6])];
    else p = args.map((v, k) => (k % 2 ? Y(v) : X(v)));
    out.push(cmd + p.map(n).join(' '));
    // After a move, further pairs are lines.
    if (lower === 'm') cmd = rel ? 'l' : 'L';
  }
  return out.join(' ');
}

/** A shape's outline as path data, centred on the origin in a w × h box (mm), as the renderer draws it. */
export function shapePathData(c: ShapeContent, w: number, h: number): string {
  const hw = w / 2;
  const hh = h / 2;
  switch (c.shape) {
    case 'rect':
    case 'line': {
      const r = Math.min(c.cornerRadiusMm, hw, hh);
      if (r <= 0) return `M${n(-hw)} ${n(-hh)}H${n(hw)}V${n(hh)}H${n(-hw)}Z`;
      return `M${n(-hw + r)} ${n(-hh)}H${n(hw - r)}A${n(r)} ${n(r)} 0 0 1 ${n(hw)} ${n(-hh + r)}V${n(hh - r)}A${n(r)} ${n(r)} 0 0 1 ${n(hw - r)} ${n(hh)}H${n(-hw + r)}A${n(r)} ${n(r)} 0 0 1 ${n(-hw)} ${n(hh - r)}V${n(-hh + r)}A${n(r)} ${n(r)} 0 0 1 ${n(-hw + r)} ${n(-hh)}Z`;
    }
    case 'ellipse':
      return `M${n(-hw)} 0A${n(hw)} ${n(hh)} 0 1 0 ${n(hw)} 0A${n(hw)} ${n(hh)} 0 1 0 ${n(-hw)} 0Z`;
    case 'triangle':
      return `M0 ${n(-hh)}L${n(hw)} ${n(hh)}L${n(-hw)} ${n(hh)}Z`;
    case 'star': {
      const pts = c.points ?? 5;
      const inner = c.innerRatio ?? 0.45;
      const p: string[] = [];
      for (let i = 0; i < pts * 2; i++) {
        const r = i % 2 ? inner : 1;
        const a = -Math.PI / 2 + (i * Math.PI) / pts;
        p.push(`${i ? 'L' : 'M'}${n(Math.cos(a) * r * hw)} ${n(Math.sin(a) * r * hh)}`);
      }
      return `${p.join('')}Z`;
    }
    case 'polygon': {
      const pts = c.points ?? 6;
      const p: string[] = [];
      for (let i = 0; i < pts; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / pts;
        p.push(`${i ? 'L' : 'M'}${n(Math.cos(a) * hw)} ${n(Math.sin(a) * hh)}`);
      }
      return `${p.join('')}Z`;
    }
    case 'heart': {
      const X = (u: number) => n((u - 0.5) * w);
      const Y = (v: number) => n((v - 0.5) * h);
      return [
        `M${X(0.5)} ${Y(0.28)}`,
        `C${X(0.5)} ${Y(0.2)} ${X(0.42)} ${Y(0)} ${X(0.25)} ${Y(0)}`,
        `C${X(0.05)} ${Y(0)} ${X(0)} ${Y(0.18)} ${X(0)} ${Y(0.32)}`,
        `C${X(0)} ${Y(0.55)} ${X(0.22)} ${Y(0.74)} ${X(0.5)} ${Y(1)}`,
        `C${X(0.78)} ${Y(0.74)} ${X(1)} ${Y(0.55)} ${X(1)} ${Y(0.32)}`,
        `C${X(1)} ${Y(0.18)} ${X(0.95)} ${Y(0)} ${X(0.75)} ${Y(0)}`,
        `C${X(0.58)} ${Y(0)} ${X(0.5)} ${Y(0.2)} ${X(0.5)} ${Y(0.28)}Z`,
      ].join('');
    }
    case 'path':
      // Library graphics are drawn in a 0–100 box.
      return c.path ? transformPathData(c.path, w / 100, h / 100, -w / 2, -h / 2) : '';
  }
  return '';
}

/** Any shape as a path in a 0–100 box over its own w × h (mm) box: what editing its points starts from. */
export function shapeToBoxPath(c: ShapeContent, w: number, h: number): string {
  if (c.shape === 'path') return c.path ?? '';
  return transformPathData(shapePathData(c, w, h), 100 / w, 100 / h, 50, 50);
}
