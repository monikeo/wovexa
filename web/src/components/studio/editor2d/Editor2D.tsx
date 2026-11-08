'use client';
/**
 * Wovexa Studio 2D editor: the Fabric adapter (spec §36.1). Fabric is used only for
 * interaction (hit-testing, selection, transform handles). Every object's pixels come from
 * the canonical renderer, and every finished gesture becomes one domain command.
 * World units are millimetres from the top-left of the active print zone.
 */
import { ActiveSelection, Canvas as FabricCanvas, FabricImage, Group, Point, type FabricObject, type TPointerEventInfo } from 'fabric';
import { Focus, Maximize, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { unionBounds } from '@/domain/arrange';
import { updateTransforms } from '@/domain/commands';
import { getGarment, getSize } from '@/domain/garments';
import { rotatedBounds, type Rect } from '@/domain/geometry';
import type { ArtworkLayer, LayerTransform, ZoneDesign, ZoneId } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from '@/lib/assets';
import { usePreference } from '@/lib/preferences';
import { ensureFonts, renderLayerBitmap } from '@/lib/render/zone-renderer';
import { useActiveColorway, useActiveZoneSpec, useLive, useStudio } from '@/stores/studio-store';
import { drawRuler, RULER_SIZE } from './rulers';
import { sketchForZone } from './flat-sketch';

type LayerObject = FabricImage & { layerId: string; bitmapKey?: string; bitmap?: HTMLCanvasElement };
type GroupObject = Group & { groupKey: string; signature?: string };

const PAD = 44;
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

/** Layer objects inside a target, through groups and active selections. */
function leaves(obj: FabricObject): LayerObject[] {
  if ((obj as LayerObject).layerId) return [obj as LayerObject];
  if (obj instanceof Group) return obj.getObjects().flatMap(leaves);
  return [];
}

/** Absolute physical transform of an object, including any group or active selection. */
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

/** Document order split into display items: single layers, or contiguous group blocks. */
function displayItems(zone: ZoneDesign) {
  const items: { key: string; ids: string[] }[] = [];
  const seen = new Map<string, number>();
  for (const id of zone.orderedLayerIds) {
    const layer = zone.layers[id];
    if (!layer) continue;
    const g = layer.groupId;
    const last = items[items.length - 1];
    if (g && last && last.key.startsWith(`g:${g}`)) {
      last.ids.push(id);
      continue;
    }
    if (g) {
      const n = (seen.get(g) ?? 0) + 1;
      seen.set(g, n);
      items.push({ key: n === 1 ? `g:${g}` : `g:${g}:${n}`, ids: [id] });
    } else {
      items.push({ key: `l:${id}`, ids: [id] });
    }
  }
  // A "group" of one (e.g. after deleting other members) behaves like a single layer.
  return items.map((it) => (it.key.startsWith('g:') && it.ids.length === 1 ? { key: `l:${it.ids[0]}`, ids: it.ids } : it));
}

export function Editor2D() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const rulerTopRef = useRef<HTMLCanvasElement>(null);
  const rulerLeftRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const objectsRef = useRef(new Map<string, LayerObject>());
  const groupsRef = useRef(new Map<string, GroupObject>());
  const zoneRef = useRef<ZoneId>('front');
  const syncingSelection = useRef(false);
  const snapLines = useRef<{ x?: number; y?: number }>({});
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const fitRef = useRef(true);
  const renderRulersRef = useRef<() => void>(() => {});
  const [zoomPct, setZoomPct] = useState(100);
  const [ready, setReady] = useState(false);
  // Bumped when an image decodes or a web font loads, so objects are redrawn with real pixels.
  const [refreshTick, setRefreshTick] = useState(0);

  const doc = useStudio((s) => s.document);
  const zoneId = useStudio((s) => s.activeZoneId);
  const selected = useStudio((s) => s.selectedLayerIds);
  const zoneSpec = useActiveZoneSpec();
  const colorway = useActiveColorway();
  const units = usePreference('units');
  const zone = doc?.zones[zoneId];

  // Latest values for event handlers registered once; refreshed after every render.
  const latest = useRef({ zoneSpec, colorway, doc, zoneId, units, selected });
  useEffect(() => {
    latest.current = { zoneSpec, colorway, doc, zoneId, units, selected };
    fabricRef.current?.requestRenderAll();
  });

  const reportZoom = useCallback(() => {
    const c = fabricRef.current;
    if (c) setZoomPct(Math.round((c.getZoom() / ACTUAL_SIZE) * 100));
  }, []);

  const zoomToRect = useCallback(
    (r: Rect, pad = PAD) => {
      const c = fabricRef.current;
      if (!c) return;
      const w = c.getWidth();
      const h = c.getHeight();
      const zoom = Math.min(ACTUAL_SIZE * 8, Math.max(0.05, Math.min((w - pad * 2) / Math.max(r.width, 1), (h - pad * 2) / Math.max(r.height, 1))));
      c.setViewportTransform([zoom, 0, 0, zoom, (w - r.width * zoom) / 2 - r.x * zoom + RULER_SIZE / 2, (h - r.height * zoom) / 2 - r.y * zoom + RULER_SIZE / 2]);
      reportZoom();
    },
    [reportZoom],
  );

  const fit = useCallback(() => {
    const spec = latest.current.zoneSpec;
    if (!spec) return;
    zoomToRect({ x: 0, y: 0, width: spec.printableWidthMm, height: spec.printableHeightMm });
    fitRef.current = true;
  }, [zoomToRect]);

  const zoomToSelection = useCallback(() => {
    const { doc: d, zoneId: z, selected: ids } = latest.current;
    const zn = d?.zones[z];
    if (!zn || !ids.length) return;
    const rects = ids.map((id) => zn.layers[id]).filter(Boolean).map((l) => rotatedBounds(l.transform));
    if (!rects.length) return;
    zoomToRect(unionBounds(rects), 80);
    fitRef.current = false;
  }, [zoomToRect]);

  /** Make the canvas selection match the given layer ids (whole groups only). */
  const restoreSelection = useCallback((canvas: FabricCanvas, zn: ZoneDesign, ids: string[]) => {
    canvas.discardActiveObject();
    const targets: FabricObject[] = [];
    for (const item of displayItems(zn)) {
      if (!item.ids.every((id) => ids.includes(id))) continue;
      const obj = item.key.startsWith('g:') ? groupsRef.current.get(item.key) : objectsRef.current.get(item.ids[0]);
      if (obj && obj.selectable && canvas.getObjects().includes(obj)) targets.push(obj);
    }
    if (targets.length === 1) canvas.setActiveObject(targets[0]);
    else if (targets.length > 1) canvas.setActiveObject(new ActiveSelection(targets, { canvas }));
    canvas.requestRenderAll();
  }, []);

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

    // Print area, safe margin, snap guides and rulers on top.
    canvas.on('after:render', ({ ctx }) => {
      if (ctx !== canvas.getContext()) return;
      const spec = latest.current.zoneSpec;
      if (!spec) return;
      const v = canvas.viewportTransform;
      const zoom = v[0];
      const X = (mm: number) => Math.round(v[4] + mm * zoom) + 0.5;
      const Y = (mm: number) => Math.round(v[5] + mm * zoom) + 0.5;
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
      renderRulers();
    });

    // Rulers: selection extent from the live objects while dragging, else from the document.
    const renderRulers = () => {
      const { units: u, doc: d, zoneId: z, selected: ids } = latest.current;
      const v = canvas.viewportTransform;
      const active = canvas.getActiveObjects().flatMap(leaves);
      const zn = d?.zones[z];
      const rects = active.length
        ? active.map((o) => rotatedBounds(transformOf(o)))
        : zn
          ? ids.map((id) => zn.layers[id]).filter(Boolean).map((l) => rotatedBounds(l.transform))
          : [];
      const sel = rects.length ? unionBounds(rects) : null;
      const colors = { bg: cssVar('--surface-panel', '#fff'), fg: cssVar('--text-muted', '#8c909b'), line: cssVar('--border', '#dcdee4'), accent };
      const p = pointerRef.current;
      if (rulerTopRef.current) drawRuler(rulerTopRef.current, 'x', { zoom: v[0], offset: v[4], units: u, selection: sel ? [sel.x, sel.x + sel.width] : null, pointer: p?.x ?? null, colors });
      if (rulerLeftRef.current) drawRuler(rulerLeftRef.current, 'y', { zoom: v[0], offset: v[5], units: u, selection: sel ? [sel.y, sel.y + sel.height] : null, pointer: p?.y ?? null, colors });
    };
    let rulerFrame = 0;
    renderRulersRef.current = () => {
      if (!rulerFrame) rulerFrame = requestAnimationFrame(() => ((rulerFrame = 0), renderRulers()));
    };

    // ---- Live previews while transforming ----
    let liveFrame = 0;
    const pushLive = (target: FabricObject) => {
      if (liveFrame) return;
      liveFrame = requestAnimationFrame(() => {
        liveFrame = 0;
        const overrides: Record<string, Partial<LayerTransform>> = {};
        for (const o of leaves(target)) overrides[o.layerId] = transformOf(o);
        useLive.getState().setOverrides(zoneRef.current, overrides);
      });
    };

    // Smart guides: snap edges and centres to the print area and to other layers (spec ED2-08).
    canvas.on('object:moving', (e) => {
      const target = e.target;
      snapLines.current = {};
      const { zoneSpec: spec, doc: d } = latest.current;
      const zn = d?.zones[zoneRef.current];
      if (spec && zn && !(e.e as MouseEvent).altKey) {
        const moving = leaves(target);
        const movingIds = new Set(moving.map((o) => o.layerId));
        const b = unionBounds(moving.map((o) => rotatedBounds(transformOf(o))));
        const W = spec.printableWidthMm;
        const H = spec.printableHeightMm;
        const xs = [0, W / 2, W, spec.safeInsetMm, W - spec.safeInsetMm];
        const ys = [0, H / 2, H, spec.safeInsetMm, H - spec.safeInsetMm];
        for (const id of zn.orderedLayerIds) {
          const l = zn.layers[id];
          if (!l || !l.visible || movingIds.has(id)) continue;
          const r = rotatedBounds(l.transform);
          xs.push(r.x, r.x + r.width / 2, r.x + r.width);
          ys.push(r.y, r.y + r.height / 2, r.y + r.height);
        }
        const tol = SNAP_PX / canvas.getZoom();
        const best = (edges: number[], lines: number[]) => {
          let pick: { delta: number; line: number } | null = null;
          for (const edge of edges) for (const line of lines) {
            const delta = line - edge;
            if (Math.abs(delta) < tol && (!pick || Math.abs(delta) < Math.abs(pick.delta))) pick = { delta, line };
          }
          return pick;
        };
        const sx = best([b.x, b.x + b.width / 2, b.x + b.width], xs);
        const sy = best([b.y, b.y + b.height / 2, b.y + b.height], ys);
        if (sx || sy) {
          target.set({ left: target.left + (sx?.delta ?? 0), top: target.top + (sy?.delta ?? 0) });
          target.setCoords();
          snapLines.current = { x: sx?.line, y: sy?.line };
        }
      }
      pushLive(target);
    });
    canvas.on('object:scaling', (e) => pushLive(e.target));
    canvas.on('object:rotating', (e) => pushLive(e.target));

    canvas.on('object:modified', (e) => {
      cancelAnimationFrame(liveFrame);
      liveFrame = 0;
      snapLines.current = {};
      const changes: Record<string, Partial<LayerTransform>> = {};
      for (const o of leaves(e.target)) changes[o.layerId] = transformOf(o);
      const action = e.action ?? '';
      const label = action.startsWith('scale') ? 'Resize' : action === 'rotate' ? 'Rotate' : 'Move';
      useStudio.getState().dispatch(updateTransforms(zoneRef.current, changes, label));
      useLive.getState().clear();
      canvas.requestRenderAll();
    });

    // ---- Selection sync: canvas → store ----
    const onSelection = () => {
      if (syncingSelection.current) return;
      const ids = canvas.getActiveObjects().flatMap(leaves).map((o) => o.layerId);
      useStudio.getState().select(ids);
    };
    canvas.on('selection:created', onSelection);
    canvas.on('selection:updated', onSelection);
    canvas.on('selection:cleared', onSelection);

    canvas.on('mouse:dblclick', (e) => {
      const id = e.target ? leaves(e.target)[0]?.layerId : undefined;
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
      if (spaceDown || ev.button === 1 || touchEmpty) panning = { x: ev.clientX, y: ev.clientY };
    });
    canvas.on('mouse:move', (opt: TPointerEventInfo) => {
      pointerRef.current = canvas.getScenePoint(opt.e);
      renderRulersRef.current();
      if (!panning || pinch.size > 1) return;
      const ev = opt.e as PointerEvent;
      canvas.relativePan(new Point(ev.clientX - panning.x, ev.clientY - panning.y));
      panning = { x: ev.clientX, y: ev.clientY };
      fitRef.current = false;
    });
    canvas.on('mouse:out', () => {
      pointerRef.current = null;
      renderRulersRef.current();
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

    const onZoomToSelection = () => zoomToSelection();
    const onFit = () => fit();
    window.addEventListener('wovexa:zoom-to-selection', onZoomToSelection);
    window.addEventListener('wovexa:fit', onFit);

    const ro = new ResizeObserver(() => {
      canvas.setDimensions({ width: host.clientWidth, height: host.clientHeight });
      if (fitRef.current) fit();
      canvas.requestRenderAll();
    });
    ro.observe(host);
    setReady(true);

    const objects = objectsRef.current;
    const groups = groupsRef.current;
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('wovexa:zoom-to-selection', onZoomToSelection);
      window.removeEventListener('wovexa:fit', onFit);
      upper.removeEventListener('pointerdown', onPointerDown);
      upper.removeEventListener('pointermove', onPointerMove);
      upper.removeEventListener('pointerup', onPointerUp);
      upper.removeEventListener('pointercancel', onPointerUp);
      cancelAnimationFrame(liveFrame);
      objects.clear();
      groups.clear();
      fabricRef.current = null;
      void canvas.dispose();
    };
  }, [fit, zoomBy, reportZoom, zoomToSelection]);

  // ---- Reconcile Fabric objects with the canonical document ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !zone || !ready) return;
    const objects = objectsRef.current;
    const groups = groupsRef.current;

    // Objects inside a temporary multi-selection use selection-relative coordinates, so the
    // selection is released before placing objects and restored afterwards.
    const quietly = (fn: () => void) => {
      syncingSelection.current = true;
      fn();
      syncingSelection.current = false;
    };
    let reselect = false;
    if (canvas.getActiveObject() instanceof ActiveSelection) {
      quietly(() => canvas.discardActiveObject());
      reselect = true;
    }

    if (zoneRef.current !== zoneId) {
      quietly(() => canvas.discardActiveObject());
      for (const g of groups.values()) canvas.remove(g);
      for (const obj of objects.values()) canvas.remove(obj);
      objects.clear();
      groups.clear();
      zoneRef.current = zoneId;
      fit();
    }

    let cancelled = false;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const accent = cssVar('--accent', '#2b59ff');
    const controlStyle = {
      lockScalingFlip: true,
      borderColor: accent,
      cornerColor: '#ffffff',
      cornerStrokeColor: accent,
      cornerStyle: 'rect' as const,
      transparentCorners: false,
      cornerSize: coarse ? 20 : 10,
      touchCornerSize: 28,
      borderScaleFactor: 1.5,
      padding: 0,
      objectCaching: false,
    };
    const resolution = () => Math.min(12, canvas.getZoom() * (window.devicePixelRatio || 1));

    // Pixels and absolute placement for a layer object that is not inside a group.
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

    const ensureObject = (id: string) => {
      let obj = objects.get(id);
      if (!obj) {
        obj = new FabricImage(placeholder(), { originX: 'center', originY: 'center', ...controlStyle }) as LayerObject;
        obj.layerId = id;
        objects.set(id, obj);
      }
      return obj;
    };

    const detach = (obj: FabricObject) => {
      const parent = obj.group;
      if (parent && !(parent instanceof ActiveSelection)) parent.remove(obj);
      if (canvas.getObjects().includes(obj)) canvas.remove(obj);
    };

    const items = displayItems(zone);
    const liveKeys = new Set(items.map((i) => i.key));
    const liveIds = new Set(zone.orderedLayerIds);

    // Remove groups and layers that no longer exist.
    for (const [key, group] of groups) {
      if (!liveKeys.has(key)) {
        if (canvas.getActiveObject() === group) quietly(() => canvas.discardActiveObject());
        group.removeAll();
        canvas.remove(group);
        groups.delete(key);
      }
    }
    for (const [id, obj] of objects) {
      if (!liveIds.has(id)) {
        detach(obj);
        objects.delete(id);
      }
    }

    const zoomBucket = Math.round(resolution() * 4);
    const display: FabricObject[] = [];
    for (const item of items) {
      if (item.key.startsWith('l:')) {
        const id = item.ids[0];
        const obj = ensureObject(id);
        if (obj.group && !(obj.group instanceof ActiveSelection)) detach(obj);
        applyLayer(obj, zone.layers[id]);
        display.push(obj);
        continue;
      }
      const members = item.ids.map((id) => zone.layers[id]);
      const signature = JSON.stringify([members, zoomBucket, members.map((m) => (m.content.kind === 'image' ? !!getLoadedImage(m.content.assetId) : 1))]);
      let group = groups.get(item.key);
      if (!group || group.signature !== signature) {
        if (group) {
          if (canvas.getActiveObject() === group) {
            quietly(() => canvas.discardActiveObject());
            reselect = true;
          }
          group.removeAll();
          canvas.remove(group);
        }
        const objs = item.ids.map((id) => {
          const obj = ensureObject(id);
          detach(obj);
          applyLayer(obj, zone.layers[id]);
          return obj;
        });
        group = new Group(objs, { originX: 'center', originY: 'center', subTargetCheck: false, interactive: false, ...controlStyle }) as GroupObject;
        group.groupKey = item.key;
        group.signature = signature;
        const locked = members.some((m) => m.locked);
        group.set({ selectable: !locked, evented: !locked && members.some((m) => m.visible), hoverCursor: locked ? 'default' : 'move' });
        groups.set(item.key, group);
      }
      display.push(group);
    }

    display.forEach((obj, index) => {
      if (!canvas.getObjects().includes(obj)) canvas.add(obj);
      if (canvas.getObjects().indexOf(obj) !== index) canvas.moveObjectTo(obj, index);
    });

    if (reselect) quietly(() => restoreSelection(canvas, zone, latest.current.selected));

    // Images decode asynchronously; redraw once they're ready.
    for (const id of zone.orderedLayerIds) {
      const layer = zone.layers[id];
      if (layer.content.kind === 'image' && !getLoadedImage(layer.content.assetId)) {
        loadAssetImage(layer.content.assetId).then(
          () => !cancelled && setRefreshTick((t) => t + 1),
          () => {},
        );
      }
    }

    // Text bitmaps need their web fonts; redraw with real metrics once a font arrives.
    ensureFonts([zone]).then((loaded) => {
      if (cancelled || !loaded) return;
      for (const obj of objects.values()) obj.bitmapKey = undefined;
      setRefreshTick((t) => t + 1);
    });

    canvas.requestRenderAll();
    return () => {
      cancelled = true;
    };
  }, [zone, zoneId, ready, zoomPct, fit, colorway, refreshTick, restoreSelection]);

  // ---- Selection sync: store → canvas ----
  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || !ready || !zone) return;
    const current = canvas.getActiveObjects().flatMap(leaves).map((o) => o.layerId);
    if (current.length === selected.length && current.every((id) => selected.includes(id))) return;
    syncingSelection.current = true;
    restoreSelection(canvas, zone, selected);
    syncingSelection.current = false;
  }, [selected, ready, zone, restoreSelection]);

  // Rulers follow device pixel ratio and size.
  useEffect(() => {
    const top = rulerTopRef.current;
    const left = rulerLeftRef.current;
    const host = hostRef.current;
    if (!top || !left || !host) return;
    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      top.width = Math.round(host.clientWidth * dpr);
      top.height = Math.round(RULER_SIZE * dpr);
      left.width = Math.round(RULER_SIZE * dpr);
      left.height = Math.round(host.clientHeight * dpr);
      fabricRef.current?.requestRenderAll();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas" data-testid="editor-2d">
      <div ref={hostRef} className="absolute inset-0 touch-none">
        <canvas ref={canvasElRef} aria-label={`${zoneSpec?.label ?? ''} print zone editor`} />
      </div>
      <canvas ref={rulerTopRef} className="pointer-events-none absolute left-0 top-0 h-5 w-full" aria-hidden />
      <canvas ref={rulerLeftRef} className="pointer-events-none absolute left-0 top-0 h-full w-5" aria-hidden />
      <div className="pointer-events-none absolute left-0 top-0 grid h-5 w-5 place-items-center border-b border-r border-line bg-panel text-[9px] font-semibold text-fg-3" aria-hidden>
        {units}
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
        <button className="icon-btn" onClick={zoomToSelection} disabled={!selected.length} aria-label="Zoom to selection" title="Zoom to selection (Shift+2)">
          <Focus size={15} />
        </button>
        <button className="icon-btn" onClick={fit} aria-label="Fit print area to screen" title="Fit (Shift+1)">
          <Maximize size={15} />
        </button>
      </div>
    </div>
  );
}
