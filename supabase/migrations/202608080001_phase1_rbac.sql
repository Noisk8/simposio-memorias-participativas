begin;

create extension if not exists pgcrypto;

create table if not exists public.admin_emails (
  email text primary key
);
alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;

-- Conserva las tablas de la implementación admin/editor para una reversión segura.
do $$
begin
  if to_regclass('public.user_roles') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'user_roles' and column_name = 'roles'
     ) then
    alter table public.user_roles rename to user_roles_legacy;
  end if;

  if to_regclass('public.audit_log') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'audit_log' and column_name = 'user_id'
     ) then
    alter table public.audit_log rename to audit_log_legacy;
  end if;
end
$$;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text unique not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text unique not null check (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  actor_id uuid references auth.users(id),
  action text not null,
  resource_type text,
  resource_id uuid,
  result text not null check (result in ('allowed', 'denied', 'success', 'failure')),
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.roles (key, name, description) values
  ('superadmin', 'Superadministración', 'Control total, incluidos roles y configuración.'),
  ('admin', 'Administración', 'Administración de usuarios, contenido y configuración.'),
  ('editor', 'Edición', 'Edición, aprobación y publicación de contenido.'),
  ('reviewer', 'Revisión', 'Revisión, solicitud de cambios y aprobación.'),
  ('author', 'Autoría', 'Creación y envío a revisión de contenido propio.'),
  ('read_only', 'Solo lectura', 'Consulta administrativa sin modificaciones.')
on conflict (key) do update set name = excluded.name, description = excluded.description;

insert into public.permissions (key, description)
select key, description
from (values
  ('admin.access', 'Acceder al panel administrativo'),
  ('users.read', 'Consultar usuarios'), ('users.manage', 'Gestionar usuarios'),
  ('roles.read', 'Consultar roles'), ('roles.manage', 'Gestionar roles'),
  ('entrada.read', 'Consultar entradas'), ('entrada.create', 'Crear entradas'),
  ('entrada.update', 'Editar entradas'), ('entrada.submit_review', 'Enviar entradas a revisión'),
  ('entrada.approve', 'Aprobar entradas'), ('entrada.publish', 'Publicar entradas'),
  ('entrada.archive', 'Archivar entradas'), ('entrada.delete', 'Eliminar entradas'),
  ('memoria.read', 'Consultar memorias'), ('memoria.create', 'Crear memorias'),
  ('memoria.update', 'Editar memorias'), ('memoria.submit_review', 'Enviar memorias a revisión'),
  ('memoria.approve', 'Aprobar memorias'), ('memoria.publish', 'Publicar memorias'),
  ('memoria.archive', 'Archivar memorias'), ('memoria.delete', 'Eliminar memorias'),
  ('pagina.read', 'Consultar páginas'), ('pagina.create', 'Crear páginas'),
  ('pagina.update', 'Editar páginas'), ('pagina.submit_review', 'Enviar páginas a revisión'),
  ('pagina.approve', 'Aprobar páginas'), ('pagina.publish', 'Publicar páginas'),
  ('pagina.archive', 'Archivar páginas'), ('pagina.delete', 'Eliminar páginas'),
  ('simposio.read', 'Consultar simposios'), ('simposio.create', 'Crear simposios'),
  ('simposio.update', 'Editar simposios'), ('simposio.publish', 'Publicar simposios'),
  ('simposio.delete', 'Eliminar simposios'),
  ('taxonomy.read', 'Consultar taxonomías'), ('taxonomy.manage', 'Gestionar taxonomías'),
  ('menu.read', 'Consultar menús'), ('menu.manage', 'Gestionar menús'),
  ('media.read', 'Consultar medios'), ('media.upload', 'Cargar medios'),
  ('media.update', 'Editar metadatos de medios'), ('media.delete', 'Eliminar medios'),
  ('media.manage_sensitive', 'Gestionar medios sensibles'),
  ('audit.read', 'Consultar auditoría'), ('backup.execute', 'Ejecutar respaldos'),
  ('settings.manage', 'Gestionar configuración')
) as seed(key, description)
on conflict (key) do update set description = excluded.description;

-- Superadmin y admin reciben todos los permisos de la Fase 1.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.key in ('superadmin', 'admin')
on conflict do nothing;

-- Matriz de mínimo privilegio para los demás perfiles.
with grants(role_key, permission_key) as (values
  ('editor', 'admin.access'), ('editor', 'entrada.read'), ('editor', 'entrada.create'),
  ('editor', 'entrada.update'), ('editor', 'entrada.submit_review'), ('editor', 'entrada.approve'),
  ('editor', 'entrada.publish'), ('editor', 'entrada.archive'),
  ('editor', 'memoria.read'), ('editor', 'memoria.create'), ('editor', 'memoria.update'),
  ('editor', 'memoria.submit_review'), ('editor', 'memoria.approve'), ('editor', 'memoria.publish'),
  ('editor', 'memoria.archive'), ('editor', 'pagina.read'), ('editor', 'pagina.create'),
  ('editor', 'pagina.update'), ('editor', 'pagina.submit_review'), ('editor', 'pagina.approve'),
  ('editor', 'pagina.publish'), ('editor', 'pagina.archive'), ('editor', 'simposio.read'),
  ('editor', 'taxonomy.read'), ('editor', 'taxonomy.manage'), ('editor', 'menu.read'),
  ('editor', 'menu.manage'), ('editor', 'media.read'), ('editor', 'media.upload'),
  ('editor', 'media.update'),
  ('reviewer', 'admin.access'), ('reviewer', 'entrada.read'), ('reviewer', 'entrada.approve'),
  ('reviewer', 'memoria.read'), ('reviewer', 'memoria.approve'), ('reviewer', 'pagina.read'),
  ('reviewer', 'pagina.approve'), ('reviewer', 'simposio.read'), ('reviewer', 'taxonomy.read'),
  ('reviewer', 'menu.read'), ('reviewer', 'media.read'),
  ('author', 'admin.access'), ('author', 'entrada.read'), ('author', 'entrada.create'),
  ('author', 'entrada.update'), ('author', 'entrada.submit_review'), ('author', 'memoria.read'),
  ('author', 'memoria.create'), ('author', 'memoria.update'), ('author', 'memoria.submit_review'),
  ('author', 'pagina.read'), ('author', 'pagina.create'), ('author', 'pagina.update'),
  ('author', 'pagina.submit_review'), ('author', 'simposio.read'), ('author', 'taxonomy.read'),
  ('author', 'menu.read'), ('author', 'media.read'), ('author', 'media.upload'),
  ('read_only', 'admin.access'), ('read_only', 'entrada.read'), ('read_only', 'memoria.read'),
  ('read_only', 'pagina.read'), ('read_only', 'simposio.read'), ('read_only', 'taxonomy.read'),
  ('read_only', 'menu.read'), ('read_only', 'media.read')
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from grants g
join public.roles r on r.key = g.role_key
join public.permissions p on p.key = g.permission_key
on conflict do nothing;

-- Migra cada rol legacy sin confiar en app_metadata ni en el cliente.
do $$
begin
  if to_regclass('public.user_roles_legacy') is not null then
    insert into public.user_roles (user_id, role_id)
    select legacy.user_id, role_row.id
    from public.user_roles_legacy legacy
    cross join lateral unnest(legacy.roles) as legacy_role(key)
    join public.roles role_row on role_row.key = legacy_role.key
    on conflict do nothing;

    insert into public.user_roles (user_id, role_id)
    select legacy.user_id, role_row.id
    from public.user_roles_legacy legacy
    join public.roles role_row on role_row.key = 'read_only'
    where coalesce(cardinality(legacy.roles), 0) = 0
    on conflict do nothing;
  end if;
end
$$;

-- Conserva el historial legacy en el nuevo formato.
do $$
begin
  if to_regclass('public.audit_log_legacy') is not null then
    insert into public.audit_log (request_id, actor_id, action, result, metadata, created_at)
    select gen_random_uuid(), legacy.user_id, legacy.action, 'success',
           coalesce(legacy.details, '{}'::jsonb) || jsonb_build_object('legacy_email', legacy.email),
           legacy.created_at
    from public.audit_log_legacy legacy;
  end if;
end
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_role text;
begin
  initial_role := case
    when exists (select 1 from public.admin_emails where email = new.email) then 'admin'
    else 'author'
  end;

  insert into public.user_roles (user_id, role_id)
  select new.id, id from public.roles where key = initial_role
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.cms_set_user_roles(
  target_user_id uuid,
  target_role_keys text[],
  actor_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  valid_role_count integer;
  target_exists boolean;
  target_is_manager boolean;
  remaining_managers integer;
begin
  select exists(select 1 from auth.users where id = target_user_id) into target_exists;
  if not target_exists then raise exception 'Usuario no encontrado'; end if;
  if target_role_keys is null or cardinality(target_role_keys) = 0 then
    raise exception 'Debe asignarse al menos un rol';
  end if;

  select count(distinct key) into valid_role_count
  from public.roles where key = any(target_role_keys);
  if valid_role_count <> cardinality(array(select distinct unnest(target_role_keys))) then
    raise exception 'La lista de roles no es válida';
  end if;

  select exists(
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = target_user_id and r.key in ('superadmin', 'admin')
  ) into target_is_manager;

  if target_user_id = actor_user_id
     and not (target_role_keys && array['superadmin', 'admin']::text[]) then
    raise exception 'No puedes quitar tus propios permisos administrativos';
  end if;

  if target_is_manager and not (target_role_keys && array['superadmin', 'admin']::text[]) then
    select count(distinct ur.user_id) into remaining_managers
    from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id <> target_user_id and r.key in ('superadmin', 'admin');
    if remaining_managers = 0 then raise exception 'No se puede quitar el último administrador'; end if;
  end if;

  delete from public.user_roles where user_id = target_user_id;
  insert into public.user_roles (user_id, role_id, assigned_by)
  select target_user_id, id, actor_user_id from public.roles where key = any(target_role_keys);
end;
$$;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.roles, public.permissions, public.role_permissions, public.user_roles, public.audit_log
  from anon, authenticated;
revoke all on function public.cms_set_user_roles(uuid, text[], uuid) from public, anon, authenticated;
grant execute on function public.cms_set_user_roles(uuid, text[], uuid) to service_role;

create index if not exists audit_log_created_at_idx on public.audit_log(created_at desc);
create index if not exists audit_log_actor_id_idx on public.audit_log(actor_id, created_at desc);

commit;

-- Reversión manual documentada en docs/FASE-1-RBAC.md. Las tablas *_legacy
-- se conservan deliberadamente hasta verificar el despliegue.
