begin;

alter table public.cms_content_records
  add column if not exists current_sha text,
  add column if not exists approved_sha text,
  add column if not exists approved_github_sha text,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists published_sha text,
  add column if not exists published_by uuid references auth.users(id) on delete set null,
  add column if not exists published_at timestamptz,
  add column if not exists publication_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists publication_requested_at timestamptz,
  add column if not exists github_branch text,
  add column if not exists github_pr_number bigint,
  add column if not exists github_pr_url text,
  add column if not exists merge_sha text,
  add column if not exists deployment_state text not null default 'none';

alter table public.cms_content_records
  drop constraint if exists cms_content_records_current_sha_check,
  add constraint cms_content_records_current_sha_check
    check (current_sha is null or current_sha ~ '^[a-f0-9]{64}$'),
  drop constraint if exists cms_content_records_approved_sha_check,
  add constraint cms_content_records_approved_sha_check
    check (approved_sha is null or approved_sha ~ '^[a-f0-9]{64}$'),
  drop constraint if exists cms_content_records_approved_github_sha_check,
  add constraint cms_content_records_approved_github_sha_check
    check (approved_github_sha is null or approved_github_sha ~ '^[a-f0-9]{40}$'),
  drop constraint if exists cms_content_records_published_sha_check,
  add constraint cms_content_records_published_sha_check
    check (published_sha is null or published_sha ~ '^[a-f0-9]{64}$'),
  drop constraint if exists cms_content_records_merge_sha_check,
  add constraint cms_content_records_merge_sha_check
    check (merge_sha is null or merge_sha ~ '^[a-f0-9]{40}$'),
  drop constraint if exists cms_content_records_github_branch_check,
  add constraint cms_content_records_github_branch_check
    check (github_branch is null or github_branch ~ '^cms/[0-9a-f-]{36}/[0-9]{8}T[0-9]{9}Z$'),
  drop constraint if exists cms_content_records_github_pr_number_check,
  add constraint cms_content_records_github_pr_number_check
    check (github_pr_number is null or github_pr_number > 0),
  drop constraint if exists cms_content_records_deployment_state_check,
  add constraint cms_content_records_deployment_state_check
    check (deployment_state in ('none', 'editing', 'creating_pr', 'pr_open', 'merged', 'closed', 'failed', 'stale'));

alter table public.cms_workflow_events
  add column if not exists event_type text,
  add column if not exists content_sha text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.cms_workflow_events
  drop constraint if exists cms_workflow_events_content_sha_check,
  add constraint cms_workflow_events_content_sha_check
    check (content_sha is null or content_sha ~ '^[a-f0-9]{64}$');

create index if not exists cms_content_approved_sha_idx
  on public.cms_content_records(approved_sha) where approved_sha is not null;
create unique index if not exists cms_content_open_pr_idx
  on public.cms_content_records(github_pr_number) where github_pr_number is not null;
create index if not exists cms_content_deployment_idx
  on public.cms_content_records(deployment_state, updated_at desc);

-- No se puede reconstruir con seguridad el SHA editorial de aprobaciones
-- históricas solo desde PostgreSQL. Obliga a revisarlas de nuevo.
update public.cms_content_records
set workflow_state = 'changes_requested', updated_at = now()
where workflow_state = 'approved' and approved_sha is null;

comment on column public.cms_content_records.current_sha is
  'SHA-256 canónico del contenido editorial; excluye draft, workflow_state y owner_id.';
comment on column public.cms_content_records.github_sha is
  'SHA del blob GitHub usado para control de concurrencia; no sustituye current_sha.';
comment on column public.cms_content_records.published_sha is
  'Versión editorial aprobada confirmada como fusionada en la rama pública.';

commit;
