'use client';
import { useEffect } from 'react';

/**
 * Registers the offline service worker in production builds only (spec §23).
 * In development it unregisters any leftover worker so stale caches never hide code changes.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      return;
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Offline support is an enhancement; the app works without it.
    });
  }, []);
  return null;
}
