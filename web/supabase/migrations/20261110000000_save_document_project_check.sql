-- ---------------------------------------------------------------------------
-- save_project_document can be called straight through the database API, not only through
-- the app's route, so it checks for itself that the document is this project's (as
-- create_project already does). Otherwise identical to the initial version.
-- ---------------------------------------------------------------------------
create or replace function public.save_project_document(p_project_id uuid, p_expected_revision integer, p_document jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current integer;
  v_org uuid;
  v_status text;
begin
  if (p_document ->> 'projectId') is distinct from p_project_id::text then
    raise exception 'document belongs to another project' using errcode = '22023';
  end if;

  select p.current_revision, p.org_id, p.status
    into v_current, v_org, v_status
  from public.projects p
  where p.id = p_project_id and p.deleted_at is null
  for update;

  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_org, array['owner', 'admin', 'designer']::public.member_role[]) then
    raise exception 'not allowed to edit this project' using errcode = '42501';
  end if;
  if v_status = 'approved' then
    raise exception 'approved versions are frozen; duplicate to keep editing' using errcode = '42501';
  end if;
  if v_current <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = 'P0001', detail = v_current::text;
  end if;

  update public.project_documents
  set revision = v_current + 1,
      schema_version = (p_document ->> 'schemaVersion')::int,
      design_state = jsonb_set(p_document, '{revision}', to_jsonb(v_current + 1)),
      updated_by = (select auth.uid()),
      updated_at = now()
  where project_id = p_project_id;

  update public.projects
  set current_revision = v_current + 1,
      title = left(coalesce(nullif(p_document ->> 'title', ''), title), 120)
  where id = p_project_id;

  return v_current + 1;
end;
$$;

revoke execute on function public.save_project_document(uuid, integer, jsonb) from public, anon;
grant execute on function public.save_project_document(uuid, integer, jsonb) to authenticated;
