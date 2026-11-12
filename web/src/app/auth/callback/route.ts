import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

/**
 * Where to go once signed in: a page of this site only, so a link can't send someone elsewhere.
 * Checked on the resolved address, since URL parsing drops tabs and line breaks ("/\t/x.com"
 * becomes "//x.com") and treats a backslash as a slash.
 */
function safeNext(value: string | null, origin: string) {
  if (value?.startsWith('/')) {
    try {
      const url = new URL(value, origin);
      if (url.origin === origin) return url;
    } catch {
      // Not an address: fall through to the dashboard.
    }
  }
  return new URL('/dashboard', origin);
}

/**
 * The sign-in email's link lands here: its one-time code is swapped for a session cookie, then on
 * to the page asked for. A link that expired, was used already or was opened in another browser
 * (the code only works where it was asked for) goes back to sign-in with a note.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get('next'), url.origin);
  const failed = new URL('/sign-in?error=link', url.origin);
  const supabase = await getServerSupabase();
  // Local mode has no accounts: carry on to the page.
  if (!supabase) return NextResponse.redirect(next);
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.has('error')) return NextResponse.redirect(failed);
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return NextResponse.redirect(error ? failed : next);
  } catch {
    // Supabase out of reach: back to sign-in rather than an error page.
    return NextResponse.redirect(failed);
  }
}
