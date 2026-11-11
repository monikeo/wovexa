'use client';
/** The brand kit linked to the open project, loaded once and shared by the studio panels. */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BRAND_KIT_CHANGED, getBrandKit, type BrandKit } from '@/lib/local-db';
import { useStudio } from '@/stores/studio-store';

const BrandKitContext = createContext<BrandKit | null>(null);

export function BrandKitProvider({ children }: { children: ReactNode }) {
  const brandKitId = useStudio((s) => s.document?.brandKitId);
  const [kit, setKit] = useState<BrandKit | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (!brandKitId) return Promise.resolve(null);
      return getBrandKit(brandKitId).then((k) => k ?? null, () => null);
    };
    load().then((k) => alive && setKit(k));
    // Brand kits can be edited in another tab or page; refresh when the studio regains focus, and
    // at once when this tab saves one (a lockup saved to the kit, say).
    const onFocus = () => load().then((k) => alive && setKit(k));
    const onChanged = (e: Event) => {
      if ((e as CustomEvent<{ kitId: string }>).detail?.kitId === brandKitId) void onFocus();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener(BRAND_KIT_CHANGED, onChanged);
    return () => {
      alive = false;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(BRAND_KIT_CHANGED, onChanged);
    };
  }, [brandKitId]);
  return <BrandKitContext.Provider value={brandKitId ? kit : null}>{children}</BrandKitContext.Provider>;
}

export function useBrandKit() {
  return useContext(BrandKitContext);
}
