-- Personal, single-use recovery codes for active host/player memberships.
-- Safe for existing runs: no run, player, encounter, Pokemon or SoulLink data is deleted.

create extension if not exists pgcrypto;

alter table public.run_members add column if not exists recovery_code_hash bytea;
alter table public.run_members add column if not exists recovery_code_created_at timestamptz;
alter table public.run_members add column if not exists recovered_at timestamptz;
alter table public.run_members add column if not exists inactive_reason text;

alter table public.run_members drop constraint if exists run_members_inactive_reason_check;
alter table public.run_members add constraint run_members_inactive_reason_check
  check (inactive_reason is null or inactive_reason in ('kicked','left','recovered'));

-- Normalize legacy duplicate active rows deterministically before enforcing the invariant.
with duplicates as (
  select run_id, player_id, user_id,
    row_number() over (partition by run_id, player_id order by (role = 'host') desc, joined_at desc, user_id) as position
  from public.run_members where active and player_id is not null
)
update public.run_members member
set active = false, recovery_code_hash = null, inactive_reason = 'recovered'
from duplicates duplicate
where member.run_id = duplicate.run_id and member.user_id = duplicate.user_id and duplicate.position > 1;

create unique index if not exists run_members_one_active_player
  on public.run_members(run_id, player_id) where active = true and player_id is not null;

create or replace function public.format_member_recovery_code(raw_code text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(upper(raw_code), '(.{4})(?=.)', '\1-', 'g');
$$;

drop function if exists public.issue_member_recovery_code(uuid);
create or replace function public.issue_member_recovery_code(target_run uuid)
returns text language plpgsql security definer set search_path = public as $$
declare raw_code text; member_row public.run_members%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into member_row from public.run_members
    where run_id = target_run and user_id = auth.uid() and active and role in ('host','player') for update;
  if not found then raise exception 'Active player membership required' using errcode = '42501'; end if;
  if member_row.recovery_code_hash is not null then raise exception 'Recovery code already configured' using errcode = 'P0001'; end if;
  raw_code := upper(encode(extensions.gen_random_bytes(16), 'hex'));
  update public.run_members set recovery_code_hash = extensions.digest(raw_code, 'sha256'), recovery_code_created_at = now()
    where run_id = target_run and user_id = auth.uid();
  return public.format_member_recovery_code(raw_code);
end;
$$;

drop function if exists public.rotate_member_recovery_code(uuid);
create or replace function public.rotate_member_recovery_code(target_run uuid)
returns text language plpgsql security definer set search_path = public as $$
declare raw_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  perform 1 from public.run_members
    where run_id = target_run and user_id = auth.uid() and active and role in ('host','player') for update;
  if not found then raise exception 'Active player membership required' using errcode = '42501'; end if;
  raw_code := upper(encode(extensions.gen_random_bytes(16), 'hex'));
  update public.run_members set recovery_code_hash = extensions.digest(raw_code, 'sha256'), recovery_code_created_at = now()
    where run_id = target_run and user_id = auth.uid();
  return public.format_member_recovery_code(raw_code);
end;
$$;

drop function if exists public.recover_run_member(text,text);
create or replace function public.recover_run_member(code text, recovery_code text)
returns table(run_id uuid, new_recovery_code text)
language plpgsql security definer set search_path = public as $$
declare target_run public.runs%rowtype; old_member public.run_members%rowtype; normalized_code text; raw_new_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  normalized_code := upper(regexp_replace(coalesce(recovery_code,''), '[-[:space:]]', '', 'g'));
  if normalized_code !~ '^[0-9A-F]{32}$' then raise exception 'Run or recovery code is invalid' using errcode = '22023'; end if;

  select * into target_run from public.runs where invite_code = upper(trim(code)) for update;
  if not found then raise exception 'Run or recovery code is invalid' using errcode = '22023'; end if;
  if exists(select 1 from public.run_members where run_id = target_run.id and user_id = auth.uid() and active) then
    raise exception 'This browser is already connected to this run' using errcode = 'P0001';
  end if;
  select * into old_member from public.run_members
    where run_id = target_run.id and active and role in ('host','player')
      and recovery_code_hash = extensions.digest(normalized_code, 'sha256') for update;
  if not found then raise exception 'Run or recovery code is invalid' using errcode = '22023'; end if;

  update public.run_members set active = false, recovery_code_hash = null, inactive_reason = 'recovered', recovered_at = now()
    where run_id = old_member.run_id and user_id = old_member.user_id;
  raw_new_code := upper(encode(extensions.gen_random_bytes(16), 'hex'));
  insert into public.run_members(run_id,user_id,player_id,display_name,role,color,active,joined_at,recovery_code_hash,recovery_code_created_at,recovered_at,inactive_reason)
  values(old_member.run_id,auth.uid(),old_member.player_id,old_member.display_name,old_member.role,old_member.color,true,now(),extensions.digest(raw_new_code,'sha256'),now(),now(),null)
  on conflict (run_id,user_id) do update set player_id=excluded.player_id,display_name=excluded.display_name,role=excluded.role,color=excluded.color,active=true,joined_at=now(),recovery_code_hash=excluded.recovery_code_hash,recovery_code_created_at=now(),recovered_at=now(),inactive_reason=null;

  update public.runs set
    owner_id = case when old_member.role = 'host' then auth.uid() else owner_id end,
    state = jsonb_set(state, '{members}', coalesce((select jsonb_agg(case
      when item->>'participantId' = old_member.user_id::text then item || jsonb_build_object('participantId',auth.uid()::text,'active',true,'role',old_member.role)
      else item end) from jsonb_array_elements(coalesce(state->'members','[]'::jsonb)) item),'[]'::jsonb))
    where id = old_member.run_id;
  return query select old_member.run_id, public.format_member_recovery_code(raw_new_code);
end;
$$;

-- Kick and leave invalidate codes server-side.
create or replace function public.manage_run_member(target_run uuid, target_user uuid, member_action text)
returns void language plpgsql security definer set search_path = public as $$
declare target_player text;
begin
  if public.run_member_role(target_run) <> 'host' then raise exception 'Host permission required'; end if;
  if member_action = 'remove' then
    select player_id into target_player from public.run_members where run_id=target_run and user_id=target_user and role<>'host';
    if not found then raise exception 'Member not removable'; end if;
    update public.run_members set active=false,recovery_code_hash=null,inactive_reason='kicked' where run_id=target_run and user_id=target_user;
    update public.runs set state=jsonb_set(jsonb_set(jsonb_set(state,'{members}',coalesce((select jsonb_agg(case when item->>'participantId'=target_user::text then item||'{"active":false}'::jsonb else item end) from jsonb_array_elements(state->'members') item),'[]'::jsonb)),'{players}',coalesce((select jsonb_agg(case when item->>'id'=target_player then item||'{"active":false}'::jsonb else item end) from jsonb_array_elements(state->'players') item),'[]'::jsonb)),'{playerSlots}',coalesce((select jsonb_agg(case when slot->>'playerId'=target_player then slot-'playerId'-'memberId' else slot end order by (slot->>'position')::integer) from jsonb_array_elements(state->'playerSlots') slot),'[]'::jsonb)) where id=target_run;
  elsif member_action='transfer_host' then
    if not exists(select 1 from public.run_members where run_id=target_run and user_id=target_user and active and role='player') then raise exception 'Active player required'; end if;
    update public.run_members set role=case when user_id=target_user then 'host' when user_id=auth.uid() then 'player' else role end where run_id=target_run and active;
    update public.runs set owner_id=target_user,state=jsonb_set(state,'{members}',coalesce((select jsonb_agg(case when item->>'participantId'=target_user::text then item||'{"role":"host"}'::jsonb when item->>'participantId'=auth.uid()::text then item||'{"role":"player"}'::jsonb else item end) from jsonb_array_elements(state->'members') item),'[]'::jsonb)) where id=target_run;
  else raise exception 'Invalid action'; end if;
end;
$$;

create or replace function public.leave_run(target_run uuid)
returns void language plpgsql security definer set search_path = public as $$
declare leaving_role text; leaving_player text;
begin
  select role,player_id into leaving_role,leaving_player from public.run_members where run_id=target_run and user_id=auth.uid() and active;
  if leaving_role is null then return; end if;
  if leaving_role='host' and exists(select 1 from public.run_members where run_id=target_run and user_id<>auth.uid() and active and role in ('host','player')) then raise exception 'Übertrage zuerst die Host-Rolle oder entferne die anderen Spieler.'; end if;
  update public.run_members set active=false,recovery_code_hash=null,inactive_reason='left' where run_id=target_run and user_id=auth.uid();
  update public.runs set state=jsonb_set(state,'{members}',coalesce((select jsonb_agg(case when item->>'participantId'=auth.uid()::text then item||'{"active":false}'::jsonb else item end) from jsonb_array_elements(state->'members') item),'[]'::jsonb)) where id=target_run;
  if leaving_player is not null then update public.runs set state=jsonb_set(jsonb_set(state,'{players}',coalesce((select jsonb_agg(case when item->>'id'=leaving_player then item||'{"active":false}'::jsonb else item end) from jsonb_array_elements(state->'players') item),'[]'::jsonb)),'{playerSlots}',coalesce((select jsonb_agg(case when slot->>'playerId'=leaving_player then slot-'playerId'-'memberId' else slot end order by (slot->>'position')::integer) from jsonb_array_elements(state->'playerSlots') slot),'[]'::jsonb)) where id=target_run; end if;
end;
$$;

revoke all on function public.format_member_recovery_code(text) from public;
revoke all on function public.issue_member_recovery_code(uuid) from public;
revoke all on function public.rotate_member_recovery_code(uuid) from public;
revoke all on function public.recover_run_member(text,text) from public;
revoke all on function public.manage_run_member(uuid,uuid,text) from public;
revoke all on function public.leave_run(uuid) from public;
grant execute on function public.issue_member_recovery_code(uuid) to authenticated;
grant execute on function public.rotate_member_recovery_code(uuid) to authenticated;
grant execute on function public.recover_run_member(text,text) to authenticated;
grant execute on function public.manage_run_member(uuid,uuid,text) to authenticated;
grant execute on function public.leave_run(uuid) to authenticated;

-- The hash is server-only: authenticated clients may read membership metadata, never the hash column.
revoke select on public.run_members from authenticated;
grant select (run_id,user_id,player_id,display_name,role,color,active,joined_at,recovery_code_created_at,recovered_at,inactive_reason)
  on public.run_members to authenticated;

-- Make newly created RPC signatures visible to PostgREST immediately.
notify pgrst, 'reload schema';
