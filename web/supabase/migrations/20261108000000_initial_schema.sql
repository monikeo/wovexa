-- WOVEXA initial schema (spec §29). Every user-facing table has RLS (spec §29.3).
-- Apply with `supabase db push`, or paste into the Supabase SQL editor of a NEW project.
-- Status: written against the spec, not yet applied to a live project. Run the checks at
-- the bottom in a branch or local stack before production.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'designer', 'reviewer', 'production', 'guest');
create type public.member_status as enum ('active', 'invited', 'suspended');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,48}$'),
  owner_id uuid not null references auth.users (id),
  billing_plan text not null default 'starter' check (billing_plan in ('starter', 'creator', 'studio', 'enterprise')),
  personal boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'designer',
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  created_by uuid not null references auth.users (id),
  title text not null check (char_length(title) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'changes_requested', 'approved', 'archived')),
  current_revision integer not null default 0 check (current_revision >= 0),
  garment_model_id text not null default 'tee-classic',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index projects_org_updated_idx on public.projects (org_id, updated_at desc);
create index projects_title_search_idx on public.projects using gin (to_tsvector('simple', title));

create table public.project_documents (
  project_id uuid primary key references public.projects (id) on delete cascade,
  revision integer not null check (revision >= 0),
  schema_version integer not null check (schema_version > 0),
  design_state jsonb not null,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint design_state_size check (pg_column_size(design_state) < 2097152)
);

-- Immutable snapshots: no update or delete policies exist for clients.
create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete restrict,
  revision integer not null,
  label text check (char_length(label) <= 120),
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null,
  approved boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (project_id, revision)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  uploaded_by uuid not null references auth.users (id),
  storage_key text not null unique,
  original_name text not null check (char_length(original_name) <= 200),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')),
  bytes bigint not null check (bytes > 0 and bytes <= 26214400),
  width integer not null check (width > 0 and width <= 20000),
  height integer not null check (height > 0 and height <= 20000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (org_id, sha256)
);
create index assets_org_created_idx on public.assets (org_id, created_at desc);

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  project_id uuid not null references public.projects (id),
  revision integer not null check (revision >= 0),
  type text not null check (type in ('mockup_stills', 'print_files', 'tech_pack', 'turntable', 'batch')),
  config jsonb not null default '{}'::jsonb,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  state text not null default 'queued'
    check (state in ('queued', 'leased', 'rendering', 'encoding', 'uploading', 'completed', 'failed', 'cancelled', 'expired')),
  attempts integer not null default 0,
  leased_until timestamptz,
  progress numeric(5, 2) not null default 0 check (progress between 0 and 100),
  error_code text,
  requested_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, revision, type, idempotency_key)
);
create index export_jobs_queue_idx on public.export_jobs (state, created_at) where state in ('queued', 'leased');

create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id),
  actor_id uuid references auth.users (id),
  action text not null,
  target text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Authorization helper. SECURITY DEFINER avoids RLS recursion on organization_members.
-- ---------------------------------------------------------------------------
create or replace function public.has_org_role(p_org uuid, p_roles public.member_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (p_roles is null or m.role = any (p_roles))
  );
$$;
revoke execute on function public.has_org_role(uuid, public.member_role[]) from public, anon;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- New users get a profile and a personal workspace they own.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, left(split_part(coalesce(new.email, ''), '@', 1), 80));

  insert into public.organizations (name, slug, owner_id, personal)
  values ('Personal workspace', 'u-' || replace(new.id::text, '-', ''), new.id, true)
  returning id into v_org;

  insert into public.organization_members (org_id, user_id, role) values (v_org, new.id, 'owner');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Guards: ownership columns are immutable; approval only through a dedicated RPC.
-- ---------------------------------------------------------------------------
create or replace function public.guard_project_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.org_id <> old.org_id or new.created_by <> old.created_by then
    raise exception 'project ownership columns are immutable' using errcode = '42501';
  end if;
  if new.status = 'approved' and old.status <> 'approved'
     and coalesce(current_setting('wovexa.approving', true), '') <> 'on' then
    raise exception 'approve projects through the review workflow' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger guard_project_update
before update on public.projects
for each row execute function public.guard_project_update();

-- ---------------------------------------------------------------------------
-- RPC: create a project and its first document atomically.
-- SECURITY INVOKER, so the RLS policies below still apply to every write.
-- ---------------------------------------------------------------------------
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

  insert into public.projects (id, org_id, created_by, title)
  values (p_project_id, v_org, (select auth.uid()), p_title)
  returning * into v_project;

  insert into public.project_documents (project_id, revision, schema_version, design_state, updated_by)
  values (p_project_id, 0, (p_document ->> 'schemaVersion')::int, p_document, (select auth.uid()));

  return v_project;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: save with optimistic concurrency (spec §29.5). Raises revision_conflict with
-- the current server revision in DETAIL when the client's expected revision is stale.
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

revoke execute on function public.create_project(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.save_project_document(uuid, integer, jsonb) from public, anon;
grant execute on function public.create_project(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.save_project_document(uuid, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_documents enable row level security;
alter table public.project_versions enable row level security;
alter table public.assets enable row level security;
alter table public.export_jobs enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: each user sees and edits only their own
create policy "own profile read" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own profile update" on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- organizations: members read; owners and admins rename. Creation happens in the signup trigger.
create policy "members read organizations" on public.organizations for select to authenticated
  using (public.has_org_role(id));
create policy "admins update organizations" on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.member_role[]));
-- Ownership transfer needs its own audited RPC; the guard below blocks it from plain updates.
create or replace function public.guard_org_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_id <> old.owner_id or new.personal <> old.personal or new.billing_plan <> old.billing_plan then
    raise exception 'owner, workspace type and plan change through dedicated workflows' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger guard_org_update before update on public.organizations
for each row execute function public.guard_org_update();

-- organization_members: members see the roster; owners and admins manage others, never themselves
create policy "members read roster" on public.organization_members for select to authenticated
  using (public.has_org_role(org_id));
create policy "admins add members" on public.organization_members for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.member_role[])
              and user_id <> (select auth.uid()) and role <> 'owner');
create policy "admins change members" on public.organization_members for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.member_role[]) and user_id <> (select auth.uid()))
  with check (public.has_org_role(org_id, array['owner', 'admin']::public.member_role[]) and user_id <> (select auth.uid()) and role <> 'owner');
create policy "admins remove members" on public.organization_members for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.member_role[]) and user_id <> (select auth.uid()) and role <> 'owner');

-- projects
create policy "members read projects" on public.projects for select to authenticated
  using (public.has_org_role(org_id));
create policy "designers create projects" on public.projects for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin', 'designer']::public.member_role[])
              and created_by = (select auth.uid()));
create policy "designers update projects" on public.projects for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin', 'designer']::public.member_role[]))
  with check (public.has_org_role(org_id, array['owner', 'admin', 'designer']::public.member_role[]));
-- No delete policy: projects are soft-deleted (deleted_at) and purged by a retention job.

-- project_documents follow their project
create policy "members read documents" on public.project_documents for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and public.has_org_role(p.org_id)));
create policy "designers write documents" on public.project_documents for insert to authenticated
  with check (exists (select 1 from public.projects p where p.id = project_id
                      and public.has_org_role(p.org_id, array['owner', 'admin', 'designer']::public.member_role[])));
create policy "designers update documents" on public.project_documents for update to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id
                 and public.has_org_role(p.org_id, array['owner', 'admin', 'designer']::public.member_role[])))
  with check (exists (select 1 from public.projects p where p.id = project_id
                      and public.has_org_role(p.org_id, array['owner', 'admin', 'designer']::public.member_role[])));

-- project_versions: read by members, created by designers, never changed by clients
create policy "members read versions" on public.project_versions for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and public.has_org_role(p.org_id)));
create policy "designers snapshot versions" on public.project_versions for insert to authenticated
  with check (approved = false and created_by = (select auth.uid())
              and exists (select 1 from public.projects p where p.id = project_id
                          and public.has_org_role(p.org_id, array['owner', 'admin', 'designer']::public.member_role[])));

-- assets
create policy "members read assets" on public.assets for select to authenticated
  using (public.has_org_role(org_id));
create policy "designers upload assets" on public.assets for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin', 'designer']::public.member_role[])
              and uploaded_by = (select auth.uid())
              and storage_key like org_id::text || '/%');
create policy "uploader or admin deletes assets" on public.assets for delete to authenticated
  using (uploaded_by = (select auth.uid()) or public.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- export_jobs: members read; non-guests request; only workers (service role) update
create policy "members read export jobs" on public.export_jobs for select to authenticated
  using (public.has_org_role(org_id));
create policy "members request exports" on public.export_jobs for insert to authenticated
  with check (requested_by = (select auth.uid()) and state = 'queued' and attempts = 0
              and public.has_org_role(org_id, array['owner', 'admin', 'designer', 'production']::public.member_role[])
              and exists (select 1 from public.projects p where p.id = project_id and p.org_id = export_jobs.org_id));

-- audit_logs: owners and admins read; written only by server-side code
create policy "admins read audit log" on public.audit_logs for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']::public.member_role[]));

-- ---------------------------------------------------------------------------
-- Storage: private artwork, keyed {org_id}/{asset_id}/{filename} (spec §29.4)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspace-assets-private', 'workspace-assets-private', false, 26214400,
        array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy "members read org artwork" on storage.objects for select to authenticated
  using (bucket_id = 'workspace-assets-private'
         and public.has_org_role(((storage.foldername(name))[1])::uuid));
create policy "designers upload org artwork" on storage.objects for insert to authenticated
  with check (bucket_id = 'workspace-assets-private'
              and public.has_org_role(((storage.foldername(name))[1])::uuid,
                                      array['owner', 'admin', 'designer']::public.member_role[]));
-- No update policy: originals are immutable. Deletes go through a server route that checks usage.

-- ---------------------------------------------------------------------------
-- Checks to run after applying (spec §39.1 permission tests):
--   1. Sign up two users A and B. As A, create a project; as B, select it: expect 0 rows.
--   2. As B, call save_project_document on A's project: expect 42501.
--   3. Save twice with the same expected revision: the second raises revision_conflict.
--   4. As a designer, update projects set status = 'approved': expect 42501.
--   5. As an admin, update your own organization_members row: expect 0 rows changed.
-- ---------------------------------------------------------------------------
