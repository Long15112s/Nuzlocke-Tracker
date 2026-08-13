-- Keep kicked users able to observe their own inactive membership while
-- preserving the existing visibility rules for other members.
-- Non-destructive and safe to execute repeatedly.

begin;

alter table public.run_members replica identity full;
alter table public.runs replica identity full;

alter table public.run_members enable row level security;

drop policy if exists "members_select_members" on public.run_members;
drop policy if exists "members_select_own" on public.run_members;
drop policy if exists "members_select_active_run" on public.run_members;

create policy "members_select_own" on public.run_members
for select to authenticated
using (user_id = auth.uid());

create policy "members_select_active_run" on public.run_members
for select to authenticated
using (public.is_run_member(run_id));

do $$
begin
  alter publication supabase_realtime add table public.run_members;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.runs;
exception when duplicate_object then null;
end $$;

commit;
