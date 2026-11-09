import { describe, expect, it } from 'vitest';
import { closeUp, distanceToFit, easeInOut, pathPose, type CameraKey } from './camera-path';

const key = (x: number, fov = 28): CameraKey => ({ position: [x, 0, 2], target: [0, 0, 0], fovDeg: fov });

describe('camera moves for video', () => {
  it('starts and ends exactly on the first and last positions, easing in and out', () => {
    const keys = [key(0), key(1)];
    expect(pathPose(keys, 0).position).toEqual([0, 0, 2]);
    expect(pathPose(keys, 1).position).toEqual([1, 0, 2]);
    expect(pathPose(keys, 0.5).position[0]).toBeCloseTo(0.5);
    // Slow at the ends: a tenth of the time covers far less than a tenth of the way.
    expect(pathPose(keys, 0.1).position[0]).toBeLessThan(0.02);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
  });

  it('passes through every saved view on the way', () => {
    const keys = [key(0, 20), key(4, 30), key(2, 40)];
    // Halfway through the eased move is exactly the middle key.
    const mid = pathPose(keys, 0.5);
    expect(mid.position[0]).toBeCloseTo(4);
    expect(mid.fovDeg).toBeCloseTo(30);
  });

  it('frames a print from outside the cloth, a little above it', () => {
    const shot = closeUp([0, 0.1, 0.12], [0, 0, 2], 0.6, 28);
    expect(shot.target).toEqual([0, 0.1, 0.12]);
    expect(shot.position[2]).toBeCloseTo(0.72);
    expect(shot.position[1]).toBeGreaterThan(0.1);
    // A 30 cm print at 28° needs the camera about 0.8 m away, margin included.
    expect(distanceToFit(0.3, 28)).toBeCloseTo(0.81, 1);
  });
});
