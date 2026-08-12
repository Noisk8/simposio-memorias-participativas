begin;

-- El bucket aplica un techo operativo. manage-media puede configurar un límite
-- menor mediante CMS_MEDIA_MAX_BYTES, pero nunca superar estos 10 MiB.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp',
      'application/pdf',
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
      'video/mp4', 'video/webm'
    ]::text[]
where id = 'cms-media';

alter table public.cms_media
  add column if not exists is_decorative boolean,
  add column if not exists image_format text;

-- Completa el formato de los medios históricos ya decodificados durante la migración.
update public.cms_media
set image_format = case mime_type
  when 'image/jpeg' then 'jpeg'
  when 'image/png' then 'png'
  when 'image/webp' then 'webp'
  else image_format
end
where media_kind = 'image' and image_format is null;

alter table public.cms_media
  drop constraint if exists cms_media_storage_path_check,
  drop constraint if exists cms_media_size_bytes_check,
  drop constraint if exists cms_media_image_type_check,
  drop constraint if exists cms_media_editorial_metadata_check;

-- Conserva paths SHA-256 de la migración inicial y admite el nuevo formato
-- opaco UUID-slug para todas las cargas creadas por manage-media.
alter table public.cms_media
  add constraint cms_media_storage_path_check check (
    storage_path ~ '^(images|documents|audio|video)/[0-9]{4}/(0[1-9]|1[0-2])/([a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})-[a-z0-9][a-z0-9._-]*$'
  ),
  add constraint cms_media_size_bytes_check check (size_bytes between 1 and 10485760),
  add constraint cms_media_image_type_check check (
    media_kind <> 'image' or (
      mime_type in ('image/jpeg', 'image/png', 'image/webp')
      and image_format in ('jpeg', 'png', 'webp')
      and (mime_type, image_format) in (
        ('image/jpeg', 'jpeg'), ('image/png', 'png'), ('image/webp', 'webp')
      )
      and width is not null and height is not null
    )
  ),
  add constraint cms_media_editorial_metadata_check check (
    media_kind <> 'image'
    -- Los 32 registros de la importación inicial no tenían metadata editorial.
    -- Permanecen identificables por created_by null y deben completarse desde el CMS.
    or created_by is null
    or (
      is_decorative is not null
      and char_length(btrim(credit)) between 1 and 500
      and char_length(btrim(license)) between 1 and 255
      and (
        (is_decorative and alt_text is null)
        or (not is_decorative and char_length(btrim(alt_text)) between 1 and 500)
      )
    )
  );

commit;

