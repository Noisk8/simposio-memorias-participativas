begin;

-- Una cuenta creada fuera del flujo administrativo queda sin permisos hasta que
-- un administrador le asigne explícitamente un rol. La allowlist solo conserva
-- el bootstrap de administradores predeclarados.
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

insert into public.permissions (key, description)
values ('simposio.archive', 'Archivar simposios')
on conflict (key) do update set description = excluded.description;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key in ('superadmin', 'admin', 'editor') and p.key = 'simposio.archive'
on conflict do nothing;

alter table public.cms_content_records
  drop constraint if exists cms_content_records_workflow_state_check,
  add constraint cms_content_records_workflow_state_check check (
    workflow_state in (
      'draft', 'publishing', 'published', 'publish_failed',
      'archiving', 'archived', 'archive_failed',
      'in_review', 'changes_requested', 'approved'
    )
  ),
  drop constraint if exists cms_content_records_publication_state_check,
  add constraint cms_content_records_publication_state_check check (
    publication_state in (
      'idle', 'queued', 'validating', 'pr_open', 'merged',
      'live', 'archived', 'failed', 'cancelled'
    )
  ),
  drop constraint if exists cms_content_records_deployment_state_check,
  add constraint cms_content_records_deployment_state_check check (
    deployment_state in (
      'none', 'editing', 'creating_pr', 'pr_open', 'merged', 'deploying',
      'live', 'archived', 'closed', 'failed', 'stale'
    )
  );

alter table public.cms_publications
  add column if not exists operation text not null default 'publish',
  add column if not exists deploy_id text,
  add column if not exists deploy_url text;

alter table public.cms_publications
  drop constraint if exists cms_publications_operation_check,
  add constraint cms_publications_operation_check check (operation in ('publish', 'archive')),
  drop constraint if exists cms_publications_status_check,
  add constraint cms_publications_status_check check (
    status in ('queued', 'validating', 'pr_open', 'merged', 'live', 'archived', 'failed', 'cancelled')
  );

-- Los estados live/archived son terminales. Excluirlos permite archivar y volver
-- a publicar exactamente la misma versión sin colisionar con el intento anterior.
drop index if exists public.cms_publications_active_version_idx;
create unique index cms_publications_active_content_idx
  on public.cms_publications(content_id)
  where status in ('queued', 'validating', 'pr_open', 'merged');

create or replace function public.cms_mark_publication_merged(
  p_publication_id uuid,
  p_merge_sha text,
  p_merged_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publication public.cms_publications%rowtype;
  v_record public.cms_content_records%rowtype;
  v_event_type text;
begin
  if p_merge_sha !~ '^[a-f0-9]{40}$' then
    raise exception 'invalid merge sha' using errcode = '22023';
  end if;

  select * into v_publication
  from public.cms_publications
  where id = p_publication_id
  for update;

  if not found then
    raise exception 'publication not found' using errcode = 'P0002';
  end if;
  if v_publication.status in ('merged', 'live', 'archived') then
    return false;
  end if;
  if v_publication.status not in ('queued', 'validating', 'pr_open') then
    raise exception 'publication cannot be merged from state %', v_publication.status
      using errcode = '22023';
  end if;

  select * into v_record
  from public.cms_content_records
  where id = v_publication.content_id
  for update;

  update public.cms_publications
  set status = 'merged', merge_sha = p_merge_sha, merged_at = p_merged_at,
      error_code = null, error_message = null
  where id = v_publication.id;

  update public.cms_content_records
  set workflow_state = case when v_publication.operation = 'archive' then 'archiving' else 'publishing' end,
      publication_state = 'merged', deployment_state = 'deploying',
      merge_sha = p_merge_sha, github_sha = p_merge_sha, updated_at = now()
  where id = v_publication.content_id;

  v_event_type := case
    when v_publication.operation = 'archive' then 'content_archive_merged'
    else 'content_publish_merged'
  end;
  insert into public.cms_workflow_events (
    content_id, from_state, to_state, event_type, content_sha, actor_id, metadata
  ) values (
    v_publication.content_id,
    v_record.workflow_state,
    case when v_publication.operation = 'archive' then 'archiving' else 'publishing' end,
    v_event_type,
    (select content_sha from public.cms_content_versions where id = v_publication.version_id),
    v_publication.requested_by,
    jsonb_build_object(
      'publication_id', v_publication.id,
      'pull_request', v_publication.github_pr_number,
      'merge_sha', p_merge_sha
    )
  ) on conflict do nothing;
  return true;
end;
$$;

create or replace function public.cms_finalize_publication(
  p_publication_id uuid,
  p_deploy_id text,
  p_deploy_url text,
  p_deployed_at timestamptz,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publication public.cms_publications%rowtype;
  v_record public.cms_content_records%rowtype;
  v_version public.cms_content_versions%rowtype;
  v_terminal_status text;
  v_workflow_state text;
  v_event_type text;
begin
  select * into v_publication
  from public.cms_publications
  where id = p_publication_id
  for update;

  if not found then
    raise exception 'publication not found' using errcode = 'P0002';
  end if;
  if v_publication.status in ('live', 'archived') then
    return false;
  end if;
  if v_publication.status <> 'merged' then
    raise exception 'publication is not ready for deployment confirmation' using errcode = '22023';
  end if;

  select * into v_record
  from public.cms_content_records
  where id = v_publication.content_id
  for update;
  select * into v_version
  from public.cms_content_versions
  where id = v_publication.version_id;

  if v_publication.operation = 'archive' then
    v_terminal_status := 'archived';
    v_workflow_state := 'archived';
    v_event_type := 'content_archived';

    update public.cms_content_records
    set published_sha = null, published_version_id = null, published_by = null,
        published_at = null, workflow_state = 'archived',
        publication_state = 'archived', deployment_state = 'archived',
        updated_at = now()
    where id = v_publication.content_id;
  else
    v_terminal_status := 'live';
    v_workflow_state := case
      when v_record.current_sha = v_version.content_sha then 'published'
      else 'draft'
    end;
    v_event_type := 'content_published';

    update public.cms_content_records
    set published_sha = v_version.content_sha,
        published_version_id = v_version.id,
        published_by = v_publication.requested_by,
        published_at = p_deployed_at,
        workflow_state = v_workflow_state,
        publication_state = 'live', deployment_state = 'live',
        updated_at = now()
    where id = v_publication.content_id;
  end if;

  update public.cms_publications
  set status = v_terminal_status, deploy_id = p_deploy_id, deploy_url = p_deploy_url,
      live_at = p_deployed_at, error_code = null, error_message = null
  where id = v_publication.id;

  insert into public.cms_workflow_events (
    content_id, from_state, to_state, event_type, content_sha, actor_id, metadata
  ) values (
    v_publication.content_id, v_record.workflow_state, v_workflow_state,
    v_event_type, v_version.content_sha, v_publication.requested_by,
    jsonb_build_object(
      'publication_id', v_publication.id,
      'pull_request', v_publication.github_pr_number,
      'merge_sha', v_publication.merge_sha,
      'deploy_id', p_deploy_id,
      'deploy_url', p_deploy_url
    )
  ) on conflict do nothing;

  insert into public.audit_log (
    request_id, actor_id, action, resource_type, resource_id, result, metadata
  ) values (
    p_request_id,
    v_publication.requested_by,
    v_event_type,
    v_record.collection,
    v_record.id,
    'success',
    jsonb_build_object(
      'path', v_record.path,
      'content_sha', v_version.content_sha,
      'merge_sha', v_publication.merge_sha,
      'deploy_id', p_deploy_id
    )
  );
  return true;
end;
$$;

revoke all on function public.cms_mark_publication_merged(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.cms_finalize_publication(uuid, text, text, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.cms_mark_publication_merged(uuid, text, timestamptz)
  to service_role;
grant execute on function public.cms_finalize_publication(uuid, text, text, timestamptz, uuid)
  to service_role;

-- Los documentos de prueba retirados de Git quedan también bloqueados en el
-- workspace editorial para que no puedan republicarse por accidente.
update public.cms_content_records
set workflow_state = 'archived', publication_state = 'archived', deployment_state = 'archived',
    published_sha = null, published_version_id = null, published_by = null, published_at = null,
    updated_at = now()
where id in (
  '1270fef3-f948-496f-9679-74a9bd32b883',
  'c5c912d3-2199-4cbe-ba8a-8a895f902a70',
  '9e31b8e6-72a7-46f2-9f32-ef1fa910f6da',
  '73739528-dda0-4f81-8cac-5fc7f405870c',
  '360ce165-29d8-4086-bacc-2f9375a871d3',
  '7ae98086-23b8-427d-91e2-500a0716cfc5',
  '171ad509-0857-4dca-a9d7-64bfae717a23'
);

commit;
