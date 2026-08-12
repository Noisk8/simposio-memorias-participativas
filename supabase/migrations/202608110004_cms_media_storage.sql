begin;

-- Los medios publicados necesitan una URL estable para que Astro pueda renderizarlos
-- sin consultar Supabase durante el build. El bucket es público solo para descargas;
-- listar y todas las mutaciones siguen controladas por RLS/Functions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cms-media',
  'cms-media',
  true,
  4194304,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml',
    'application/pdf',
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
    'video/mp4', 'video/webm'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.cms_media (
  id uuid primary key default gen_random_uuid(),
  storage_bucket text not null default 'cms-media' check (storage_bucket = 'cms-media'),
  storage_path text not null check (
    storage_path ~ '^(images|documents|audio|video)/[0-9]{4}/(0[1-9]|1[0-2])/[a-f0-9]{64}-[a-z0-9][a-z0-9._-]*$'
  ),
  public_url text not null unique check (public_url ~ '^https?://'),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  safe_filename text not null check (
    char_length(safe_filename) between 1 and 160
    and safe_filename ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  media_kind text not null check (media_kind in ('image', 'document', 'audio', 'video')),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 4194304),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  alt_text text check (alt_text is null or char_length(alt_text) <= 500),
  credit text check (credit is null or char_length(credit) <= 500),
  author text check (author is null or char_length(author) <= 255),
  license text check (license is null or char_length(license) <= 255),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint cms_media_dimensions_pair check ((width is null) = (height is null)),
  constraint cms_media_storage_object_unique unique (storage_bucket, storage_path)
);

create unique index if not exists cms_media_active_checksum_unique_idx
  on public.cms_media(storage_bucket, checksum_sha256)
  where deleted_at is null;
create index if not exists cms_media_active_created_idx
  on public.cms_media(created_at desc)
  where deleted_at is null;
create index if not exists cms_media_created_by_idx
  on public.cms_media(created_by, created_at desc);

create or replace function public.cms_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cms_media_touch_updated_at on public.cms_media;
create trigger cms_media_touch_updated_at
  before update on public.cms_media
  for each row execute function public.cms_touch_updated_at();
revoke all on function public.cms_touch_updated_at() from public, anon, authenticated;

-- Las políticas no confían en roles del JWT: consultan la matriz RBAC canónica.
create or replace function public.cms_has_permission(p_user_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = p_user_id and p.key = p_permission_key
  );
$$;

revoke all on function public.cms_has_permission(uuid, text) from public, anon;
grant execute on function public.cms_has_permission(uuid, text) to authenticated, service_role;

alter table public.cms_media enable row level security;
revoke all on public.cms_media from anon, authenticated;
grant select on public.cms_media to authenticated;
grant select, insert, update, delete on public.cms_media to service_role;

drop policy if exists cms_media_read_with_permission on public.cms_media;
create policy cms_media_read_with_permission
  on public.cms_media for select to authenticated
  using (public.cms_has_permission((select auth.uid()), 'media.read'));

-- Políticas RESTRICTIVE: aunque exista en el proyecto una política permisiva amplia,
-- ningún JWT cliente puede escribir en este bucket. service_role omite RLS y solo se
-- usa detrás de manage-media después de autenticar y autorizar la petición.
drop policy if exists cms_media_backend_only_insert on storage.objects;
create policy cms_media_backend_only_insert
  on storage.objects as restrictive for insert to public
  with check (bucket_id <> 'cms-media');

drop policy if exists cms_media_backend_only_update on storage.objects;
create policy cms_media_backend_only_update
  on storage.objects as restrictive for update to public
  using (bucket_id <> 'cms-media')
  with check (bucket_id <> 'cms-media');

drop policy if exists cms_media_backend_only_delete on storage.objects;
create policy cms_media_backend_only_delete
  on storage.objects as restrictive for delete to public
  using (bucket_id <> 'cms-media');

drop policy if exists cms_media_list_with_permission on storage.objects;
create policy cms_media_list_with_permission
  on storage.objects for select to authenticated
  using (
    bucket_id = 'cms-media'
    and public.cms_has_permission((select auth.uid()), 'media.read')
  );

drop policy if exists cms_media_bucket_backend_only_insert on storage.buckets;
create policy cms_media_bucket_backend_only_insert
  on storage.buckets as restrictive for insert to public
  with check (id <> 'cms-media');

drop policy if exists cms_media_bucket_backend_only_update on storage.buckets;
create policy cms_media_bucket_backend_only_update
  on storage.buckets as restrictive for update to public
  using (id <> 'cms-media')
  with check (id <> 'cms-media');

drop policy if exists cms_media_bucket_backend_only_delete on storage.buckets;
create policy cms_media_bucket_backend_only_delete
  on storage.buckets as restrictive for delete to public
  using (id <> 'cms-media');

commit;
