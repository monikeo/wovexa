'use client';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { create } from 'zustand';

// ---- Layout mode (spec §21.1): pointer and width, not width alone ----

export type LayoutMode = 'mobile' | 'tablet' | 'desktop';

function subscribe(cb: () => void) {
  const queries = ['(min-width: 768px)', '(min-width: 1280px)'].map((q) => matchMedia(q));
  queries.forEach((q) => q.addEventListener('change', cb));
  return () => queries.forEach((q) => q.removeEventListener('change', cb));
}
function snapshot(): LayoutMode {
  if (matchMedia('(min-width: 1280px)').matches) return 'desktop';
  if (matchMedia('(min-width: 768px)').matches) return 'tablet';
  return 'mobile';
}
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, snapshot, () => 'desktop');
}

// ---- Toasts ----

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error' | 'success';
}
interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
}
let toastId = 0;
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(message, tone = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-2), { id, message, tone }] });
    setTimeout(() => get().dismiss(id), tone === 'error' ? 7000 : 3500);
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
export const toast = (message: string, tone?: Toast['tone']) => useToasts.getState().push(message, tone);

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
            t.tone === 'error' ? 'bg-danger text-white' : 'bg-inverse text-fg-inverse'
          }`}
        >
          <span className="flex-1">{t.message}</span>
          <button className="opacity-70 hover:opacity-100" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- Sheet: bottom sheet on phones, side drawer on tablets (spec MOB-03, TAB-03) ----

export function Sheet({
  open,
  onClose,
  title,
  side = 'bottom',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: 'bottom' | 'right' | 'left';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const position =
    side === 'bottom'
      ? 'inset-x-0 bottom-0 max-h-[78dvh] rounded-t-[var(--sheet-radius)] safe-bottom'
      : side === 'right'
        ? 'inset-y-0 right-0 w-[min(360px,92vw)]'
        : 'inset-y-0 left-0 w-[min(320px,88vw)]';
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0" style={{ background: 'var(--overlay-scrim)' }} onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`absolute flex flex-col overflow-hidden border-line bg-panel shadow-2xl outline-none ${position}`}
      >
        {side === 'bottom' ? <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden /> : null}
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h2 id={titleId} className="panel-title text-base">
            {title}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}

// ---- Confirm dialog for destructive actions ----

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" style={{ background: 'var(--overlay-scrim)' }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-sm rounded-2xl bg-panel p-5 shadow-2xl">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-fg-2">{body}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} className="btn btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Number field in physical units: commits on Enter or blur, Escape reverts ----

export function NumberField({
  label,
  value,
  onCommit,
  suffix,
  step = 1,
  min,
  max,
  decimals = 1,
  id,
  compact = false,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  id?: string;
  /** Short one-letter labels (X, Y, W, H) in a two-column grid. */
  compact?: boolean;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const format = (v: number) => (Number.isFinite(v) ? v.toFixed(decimals) : '');
  // While focused the field shows the user's draft; otherwise it always mirrors the document.
  const [draft, setDraft] = useState(format(value));
  const [focused, setFocused] = useState(false);
  const commit = () => {
    const n = parseFloat(draft.replace(',', '.'));
    if (!Number.isFinite(n)) return setDraft(format(value));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (Math.abs(clamped - value) > 1e-9) onCommit(clamped);
    setDraft(format(clamped));
  };
  return (
    <label htmlFor={inputId} className={`grid items-center ${compact ? 'grid-cols-[14px_1fr] gap-1.5' : 'grid-cols-[52px_1fr] gap-2'}`}>
      <span className="label">{label}</span>
      <span className="relative min-w-0">
        <input
          id={inputId}
          className={`field num ${suffix && suffix.length > 1 ? 'pr-9' : 'pr-6'}`}
          inputMode="decimal"
          value={focused ? draft : format(value)}
          onFocus={() => {
            setDraft(format(value));
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraft(format(value));
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value + delta));
              onCommit(next);
            }
          }}
        />
        {suffix ? <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-fg-3">{suffix}</span> : null}
      </span>
    </label>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  swatches,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  /** Brand palette shown as one-click swatches under the field. */
  swatches?: { name: string; hex: string }[];
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  // Follow outside changes (undo, colourway switch) unless the user is mid-edit.
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value);
  }
  return (
    <div className="grid grid-cols-[52px_1fr] items-center gap-2">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          className="h-[34px] w-10 flex-none cursor-pointer rounded-md border border-line bg-panel p-0.5"
          value={value.toLowerCase()}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <input
          id={id}
          className="field font-mono uppercase"
          value={draft}
          maxLength={7}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => (/^#[0-9a-f]{6}$/i.test(draft) ? onChange(draft.toUpperCase()) : setDraft(value))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      {swatches?.length ? (
        <div className="col-start-2 flex flex-wrap gap-1" role="group" aria-label={`${label}: brand colours`}>
          {swatches.map((s) => (
            <button
              key={s.hex + s.name}
              type="button"
              title={`${s.name} ${s.hex}`}
              aria-label={`Use ${s.name}`}
              aria-pressed={s.hex.toUpperCase() === value.toUpperCase()}
              onClick={() => onChange(s.hex.toUpperCase())}
              className="h-6 w-6 rounded-md border border-line aria-pressed:ring-2 aria-pressed:ring-[var(--focus-ring)] aria-pressed:ring-offset-1"
              style={{ background: s.hex }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
