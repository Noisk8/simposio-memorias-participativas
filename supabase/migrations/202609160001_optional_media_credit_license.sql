begin;

-- Crédito y licencia son opcionales. Sus límites de longitud siguen vigentes.
-- Se conserva la excepción de las importaciones históricas sin created_by.
alter table public.cms_media
  drop constraint if exists cms_media_editorial_metadata_check,
  add constraint cms_media_editorial_metadata_check check (
    media_kind <> 'image'
    or created_by is null
    or (
      is_decorative is not null
      and (
        (is_decorative and alt_text is null)
        or (
          not is_decorative
          and alt_text is not null
          and char_length(btrim(alt_text)) between 1 and 500
        )
      )
    )
  );

commit;
