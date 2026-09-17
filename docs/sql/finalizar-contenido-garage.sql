-- Ejecutar SOLO después de desplegar el backend compatible, activar Garage
-- y terminar migrate-content-to-garage.mjs --apply sin errores.
-- Es transaccional: si quedan textos inline no aplica ninguna restricción.
begin;

create or replace function public.cms_is_garage_content_reference(
  p_id uuid, p_data jsonb, p_body text
) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    p_body = ''
    and jsonb_typeof(p_data) = 'object'
    and p_data - '_garage' = '{}'::jsonb
    and jsonb_typeof(p_data -> '_garage') = 'object'
    and p_data #>> '{_garage,version}' = '1'
    and p_data #>> '{_garage,sha256}' ~ '^[a-f0-9]{64}$'
    and p_data #>> '{_garage,key}' =
      'content/' || p_id::text || '/' || (p_data #>> '{_garage,sha256}') || '.json'
    and (p_data -> '_garage') - array['version','sha256','key'] = '{}'::jsonb,
    false
  );
$$;
revoke all on function public.cms_is_garage_content_reference(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.cms_is_garage_content_reference(uuid, jsonb, text) to service_role;

alter table public.cms_content_drafts
  drop constraint if exists cms_drafts_garage_only,
  add constraint cms_drafts_garage_only check (
    public.cms_is_garage_content_reference(content_id, data, body)
  );
alter table public.cms_content_versions
  drop constraint if exists cms_versions_garage_only,
  add constraint cms_versions_garage_only check (
    public.cms_is_garage_content_reference(content_id, data, body)
  );
commit;
