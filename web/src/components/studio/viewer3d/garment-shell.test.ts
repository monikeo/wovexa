import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DOBOK, getSize, TEE_CLASSIC, TEE_LONG, type GarmentModel } from '@/domain/garments';
import { buildGarment, type GarmentGeometry } from './garment-geometry';
import { creditOf, fitShell, HINT_CODE, hintOfName, poseSleeves, transferShell, weld, type ParsedShell, type ShellHint } from './garment-shell';

const pressed = (model: GarmentModel = TEE_CLASSIC) => buildGarment(model, getSize(model, model.defaultSize), 'low', 0);

/**
 * A pattern's own parts merged into one surface, moved by `m`: a stand-in for an artist's GLB.
 * With `named`, each piece carries the hint its mesh name would give (torso, sleeve, leg, belt).
 */
function asShell(geo: GarmentGeometry, m: THREE.Matrix4, extra?: THREE.BufferGeometry, named = false): ParsedShell {
  const hintOf: Record<string, ShellHint> = { torso: 'torso', sleeveLeft: 'sleeve', sleeveRight: 'sleeve', legLeft: 'leg', legRight: 'leg' };
  const pieces: { g: THREE.BufferGeometry; hint: number }[] = [
    ...geo.parts.map((p) => ({ g: p.geometry, hint: named ? HINT_CODE[hintOf[p.id]] : 0 })),
    ...(named ? geo.trims.filter((t) => t.color === 'belt').map((t) => ({ g: t.geometry, hint: HINT_CODE.belt })) : []),
    ...(extra ? [{ g: extra, hint: 0 }] : []),
  ];
  const position: number[] = [];
  const index: number[] = [];
  const hints: number[] = [];
  const v = new THREE.Vector3();
  for (const { g, hint } of pieces) {
    const offset = position.length / 3;
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      position.push(v.x, v.y, v.z);
    }
    const idx = g.getIndex()!;
    for (let k = 0; k < idx.count; k++) index.push(offset + idx.getX(k));
    for (let k = 0; k < idx.count / 3; k++) hints.push(hint);
  }
  return { position: Float32Array.from(position), index: Uint32Array.from(index), triangleHint: Uint8Array.from(hints), meshes: pieces.length, triangles: index.length / 3, credit: null };
}

const bounds = (a: ArrayLike<number>) => new THREE.Box3().setFromArray(a);

describe('garment shells: any GLB over the pattern', () => {
  it('welds split vertices and drops an inside copy of the same cloth', () => {
    // A quad as two triangles with six separate vertices, then the same quad wound the other way.
    const quad = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
    const inside = [0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0];
    const position = Float32Array.from([...quad, ...inside]);
    const index = Uint32Array.from({ length: 12 }, (_, i) => i);
    const out = weld(position, index, 1e-6);
    expect(out.position.length / 3).toBe(4);
    expect(out.index.length / 3).toBe(2);
  });

  it('reads what a mesh is from its name, and nothing from a generic one', () => {
    expect(hintOfName('Sleeve_Left')).toBe('sleeve');
    expect(hintOfName('Dobok_Trousers')).toBe('leg');
    expect(hintOfName('V_Collar_Ribbing')).toBe('collar');
    expect(hintOfName('Black_Belt')).toBe('belt');
    expect(hintOfName('Jacket_Back_Torso')).toBe('torso');
    expect(hintOfName('Jacket_Front_Left')).toBe('torso');
    expect(hintOfName('Object_2')).toBeNull();
    expect(hintOfName('Hood_Lining')).toBeNull();
  });

  it('fits a uniform by its named jacket, keeps the pants on the legs and the belt in its own colour', async () => {
    const base = pressed(DOBOK);
    const fitted = fitShell(asShell(base, new THREE.Matrix4().makeScale(0.001, 0.001, 0.001), undefined, true), base);
    expect(fitted.scale).toBeGreaterThan(970);
    expect(fitted.scale).toBeLessThan(1030);
    const geo = await transferShell(fitted, base, poseSleeves(base, fitted));
    expect(geo.parts.map((p) => p.id).sort()).toEqual(['legLeft', 'legRight', 'sleeveLeft', 'sleeveRight', 'torso']);
    expect(geo.trims.some((t) => t.color === 'belt')).toBe(true);
    // Unnamed, the same uniform is found by its proportions and still fits.
    expect(fitShell(asShell(base, new THREE.Matrix4()), base).scale).toBeGreaterThan(0.9);
  });

  it('reads a model’s credit from its asset record', () => {
    expect(creditOf({ version: '2.0', extras: { title: 'HOODIE', author: 'Obridje (https://sketchfab.com/Obridje)', license: 'CC-BY-4.0', source: 'https://sketchfab.com/3d-models/hoodie' } })).toEqual({
      title: 'HOODIE',
      author: 'Obridje (https://sketchfab.com/Obridje)',
      license: 'CC-BY-4.0',
      source: 'https://sketchfab.com/3d-models/hoodie',
    });
    expect(creditOf({ version: '2.0', copyright: 'Studio North' })).toEqual({ author: 'Studio North' });
    expect(creditOf({ version: '2.0' })).toBeNull();
  });

  it('turns a file that shows its back to face front and fits it to the chest, from metres', () => {
    const base = pressed();
    // In metres, turned to show its back, and off to one side.
    const m = new THREE.Matrix4().makeTranslation(0.3, 1.2, -0.4).multiply(new THREE.Matrix4().makeRotationY(Math.PI)).multiply(new THREE.Matrix4().makeScale(0.001, 0.001, 0.001));
    const fitted = fitShell(asShell(base, m), base);
    expect(fitted.turned).toBe(true);
    expect(fitted.scale).toBeGreaterThan(970);
    expect(fitted.scale).toBeLessThan(1030);
    // It lands on the pattern: same extent, within a few millimetres.
    const original = asShell(base, new THREE.Matrix4());
    const a = bounds(fitted.position);
    const b = bounds(original.position);
    for (const k of ['x', 'y', 'z'] as const) {
      expect(Math.abs(a.min[k] - b.min[k])).toBeLessThan(6);
      expect(Math.abs(a.max[k] - b.max[k])).toBeLessThan(6);
    }
    // The person can turn it the other way.
    expect(fitShell(asShell(base, m), base, true).turned).toBe(false);
  });

  it('stands up a file lying on its back (z up)', () => {
    const base = pressed();
    const lying = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const fitted = fitShell(asShell(base, lying), base);
    const a = bounds(fitted.position);
    const b = bounds(asShell(base, new THREE.Matrix4()).position);
    expect(Math.abs(a.max.y - a.min.y - (b.max.y - b.min.y))).toBeLessThan(6);
    expect(fitted.turned).toBe(false);
  });

  it('gives every point the pattern’s print coordinates, with motion and limb pivots', async () => {
    const base = pressed();
    const geo = await transferShell(fitShell(asShell(base, new THREE.Matrix4()), base), base);
    expect(geo.parts.map((p) => p.id).sort()).toEqual(['sleeveLeft', 'sleeveRight', 'torso']);
    expect(geo.trims).toHaveLength(0);
    const torso = geo.parts.find((p) => p.id === 'torso')!.geometry;
    const pos = torso.getAttribute('position');
    const uv = torso.getAttribute('uv');
    // Front and back centre at chest height carry the layout's front and back centre lines.
    const chest = base.layout.torsoHeightMm * 0.45;
    const find = (front: boolean) => {
      let best = -1;
      let score = Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (front ? pos.getZ(i) < 0 : pos.getZ(i) > 0) continue;
        const s = Math.abs(pos.getX(i)) + Math.abs(pos.getY(i) - chest);
        if (s < score) {
          score = s;
          best = i;
        }
      }
      return best;
    };
    expect(uv.getX(find(true)) % 1).toBeCloseTo(base.layout.frontCenterU, 1);
    expect(uv.getX(find(false)) % 1).toBeCloseTo(base.layout.backCenterU, 1);
    expect(torso.getAttribute('aFree')).toBeTruthy();
    expect(torso.getAttribute('color')).toBeTruthy();
    expect(geo.parts.find((p) => p.id === 'sleeveLeft')!.geometry.getAttribute('aLimb')).toBeTruthy();
    expect(geo.limbPivots[1]).toBeTruthy();
    expect(geo.limbPivots[2]).toBeTruthy();
    // Production stays on the pattern.
    expect(geo.islands).toBe(base.islands);
    expect(geo.layout.torsoCircumferenceMm).toBe(base.layout.torsoCircumferenceMm);
  });

  it('shows cloth beyond the pattern, like a hood, as plain fabric in the body colour', async () => {
    const base = pressed();
    const hood = new THREE.SphereGeometry(110, 24, 16);
    hood.translate(0, base.layout.torsoHeightMm + 170, -30);
    const geo = await transferShell(fitShell(asShell(base, new THREE.Matrix4(), hood), base), base);
    const plain = geo.trims.find((t) => t.color === 'body');
    expect(plain).toBeTruthy();
    expect(plain!.geometry.getIndex()!.count / 3).toBeGreaterThan(hood.getIndex()!.count / 3 - 20);
  });

  it.each([
    [TEE_CLASSIC, -20],
    [TEE_CLASSIC, 25],
    [TEE_LONG, 20],
  ] as const)('turns the pattern’s sleeves to hang like the shell’s before matching (%s, %i°)', (model, degrees) => {
    const base = pressed(model);
    // The same garment with both sleeves turned at the shoulder (negative: lowered).
    const turned = pressed(model);
    for (const [id, limb, side] of [['sleeveLeft', 1, 1], ['sleeveRight', 2, -1]] as const) {
      const pivot = turned.limbPivots[limb]!;
      const g = turned.parts.find((p) => p.id === id)!.geometry;
      g.translate(-pivot[0], -pivot[1], -pivot[2]);
      g.rotateZ((degrees * Math.PI * side) / 180);
      g.translate(pivot[0], pivot[1], pivot[2]);
    }
    const fitted = fitShell(asShell(turned, new THREE.Matrix4()), base);
    const posed = poseSleeves(base, fitted);
    const centre = (a: ArrayLike<number>) => bounds(a).getCenter(new THREE.Vector3());
    for (const id of ['sleeveLeft', 'sleeveRight'] as const) {
      const target = centre(turned.parts.find((p) => p.id === id)!.geometry.getAttribute('position').array);
      const before = centre(base.parts.find((p) => p.id === id)!.geometry.getAttribute('position').array).distanceTo(target);
      expect(posed.get(id)).toBeTruthy();
      const after = centre(posed.get(id)!).distanceTo(target);
      // A short sleeve lowered toward the body hides part of its cuff inside the body's width, so
      // it is turned most of the way rather than all of it.
      expect(after).toBeLessThan(before * (degrees < 0 ? 0.65 : 0.35));
    }
  });
});
