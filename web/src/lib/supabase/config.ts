/**
 * Supabase is optional. Without these variables WOVEXA runs in local mode (IndexedDB only).
 * Only the publishable key is ever exposed to the browser; the service role key must never
 * appear in client code, PWA caches or NEXT_PUBLIC_ variables (spec SEC-02).
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export function isSupabaseConfigured() {
  return SUPABASE_URL.startsWith('https://') && SUPABASE_PUBLISHABLE_KEY.length > 20;
}
