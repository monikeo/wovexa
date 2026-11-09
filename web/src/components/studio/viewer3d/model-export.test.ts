import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { turnedInside } from './model-export';

/** The direction a triangle faces, from its winding. */
function faceNormal(pos: ArrayLike<number>, a: number, b: number, c: number) {
  const v = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  return new THREE.Vector3().crossVectors(v(b).sub(v(a)), v(c).sub(v(a))).normalize();
}

describe('turning a surface inside out for export', () => {
  it('reverses the winding and the normals of indexed geometry, leaving the source alone', () => {
    const g = new THREE.PlaneGeometry(1, 1);
    const turned = turnedInside(g)!;
    const pos = g.getAttribute('position').array;
    const [a, b, c] = Array.from(g.index!.array.slice(0, 3));
    const [ta, tb, tc] = Array.from(turned.index!.array.slice(0, 3));
    expect(faceNormal(pos, a, b, c).z).toBeCloseTo(1);
    expect(faceNormal(pos, ta, tb, tc).z).toBeCloseTo(-1);
    expect(turned.getAttribute('normal').getZ(0)).toBeCloseTo(-1);
    expect(g.getAttribute('normal').getZ(0)).toBeCloseTo(1);
  });

  it('swaps whole vertices of non-indexed geometry, every attribute together', () => {
    const g = new THREE.PlaneGeometry(1, 1).toNonIndexed();
    const uv = Array.from(g.getAttribute('uv').array.slice(0, 6));
    const turned = turnedInside(g)!;
    const pos = turned.getAttribute('position').array;
    expect(faceNormal(pos, 0, 1, 2).z).toBeCloseTo(-1);
    // The second and third vertices traded places, uvs with them.
    expect(Array.from(turned.getAttribute('uv').array.slice(0, 6))).toEqual([uv[0], uv[1], uv[4], uv[5], uv[2], uv[3]]);
  });

  it('refuses interleaved data it cannot turn', () => {
    const g = new THREE.BufferGeometry();
    const data = new THREE.InterleavedBuffer(new Float32Array(18), 6);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(data, 3, 0));
    expect(turnedInside(g)).toBeNull();
  });
});
