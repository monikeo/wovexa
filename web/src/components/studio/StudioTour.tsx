'use client';
/**
 * The first-visit studio walkthrough (spec ACC-03): four tips, dismissible at any point and
 * never shown again on this device. Tips only; it never changes the design.
 */
import { Clapperboard, Move, Search, Type, X } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { useModKey } from './CommandPalette';

const KEY = 'wovexa.studio-tour';
const listeners = new Set<() => void>();

function useSeen() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => {
      try {
        return localStorage.getItem(KEY) === '1';
      } catch {
        return true;
      }
    },
    () => true,
  );
}

function dismiss() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {}
  listeners.forEach((l) => l());
}

const TIPS = [
  { Icon: Type, title: 'Design in 2D', body: 'Add text, images and shapes from the tools. Everything is measured in millimetres on the real print area, and print checks run as you work.' },
  { Icon: Move, title: 'Place it on the garment', body: 'In the 3D view, switch to Place to drag, resize and turn artwork right on the shirt. Orbit looks around without moving anything.' },
  { Icon: Clapperboard, title: 'Render and hand off', body: 'Wovexa Render makes product shots and turntable video. Export gives print-ready files, a manifest and the tech pack.' },
  {
    Icon: Search,
    title: 'Find any action by name',
    body: (open: string) => `${open} and type what you want: add a star, align left, wear a hoodie, export. Colourways show on the garment as you pass them.`,
  },
];

export function StudioTour({ mobile }: { mobile: boolean }) {
  const seen = useSeen();
  const mod = useModKey();
  const [i, setI] = useState(0);
  if (seen) return null;
  const tip = TIPS[i];
  const body = typeof tip.body === 'string' ? tip.body : tip.body(mobile ? 'Tap ⋯ then Find an action' : `Press ${mod}+K`);
  return (
    <div
      role="dialog"
      aria-label="Studio tips"
      className={`fixed z-40 w-[min(340px,calc(100vw-1.5rem))] rounded-xl border border-line bg-floating p-4 shadow-xl ${mobile ? 'bottom-[calc(8.5rem+env(safe-area-inset-bottom))] left-3' : 'bottom-16 left-[calc(var(--toolrail-width)+1rem)]'}`}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-selected text-accent">
          <tip.Icon size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-fg-3">
            Tip {i + 1} of {TIPS.length}
          </p>
          <h2 className="text-sm font-semibold">{tip.title}</h2>
          <p className="mt-1 text-xs text-fg-2">{body}</p>
        </div>
        <button className="icon-btn h-8 w-8 flex-none" onClick={dismiss} aria-label="Close tips">
          <X size={15} />
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {i > 0 ? (
          <button className="btn btn-ghost min-h-8 px-3 text-xs" onClick={() => setI(i - 1)}>
            Back
          </button>
        ) : null}
        <button className="btn btn-primary min-h-8 px-3 text-xs" onClick={() => (i < TIPS.length - 1 ? setI(i + 1) : dismiss())}>
          {i < TIPS.length - 1 ? 'Next tip' : 'Got it'}
        </button>
      </div>
    </div>
  );
}
