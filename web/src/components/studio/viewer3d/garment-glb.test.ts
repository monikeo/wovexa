import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DOBOK, getSize, TANK, TEE_CLASSIC } from '@/domain/garments';
import { buildGarment } from './garment-geometry';
import { exportGarmentTemplate, parseGarmentShape, partOfName, ShapeError, shapedGarment, unitScaleToMm } from './garment-glb';

// The GLB writer reads its output through FileReader, which Node lacks: a minimal stand-in.
beforeAll(() => {
  if (typeof globalThis.FileReader === 'undefined') {
    class NodeFileReader {
      result: ArrayBuffer | null = null;
      onloadend: (() => void) | null = null;
      onload: (() => void) | null = null;
      readAsArrayBuffer(blob: Blob) {
        void blob.arrayBuffer().then((buffer) => {
          this.result = buffer;
          this.onload?.();
          this.onloadend?.();
        });
      }
    }
    (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
  }
});

async function template(model = TEE_CLASSIC, code = model.defaultSize) {
  const size = getSize(model, code);
  const geo = buildGarment(model, size, 'low', 1);
  const blob = await exportGarmentTemplate(geo, model, size, new Map());
  return { geo, data: await blob.arrayBuffer() };
}

describe('garment GLB templates', () => {
  it('recognises part names from templates, Blender copies and older exports', () => {
    expect(partOfName('torso')).toBe('torso');
    expect(partOfName('sleeveLeft.001')).toBe('sleeveLeft');
    expect(partOfName('legRight_draped')).toBe('legRight');
    expect(partOfName('Left sleeve')).toBe('sleeveLeft');
    expect(partOfName('trim_collar')).toBeNull();
  });

  it('reads metres, centimetres and millimetres', () => {
    expect(unitScaleToMm(0.73)).toBe(1000);
    expect(unitScaleToMm(73)).toBe(10);
    expect(unitScaleToMm(730)).toBe(1);
  });

  it('round-trips a style: same parts, same print layout UVs, same size in millimetres', async () => {
    const { geo, data } = await template();
    const shape = await parseGarmentShape(data, TEE_CLASSIC);
    expect(shape.info.modelId).toBe('tee-classic');
    expect([...shape.parts.keys()].sort()).toEqual(['sleeveLeft', 'sleeveRight', 'torso']);
    expect(shape.trims.length).toBe(geo.trims.length);
    const before = geo.parts.find((p) => p.id === 'torso')!.geometry;
    const after = shape.parts.get('torso')!;
    before.computeBoundingBox();
    after.computeBoundingBox();
    expect(after.boundingBox!.max.y).toBeCloseTo(before.boundingBox!.max.y, 0);
    expect(after.boundingBox!.min.x).toBeCloseTo(before.boundingBox!.min.x, 0);
    // UVs carry the print layout through unchanged.
    const uvBefore = before.getAttribute('uv');
    const uvAfter = after.getAttribute('uv');
    expect(uvAfter.count).toBe(uvBefore.count);
    for (const i of [0, 17, Math.floor(uvBefore.count / 2), uvBefore.count - 1]) {
      expect(uvAfter.getX(i)).toBeCloseTo(uvBefore.getX(i), 4);
      expect(uvAfter.getY(i)).toBeCloseTo(uvBefore.getY(i), 4);
    }
  });

  it('refuses a shape that lacks parts this style needs, saying what is missing', async () => {
    const { data } = await template(TANK);
    await expect(parseGarmentShape(data, TEE_CLASSIC)).rejects.toThrow(ShapeError);
    await expect(parseGarmentShape(data, TEE_CLASSIC)).rejects.toThrow(/sleeveLeft, sleeveRight/);
    const dobok = await template(DOBOK);
    await expect(parseGarmentShape(dobok.data, TEE_CLASSIC)).rejects.toThrow(/taekwondo-dobok template/);
  });

  it('stands a shape in for the built-in parts, with motion, limb pivots and size grading', async () => {
    const { geo, data } = await template();
    const shape = await parseGarmentShape(data, TEE_CLASSIC);
    const shaped = shapedGarment(geo, shape, { width: 1.1, length: 1.05 });
    const torso = shaped.parts.find((p) => p.id === 'torso')!.geometry;
    expect(torso.getAttribute('aFree')).toBeTruthy();
    expect(torso.getAttribute('color')).toBeTruthy();
    expect(shaped.parts.find((p) => p.id === 'sleeveLeft')!.geometry.getAttribute('aLimb')).toBeTruthy();
    expect(shaped.limbPivots[1]).toBeTruthy();
    expect(shaped.limbPivots[2]).toBeTruthy();
    // A larger size than the template was made at scales the shape with it.
    const box = new THREE.Box3().setFromBufferAttribute(torso.getAttribute('position') as THREE.BufferAttribute);
    const original = new THREE.Box3().setFromBufferAttribute(shape.parts.get('torso')!.getAttribute('position') as THREE.BufferAttribute);
    expect((box.max.x - box.min.x) / (original.max.x - original.min.x)).toBeCloseTo(1.1, 2);
    expect(shaped.layout.torsoCircumferenceMm).toBe(geo.layout.torsoCircumferenceMm);
  });
});
