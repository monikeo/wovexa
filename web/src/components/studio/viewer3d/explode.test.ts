import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GARMENT_LIST, getSize, HOODIE, TEE_CLASSIC } from '@/domain/garments';
import { buildGarment, type GarmentGeometry } from './garment-geometry';
import { canTakeApart, easeApart, ensureApart } from './explode';

const offsetOf = (g: THREE.BufferGeometry, i = 0) => new THREE.Vector3().fromBufferAttribute(g.getAttribute('aExplode') as THREE.BufferAttribute, i);

describe('taking a garment apart', () => {
  it('moves each built-in piece its own way: front forward, back back, sleeves out, the neck rib up', () => {
    const geo = buildGarment(TEE_CLASSIC, getSize(TEE_CLASSIC, 'M'), 'low');
    const torso = geo.parts.find((p) => p.id === 'torso')!.geometry;
    const pos = torso.getAttribute('position');
    let front = 0;
    let back = 0;
    for (let i = 0; i < pos.count; i += 7) {
      const z = offsetOf(torso, i).z;
      if (pos.getZ(i) > 20) {
        expect(z).toBeGreaterThan(0);
        front++;
      }
      if (pos.getZ(i) < -20) {
        expect(z).toBeLessThan(0);
        back++;
      }
    }
    expect(front).toBeGreaterThan(50);
    expect(back).toBeGreaterThan(50);
    // The wearer's left sleeve is at +x and moves further out that way; the right one the other way.
    expect(offsetOf(geo.parts.find((p) => p.id === 'sleeveLeft')!.geometry).x).toBeGreaterThan(50);
    expect(offsetOf(geo.parts.find((p) => p.id === 'sleeveRight')!.geometry).x).toBeLessThan(-50);
    const collar = offsetOf(geo.trims.find((t) => t.key === 'collar')!.geometry);
    expect(collar.y).toBeGreaterThan(50);
    expect(Math.abs(collar.x) + Math.abs(collar.z)).toBe(0);
    expect(canTakeApart(geo)).toBe(true);
  });

  it('gives every piece of every style a way out, a hood up and a pocket in front of the body', () => {
    for (const model of GARMENT_LIST) {
      const geo = buildGarment(model, getSize(model, model.defaultSize), 'low');
      for (const g of [...geo.parts.map((p) => p.geometry), ...geo.trims.map((t) => t.geometry)]) {
        const a = g.getAttribute('aExplode');
        expect(a, model.shortName).toBeDefined();
        expect(a.count).toBe(g.getAttribute('position').count);
      }
    }
    const hoodie = buildGarment(HOODIE, getSize(HOODIE, HOODIE.defaultSize), 'low');
    expect(offsetOf(hoodie.trims.find((t) => t.key === 'hood')!.geometry).y).toBeGreaterThan(50);
    const torsoFront = Math.max(...Array.from({ length: 50 }, (_, i) => offsetOf(hoodie.parts[0].geometry, i).z));
    expect(offsetOf(hoodie.trims.find((t) => t.key === 'pocket')!.geometry).z).toBeGreaterThan(torsoFront);
  });

  it('separates the pieces of a shape that brings no way out of its own, keeping the body still', () => {
    const torso = new THREE.BoxGeometry(500, 700, 220);
    torso.translate(0, 350, 0);
    const left = new THREE.BoxGeometry(200, 120, 120);
    left.translate(330, 600, 0);
    const right = new THREE.BoxGeometry(200, 120, 120);
    right.translate(-330, 600, 0);
    const hood = new THREE.SphereGeometry(110, 12, 8);
    hood.translate(0, 860, -20);
    // A piece that already has its own way out keeps it.
    const own = new THREE.BoxGeometry(10, 10, 10);
    own.setAttribute('aExplode', new THREE.BufferAttribute(new Float32Array(own.getAttribute('position').count * 3).fill(7), 3));
    const geo = {
      parts: [
        { id: 'torso', geometry: torso },
        { id: 'sleeveLeft', geometry: left },
        { id: 'sleeveRight', geometry: right },
      ],
      trims: [
        { key: 'shell-body', geometry: hood, color: 'body', surface: 'jersey' },
        { key: 'own', geometry: own, color: 'body', surface: 'jersey' },
      ],
    } as unknown as GarmentGeometry;
    ensureApart(geo);
    expect(offsetOf(torso).length()).toBe(0);
    expect(offsetOf(left).x).toBeGreaterThan(50);
    expect(offsetOf(right).x).toBeLessThan(-50);
    expect(offsetOf(hood).y).toBeGreaterThan(50);
    expect(offsetOf(own).x).toBe(7);
    expect(canTakeApart(geo)).toBe(true);
    // A single piece that stays put has nothing to take apart.
    const lone = new THREE.BoxGeometry(500, 700, 220);
    const one = { parts: [{ id: 'torso', geometry: lone }], trims: [] } as unknown as GarmentGeometry;
    ensureApart(one);
    expect(canTakeApart(one)).toBe(false);
  });

  it('eases in and out, and holds at either end', () => {
    expect(easeApart(0)).toBe(0);
    expect(easeApart(1)).toBe(1);
    expect(easeApart(0.5)).toBeCloseTo(0.5);
    expect(easeApart(0.1)).toBeLessThan(0.1);
    expect(easeApart(0.9)).toBeGreaterThan(0.9);
    expect(easeApart(-1)).toBe(0);
    expect(easeApart(3)).toBe(1);
  });
});
