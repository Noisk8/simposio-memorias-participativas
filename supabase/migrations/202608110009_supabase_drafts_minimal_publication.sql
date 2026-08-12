begin;

-- El contenido editable vive en Supabase. GitHub conserva únicamente artefactos
-- Markdown publicados y deja de participar en crear, editar o guardar borradores.
alter table public.cms_content_records
  add column if not exists current_version_id uuid,
  add column if not exists published_version_id uuid,
  add column if not exists publication_state text not null default 'idle';

alter table public.cms_content_records
  drop constraint if exists cms_content_records_workflow_state_check,
  add constraint cms_content_records_workflow_state_check check (
    workflow_state in (
      'draft', 'publishing', 'published', 'publish_failed', 'archived',
      -- Estados legacy: se conservan para que la migración sea aditiva.
      'in_review', 'changes_requested', 'approved'
    )
  ),
  drop constraint if exists cms_content_records_publication_state_check,
  add constraint cms_content_records_publication_state_check check (
    publication_state in ('idle', 'queued', 'validating', 'pr_open', 'merged', 'live', 'failed')
  );

create table if not exists public.cms_content_drafts (
  content_id uuid primary key references public.cms_content_records(id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  body text not null default '' check (char_length(body) <= 200000),
  revision bigint not null default 1 check (revision > 0),
  content_sha text not null check (content_sha ~ '^[a-f0-9]{64}$'),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_content_versions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.cms_content_records(id) on delete cascade,
  version_number bigint not null check (version_number > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  body text not null default '' check (char_length(body) <= 200000),
  content_sha text not null check (content_sha ~ '^[a-f0-9]{64}$'),
  reason text not null default 'manual_save'
    check (reason in ('import', 'manual_save', 'publication', 'restore')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (content_id, version_number)
);

create unique index if not exists cms_content_versions_sha_idx
  on public.cms_content_versions(content_id, content_sha);
create index if not exists cms_content_versions_history_idx
  on public.cms_content_versions(content_id, created_at desc);

alter table public.cms_content_records
  drop constraint if exists cms_content_records_current_version_fk,
  add constraint cms_content_records_current_version_fk
    foreign key (current_version_id) references public.cms_content_versions(id) on delete set null,
  drop constraint if exists cms_content_records_published_version_fk,
  add constraint cms_content_records_published_version_fk
    foreign key (published_version_id) references public.cms_content_versions(id) on delete set null;

create table if not exists public.cms_publications (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.cms_content_records(id) on delete cascade,
  version_id uuid not null references public.cms_content_versions(id) on delete restrict,
  operation_key uuid not null unique,
  status text not null default 'queued' check (
    status in ('queued', 'validating', 'pr_open', 'merged', 'live', 'failed', 'cancelled')
  ),
  attempt_count integer not null default 1 check (attempt_count > 0),
  github_branch text,
  github_pr_number bigint,
  github_pr_url text,
  merge_sha text,
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  merged_at timestamptz,
  live_at timestamptz,
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cms_publications_branch_check check (
    github_branch is null or github_branch ~ '^cms/[0-9a-f-]{36}/[0-9]{8}T[0-9]{9}Z$'
  ),
  constraint cms_publications_pr_check check (github_pr_number is null or github_pr_number > 0),
  constraint cms_publications_merge_sha_check check (merge_sha is null or merge_sha ~ '^[a-f0-9]{40}$')
);

create unique index if not exists cms_publications_active_version_idx
  on public.cms_publications(content_id, version_id)
  where status in ('queued', 'validating', 'pr_open', 'merged', 'live');
create index if not exists cms_publications_status_idx
  on public.cms_publications(status, updated_at desc);

alter table public.cms_content_drafts enable row level security;
alter table public.cms_content_versions enable row level security;
alter table public.cms_publications enable row level security;
revoke all on public.cms_content_drafts, public.cms_content_versions, public.cms_publications
  from anon, authenticated;
grant select, insert, update, delete
  on public.cms_content_drafts, public.cms_content_versions, public.cms_publications
  to service_role;

-- Guardado transaccional y con control optimista. La Function ya comprobó JWT,
-- RBAC, propiedad, esquema y SHA antes de invocar esta RPC server-side.
create or replace function public.cms_save_content_draft(
  p_content_id uuid,
  p_collection text,
  p_path text,
  p_owner_id uuid,
  p_actor_id uuid,
  p_data jsonb,
  p_body text,
  p_content_sha text,
  p_expected_revision bigint default null,
  p_create_version boolean default true,
  p_version_reason text default 'manual_save'
)
returns table (
  content_id uuid,
  revision bigint,
  content_sha text,
  workflow_state text,
  version_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.cms_content_records%rowtype;
  v_draft public.cms_content_drafts%rowtype;
  v_revision bigint;
  v_version_id uuid;
  v_version_number bigint;
  v_state text;
begin
  if p_collection not in ('entradas', 'memorias', 'paginas', 'simposios', 'categorias', 'etiquetas')
     or p_path !~ '^src/content/[a-z][a-z0-9_]*/[a-zA-Z0-9._/-]+\.md$'
     or jsonb_typeof(p_data) <> 'object'
     or char_length(p_body) > 200000
     or p_content_sha !~ '^[a-f0-9]{64}$'
     or p_version_reason not in ('import', 'manual_save', 'publication', 'restore') then
    raise exception 'invalid draft parameters' using errcode = '22023';
  end if;

  select * into v_record
  from public.cms_content_records
  where id = p_content_id
  for update;

  if not found then
    insert into public.cms_content_records (
      id, collection, path, owner_id, workflow_state, publication_state,
      current_sha, created_by, updated_by
    ) values (
      p_content_id, p_collection, p_path, p_owner_id, 'draft', 'idle',
      p_content_sha, p_actor_id, p_actor_id
    ) returning * into v_record;
  elsif v_record.collection <> p_collection or v_record.path <> p_path then
    raise exception 'content identity mismatch' using errcode = '23505';
  end if;

  select * into v_draft
  from public.cms_content_drafts
  where cms_content_drafts.content_id = p_content_id
  for update;

  if found then
    if p_expected_revision is null or p_expected_revision <> v_draft.revision then
      raise exception 'draft revision conflict' using errcode = '40001';
    end if;
    v_revision := v_draft.revision + 1;
    update public.cms_content_drafts
    set data = p_data,
        body = p_body,
        revision = v_revision,
        content_sha = p_content_sha,
        updated_by = p_actor_id,
        updated_at = now()
    where cms_content_drafts.content_id = p_content_id;
  else
    v_revision := 1;
    insert into public.cms_content_drafts (
      content_id, data, body, revision, content_sha, updated_by
    ) values (
      p_content_id, p_data, p_body, v_revision, p_content_sha, p_actor_id
    );
  end if;

  v_state := case
    when v_record.published_sha = p_content_sha then 'published'
    else 'draft'
  end;

  if p_create_version then
    select id into v_version_id
    from public.cms_content_versions
    where cms_content_versions.content_id = p_content_id
      and cms_content_versions.content_sha = p_content_sha;

    if v_version_id is null then
      select coalesce(max(version_number), 0) + 1 into v_version_number
      from public.cms_content_versions
      where cms_content_versions.content_id = p_content_id;

      insert into public.cms_content_versions (
        content_id, version_number, data, body, content_sha, reason, created_by
      ) values (
        p_content_id, v_version_number, p_data, p_body, p_content_sha,
        p_version_reason, p_actor_id
      ) returning id into v_version_id;
    end if;
  else
    v_version_id := v_record.current_version_id;
  end if;

  update public.cms_content_records
  set owner_id = coalesce(owner_id, p_owner_id),
      current_sha = p_content_sha,
      current_version_id = coalesce(v_version_id, current_version_id),
      workflow_state = v_state,
      publication_state = case
        when publication_state in ('queued', 'validating', 'pr_open', 'merged')
          then publication_state
        when v_state = 'published' then 'live'
        else 'idle'
      end,
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_content_id;

  return query select p_content_id, v_revision, p_content_sha, v_state, v_version_id;
end;
$$;

revoke all on function public.cms_save_content_draft(
  uuid, text, text, uuid, uuid, jsonb, text, text, bigint, boolean, text
) from public, anon, authenticated;
grant execute on function public.cms_save_content_draft(
  uuid, text, text, uuid, uuid, jsonb, text, text, bigint, boolean, text
) to service_role;

drop trigger if exists cms_content_drafts_touch_updated_at on public.cms_content_drafts;
create trigger cms_content_drafts_touch_updated_at
  before update on public.cms_content_drafts
  for each row execute function public.cms_touch_updated_at();

drop trigger if exists cms_publications_touch_updated_at on public.cms_publications;
create trigger cms_publications_touch_updated_at
  before update on public.cms_publications
  for each row execute function public.cms_touch_updated_at();

comment on table public.cms_content_drafts is
  'Copia mutable para edición y autosave. Nunca se publica directamente.';
comment on table public.cms_content_versions is
  'Snapshots editoriales inmutables usados por historial y publicación exacta.';
comment on table public.cms_publications is
  'Intentos idempotentes de llevar una versión inmutable a GitHub y producción.';

commit;
