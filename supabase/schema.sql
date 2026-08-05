-- =============================================================
-- Setup Supabase para simposio-memorias-participativas
-- Ejecutar en: Supabase → SQL Editor
--
-- Crea:
--   public.admin_emails : lista de emails con rol admin inicial
--   public.user_roles   : roles por usuario (fuente de verdad)
--   public.audit_log    : registro de acciones administrativas
--   trigger en auth.users: asigna rol al registrarse
-- =============================================================

-- 1. Lista de administradores (ajusta los emails)
create table if not exists public.admin_emails (
  email text primary key
);

-- Inserta aquí los emails que deben ser admin al registrarse:
-- insert into public.admin_emails (email) values ('tu-email@ejemplo.com');

alter table public.admin_emails enable row level security;

-- 2. Roles por usuario
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  roles text[] not null default array['editor'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

-- 3. Auditoría de acciones administrativas
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  action text not null,
  user_id uuid,
  email text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

-- 4. Trigger: asigna rol inicial al registrarse
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_roles (user_id, email, roles)
  values (
    new.id,
    new.email,
    case
      when exists (select 1 from public.admin_emails where email = new.email)
        then array['admin']
      else array['editor']
    end
  )
  on conflict (user_id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. Acceso desde clientes: denegado por defecto (solo service_role/owner).
--    No se crean policies, por lo que la API anónima no puede leer/escribir.
