begin;

create table if not exists public.cms_rate_limits (
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  action text not null check (
    action in ('read', 'write', 'login-sensitive', 'media-upload', 'user-management', 'publish')
  ),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null,
  primary key (subject_hash, action)
);

create index if not exists cms_rate_limits_expires_idx
  on public.cms_rate_limits(expires_at);

alter table public.cms_rate_limits enable row level security;
revoke all on public.cms_rate_limits from public, anon, authenticated;

create or replace function public.cms_consume_rate_limit(
  p_subject_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_time timestamptz := clock_timestamp();
  bucket public.cms_rate_limits%rowtype;
begin
  if p_subject_hash !~ '^[a-f0-9]{64}$'
    or p_action not in ('read', 'write', 'login-sensitive', 'media-upload', 'user-management', 'publish')
    or p_limit < 1 or p_limit > 10000
    or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;

  insert into public.cms_rate_limits as limits (
    subject_hash, action, window_started_at, request_count, expires_at
  ) values (
    p_subject_hash,
    p_action,
    current_time,
    1,
    current_time + make_interval(secs => p_window_seconds * 2)
  )
  on conflict (subject_hash, action) do update set
    window_started_at = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= current_time
        then current_time
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= current_time
        then 1
      else limits.request_count + 1
    end,
    expires_at = current_time + make_interval(secs => p_window_seconds * 2)
  returning limits.* into bucket;

  allowed := bucket.request_count <= p_limit;
  remaining := greatest(0, p_limit - bucket.request_count);
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(extract(epoch from (
        bucket.window_started_at + make_interval(secs => p_window_seconds) - current_time
      )))::integer
    )
  end;

  -- Poda oportunista y acotada; la función de mantenimiento hace la limpieza completa.
  if random() < 0.01 then
    delete from public.cms_rate_limits
    where (subject_hash, action) in (
      select stale.subject_hash, stale.action
      from public.cms_rate_limits as stale
      where stale.expires_at < current_time
      order by stale.expires_at
      limit 100
    );
  end if;

  return next;
end;
$$;

revoke all on function public.cms_consume_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.cms_consume_rate_limit(text, text, integer, integer)
  to service_role;

create or replace function public.cms_prune_operational_data()
returns void language sql security definer set search_path = '' as $$
  delete from public.cms_operation_keys where created_at < now() - interval '7 days';
  delete from public.cms_rate_limits where expires_at < now();
  delete from public.audit_log where created_at < now() - interval '365 days';
$$;
revoke all on function public.cms_prune_operational_data() from public, anon, authenticated;
grant execute on function public.cms_prune_operational_data() to service_role;

commit;
