import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/supabase/config';

/**
 * Refreshes the Supabase session cookie on each request (Next 16 `proxy`, formerly middleware).
 * Does nothing in local mode. Authorization is enforced by RLS and route handlers, not here.
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured()) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  try {
    await supabase.auth.getUser();
  } catch {
    // Supabase out of reach: the page still opens (projects live on the device); the session is
    // refreshed on a later request.
  }
  return response;
}

export const config = {
  // Not for files anyone may fetch: the 3D model library and its views, the health check, static files.
  matcher: ['/((?!_next/static|_next/image|api/models|api/health|brand/|icons/|sw.js|manifest.webmanifest|favicon|.*\\.(?:svg|png|jpg|jpeg|webp|ico|glb)$).*)'],
};
