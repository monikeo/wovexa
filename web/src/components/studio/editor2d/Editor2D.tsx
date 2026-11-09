'use client';
/**
 * Wovexa Studio 2D editor: the Fabric adapter (spec §36.1). Fabric is used only for
 * interaction (hit-testing, selection, transform handles). Every object's pixels come from
 * the canonical renderer, and every finished gesture becomes one domain command.
 * World units are millimetres from the top-left of the active print zone.
 */
import { ActiveSelection, Canvas as FabricCanvas, FabricImage, Group, Point, type FabricObject, type TPointerEventInfo } from 'fabric';
import { Focus, Maximize, Minus, PenTool, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { expandToGroups, unionBounds } from '@/domain/arrange';
import { EditorContextMenu } from './ContextMenu';
import { updateTransforms } from '@/domain/commands';
import { getGarment, getSize, partColor } from '@/domain/garments';
import { rotatedBounds, type Rect } from '@/domain/geometry';
import { artboardOf } from '@/domain/areas';
import type { ArtboardId, ArtworkLayer, LayerStack, LayerTransform } from '@/domain/schema';
import { getLoadedImage, loadAssetImage } from '@/lib/assets';
import { usePreference } from '@/lib/preferences';
import { ensureFonts, imageNeedsBitmap, imageSource, renderLayerBitmap } from '@/lib/render/zone-renderer';
import { useActiveColorway, useActiveZoneSpec, useLive, useStudio } from '@/stores/studio-store';
import { drawRuler, RULER_SIZE } from './rulers';
import { drawSketch, sketchForZone } from './flat-sketch';
import { PenOverlay } from './PenOverlay';
import { penShape } from '@/domain/pen';
import { addDrawnShape } from '../actions';

/**
 * A layer's Fabric object. Its width and height are the layer box; the bitmap may carry extra
 * pixels (`bleed`) on every side for outlines and shadows, drawn outside the box but never hit-tested.
 */
class LayerImage extends FabricImage {
  layerId = '';
  bitmapKey?: string;
  bitmap?: HTMLCanvasElement;
  bitmapBleed = 0;
  bleed = 0;
  _renderFill(ctx: CanvasRenderingContext2D) {
    const el = this.getElement() as HTMLCanvasElement | HTMLImageElement | undefined;
    if (!el || !this.bleed) return super._renderFill(ctx);
    const b = this.bleed;
    ctx.drawImage(el, -this.width / 2 - b, -this.height / 2 - b, this.width + 2 * b, this.height + 2 * b);
  }
}
type LayerObject = LayerImage;
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
function displayItems(zone: LayerStack) {
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
  const zoneRef = useRef<ArtboardId>('front');
  const syncingSelection = useRef(false);
  const snapLines = useRef<{ x?: number; y?: number }>({});
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const fitRef = useRef(true);
  const renderRulersRef = useRef<() => void>(() => {});
  const [zoomPct, setZoomPct] = useState(100);
  const [ready, setReady] = useState(false);
  // Bumped when an image decodes or a web font loads, so objects are redrawn with real pixels.
  const [refreshTick, setRefreshTick] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenu(null);
    if (restoreFocus) hostRef.current?.focus();
  }, []);
  // The pen: draw a shape of your own over the artboard (P, the toolbar, or the Add menu).
  const [penOn, setPenOn] = useState(false);
  const getFabric = useCallback(() => fabricRef.current, []);
  useEffect(() => {
    const toggle = (e: Event) => setPenOn((on) => ((e as CustomEvent).detail === 'on' ? true : !on));
    window.addEventListener('wovexa:pen', toggle);
    return () => window.removeEventListener('wovexa:pen', toggle);
  }, []);

  const doc = useStudio((s) => s.document);
  const zoneId = useStudio((s) => s.activeZoneId);
  const selected = useStudio((s) => s.selectedLayerIds);
  const zoneSpec = useActiveZoneSpec();
  const colorway = useActiveColorway();
  const units = usePreference('units');
  const zone = doc ? artboardOf(doc, zoneId) : undefined;

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

  // Split view (spec ED3-12): follow artwork being dragged on the 3D garment, live.
  useEffect(() => {
    let following = false;
    return useLive.subscribe((live) => {
      const canvas = fabricRef.current;
      if (!canvas) return;
      if (live.source === '3d' && live.zoneId === zoneRef.current) {
        following = true;
        const zone = latest.current.doc ? artboardOf(latest.current.doc, zoneRef.current) : undefined;
        for (const [id, patch] of Object.entries(live.overrides)) {
          const obj = objectsRef.current.get(id);
          const layer = zone?.layers[id];
          // Grouped layers sit inside a Fabric group; they catch up when the move commits.
          if (!obj || !layer || obj.group) continue;
          const t = { ...layer.transform, ...patch };
          obj.set({ left: t.centerXmm, top: t.centerYmm, angle: t.rotationDeg, scaleX: t.widthMm / obj.width, scaleY: t.heightMm / obj.height });
          obj.setCoords();
        }
        canvas.requestRenderAll();
      } else if (following && live.source === null) {
        // Committed or cancelled: re-place every object from the document.
        following = false;
        setRefreshTick((t) => t + 1);
      }
    });
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
    const zn = d ? artboardOf(d, z) : undefined;
    if (!zn || !ids.length) return;
    const rects = ids.map((id) => zn.layers[id]).filter(Boolean).map((l) => rotatedBounds(l.transform));
    if (!rects.length) return;
    zoomToRect(unionBounds(rects), 80);
    fitRef.current = false;
  }, [zoomToRect]);

  /** Make the canvas selection match the given layer ids (whole groups only). */
  const restoreSelection = useCallback((canvas: FabricCanvas, zn: LayerStack, ids: string[]) => {
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
      const v = canvas.viewportTransform;
      ctx.save();
      ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
      if (spec.areaId) {
        // A design area sits on the 3D garment, not on the flat: plain fabric round its print area.
        const m = Math.max(20, 0.15 * Math.max(spec.printableWidthMm, spec.printableHeightMm));
        ctx.fillStyle = partColor(cw, 'body');
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 1 / v[0];
        ctx.beginPath();
        ctx.roundRect(-m, -m, spec.printableWidthMm + 2 * m, spec.printableHeightMm + 2 * m, m * 0.4);
        ctx.fill();
        ctx.stroke();
      } else {
        const model = getGarment(d.garment.modelId);
        const sketch = sketchForZone(model, spec, getSize(model, d.garment.sizeCode).scale);
        drawSketch(ctx, sketch, cw, v[0] * (window.devicePixelRatio || 1));
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
      const zn = d ? artboardOf(d, z) : undefined;
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
      const zn = d ? artboardOf(d, zoneRef.current) : undefined;
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
      // Nothing selected here and nothing to clear: leave a selection made elsewhere (artwork
      // across seams, picked in 3D or the layer list) alone.
      if (!ids.length && !useStudio.getState().selectedLayerIds.length) return;
      useStudio.getState().select(ids);
    };
    canvas.on('selection:created', onSelection);
    canvas.on('selection:updated', onSelection);
    canvas.on('selection:cleared', onSelection);

    canvas.on('mouse:dblclick', (e) => {
      const id = e.target ? leaves(e.target)[0]?.layerId : undefined;
      if (id) window.dispatchEvent(new CustomEvent('wovexa:edit-layer', { detail: { layerId: id } }));
    });

    // ---- Context menu: right-click (spec DSK-03), long-press (MOB-05), Shift+F10 / Menu key ----
    const openMenuAt = (x: number, y: number, target?: FabricObject) => {
      const zn = latest.current.doc ? artboardOf(latest.current.doc, zoneRef.current) : undefined;
      if (zn) {
        const ids = target ? leaves(target).map((o) => o.layerId) : [];
        const current = useStudio.getState().selectedLayerIds;
        if (!ids.length) useStudio.getState().select([]);
        else if (!ids.every((id) => current.includes(id))) useStudio.getState().select(expandToGroups(zn, ids));
      }
      setMenu({ x, y });
    };
    canvas.on('contextmenu', (opt) => {
      const ev = opt.e as MouseEvent;
      openMenuAt(ev.clientX, ev.clientY, opt.target ?? undefined);
    });
    const onMenuKey = () => {
      const r = host.getBoundingClientRect();
      const { doc: d, selected: ids } = latest.current;
      const zn = d ? artboardOf(d, zoneRef.current) : undefined;
      const rects = zn ? ids.map((id) => zn.layers[id]).filter(Boolean).map((l) => rotatedBounds(l.transform)) : [];
      if (!rects.length) return setMenu({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      const b = unionBounds(rects);
      const v = canvas.viewportTransform;
      setMenu({ x: r.left + v[4] + (b.x + b.width / 2) * v[0], y: r.top + v[5] + (b.y + b.height / 2) * v[0] });
    };

    const upper = canvas.upperCanvasEl;
    const clampZoom = (z: number) => Math.min(ACTUAL_SIZE * 8, Math.max(ACTUAL_SIZE * 0.05, z));

    /** Abandon a drag in progress and put the object back where it started. */
    const cancelTransform = () => {
      const t = canvas._currentTransform;
      if (!t) return;
      const o = t.original;
      t.target.set({ left: o.left, top: o.top, scaleX: o.scaleX, scaleY: o.scaleY, angle: o.angle, flipX: o.flipX, flipY: o.flipY, skewX: o.skewX, skewY: o.skewY });
      t.target.setCoords();
      canvas._currentTransform = null;
      snapLines.current = {};
      useLive.getState().clear();
      canvas.requestRenderAll();
    };

    // ---- Pan: middle button, Space + drag, or one finger / stylus on empty canvas ----
    let spaceDown = false;
    let panning: { id: number; x: number; y: number } | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      // Space keeps activating buttons and typing spaces; it only pans from the page or the stage.
      const t = e.target as HTMLElement | null;
      if (t?.closest('button, a, input, textarea, select, [contenteditable="true"], [role="menuitem"], [role="tab"], [role="dialog"]')) return;
      spaceDown = e.type === 'keydown';
      canvas.defaultCursor = spaceDown ? 'grab' : 'default';
      canvas.skipTargetFind = spaceDown;
      canvas.selection = !spaceDown && !coarse;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    canvas.on('mouse:move', (opt: TPointerEventInfo) => {
      pointerRef.current = canvas.getScenePoint(opt.e);
      renderRulersRef.current();
    });
    canvas.on('mouse:out', () => {
      pointerRef.current = null;
      renderRulersRef.current();
    });

    // Wheel and trackpad: two-finger scroll pans, pinch (ctrl+wheel) zooms. Line and page
    // deltas (Firefox mouse wheels) are converted to pixels; Shift+wheel pans sideways.
    canvas.on('mouse:wheel', (opt) => {
      const ev = opt.e as WheelEvent;
      ev.preventDefault();
      ev.stopPropagation();
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? canvas.getHeight() : 1;
      let dx = ev.deltaX * unit;
      let dy = ev.deltaY * unit;
      if (ev.ctrlKey || ev.metaKey) {
        zoomBy(Math.min(2, Math.max(0.5, Math.exp(-dy * 0.0022))), canvas.getViewportPoint(ev));
        return;
      }
      if (ev.shiftKey && dx === 0) {
        dx = dy;
        dy = 0;
      }
      canvas.relativePan(new Point(-dx, -dy));
      fitRef.current = false;
      renderRulersRef.current();
    });

    // Safari reports trackpad pinch as gesture events instead of ctrl+wheel.
    let gestureZoom = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureZoom = canvas.getZoom();
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (pinch.size > 1) return; // touch pinches are handled by pointer events below
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      const rect = upper.getBoundingClientRect();
      canvas.zoomToPoint(new Point(g.clientX - rect.left, g.clientY - rect.top), clampZoom(gestureZoom * g.scale));
      fitRef.current = false;
      reportZoom();
    };
    const preventGesture = (e: Event) => e.preventDefault();
    host.addEventListener('gesturestart', onGestureStart);
    host.addEventListener('gesturechange', onGestureChange);
    host.addEventListener('gestureend', preventGesture);

    // Touch and pen: one finger on empty canvas pans, two fingers pinch-zoom (spec TAB-04),
    // a held press opens the context menu, and a double tap edits text.
    const pinch = new Map<number, { x: number; y: number }>();
    let pinchStart: { dist: number; zoom: number; mid: { x: number; y: number } } | null = null;
    let press: { id: number; x: number; y: number; at: number; event: PointerEvent; timer: ReturnType<typeof setTimeout> } | null = null;
    let lastTap: { at: number; x: number; y: number } | null = null;

    const onPointerDown = (e: PointerEvent) => {
      const empty = !canvas.findTarget(e).target;
      if (e.button === 1 || (spaceDown && e.button === 0) || (e.pointerType !== 'mouse' && e.isPrimary && empty)) {
        panning = { id: e.pointerId, x: e.clientX, y: e.clientY };
        if (e.button === 1) e.preventDefault(); // no autoscroll cursor
      }
      if (e.pointerType === 'mouse') return;
      pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size === 2) {
        const [a, b] = [...pinch.values()];
        pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: canvas.getZoom(), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        panning = null;
        cancelTransform();
        if (press) clearTimeout(press.timer);
        press = null;
      } else if (e.isPrimary) {
        const start = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), event: e };
        press = {
          ...start,
          timer: setTimeout(() => {
            if (!press) return;
            cancelTransform();
            panning = null;
            const target = canvas.findTarget(start.event).target;
            openMenuAt(start.x, start.y, target ?? undefined);
            press = null;
            lastTap = null;
          }, 550),
        };
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
        clearTimeout(press.timer);
        press = null;
      }
      if (pinch.has(e.pointerId)) pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.size === 2 && pinchStart) {
        const [a, b] = [...pinch.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const rect = upper.getBoundingClientRect();
        canvas.relativePan(new Point(mid.x - pinchStart.mid.x, mid.y - pinchStart.mid.y));
        canvas.zoomToPoint(new Point(mid.x - rect.left, mid.y - rect.top), clampZoom((pinchStart.zoom * dist) / pinchStart.dist));
        pinchStart.mid = mid;
        fitRef.current = false;
        reportZoom();
        return;
      }
      if (panning && e.pointerId === panning.id) {
        canvas.relativePan(new Point(e.clientX - panning.x, e.clientY - panning.y));
        panning.x = e.clientX;
        panning.y = e.clientY;
        fitRef.current = false;
        renderRulersRef.current();
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (panning?.id === e.pointerId) panning = null;
      pinch.delete(e.pointerId);
      if (pinch.size < 2) pinchStart = null;
      if (press && e.pointerId === press.id) {
        clearTimeout(press.timer);
        const now = performance.now();
        if (e.type === 'pointerup' && now - press.at < 300) {
          if (lastTap && now - lastTap.at < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
            const target = canvas.findTarget(e).target;
            const id = target ? leaves(target)[0]?.layerId : undefined;
            if (id) window.dispatchEvent(new CustomEvent('wovexa:edit-layer', { detail: { layerId: id } }));
            lastTap = null;
          } else {
            lastTap = { at: now, x: e.clientX, y: e.clientY };
          }
        }
        press = null;
      }
    };
    upper.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    const onZoomToSelection = () => zoomToSelection();
    const onFit = () => fit();
    const onZoomStep = (e: Event) => zoomBy((e as CustomEvent<number>).detail);
    window.addEventListener('wovexa:zoom-to-selection', onZoomToSelection);
    window.addEventListener('wovexa:fit', onFit);
    window.addEventListener('wovexa:zoom-step', onZoomStep);
    window.addEventListener('wovexa:open-context-menu', onMenuKey);

    const ro = new ResizeObserver(() => {
      canvas.setDimensions({ width: host.clientWidth, height: host.clientHeight });
      if (fitRef.current) fit();
      canvas.requestRenderAll();
    });
    ro.observe(host);
    setReady(true);
    // Development-only handle for checking zoom and pan from the console.
    if (process.env.NODE_ENV !== 'production') Object.assign(window, { __wovexa2d: { canvas } });

    const objects = objectsRef.current;
    const groups = groupsRef.current;
    return () => {
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('wovexa:zoom-to-selection', onZoomToSelection);
      window.removeEventListener('wovexa:fit', onFit);
      window.removeEventListener('wovexa:zoom-step', onZoomStep);
      window.removeEventListener('wovexa:open-context-menu', onMenuKey);
      host.removeEventListener('gesturestart', onGestureStart);
      host.removeEventListener('gesturechange', onGestureChange);
      host.removeEventListener('gestureend', preventGesture);
      upper.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (press) clearTimeout(press.timer);
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
      let bleed = 0;
      if (layer.content.kind === 'image' && !imageNeedsBitmap(layer)) {
        // Plain and adjusted images show the decoded (or adjusted) pixels directly, at full resolution.
        element = (imageSource(layer.content) as HTMLCanvasElement | HTMLImageElement | undefined) ?? placeholder();
      } else {
        const ppm = Math.min(resolution(), 2048 / Math.max(layer.transform.widthMm, layer.transform.heightMm));
        const ready = layer.content.kind === 'image' ? !!getLoadedImage(layer.content.assetId) : true;
        const s = layer.style;
        const key = JSON.stringify([layer.id, layer.content, s.finish, s.distress, s.shadow, s.outline, s.halftone, ready, Math.round(layer.transform.widthMm * ppm), Math.round(layer.transform.heightMm * ppm)]);
        if (obj.bitmapKey !== key || !obj.bitmap) {
          const rendered = renderLayerBitmap(layer, ppm);
          obj.bitmap = rendered.canvas;
          obj.bitmapBleed = rendered.bleed;
          obj.bitmapKey = key;
        }
        element = obj.bitmap;
        bleed = obj.bitmapBleed;
      }
      const boxW = Math.max(1, element.width - 2 * bleed);
      const boxH = Math.max(1, element.height - 2 * bleed);
      if (obj.getElement() !== element) obj.setElement(element, { width: boxW, height: boxH });
      obj.bleed = bleed;
      const t = layer.transform;
      obj.set({
        width: boxW,
        height: boxH,
        left: t.centerXmm,
        top: t.centerYmm,
        angle: t.rotationDeg,
        flipX: t.flipX,
        flipY: t.flipY,
        scaleX: t.widthMm / boxW,
        scaleY: t.heightMm / boxH,
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
        obj = new LayerImage(placeholder(), { originX: 'center', originY: 'center', ...controlStyle });
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
          // A selected layer that joins a new group (made copies, a paste) leaves the canvas for
          // it: release it without clearing the store's selection, and select the group once built.
          if (canvas.getActiveObjects().includes(obj)) {
            quietly(() => canvas.discardActiveObject());
            reselect = true;
          }
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
      <div
        ref={hostRef}
        className="absolute inset-0 touch-none overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
        tabIndex={0}
        role="application"
        aria-roledescription="design canvas"
        aria-label={`${zoneSpec?.label ?? ''} print zone editor`}
        aria-describedby="editor-help"
      >
        <canvas ref={canvasElRef} aria-hidden />
      </div>
      <p id="editor-help" className="sr-only">
        Choose layers in the Layers panel or press Ctrl+A. Arrow keys move the selection by 1 mm, with Shift by 10 mm. Shift+F10 opens actions. Plus and minus zoom, Shift+1 fits the print area.
      </p>
      {menu ? <EditorContextMenu x={menu.x} y={menu.y} onClose={closeMenu} /> : null}
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
        <button className="icon-btn" onClick={() => setPenOn((on) => !on)} aria-pressed={penOn} aria-label="Pen: draw a shape" title="Pen: draw your own shape (P)">
          <PenTool size={15} />
        </button>
      </div>
      {penOn && zone ? (
        <PenOverlay
          key={zoneId}
          fabric={getFabric}
          onFinish={(points) => {
            const shape = penShape(points);
            if (shape) addDrawnShape(shape.path, shape.box);
            setPenOn(false);
          }}
          onCancel={() => setPenOn(false)}
        />
      ) : null}
    </div>
  );
}
