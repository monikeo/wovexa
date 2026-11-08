'use client';
/**
 * Wovexa Studio 2D editor: the Fabric adapter (spec §36.1). Fabric is used only for
 * interaction (hit-testing, selection, transform handles). Every object's pixels come from
 * the canonical renderer, and every finished gesture becomes one domain command.
 * World units are millimetres from the top-left of the active print zone.
 */
import { ActiveSelection, Canvas as FabricCanvas, FabricImage, Point, type FabricObject, type TPointerEventInfo } from 'fabric';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { updateTransforms } from '@/domain/commands';
import { getGarment, getSize } from '@/domain/garments';
import type { ArtworkLayer, LayerTransform, ZoneId } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from '@/lib/assets';
import { ensureFonts, renderLayerBitmap } from '@/lib/render/zone-renderer';
import { useActiveColorway, useActiveZoneSpec, useLive, useStudio } from '@/stores/studio-store';
import { sketchForZone } from './flat-sketch';

type LayerObject = FabricImage & { layerId: string; bitmapKey?: string; bitmap?: HTMLCanvasElement };

const PAD = 28;
const ACTUAL_SIZE = 96 / 25.4; // CSS px per mm at 100%
const SNAP_PX = 6;

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function placeholder(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(128,128,128,0.25)';
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

/** Absolute physical transform of an object, including any active-selection group. */
function transformOf(obj: FabricObject): LayerTransform {
  const center = obj.getCenterPoint();
  const scaling = obj.getObjectScaling();
  return {
    centerXmm: center.x,
    centerYmm: center.y,
    widthMm: Math.abs(obj.width * scaling.x),
    heightMm: Math.abs(obj.height * scaling.y),
    rotationDeg: ((obj.getTotalAngle() % 360) + 540) % 360 - 180,
    flipX: !!obj.flipX,
    flipY: !!obj.flipY,
  };
}

export function Editor2D() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const objectsRef = useRef(new Map<string, LayerObject>());
  const zoneRef = useRef<ZoneId>('front');
  const syncingSelection = useRef(false);
  const snapLines = useRef<{ x?: number; y?: number }>({});
  const fitRef = useRef(true);
  const [zoomPct, setZoomPct] = useState(100);
  const [ready, setReady] = useState(false);

  const doc = useStudio((s) => s.document);
  const zoneId = useStudio((s) => s.activeZoneId);
  const selected = useStudio((s) => s.selectedLayerIds);
  const zoneSpec = useActiveZoneSpec();
  const colorway = useActiveColorway();
  const zone = doc?.zones[zoneId];

  // Latest values for event handlers registered once; refreshed after every render.
  const latest = useRef({ zoneSpec, colorway, doc, zoneId });
  useEffect(() => {
    latest.current = { zoneSpec, colorway, doc, zoneId };
    fabricRef.current?.requestRenderAll();
  });

  const reportZoom = useCallback(() => {
    const c = fabricRef.current;
    if (c) setZoomPct(Math.round((c.getZoom() / ACTUAL_SIZE) * 100));
  }, []);

  const fit = useCallback(() => {
    const c = fabricRef.current;
    const spec = latest.current.zoneSpec;
    if (!c || !spec) return;
    const w = c.getWidth();
    const h = c.getHeight();
    const zoom = Math.max(0.05, Math.min((w - PAD * 2) / spec.printableWidthMm, (h - PAD * 2) / spec.printableHeightMm));
    c.setViewportTransform([zoom, 0, 0, zoom, (w - spec.printableWidthMm * zoom) / 2, (h - spec.printableHeightMm * zoom) / 2]);
    fitRef.current = true;
    reportZoom();
  }, [reportZoom]);

  const zoomBy = useCallback(
    (factor: number, at?: Point) => {
      const c = fabricRef.current;
      if (!c) return;
      const zoom = Math.min(ACTUAL_SIZE * 8, Math.max(ACTUAL_SIZE * 0.05, c.getZoom() * factor));
      c.zoomToPoint(at ?? new Point(c.getWidth() / 2, c.getHeight() / 2), zoom);
      fitRef.current = false;
      reportZoom();
    },
    [reportZoom],
  );

  // ---- Create the Fabric canvas once ----
  useEffect(() => {
    const el = canvasElRef.current;
    const host = hostRef.current;
    if (!el || !host) return;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const canvas = new FabricCanvas(el, {
      width: host.clientWidth,
      height: host.clientHeight,
      preserveObjectStacking: true,
      selection: !coarse,
      uniformScaling: true,
      uniScaleKey: 'shiftKey',
      stopContextMenu: true,
      enableRetinaScaling: true,
      controlsAboveOverlay: true,
      selectionColor: 'rgba(43,89,255,0.08)',
      selectionBorderColor: '#2b59ff',
      targetFindTolerance: coarse ? 10 : 4,
    });
    fabricRef.current = canvas;
    const accent = cssVar('--accent', '#2b59ff');

    // Garment flat sketch behind the artwork.
    canvas.on('before:render', ({ ctx }) => {
      if (ctx !== canvas.getContext()) return;
      const { zoneSpec: spec, colorway: cw, doc: d } = latest.current;
      if (!spec || !cw || !d) return;
      const model = getGarment(d.garment.modelId);
      const sketch = sketchForZone(model, spec, getSize(model, d.garment.sizeCode).scale);
      const v = canvas.viewportTransform;
      const zoom = v[0];
      ctx.save();
      ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
      ctx.beginPath();
      sketch.body.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = spec.part === 'torso' ? cw.parts.body : cw.parts.sleeves;
      ctx.fill();
      ctx.lineWidth = 1 / zoom;
      ctx.strokeStyle = 'rgba(120,124,135,0.6)';
      ctx.stroke();
      ctx.setLineDash([4 / zoom, 3 / zoom]);
      ctx.strokeStyle = cw.parts.stitching;
      for (const seam of sketch.seams) {
        ctx.beginPath();
        seam.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (sketch.collar) {
        ctx.beginPath();
        sketch.collar.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.lineWidth = 16;
        ctx.lineCap = 'round';
        ctx.strokeStyle = cw.parts.collar;
        ctx.stroke();
        ctx.lineWidth = 1 / zoom;
        ctx.strokeStyle = 'rgba(120,124,135,0.5)';
        ctx.stroke();
      }
      ctx.restore();
    });

    // Print area, safe margin and snap guides on top.
    canvas.on('after:render', ({ ctx }) => {
      if (ctx !== canvas.getContext()) return;
      const spec = latest.current.zoneSpec;
      if (!spec) return;
      const v = canvas.viewportTransform;
      const z = v[0];
      const X = (mm: number) => Math.round(v[4] + mm * z) + 0.5;
      const Y = (mm: number) => Math.round(v[5] + mm * z) + 0.5;
      const W = spec.printableWidthMm;
      const H = spec.printableHeightMm;
      const inset = spec.safeInsetMm;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = accent;
      ctx.strokeRect(X(0), Y(0), X(W) - X(0), Y(H) - Y(0));
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = 'rgba(43,89,255,0.45)';
      ctx.strokeRect(X(inset), Y(inset), X(W - inset) - X(inset), Y(H - inset) - Y(inset));
      ctx.setLineDash([]);
      ctx.font = '600 11px var(--font-archivo), system-ui, sans-serif';
      ctx.fillStyle = accent;
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${spec.label} print area, ${W} × ${H} mm`, X(0), Y(0) - 6);
      const snap = snapLines.current;
      ctx.strokeStyle = '#e8336d';
      if (snap.x !== undefined) {
        ctx.beginPath();
        ctx.moveTo(X(snap.x), 0);
        ctx.lineTo(X(snap.x), canvas.getHeight());
        ctx.stroke();
      }
      if (snap.y !== undefined) {
        ctx.beginPath();
        ctx.moveTo(0, Y(snap.y));
        ctx.lineTo(canvas.getWidth(), Y(snap.y));
        ctx.stroke();
      }
      ctx.restore();
    });

    // ---- Live previews while transforming ----
    let liveFrame = 0;
    const pushLive = (target: FabricObject) => {
      if (liveFrame) return;
      liveFrame = requestAnimationFrame(() => {
        liveFrame = 0;
        const objs = target instanceof ActiveSelection ? target.getObjects() : [target];
        const overrides: Record<string, Partial<LayerTransform>> = {};
        for (const o of objs) {
          const id = (o as LayerObject).layerId;
          if (id) overrides[id] = transformOf(o);
        }
        useLive.getState().setOverrides(zoneRef.current, overrides);
      });
    };

    canvas.on('object:moving', (e) => {
      const target = e.target;
      const spec = latest.current.zoneSpec;
      snapLines.current = {};
      if (spec && !(e.e as MouseEvent).altKey) {
        const tol = SNAP_PX / canvas.getZoom();
        const c = target.getCenterPoint();
        let { x, y } = c;
        if (Math.abs(x - spec.printableWidthMm / 2) < tol) {
          x = spec.printableWidthMm / 2;
          snapLines.current.x = x;
        }
        if (Math.abs(y - spec.printableHeightMm / 2) < tol) {
          y = spec.printableHeightMm / 2;
          snapLines.current.y = y;
        }
        if (x !== c.x || y !== c.y) target.setPositionByOrigin(new Point(x, y), 'center', 'center');
      }
      pushLive(target);
    });
    canvas.on('object:scaling', (e) => pushLive(e.target));
    canvas.on('object:rotating', (e) => pushLive(e.target));

    canvas.on('object:modified', (e) => {
      cancelAnimationFrame(liveFrame);
      liveFrame = 0;
      snapLines.current = {};
      const target = e.target;
      const objs = target instanceof ActiveSelection ? target.getObjects() : [target];
      const changes: Record<string, Partial<LayerTransform>> = {};
      for (const o of objs) {
        const id = (o as LayerObject).layerId;
        if (id) changes[id] = transformOf(o);
      }
      const action = e.action ?? '';
      const label = action.startsWith('scale') ? 'Resize' : action === 'rotate' ? 'Rotate' : 'Move';
      useStudio.getState().dispatch(updateTransforms(zoneRef.current, changes, label));
      useLive.getState().clear();
      canvas.requestRenderAll();
    });

    // ---- Selection sync: canvas → store ----
    const onSelection = () => {
      if (syncingSelection.current) return;
      const ids = canvas.getActiveObjects().map((o) => (o as LayerObject).layerId).filter(Boolean);
      useStudio.getState().select(ids);
    };
    canvas.on('selection:created', onSelection);
    canvas.on('selection:updated', onSelection);
    canvas.on('selection:cleared', onSelection);

    canvas.on('mouse:dblclick', (e) => {
      const id = (e.target as LayerObject | undefined)?.layerId;
      if (id) window.dispatchEvent(new CustomEvent('wovexa:edit-layer', { detail: { layerId: id } }));
    });

    // ---- Pan and zoom ----
    let panning: { x: number; y: number } | null = null;
    let spaceDown = false;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]');
      if (e.code === 'Space' && !typing) {
        spaceDown = e.type === 'keydown';
        canvas.defaultCursor = spaceDown ? 'grab' : 'default';
        canvas.skipTargetFind = spaceDown;
        canvas.selection = !spaceDown && !coarse;
        if (spaceDown) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    canvas.on('mouse:down', (opt: TPointerEventInfo) => {
      const ev = opt.e as PointerEvent;
      const touchEmpty = ev.pointerType === 'touch' && !opt.target;
      if (spaceDown || ev.button === 1 || touchEmpty) {
        panning = { x: ev.clientX, y: ev.clientY };
      }
    });
    canvas.on('mouse:move', (opt: TPointerEventInfo) => {
      if (!panning || pinch.size > 1) return;
      const ev = opt.e as PointerEvent;
      canvas.relativePan(new Point(ev.clientX - panning.x, ev.clientY - panning.y));
      panning = { x: ev.clientX, y: ev.clientY };
      fitRef.current = false;
    });
    canvas.on('mouse:up', () => {
      panning = null;
    });
    canvas.on('mouse:wheel', (opt) => {
      const ev = opt.e as WheelEvent;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.ctrlKey || ev.metaKey) {
        zoomBy(Math.exp(-ev.deltaY * 0.0022), canvas.getViewportPoint(ev));
      } else {
        canvas.relativePan(new Point(-ev.deltaX, -ev.deltaY));
        fitRef.current = false;
      }
    });

    // Two-finger pinch zoom and pan on touch screens (spec TAB-04).
    const pinch = new Map<number, { x: number; y: number }>();
    let pinchStart: { dist: number; zoom: number; mid: { x: number; y: number } } | null = null;
    const upper = canvas.upperCanvasEl;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size === 2) {
        const [a, b] = [...pinch.values()];
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: canvas.getZoom(), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        panning = null;
        canvas.discardActiveObject();
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pinch.has(e.pointerId)) return;
      pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size === 2 && pinchStart) {
        const [a, b] = [...pinch.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const rect = upper.getBoundingClientRect();
        canvas.relativePan(new Point(mid.x - pinchStart.mid.x, mid.y - pinchStart.mid.y));
        const zoom = Math.min(ACTUAL_SIZE * 8, Math.max(ACTUAL_SIZE * 0.05, (pinchStart.zoom * dist) / pinchStart.dist));
        canvas.zoomToPoint(new Point(mid.x - rect.left, mid.y - rect.top), zoom);
        pinchStart.mid = mid;
        fitRef.current = false;
        reportZoom();
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      pinch.delete(e.pointerId);
      if (pinch.size < 2) pinchStart = null;
    };
    upper.addEventListener('pointerdown', onPointerDown);
    upper.addEventListener('pointermove', onPointerMove);
    upper.addEventListener('pointerup', onPointerUp);
    upper.addEventListener('pointercancel', onPointerUp);

    const ro = new ResizeObserver(() => {
      canvas.setDimensions({ width: host.clientWidth, height: host.clientHeight });
      if (fitRef.current) fit();
      canvas.requestRenderAll();
    });
    ro.observe(host);
    setReady(true);

    const objects = objectsRef.current;
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      upper.removeEventListener('pointerdown', onPointerDown);
      upper.removeEventListener('pointermove', onPointerMove);
      upper.removeEventListener('pointerup', onPointerUp);
      upper.removeEventListener('pointercancel', onPointerUp);
      cancelAnimationFrame(liveFrame);
      objects.clear();
      fabricRef.current = null;
      void canvas.dispose();
    };
  }, [fit, zoomBy, reportZoom]);

  // ---- Reconcile Fabric objects with the canonical document ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !zone || !ready) return;
    const objects = objectsRef.current;

    if (zoneRef.current !== zoneId) {
      for (const obj of objects.values()) canvas.remove(obj);
      objects.clear();
      zoneRef.current = zoneId;
      fit();
    }

    let cancelled = false;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const accent = cssVar('--accent', '#2b59ff');
    const resolution = () => Math.min(12, canvas.getZoom() * (window.devicePixelRatio || 1));

    const applyLayer = (obj: LayerObject, layer: ArtworkLayer) => {
      let element: HTMLCanvasElement | HTMLImageElement;
      if (layer.content.kind === 'image') {
        element = getLoadedImage(layer.content.assetId) ?? placeholder();
      } else {
        const ppm = Math.min(resolution(), 2048 / Math.max(layer.transform.widthMm, layer.transform.heightMm));
        const key = JSON.stringify([layer.content, Math.round(layer.transform.widthMm * ppm), Math.round(layer.transform.heightMm * ppm)]);
        if (obj.bitmapKey !== key || !obj.bitmap) {
          obj.bitmap = renderLayerBitmap(layer, ppm, document.createElement('canvas'));
          obj.bitmapKey = key;
        }
        element = obj.bitmap;
      }
      if (obj.getElement() !== element) obj.setElement(element);
      const t = layer.transform;
      obj.set({
        left: t.centerXmm,
        top: t.centerYmm,
        angle: t.rotationDeg,
        flipX: t.flipX,
        flipY: t.flipY,
        scaleX: t.widthMm / element.width,
        scaleY: t.heightMm / element.height,
        opacity: layer.style.opacity,
        visible: layer.visible,
        selectable: !layer.locked,
        evented: layer.visible && !layer.locked,
        hoverCursor: layer.locked ? 'default' : 'move',
      });
      obj.setCoords();
    };

    const order = zone.orderedLayerIds;
    for (const [id, obj] of objects) {
      if (!zone.layers[id]) {
        canvas.remove(obj);
        objects.delete(id);
      }
    }
    order.forEach((id, index) => {
      const layer = zone.layers[id];
      let obj = objects.get(id);
      if (!obj) {
        obj = new FabricImage(placeholder(), {
          originX: 'center',
          originY: 'center',
          lockScalingFlip: true,
          borderColor: accent,
          cornerColor: '#ffffff',
          cornerStrokeColor: accent,
          cornerStyle: 'rect',
          transparentCorners: false,
          cornerSize: coarse ? 20 : 10,
          touchCornerSize: 28,
          borderScaleFactor: 1.5,
          padding: 0,
          objectCaching: false,
        }) as LayerObject;
        obj.layerId = id;
        objects.set(id, obj);
        canvas.add(obj);
      }
      applyLayer(obj, layer);
      if (canvas.getObjects().indexOf(obj) !== index) canvas.moveObjectTo(obj, index);
      if (layer.content.kind === 'image' && !getLoadedImage(layer.content.assetId)) {
        loadAssetImage(layer.content.assetId).then(
          () => {
            const current = useStudio.getState().document?.zones[zoneRef.current].layers[id];
            const o = objects.get(id);
            if (!cancelled && current && o) {
              applyLayer(o, current);
              canvas.requestRenderAll();
            }
          },
          () => {},
        );
      }
    });

    // Text bitmaps need their web fonts; re-render once they're ready.
    ensureFonts([zone]).then(() => {
      if (cancelled) return;
      for (const id of zone.orderedLayerIds) {
        const o = objects.get(id);
        const l = zone.layers[id];
        if (o && l && l.content.kind === 'text') {
          o.bitmapKey = undefined;
          applyLayer(o, l);
        }
      }
      canvas.requestRenderAll();
    });

    canvas.requestRenderAll();
    return () => {
      cancelled = true;
    };
  }, [zone, zoneId, ready, zoomPct, fit, colorway]);

  // ---- Selection sync: store → canvas ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !ready) return;
    const current = canvas.getActiveObjects().map((o) => (o as LayerObject).layerId);
    if (current.length === selected.length && current.every((id) => selected.includes(id))) return;
    syncingSelection.current = true;
    canvas.discardActiveObject();
    const objs = selected.map((id) => objectsRef.current.get(id)).filter((o): o is LayerObject => !!o && o.selectable);
    if (objs.length === 1) canvas.setActiveObject(objs[0]);
    else if (objs.length > 1) canvas.setActiveObject(new ActiveSelection(objs, { canvas }));
    canvas.requestRenderAll();
    syncingSelection.current = false;
  }, [selected, ready, zone]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas" data-testid="editor-2d">
      <div ref={hostRef} className="absolute inset-0 touch-none">
        <canvas ref={canvasElRef} aria-label={`${zoneSpec?.label ?? ''} print zone editor`} />
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-xl border border-line bg-floating/95 p-1 shadow-sm backdrop-blur">
        <button className="icon-btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out">
          <Minus size={16} />
        </button>
        <span className="num w-12 text-center text-xs font-semibold text-fg-2" aria-live="polite">
          {zoomPct}%
        </span>
        <button className="icon-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in">
          <Plus size={16} />
        </button>
        <button className="icon-btn" onClick={fit} aria-label="Fit print area to screen" title="Fit">
          <Maximize size={15} />
        </button>
      </div>
    </div>
  );
}
