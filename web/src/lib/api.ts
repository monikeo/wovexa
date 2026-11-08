import 'server-only';
import { NextResponse } from 'next/server';
import { getServerSupabase } from './supabase/server';

/** Structured API errors (spec §30: typed error codes, no stack traces). */
export function apiError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Resolve the signed-in user, or a ready-made error response. */
export async function requireUser() {
  const supabase = await getServerSupabase();
  if (!supabase) {
    return { error: apiError(503, 'backend_not_configured', 'Cloud sync is not configured for this deployment. Projects are saved locally in the browser.') } as const;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { error: apiError(401, 'unauthenticated', 'Sign in to sync projects.') } as const;
  return { supabase, user: data.user } as const;
}

/** Reject cross-site state-changing requests (spec SEC-09, CSRF mitigation alongside SameSite cookies). */
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
