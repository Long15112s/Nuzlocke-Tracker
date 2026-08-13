-- Idempotent, non-destructive RPC for deleting exactly one run.
-- Existing data is only deleted when an authenticated owner/current host
-- explicitly invokes public.delete_run for that run.

create or replace function public.delete_run(target_run uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  run_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select owner_id into run_owner
  from public.runs
  where id = target_run;

  -- Idempotent success if another request already deleted this run.
  if not found then
    return;
  end if;

  if run_owner <> auth.uid() and not exists (
    select 1
    from public.run_members member
    where member.run_id = target_run
      and member.user_id = auth.uid()
      and member.active = true
      and member.role = 'host'
  ) then
    raise exception 'Host permission required' using errcode = '42501';
  end if;

  delete from public.runs
  where id = target_run;
end;
$$;

revoke all on function public.delete_run(uuid) from public;
grant execute on function public.delete_run(uuid) to authenticated;
