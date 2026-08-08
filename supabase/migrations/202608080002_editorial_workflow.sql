begin;

-- Un solo rol efectivo elimina combinaciones ambiguas. Conserva el de mayor jerarquía.
with ranked as (
  select ur.user_id, ur.role_id,
         row_number() over (
           partition by ur.user_id
           order by case r.key when 'superadmin' then 1 when 'admin' then 2 when 'editor' then 3
                    when 'reviewer' then 4 when 'author' then 5 else 6 end
         ) as position
  from public.user_roles ur join public.roles r on r.id = ur.role_id
)
delete from public.user_roles ur using ranked
where ur.user_id = ranked.user_id and ur.role_id = ranked.role_id and ranked.position > 1;
create unique index if not exists user_roles_one_role_per_user_idx on public.user_roles(user_id);

-- Referencia textual para recursos alojados en GitHub (una ruta no es un UUID).
alter table public.audit_log add column if not exists resource_ref text;
create index if not exists audit_log_resource_ref_idx
  on public.audit_log(resource_type, resource_ref, created_at desc);

create table if not exists public.cms_content_records (
  id uuid primary key default gen_random_uuid(),
  collection text not null check (collection in ('entradas', 'memorias', 'paginas', 'simposios', 'categorias', 'etiquetas')),
  path text not null unique check (path ~ '^src/content/[a-z][a-z0-9_]*/[a-zA-Z0-9._/-]+\.md$'),
  owner_id uuid references auth.users(id) on delete set null,
  workflow_state text not null default 'draft'
    check (workflow_state in ('draft', 'in_review', 'changes_requested', 'approved', 'published', 'archived')),
  github_sha text check (github_sha is null or github_sha ~ '^[a-f0-9]{40}$'),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cms_workflow_events (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.cms_content_records(id) on delete cascade,
  from_state text,
  to_state text not null,
  comment text check (char_length(comment) <= 2000),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.cms_operation_keys (
  operation_key uuid primary key,
  actor_id uuid references auth.users(id) on delete cascade,
  operation text not null,
  resource_ref text,
  response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cms_content_owner_idx on public.cms_content_records(owner_id, collection);
create index if not exists cms_content_state_idx on public.cms_content_records(workflow_state, updated_at desc);
create index if not exists cms_workflow_content_idx on public.cms_workflow_events(content_id, created_at desc);
create index if not exists cms_operation_keys_created_idx on public.cms_operation_keys(created_at);

alter table public.cms_content_records enable row level security;
alter table public.cms_workflow_events enable row level security;
alter table public.cms_operation_keys enable row level security;
revoke all on public.cms_content_records, public.cms_workflow_events, public.cms_operation_keys
  from anon, authenticated;

-- Los usuarios nuevos quedan pendientes de aprobación. La creación administrativa
-- asigna el rol explícitamente mediante cms_set_user_roles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.admin_emails where lower(email) = lower(new.email)) then
    insert into public.user_roles (user_id, role_id)
    select new.id, id from public.roles where key = 'admin'
    on conflict do nothing;
  end if;
  return new;
end;
$$;

-- Retención operativa: Netlify puede invocarla periódicamente con service_role.
create or replace function public.cms_prune_operational_data()
returns void language sql security definer set search_path = '' as $$
  delete from public.cms_operation_keys where created_at < now() - interval '7 days';
  delete from public.audit_log where created_at < now() - interval '365 days';
$$;
revoke all on function public.cms_prune_operational_data() from public, anon, authenticated;
grant execute on function public.cms_prune_operational_data() to service_role;

commit;
