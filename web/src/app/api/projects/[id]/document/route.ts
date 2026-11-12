import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, requireUser, sameOrigin } from '@/lib/api';
import { parseDesignDocument } from '@/domain/schema';
import { readJsonBody } from '@/lib/request-body';

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

/** GET: the current validated document for a project the user can read. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return apiError(400, 'invalid_id', 'Unknown project id.');
  const auth = await requireUser();
  if ('error' in auth) return auth.error;
  // A deleted project's document stays in the table until it's purged, but isn't served.
  const { data, error } = await auth.supabase
    .from('project_documents')
    .select('revision, schema_version, design_state, updated_at, projects!inner(deleted_at)')
    .eq('project_id', id)
    .is('projects.deleted_at', null)
    .maybeSingle();
  if (error) return apiError(500, 'query_failed', 'The project could not be loaded.');
  if (!data) return apiError(404, 'not_found', 'Project not found or not shared with you.');
  const { revision, schema_version, design_state, updated_at } = data;
  return NextResponse.json({ revision, schema_version, design_state, updated_at }, { headers: { 'Cache-Control': 'no-store' } });
}

const putBody = z.object({ expectedRevision: z.number().int().min(0), document: z.unknown() });

/**
 * PUT: save with optimistic concurrency (spec §29.5). The database function checks the
 * expected revision and the caller's editor role in one transaction, and returns 409 with
 * the server revision on conflict so the client can offer keep, compare or duplicate.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return apiError(400, 'invalid_id', 'Unknown project id.');
  if (!sameOrigin(request)) return apiError(403, 'cross_origin', 'Cross-site requests are not allowed.');
  const auth = await requireUser();
  if ('error' in auth) return auth.error;
  // Counted as it arrives: a missing or false Content-Length can't get a bigger body read.
  const raw = await readJsonBody(request, MAX_DOCUMENT_BYTES);
  if (!raw.ok && raw.reason === 'too_large') return apiError(413, 'too_large', 'This design is larger than the 2 MB document limit.');
  const body = putBody.safeParse(raw.ok ? raw.value : null);
  if (!body.success) return apiError(400, 'invalid_body', 'Send expectedRevision and document.');
  const parsed = parseDesignDocument(body.data.document);
  if (!parsed.ok) return apiError(422, 'invalid_document', 'The design failed validation.', { details: parsed.errors });
  if (parsed.document.projectId !== id) return apiError(422, 'project_mismatch', 'The document belongs to another project.');

  const { data, error } = await auth.supabase.rpc('save_project_document', {
    p_project_id: id,
    p_expected_revision: body.data.expectedRevision,
    p_document: parsed.document,
  });
  if (error) {
    if (error.message.includes('revision_conflict')) {
      return apiError(409, 'revision_conflict', 'Someone saved a newer version of this project.', { serverRevision: Number(error.details) || null });
    }
    if (error.code === '42501' && error.message.includes('approved')) {
      return apiError(403, 'approved', 'This project is approved, so its design is frozen. Duplicate it to keep editing.');
    }
    if (error.code === '42501') return apiError(403, 'forbidden', 'You can view this project but not edit it.');
    if (error.code === 'P0002') return apiError(404, 'not_found', 'This project was deleted or isn’t shared with you.');
    return apiError(500, 'save_failed', 'The project could not be saved.');
  }
  return NextResponse.json({ revision: data }, { headers: { 'Cache-Control': 'no-store' } });
}
