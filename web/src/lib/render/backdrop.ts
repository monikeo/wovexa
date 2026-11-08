import type { Scene } from '@/domain/schema';
import { getLoadedImage } from '@/lib/assets';

/**
 * Paint a scene backdrop into a 2D canvas for renders and video, matching what sits behind the
 * live view: a solid colour, an elliptical radial gradient centred high, or an image that covers
 * the frame (centred, cropped, never stretched).
 */
export function paintBackdrop(ctx: CanvasRenderingContext2D, backdrop: Scene['backdrop'] | { kind: 'solid'; color: string }, w: number, h: number) {
  if (backdrop.kind === 'transparent') return;
  if (backdrop.kind === 'solid' || backdrop.kind === 'image') {
    ctx.fillStyle = backdrop.color;
    ctx.fillRect(0, 0, w, h);
    const img = backdrop.kind === 'image' && backdrop.assetId ? getLoadedImage(backdrop.assetId) : null;
    if (img) {
      const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * k;
      const dh = img.naturalHeight * k;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    return;
  }
  ctx.save();
  // CSS: radial-gradient(120% 90% at 50% 30%, color, color2)
  ctx.translate(w / 2, h * 0.3);
  ctx.scale(1.2 * w, 0.9 * h);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, backdrop.color);
  g.addColorStop(1, backdrop.color2);
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}
