begin;

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
  v_now timestamptz := clock_timestamp();
  v_bucket public.cms_rate_limits%rowtype;
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
    v_now,
    1,
    v_now + make_interval(secs => p_window_seconds * 2)
  )
  on conflict (subject_hash, action) do update set
    window_started_at = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
        then v_now
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at + make_interval(secs => p_window_seconds) <= v_now
        then 1
      else limits.request_count + 1
    end,
    expires_at = v_now + make_interval(secs => p_window_seconds * 2)
  returning limits.* into v_bucket;

  allowed := v_bucket.request_count <= p_limit;
  remaining := greatest(0, p_limit - v_bucket.request_count);
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(extract(epoch from (
        v_bucket.window_started_at + make_interval(secs => p_window_seconds) - v_now
      )))::integer
    )
  end;

  if random() < 0.01 then
    delete from public.cms_rate_limits
    where (subject_hash, action) in (
      select stale.subject_hash, stale.action
      from public.cms_rate_limits as stale
      where stale.expires_at < v_now
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

commit;
