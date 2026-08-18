begin;

alter table public.cms_publications
  add column if not exists operational_cleaned_at timestamptz;

create index if not exists cms_publications_operational_cleanup_idx
  on public.cms_publications(updated_at)
  where operational_cleaned_at is null
    and status in ('live', 'archived', 'failed', 'cancelled');

create or replace function public.cms_prune_operational_data()
returns void language sql security definer set search_path = '' as $$
  delete from public.cms_operation_keys
    where created_at < now() - interval '7 days';
  delete from public.cms_rate_limits
    where expires_at < now();
  delete from public.audit_log
    where created_at < now() - interval '365 days';
  delete from public.cms_workflow_events
    where created_at < now() - interval '730 days';
  delete from public.cms_publications
    where operational_cleaned_at is not null
      and (
        (status in ('failed', 'cancelled') and updated_at < now() - interval '180 days')
        or (status in ('live', 'archived') and updated_at < now() - interval '730 days')
      );
$$;

revoke all on function public.cms_prune_operational_data() from public, anon, authenticated;
grant execute on function public.cms_prune_operational_data() to service_role;

comment on column public.cms_publications.operational_cleaned_at is
  'Momento en que la rama CMS y, si aplica, el PR fallido/cancelado ya fueron limpiados en GitHub.';

commit;
