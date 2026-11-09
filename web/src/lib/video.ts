/**
 * Turntable video encoding in the browser (spec MED-06, EXP-09) with Mediabunny over WebCodecs.
 * Frames render one at a time on a fixed timestep, so a clip is identical on a fast or slow
 * device and never drops frames. MP4 (H.264) where the browser can encode it, else WebM.
 */
import { BufferTarget, CanvasSource, getFirstEncodableVideoCodec, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, type VideoCodec } from 'mediabunny';
import type { RenderBackground, ShotSpec, TurntableOptions } from '@/components/studio/viewer3d/stage';
import { viewerApi } from '@/components/studio/viewer3d/stage';

export interface VideoPlan {
  codec: VideoCodec;
  container: 'mp4' | 'webm';
  mime: string;
  extension: 'mp4' | 'webm';
  label: string;
}

/** The best format this browser can encode at this size, or null when it can't encode video. */
export async function planVideo(width: number, height: number, fps: number): Promise<VideoPlan | null> {
  if (typeof window === 'undefined' || typeof (window as Window & { VideoEncoder?: unknown }).VideoEncoder === 'undefined') return null;
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], { width, height, frameRate: fps });
  if (!codec) return null;
  const mp4 = codec === 'avc';
  const names: Record<string, string> = { avc: 'MP4 (H.264)', vp9: 'WebM (VP9)', av1: 'WebM (AV1)', vp8: 'WebM (VP8)' };
  return { codec, container: mp4 ? 'mp4' : 'webm', mime: mp4 ? 'video/mp4' : 'video/webm', extension: mp4 ? 'mp4' : 'webm', label: names[codec] ?? codec };
}

export interface TurntableVideoOptions {
  width: number;
  height: number;
  fps: number;
  seconds: number;
  degrees: number;
  from?: ShotSpec;
  /** A camera move instead of a turn (a fly-in to the print, or a path through saved views). */
  move?: TurntableOptions['move'];
  /** Video has no alpha channel, so a transparent backdrop is filled with white. */
  background: RenderBackground;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export async function recordTurntable(opts: TurntableVideoOptions): Promise<{ blob: Blob; plan: VideoPlan; width: number; height: number }> {
  if (!viewerApi.turntable) throw new Error('Open the 3D or Split view to render video.');
  // Encoders need even dimensions; stay within what the GPU renders in one pass.
  const max = viewerApi.maxOutputSize?.() ?? 4096;
  const k = Math.min(1, max / Math.max(opts.width, opts.height));
  const W = Math.max(2, Math.round((opts.width * k) / 2) * 2);
  const H = Math.max(2, Math.round((opts.height * k) / 2) * 2);
  const plan = await planVideo(W, H, opts.fps);
  if (!plan) throw new Error('This browser can’t encode video. Use Chrome, Edge, Firefox 130+ or Safari 17+, or export still images.');

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const output = new Output({
    format: plan.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, { codec: plan.codec, quality: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: opts.fps });
  await output.start();

  const frames = Math.max(2, Math.round(opts.fps * opts.seconds));
  const background: RenderBackground = opts.background === 'transparent' ? { color: '#FFFFFF' } : opts.background;
  try {
    await viewerApi.turntable({
      width: W,
      height: H,
      frames,
      degrees: opts.degrees,
      from: opts.from,
      move: opts.move,
      background,
      frameCurrent: true,
      fps: opts.fps,
      signal: opts.signal,
      onFrame: async (frame, i) => {
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(frame, 0, 0);
        await source.add(i / opts.fps, 1 / opts.fps);
        opts.onProgress?.((i + 1) / frames);
      },
    });
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => {});
    throw error;
  }
  const buffer = output.target.buffer;
  if (!buffer) throw new Error('The video could not be finished.');
  return { blob: new Blob([buffer], { type: plan.mime }), plan, width: W, height: H };
}
