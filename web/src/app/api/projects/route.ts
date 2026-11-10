import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createDocument } from '@/domain/factory';
import { apiError, requireUser, sameOrigin } from '@/lib/api';
import { readJsonBody } from '@/lib/request-body';

/** GET: the signed-in user's projects (RLS limits rows to their organizations). */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ('error' in auth) return auth.error;
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const { data, error } = await auth.supabase
    .from('projects')
    .select('id, org_id, title, status, current_revision, updated_at, created_at')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) return apiError(500, 'query_failed', 'Projects could not be loaded.');
  return NextResponse.json({ projects: data }, { headers: { 'Cache-Control': 'no-store' } });
}

const createBody = z.object({
  title: z.string().trim().min(1).max(120),
  orgId: z.string().uuid().optional(),
});

/** POST: create a project with an empty canonical document, atomically, via RPC. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return apiError(403, 'cross_origin', 'Cross-site requests are not allowed.');
  const auth = await requireUser();
  if ('error' in auth) return auth.error;
  // A title and an id need a few hundred bytes; nothing bigger is read.
  const raw = await readJsonBody(request, 4096);
  if (!raw.ok && raw.reason === 'too_large') return apiError(413, 'too_large', 'Send a title of 1 to 120 characters.');
  const parsed = createBody.safeParse(raw.ok ? raw.value : null);
  if (!parsed.success) return apiError(400, 'invalid_body', 'Send a title of 1 to 120 characters.');

  const projectId = crypto.randomUUID();
  const document = createDocument({ projectId, title: parsed.data.title });
  const { data, error } = await auth.supabase.rpc('create_project', {
    p_project_id: projectId,
    p_org_id: parsed.data.orgId ?? null,
    p_title: parsed.data.title,
    p_document: document,
  });
  if (error) return apiError(error.code === '42501' ? 403 : 500, 'create_failed', 'The project could not be created.');
  return NextResponse.json({ project: data, document }, { status: 201 });
}
