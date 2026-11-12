-- ---------------------------------------------------------------------------
-- Saves only through the database functions.
--
-- A signed-in client can write tables straight through the database API, and the policies
-- alone let a designer:
--   * write project_documents without save_project_document, skipping the revision check
--     and the freeze on approved projects;
--   * set projects.current_revision, so the next saves conflict or skip revisions;
--   * insert a project directly, with no document, already approved or at any revision;
--   * reopen an approved project (status away from 'approved') and then edit it;
-- and the old member-update policy checked the new row's role, not the row being changed,
-- so an admin could demote or suspend the organization's owner.
--
-- create_project and save_project_document now switch a transaction-local setting on while
-- they write (and off again after, so nothing later in the same transaction inherits it), and
-- the guards below refuse those writes from the database API's roles without it. The service
-- role and maintenance connections keep direct access to documents.
-- Status: tested with the checks below in PGlite (Postgres in WebAssembly) with stand-ins for
-- Supabase's auth and storage schemas; not yet applied to a live project.
-- ---------------------------------------------------------------------------

-- Documents: written only by create_project and save_project_document.
create or replace function public.guard_document_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and coalesce(current_setting('wovexa.document_write', true), '') <> 'on' then
    raise exception 'save documents through save_project_document' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_document_write
before insert or update on public.project_documents
for each row execute function public.guard_document_write();

-- Projects: created only by create_project, so each has its document from the start, begins
-- as a draft at revision 0, and has the creator and organization the function checked.
create or replace function public.guard_project_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and coalesce(current_setting('wovexa.document_write', true), '') <> 'on' then
    raise exception 'create projects through create_project' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_project_insert
before insert on public.projects
for each row execute function public.guard_project_insert();

-- Updates: as before, plus the revision moves only with a save, approval can't be undone by a
-- plain update (an approved design stays frozen), and the creation time stays put.
create or replace function public.guard_project_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.org_id <> old.org_id or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'project ownership columns are immutable' using errcode = '42501';
  end if;
  if (new.status = 'approved') <> (old.status = 'approved')
     and coalesce(current_setting('wovexa.approving', true), '') <> 'on' then
    raise exception 'approve and reopen projects through the review workflow' using errcode = '42501';
  end if;
  if new.current_revision <> old.current_revision
     and current_user in ('anon', 'authenticated')
     and coalesce(current_setting('wovexa.document_write', true), '') <> 'on' then
    raise exception 'the revision changes only when the document is saved' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- RPC: create a project and its first document atomically (unchanged apart from the setting).
create or replace function public.create_project(p_project_id uuid, p_org_id uuid, p_title text, p_document jsonb)
returns public.projects
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := p_org_id;
  v_project public.projects;
begin
  if v_org is null then
    select o.id into v_org
    from public.organizations o
    where o.owner_id = (select auth.uid()) and o.personal
    limit 1;
  end if;
  if v_org is null or not public.has_org_role(v_org, array['owner', 'admin', 'designer']::public.member_role[]) then
    raise exception 'not allowed to create projects here' using errcode = '42501';
  end if;
  if (p_document ->> 'projectId') is distinct from p_project_id::text then
    raise exception 'document belongs to another project' using errcode = '22023';
  end if;

  perform set_config('wovexa.document_write', 'on', true);

  insert into public.projects (id, org_id, created_by, title)
  values (p_project_id, v_org, (select auth.uid()), p_title)
  returning * into v_project;

  insert into public.project_documents (project_id, revision, schema_version, design_state, updated_by)
  values (p_project_id, 0, (p_document ->> 'schemaVersion')::int, p_document, (select auth.uid()));

  perform set_config('wovexa.document_write', 'off', true);
  return v_project;
end;
$$;

-- RPC: save with optimistic concurrency (as in 20261110000000, plus the setting, and a project
-- whose document row is missing is reported instead of moving its revision on alone).
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

  perform set_config('wovexa.document_write', 'on', true);

  update public.project_documents
  set revision = v_current + 1,
      schema_version = (p_document ->> 'schemaVersion')::int,
      design_state = jsonb_set(p_document, '{revision}', to_jsonb(v_current + 1)),
      updated_by = (select auth.uid()),
      updated_at = now()
  where project_id = p_project_id;

  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  update public.projects
  set current_revision = v_current + 1,
      title = left(coalesce(nullif(p_document ->> 'title', ''), title), 120)
  where id = p_project_id;

  perform set_config('wovexa.document_write', 'off', true);
  return v_current + 1;
end;
$$;

revoke execute on function public.create_project(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.save_project_document(uuid, integer, jsonb) from public, anon;
grant execute on function public.create_project(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.save_project_document(uuid, integer, jsonb) to authenticated;

-- Members: owners and admins change other members' roles and status, never the owner's row.
drop policy "admins change members" on public.organization_members;
create policy "admins change members" on public.organization_members for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.member_role[])
         and user_id <> (select auth.uid()) and role <> 'owner')
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.member_role[])
              and user_id <> (select auth.uid()) and role <> 'owner');

-- ---------------------------------------------------------------------------
-- Checks to run after applying, as a designer of a project unless noted:
--   1. insert into or update project_documents directly: expect 42501.
--   2. update projects set current_revision = 99: expect 42501.
--   3. insert into projects directly: expect 42501. create_project still works.
--   4. save_project_document twice with the same expected revision: the second raises
--      revision_conflict, and current_revision moved by one.
--   5. On an approved project, update projects set status = 'draft': expect 42501.
--   6. As an admin, update organization_members set role = 'designer' on the owner's row:
--      expect 0 rows changed.
-- ---------------------------------------------------------------------------
