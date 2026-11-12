/**
 * Adaptive resolution for the 3D view (spec MOB-11): while it is moving (orbiting, the turntable,
 * motion, taking apart), drop the pixel ratio if frames come slowly and restore it once they come
 * quickly again. The view draws only when something changes, so only unbroken runs of frames are
 * timed: the pauses between edits (a frame each) are not slow frames. A monitor that counted frames
 * per second over those pauses read every few edits as a slideshow and blurred the view for good.
 */

/** Frames further apart than this are a pause between changes, not a slow frame. */
export const PAUSE_MS = 100;
/** Each verdict times at least this long a run, and this many frames. */
const WINDOW_MS = 500;
const WINDOW_FRAMES = 10;
/** Below this, moving frames are slow; above the other, smooth. */
const SLOW_FPS = 40;
const SMOOTH_FPS = 55;
/** Slow windows in a row before dropping the pixel ratio, and smooth ones before restoring it. */
const SLOW_WINDOWS = 2;
const SMOOTH_WINDOWS = 4;
/** After this many changes back and forth it settles where it is. */
const MAX_FLIPS = 4;

export interface Pace {
  last: number;
  time: number;
  frames: number;
  slow: number;
  smooth: number;
  low: boolean;
  flips: number;
}

export const newPace = (): Pace => ({ last: -Infinity, time: 0, frames: 0, slow: 0, smooth: 0, low: false, flips: 0 });

/** A frame drawn at `now` (ms): 'slow' when the pixel ratio should drop, 'smooth' when it can come back, else null. */
export function paceFrame(p: Pace, now: number): 'slow' | 'smooth' | null {
  const gap = now - p.last;
  p.last = now;
  if (gap > PAUSE_MS) {
    p.time = 0;
    p.frames = 0;
    return null;
  }
  p.time += gap;
  p.frames++;
  if (p.time < WINDOW_MS || p.frames < WINDOW_FRAMES) return null;
  const fps = (p.frames * 1000) / p.time;
  p.time = 0;
  p.frames = 0;
  if (p.flips >= MAX_FLIPS) return null;
  p.slow = fps < SLOW_FPS ? p.slow + 1 : 0;
  p.smooth = fps > SMOOTH_FPS ? p.smooth + 1 : 0;
  if (!p.low && p.slow >= SLOW_WINDOWS) {
    p.low = true;
    p.flips++;
    p.slow = 0;
    return 'slow';
  }
  if (p.low && p.smooth >= SMOOTH_WINDOWS) {
    p.low = false;
    p.flips++;
    p.smooth = 0;
    return 'smooth';
  }
  return null;
}
