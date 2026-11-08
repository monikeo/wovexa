'use client';
/**
 * Per-viewer preferences (spec ACC-04). Stored in localStorage: they are conveniences for
 * this device and never part of the shared design document.
 */
import { useSyncExternalStore } from 'react';

export interface Preferences {
  units: 'mm' | 'in';
  theme: 'system' | 'light' | 'dark';
  quality: 'auto' | 'low' | 'medium' | 'high';
}

const DEFAULTS: Preferences = { units: 'mm', theme: 'system', quality: 'auto' };
const listeners = new Set<() => void>();

function read<K extends keyof Preferences>(key: K): Preferences[K] {
  try {
    const v = localStorage.getItem(`wovexa.${key}`);
    return (v ?? DEFAULTS[key]) as Preferences[K];
  } catch {
    return DEFAULTS[key];
  }
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  try {
    if (value === DEFAULTS[key] || (key === 'quality' && value === 'auto')) localStorage.removeItem(`wovexa.${key}`);
    else localStorage.setItem(`wovexa.${key}`, value);
  } catch {}
  if (key === 'theme') {
    const root = document.documentElement;
    if (value === 'system') delete root.dataset.theme;
    else root.dataset.theme = value;
  }
  listeners.forEach((l) => l());
}

export function usePreference<K extends keyof Preferences>(key: K): Preferences[K] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(key),
    () => DEFAULTS[key],
  );
}
