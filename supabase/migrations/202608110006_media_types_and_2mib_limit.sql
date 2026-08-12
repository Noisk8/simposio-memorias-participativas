begin;

-- Política final de recepción: únicamente JPEG, PNG, WebP y PDF, con un
-- máximo absoluto de 2 MiB tanto en Storage como en PostgreSQL.
update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
    ]::text[]
where id = 'cms-media';

alter table public.cms_media
  drop constraint if exists cms_media_size_bytes_check,
  drop constraint if exists cms_media_media_kind_check,
  drop constraint if exists cms_media_storage_path_check,
  drop constraint if exists cms_media_allowed_types_check;

alter table public.cms_media
  add constraint cms_media_size_bytes_check check (size_bytes between 1 and 2097152),
  add constraint cms_media_media_kind_check check (media_kind in ('image', 'document')),
  add constraint cms_media_allowed_types_check check (
    (media_kind = 'image' and mime_type in ('image/jpeg', 'image/png', 'image/webp'))
    or (media_kind = 'document' and mime_type = 'application/pdf')
  ),
  add constraint cms_media_storage_path_check check (
    storage_path ~ '^(images|documents)/[0-9]{4}/(0[1-9]|1[0-2])/([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})-[a-z0-9][a-z0-9._-]*$'
  );

commit;

