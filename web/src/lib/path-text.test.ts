import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PathSpace, Subpath } from '@/domain/path-edit';
import type { LayerTransform, TextContent } from '@/domain/schema';

/** Text is measured on a canvas: in tests every letter is 30 px wide at the reference size. */
class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return { font: '', letterSpacing: '0px', save() {}, restore() {}, measureText: (s: string) => ({ width: Array.from(s).length * 30 }) };
  }
}

let lib: typeof import('./path-text');
let edit: typeof import('@/domain/path-edit');

beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  lib = await import('./path-text');
  edit = await import('@/domain/path-edit');
});

const text = (value: string): TextContent => ({ kind: 'text', value, fontFamily: 'Archivo', fontWeight: 700, italic: false, fill: '#111111', align: 'center', letterSpacingEm: 0, lineHeight: 1.1, curveDeg: 0 });

/** A text layer on an arch drawn on the artboard, placed the way the studio places it, then turned and mirrored. */
function archLayer(turn: Partial<LayerTransform> = {}) {
  const drawn: Subpath = { closed: false, nodes: [{ x: 50, y: 150, outX: 90, outY: 60 }, { x: 250, y: 150, inX: 210, inY: 60 }] };
  const { onPath, box } = lib.textPathFrom(drawn);
  onPath.start = 0.1;
  onPath.span = 0.8;
  const content = { ...text('WOVEXA TEAM'), onPath };
  const transform: LayerTransform = { ...lib.placeOnPath(content, box), ...turn };
  return { content, transform };
}

/** Where path units land on the artboard, through a layer's space and transform. */
function onArtboard(space: PathSpace, t: LayerTransform, u: number, v: number): [number, number] {
  const [x, y] = space.toLocal(u, v);
  const a = (t.rotationDeg * Math.PI) / 180;
  const fx = t.flipX ? -x : x;
  const fy = t.flipY ? -y : y;
  return [t.centerXmm + fx * Math.cos(a) - fy * Math.sin(a), t.centerYmm + fx * Math.sin(a) + fy * Math.cos(a)];
}

describe('editing the line text follows', () => {
  it('maps path units into the layer and back', () => {
    const { content, transform } = archLayer();
    const space = lib.textPathSpace(content, transform)!;
    for (const [u, v] of [
      [0, 100],
      [50, 0],
      [100, 100],
      [-20, 140],
    ]) {
      const [x, y] = space.toLocal(u, v);
      const [u2, v2] = space.fromLocal(x, y);
      expect(u2).toBeCloseTo(u, 9);
      expect(v2).toBeCloseTo(v, 9);
    }
  });

  it('is not offered for straight text', () => {
    expect(lib.textPathSpace(text('Straight'), { widthMm: 100, heightMm: 20 })).toBeNull();
  });

  for (const [label, turn] of [
    ['level', {}],
    ['turned and mirrored', { rotationDeg: 30, flipX: true }],
  ] as const) {
    it(`lands the edited line exactly where it was dragged (${label})`, () => {
      const { content, transform } = archLayer(turn);
      const space = lib.textPathSpace(content, transform)!;
      const sub = edit.parsePath(content.onPath!.d)[0];
      // Drag the end point up and out, in the path's own units, as the editor does.
      const edited = edit.moveNode([sub], 0, 1, 25, -40)[0];
      const want = edited.nodes.map((n) => onArtboard(space, transform, n.x, n.y));
      const next = lib.editedTextPath(content, transform, edited)!;
      expect(next).not.toBeNull();
      const content2 = { ...content, onPath: next.onPath };
      const t2 = { ...transform, ...next.transform };
      const space2 = lib.textPathSpace(content2, t2)!;
      const got = edit.parsePath(next.onPath.d)[0].nodes.map((n) => onArtboard(space2, t2, n.x, n.y));
      got.forEach(([x, y], i) => {
        expect(x).toBeCloseTo(want[i][0], 1);
        expect(y).toBeCloseTo(want[i][1], 1);
      });
      expect(t2.rotationDeg).toBe(transform.rotationDeg);
      expect(t2.flipX).toBe(transform.flipX);
    });
  }

  it('keeps the letters the same size, centred where they were along the line', () => {
    const { content, transform } = archLayer();
    const space = lib.textPathSpace(content, transform)!;
    const sub = edit.parsePath(content.onPath!.d)[0];
    const edited = edit.moveNode([sub], 0, 1, 30, 0)[0];
    const lengthMm = (s: Subpath, sp: PathSpace) => edit.pathLength(edit.mapSubpaths([s], sp.toLocal)[0]);
    const next = lib.editedTextPath(content, transform, edited)!;
    // The words cover the same millimetres of a longer line.
    expect(next.onPath.span * lengthMm(edited, space)).toBeCloseTo(content.onPath!.span * lengthMm(sub, space), 1);
    expect(next.onPath.start + next.onPath.span / 2).toBeCloseTo(content.onPath!.start + content.onPath!.span / 2, 9);
    expect(next.transform.heightMm / next.transform.widthMm).toBeGreaterThan(0);
  });

  it('shrinks the words when the line gets too short for them, and refuses a line too short to carry any', () => {
    const { content, transform } = archLayer();
    const sub = edit.parsePath(content.onPath!.d)[0];
    const shorter = edit.moveNode([sub], 0, 1, -90, 0)[0];
    expect(lib.editedTextPath(content, transform, shorter)!.onPath.span).toBe(1);
    const collapsed: Subpath = { closed: false, nodes: [{ x: 10, y: 10 }, { x: 10.01, y: 10 }] };
    expect(lib.editedTextPath(content, transform, collapsed)).toBeNull();
    expect(lib.editedTextPath(content, transform, { closed: false, nodes: [{ x: 1, y: 1 }] })).toBeNull();
  });
});
