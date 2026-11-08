import { connection, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';

/** Minimal readiness check with no secrets (spec §30). */
export async function GET() {
  await connection();
  return NextResponse.json(
    { status: 'ok', service: 'wovexa-web', cloudSync: isSupabaseConfigured() ? 'configured' : 'local-only', time: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
