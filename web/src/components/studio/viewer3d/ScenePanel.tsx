'use client';
/**
 * Scene and camera (spec ED3-06, ED3-09, ED3-10, MED-02, MED-03, MED-07): lighting look,
 * exposure, light direction, floor shadow, backdrop, lens, saved views (kept in the project)
 * and saved looks (kept on this device, reusable across projects).
 */
import { Bookmark, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as cmd from '@/domain/commands';
import { newId } from '@/domain/factory';
import { DRAPES, drapeOf, MOTIONS, motionOf, SCENE_PRESETS, sceneOf, STAGES, stageOf, toneOf, TONES } from '@/domain/scene';
import type { Scene } from '@/domain/schema';
import { AssetError, importImageFile, loadAssetImage } from '@/lib/assets';
import { deleteScene, listScenes, saveScene, type StoredScene } from '@/lib/local-db';
import { ColorField, toast, trapTab } from '@/components/ui/primitives';
import { useStudio } from '@/stores/studio-store';
import { viewerApi } from './stage';

function Slider({ id, label, value, min, max, step, format, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div className="grid grid-cols-[72px_1fr_48px] items-center gap-2">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 accent-[var(--accent)]" aria-valuetext={format(value)} />
      <span className="num text-right text-xs text-fg-2">{format(value)}</span>
    </div>
  );
}

function lensName(fov: number) {
  return fov < 24 ? 'Tele' : fov <= 40 ? 'Normal' : 'Wide';
}

export function ScenePanel({ onClose, compact }: { onClose: () => void; compact?: boolean }) {
  const doc = useStudio((s) => s.document);
  const dispatch = useStudio((s) => s.dispatch);
  const scene = sceneOf(doc);
  // A GLB shell keeps its own modelled folds; the drape setting applies to built-in shapes only.
  const ownFolds = doc?.garment.shape?.kind === 'shell' && doc.garment.shape.modelId === doc.garment.modelId;
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [looks, setLooks] = useState<StoredScene[]>([]);
  const [viewName, setViewName] = useState('');
  const [lookName, setLookName] = useState('');

  useEffect(() => {
    listScenes().then(setLooks, () => {});
    ref.current?.querySelector<HTMLElement>('button[aria-pressed="true"], button')?.focus();
  }, []);

  if (!doc) return null;

  const set = (patch: Partial<Omit<Scene, 'cameras'>>, label: string, gesture?: string) => {
    const command = cmd.updateScene(scene, patch, label);
    dispatch(gesture ? cmd.coalescing(command, `scene:${gesture}`) : command);
  };

  const choose = (id: string) => {
    const preset = SCENE_PRESETS.find((p) => p.id === id)!;
    set({ presetId: id, ...preset.defaults }, `Scene: ${preset.label}`);
  };

  const saveView = () => {
    const camera = viewerApi.currentCamera?.();
    if (!camera) return;
    const name = (viewName.trim() || `View ${scene.cameras.length + 1}`).slice(0, 40);
    dispatch(cmd.addCameraBookmark(scene, { id: newId(), name, ...camera }));
    setViewName('');
    toast(`Saved view "${name}". It renders in Wovexa Render too.`, 'success');
  };

  const saveLook = async () => {
    const name = lookName.trim() || `Look ${looks.length + 1}`;
    const { cameras: _cameras, ...look } = scene;
    void _cameras;
    try {
      const stored = await saveScene(name, look);
      setLooks((l) => [stored, ...l]);
      setLookName('');
      toast(`Saved look "${stored.name}" on this device.`, 'success');
    } catch {
      toast('The look couldn’t be saved: this browser’s storage refused it.', 'error');
    }
  };

  const applyLook = (look: StoredScene) => set({ ...look.scene }, `Scene: ${look.name}`);

  const removeLook = async (look: StoredScene) => {
    try {
      await deleteScene(look.id);
      setLooks((l) => l.filter((x) => x.id !== look.id));
    } catch {
      toast('The look couldn’t be removed: this browser’s storage refused the change.', 'error');
    }
  };

  const b = scene.backdrop;
  const motion = motionOf(scene);

  const setBackdropImage = async (file: File) => {
    try {
      const asset = await importImageFile(file);
      await loadAssetImage(asset.id);
      set({ backdrop: { ...b, kind: 'image', assetId: asset.id } }, 'Backdrop image');
    } catch (error) {
      toast(error instanceof AssetError ? error.message : 'That image could not be used as a backdrop.', 'error');
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Scene and camera"
      // Narrow stages (phones, split view) dock it low so the garment stays visible above it.
      className={`absolute z-20 flex flex-col overflow-hidden rounded-xl border border-line bg-floating shadow-xl ${
        compact ? 'inset-x-2 bottom-2 top-[40%]' : 'inset-x-2 bottom-24 top-[40%] @[44rem]:inset-x-auto @[44rem]:bottom-16 @[44rem]:right-3 @[44rem]:top-3 @[44rem]:w-[300px]'
      }`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
        if (ref.current) trapTab(e, ref.current);
      }}
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <h2 className="panel-title">Scene and camera</h2>
        <button className="icon-btn h-8 w-8" onClick={onClose} aria-label="Close scene panel">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <section className="space-y-2">
          <h3 className="label font-semibold text-fg">Look</h3>
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Lighting look">
            {SCENE_PRESETS.map((p) => (
              <button
                key={p.id}
                className="touch-hit rounded-lg border border-line px-2.5 py-2 text-left text-xs font-semibold hover:bg-hover aria-pressed:border-[var(--accent)] aria-pressed:bg-selected"
                aria-pressed={scene.presetId === p.id}
                onClick={() => choose(p.id)}
                title={p.description}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-fg-3">{SCENE_PRESETS.find((p) => p.id === scene.presetId)?.description}</p>
          <div className="seg" role="group" aria-label="Tone">
            {TONES.map((t) => (
              <button key={t.id} aria-pressed={toneOf(scene) === t.id} onClick={() => set({ tone: t.id }, `Tone: ${t.label.toLowerCase()}`)} title={t.description}>
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-fg-3">{TONES.find((t) => t.id === toneOf(scene))?.description}</p>
          <Slider id="scene-exposure" label="Exposure" value={scene.exposure} min={0.4} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ exposure: v }, 'Exposure', 'exposure')} />
          <Slider id="scene-rotation" label="Light angle" value={scene.envRotationDeg} min={-180} max={180} step={5} format={(v) => `${v}°`} onChange={(v) => set({ envRotationDeg: v }, 'Light angle', 'rotation')} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={scene.shadows} onChange={(e) => set({ shadows: e.target.checked }, e.target.checked ? 'Show floor shadow' : 'Hide floor shadow')} />
            Floor shadow
          </label>
        </section>

        <section className="space-y-2">
          <h3 className="label font-semibold text-fg">Stage</h3>
          <div className="seg" role="group" aria-label="What the garment is shown on">
            {STAGES.map((s) => (
              <button key={s.id} aria-pressed={stageOf(scene) === s.id} onClick={() => set({ stage: s.id === 'none' ? undefined : s.id }, `Stage: ${s.label.toLowerCase()}`)} title={s.description}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-fg-3">{STAGES.find((s) => s.id === stageOf(scene))?.description}</p>
        </section>

        <section className="space-y-2">
          <h3 className="label font-semibold text-fg">Drape</h3>
          <div className="seg" role="group" aria-label="Drape">
            {DRAPES.map((d) => (
              <button key={d.id} aria-pressed={drapeOf(scene) === d.id} disabled={ownFolds} onClick={() => set({ drape: d.id }, `Drape: ${d.label.toLowerCase()}`)} title={d.description}>
                {d.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-fg-3">{ownFolds ? 'Your 3D model keeps the folds it was made with.' : DRAPES.find((d) => d.id === drapeOf(scene))?.description}</p>
        </section>

        <section className="space-y-2">
          <h3 className="label font-semibold text-fg">Motion</h3>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label="Garment motion">
            {MOTIONS.map((m) => (
              <button
                key={m.id}
                className="touch-hit rounded-lg border border-line px-1 py-1.5 text-xs font-semibold hover:bg-hover aria-pressed:border-[var(--accent)] aria-pressed:bg-selected"
                aria-pressed={motion.kind === m.id}
                onClick={() => set({ motion: { ...motion, kind: m.id } }, `Motion: ${m.label.toLowerCase()}`)}
                title={m.description}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-fg-3">{MOTIONS.find((m) => m.id === motion.kind)?.description}</p>
          {motion.kind !== 'still' ? (
            <>
              <Slider id="scene-speed" label="Speed" value={motion.speed} min={0.25} max={2.5} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ motion: { ...motion, speed: v } }, 'Motion speed', 'speed')} />
              <p className="text-[11px] text-fg-3">Videos from Wovexa Render play this motion. It pauses while you place artwork.</p>
            </>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="label font-semibold text-fg">Backdrop</h3>
          <div className="seg" role="group" aria-label="Backdrop type">
            {(['transparent', 'solid', 'gradient', 'image'] as const).map((kind) => (
              <button
                key={kind}
                aria-pressed={b.kind === kind}
                onClick={() => (kind === 'image' && !b.assetId ? fileRef.current?.click() : set({ backdrop: { ...b, kind } }, 'Backdrop'))}
              >
                {kind === 'transparent' ? 'None' : kind === 'solid' ? 'Solid' : kind === 'gradient' ? 'Gradient' : 'Image'}
              </button>
            ))}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void setBackdropImage(f);
              e.target.value = '';
            }}
          />
          {b.kind !== 'transparent' ? <ColorField label={b.kind === 'gradient' ? 'Centre' : b.kind === 'image' ? 'Behind' : 'Colour'} value={b.color} onChange={(color) => set({ backdrop: { ...b, color } }, 'Backdrop colour', 'backdrop1')} /> : null}
          {b.kind === 'gradient' ? <ColorField label="Edge" value={b.color2} onChange={(color2) => set({ backdrop: { ...b, color2 } }, 'Backdrop colour', 'backdrop2')} /> : null}
          {b.kind === 'image' ? (
            <button className="btn btn-outline min-h-8 w-full text-xs" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={14} /> {b.assetId ? 'Replace backdrop image' : 'Choose a backdrop image'}
            </button>
          ) : null}
          {b.kind === 'image' ? <p className="text-[11px] text-fg-3">Fills the frame behind the garment, in the view and in every render.</p> : null}
          {b.kind === 'transparent' ? <p className="text-[11px] text-fg-3">Renders keep a transparent background in PNG and WebP.</p> : null}
        </section>

        <section className="space-y-2">
          <h3 className="label font-semibold text-fg">Camera</h3>
          <Slider id="scene-fov" label="Lens" value={scene.fovDeg} min={15} max={60} step={1} format={(v) => `${v}° ${lensName(v)}`} onChange={(v) => set({ fovDeg: v }, 'Lens', 'fov')} />
          <p className="text-[11px] text-fg-3">A longer lens (smaller angle) flattens perspective, like a product photographer’s.</p>
          <h4 className="label pt-1">Saved views</h4>
          {scene.cameras.length ? (
            <ul className="space-y-1">
              {scene.cameras.map((c) => (
                <li key={c.id} className="flex items-center gap-1">
                  <button className="touch-hit flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover" onClick={() => viewerApi.flyTo?.({ kind: 'bookmark', bookmark: c })} title="Go to this view">
                    <Bookmark size={14} className="flex-none text-fg-3" />
                    <span className="truncate">{c.name}</span>
                    <span className="num ml-auto flex-none text-[11px] text-fg-3">{c.fovDeg}°</span>
                  </button>
                  <button className="icon-btn h-8 w-8 text-fg-2" onClick={() => dispatch(cmd.removeCameraBookmark(c.id))} aria-label={`Delete saved view ${c.name}`}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-fg-3">Orbit to an angle you like, then save it. Saved views stay with this project.</p>
          )}
          <div className="flex gap-1.5">
            <input className="field" value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Name this view" aria-label="New view name" maxLength={40} onKeyDown={(e) => e.key === 'Enter' && saveView()} />
            <button className="btn btn-outline flex-none px-3 text-xs" onClick={saveView} disabled={scene.cameras.length >= 12}>
              <Plus size={14} /> Save
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="label font-semibold text-fg">Saved looks</h3>
          <p className="text-[11px] text-fg-3">Lighting, backdrop and lens you can reuse in any project on this device.</p>
          {looks.length ? (
            <ul className="space-y-1">
              {looks.map((look) => (
                <li key={look.id} className="flex items-center gap-1">
                  <button className="touch-hit min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover" onClick={() => applyLook(look)}>
                    {look.name}
                  </button>
                  <button className="icon-btn h-8 w-8 text-fg-2" onClick={() => void removeLook(look)} aria-label={`Delete saved look ${look.name}`}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-1.5">
            <input className="field" value={lookName} onChange={(e) => setLookName(e.target.value)} placeholder="Name this look" aria-label="New look name" maxLength={40} onKeyDown={(e) => e.key === 'Enter' && void saveLook()} />
            <button className="btn btn-outline flex-none px-3 text-xs" onClick={() => void saveLook()}>
              <Plus size={14} /> Save
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
