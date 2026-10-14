begin;

-- Eventos utiliza el mismo borrador, historial y workflow que el contenido editorial.
alter table public.cms_content_records
  drop constraint if exists cms_content_records_collection_check,
  add constraint cms_content_records_collection_check check (
    collection in ('entradas', 'eventos', 'memorias', 'paginas', 'simposios', 'categorias', 'etiquetas')
  );

insert into public.permissions (key, description)
values
  ('evento.read', 'Consultar eventos'),
  ('evento.create', 'Crear eventos'),
  ('evento.update', 'Editar eventos'),
  ('evento.publish', 'Publicar eventos'),
  ('evento.archive', 'Archivar eventos'),
  ('evento.delete', 'Eliminar eventos')
on conflict (key) do update set description = excluded.description;

-- Respeta la matriz efectiva de entradas, incluidos los roles personalizados.
-- Authors crean y editan su contenido; publicar y archivar siguen requiriendo permiso.
insert into public.role_permissions (role_id, permission_id)
select rp.role_id, event_permission.id
from public.role_permissions rp
join public.permissions entry_permission on entry_permission.id = rp.permission_id
join public.permissions event_permission
  on event_permission.key = replace(entry_permission.key, 'entrada.', 'evento.')
where entry_permission.key in (
  'entrada.read', 'entrada.create', 'entrada.update',
  'entrada.publish', 'entrada.archive', 'entrada.delete'
)
on conflict do nothing;

-- Conserva la revisión optimista y la escritura exclusiva con service_role.
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
  if p_collection not in ('entradas', 'eventos', 'memorias', 'paginas', 'simposios', 'categorias', 'etiquetas')
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

commit;
