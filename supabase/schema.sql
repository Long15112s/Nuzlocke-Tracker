-- Nuzlink Supabase schema (MVP)
-- 1) Enable anonymous sign-ins in Supabase Auth.
-- 2) Run this file in the SQL editor.
-- 3) Add the project URL and publishable key to .env.local.

create extension if not exists pgcrypto;

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  game text not null,
  current_boss text not null default 'Nächster Boss',
  level_cap integer not null default 1 check (level_cap > 0),
  badges integer not null default 0 check (badges >= 0),
  randomizer jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.run_members (
  run_id uuid not null references public.runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id text,
  display_name text not null,
  role text not null default 'player' check (role in ('host','player','spectator')),
  color text,
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (run_id, user_id)
);

-- Safe upgrade path for projects created with the earlier owner/player/viewer schema.
alter table public.run_members add column if not exists player_id text;
alter table public.run_members add column if not exists color text;
alter table public.run_members add column if not exists active boolean not null default true;
alter table public.run_members add column if not exists recovery_code_hash bytea;
alter table public.run_members add column if not exists recovery_code_created_at timestamptz;
alter table public.run_members add column if not exists recovered_at timestamptz;
alter table public.run_members add column if not exists inactive_reason text;
alter table public.run_members drop constraint if exists run_members_role_check;
update public.run_members set role = case role when 'owner' then 'host' when 'viewer' then 'spectator' else role end;
alter table public.run_members add constraint run_members_role_check check (role in ('host','player','spectator'));

create table if not exists public.encounters (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  location text not null,
  species text not null,
  nickname text not null default '',
  level integer not null check (level > 0),
  status text not null check (status in ('caught','defeated','fled','reroll','skipped')),
  soul_link_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.pokemon (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  species text not null,
  nickname text not null default '',
  level integer not null check (level > 0),
  location text not null,
  ability text,
  item text,
  status text not null default 'box' check (status in ('team','box','dead')),
  soul_link_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_members_user on public.run_members(user_id);
create index if not exists idx_encounters_run on public.encounters(run_id);
create index if not exists idx_pokemon_run on public.pokemon(run_id);

-- SECURITY DEFINER helper avoids recursive RLS lookups on run_members.
create or replace function public.is_run_member(target_run uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.run_members
    where run_id = target_run and user_id = auth.uid() and active
  );
$$;

revoke all on function public.is_run_member(uuid) from public;
grant execute on function public.is_run_member(uuid) to authenticated;

create or replace function public.run_member_role(target_run uuid)
returns text language sql security definer set search_path = public stable as $$
  select role from public.run_members where run_id = target_run and user_id = auth.uid() and active limit 1;
$$;
revoke all on function public.run_member_role(uuid) from public;
grant execute on function public.run_member_role(uuid) to authenticated;

drop function if exists public.preview_run(text);
create or replace function public.preview_run(code text)
returns table(id uuid, name text, game text, player_count bigint, max_players integer, soul_link_enabled boolean, already_joined boolean)
language sql security definer set search_path = public stable as $$
  select r.id, r.name, r.game,
    (select count(*) from jsonb_array_elements(coalesce(r.state->'playerSlots','[]'::jsonb)) slot where nullif(slot->>'playerId','') is not null),
    coalesce((r.state->>'playerCount')::integer, 3),
    coalesce((r.state->>'soulLinkEnabled')::boolean, true),
    exists(select 1 from public.run_members m where m.run_id = r.id and m.user_id = auth.uid() and m.active)
  from public.runs r where r.invite_code = upper(trim(code));
$$;
grant execute on function public.preview_run(text) to authenticated;

drop function if exists public.join_run(text, text);
create or replace function public.join_run(code text, player_name text, member_role text default 'player', player_color text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare target uuid; current_state jsonb; new_player_id text; clean_name text; free_slot_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if member_role not in ('player','spectator') then raise exception 'Invalid role'; end if;
  clean_name := coalesce(nullif(trim(player_name), ''), case when member_role = 'spectator' then 'Zuschauer' end);
  if clean_name is null then raise exception 'Name required'; end if;
  select id, state into target, current_state from public.runs where invite_code = upper(trim(code)) for update;
  if target is null then raise exception 'Run not found'; end if;
  if exists(select 1 from public.run_members where run_id = target and user_id = auth.uid() and active) then return target; end if;
  if member_role = 'player' then
    select slot->>'id' into free_slot_id from jsonb_array_elements(coalesce(current_state->'playerSlots','[]'::jsonb)) slot where nullif(slot->>'playerId','') is null order by (slot->>'position')::integer limit 1;
    if free_slot_id is null then raise exception 'Alle Spielerplätze sind bereits belegt.'; end if;
  end if;
  if exists(select 1 from public.run_members where run_id = target and active and lower(display_name) = lower(clean_name)) then raise exception 'Dieser Spielername wird bereits verwendet.'; end if;
  new_player_id := case when member_role = 'player' then 'player_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8) end;
  insert into public.run_members(run_id, user_id, display_name, role)
  values (target, auth.uid(), clean_name, member_role)
  on conflict (run_id, user_id) do update set display_name = excluded.display_name, role = excluded.role, active = true, player_id = new_player_id, color = player_color;
  update public.run_members set player_id = new_player_id, color = player_color where run_id = target and user_id = auth.uid();
  if member_role = 'player' then
    current_state := jsonb_set(current_state, '{players}', coalesce(current_state->'players','[]'::jsonb) || jsonb_build_array(jsonb_build_object('id',new_player_id,'name',clean_name,'color',player_color,'active',true)));
    current_state := jsonb_set(current_state, '{playerSlots}', coalesce((select jsonb_agg(case when slot->>'id' = free_slot_id then slot || jsonb_build_object('playerId',new_player_id,'memberId',auth.uid()::text) else slot end order by (slot->>'position')::integer) from jsonb_array_elements(current_state->'playerSlots') slot), '[]'::jsonb));
  end if;
  current_state := jsonb_set(current_state, '{members}', coalesce(current_state->'members','[]'::jsonb) || jsonb_build_array(jsonb_build_object('id',auth.uid()::text,'participantId',auth.uid()::text,'displayName',clean_name,'role',member_role,'playerId',new_player_id,'color',player_color,'active',true,'joinedAt',now())));
  update public.runs set state = current_state where id = target;
  return target;
end;
$$;

grant execute on function public.join_run(text, text, text, text) to authenticated;

create or replace function public.manage_run_member(target_run uuid, target_user uuid, member_action text)
returns void language plpgsql security definer set search_path = public as $$
declare target_player text;
begin
  if public.run_member_role(target_run) <> 'host' then raise exception 'Host permission required'; end if;
  if member_action = 'remove' then
    select player_id into target_player from public.run_members where run_id = target_run and user_id = target_user and role <> 'host';
    if not found then raise exception 'Member not removable'; end if;
    update public.run_members set active = false, recovery_code_hash = null, inactive_reason = 'kicked' where run_id = target_run and user_id = target_user;
    update public.runs set state = jsonb_set(jsonb_set(state, '{members}', coalesce((select jsonb_agg(case when item->>'participantId' = target_user::text then item || '{"active":false}'::jsonb else item end) from jsonb_array_elements(state->'members') item), '[]'::jsonb)), '{players}', coalesce((select jsonb_agg(case when item->>'id' = target_player then item || '{"active":false}'::jsonb else item end) from jsonb_array_elements(state->'players') item), '[]'::jsonb)) where id = target_run;
    update public.runs set state = jsonb_set(state, '{playerSlots}', coalesce((select jsonb_agg(case when slot->>'playerId' = target_player then slot - 'playerId' - 'memberId' else slot end order by (slot->>'position')::integer) from jsonb_array_elements(state->'playerSlots') slot), '[]'::jsonb)) where id = target_run;
  elsif member_action = 'transfer_host' then
    if not exists(select 1 from public.run_members where run_id = target_run and user_id = target_user and active and role = 'player') then raise exception 'Active player required'; end if;
    update public.run_members set role = case when user_id = target_user then 'host' when user_id = auth.uid() then 'player' else role end where run_id = target_run;
    update public.runs set owner_id = target_user, state = jsonb_set(state, '{members}', coalesce((select jsonb_agg(case when item->>'participantId' = target_user::text then item || '{"role":"host"}'::jsonb when item->>'participantId' = auth.uid()::text then item || '{"role":"player"}'::jsonb else item end) from jsonb_array_elements(state->'members') item), '[]'::jsonb)) where id = target_run;
  else raise exception 'Invalid action';
  end if;
end;
$$;
grant execute on function public.manage_run_member(uuid, uuid, text) to authenticated;

create or replace function public.leave_run(target_run uuid)
returns void language plpgsql security definer set search_path = public as $$
declare leaving_role text; leaving_player text;
begin
  select role, player_id into leaving_role, leaving_player from public.run_members where run_id = target_run and user_id = auth.uid() and active;
  if leaving_role is null then return; end if;
  if leaving_role = 'host' and exists(select 1 from public.run_members where run_id = target_run and user_id <> auth.uid() and active and role in ('host','player')) then raise exception 'Übertrage zuerst die Host-Rolle oder entferne die anderen Spieler.'; end if;
  update public.run_members set active = false, recovery_code_hash = null, inactive_reason = 'left' where run_id = target_run and user_id = auth.uid();
  update public.runs set state = jsonb_set(state, '{members}', coalesce((select jsonb_agg(case when item->>'participantId' = auth.uid()::text then item || '{"active":false}'::jsonb else item end) from jsonb_array_elements(state->'members') item), '[]'::jsonb)) where id = target_run;
  if leaving_player is not null then
    update public.runs set state = jsonb_set(jsonb_set(state, '{players}', coalesce((select jsonb_agg(case when item->>'id' = leaving_player then item || '{"active":false}'::jsonb else item end) from jsonb_array_elements(state->'players') item), '[]'::jsonb)), '{playerSlots}', coalesce((select jsonb_agg(case when slot->>'playerId' = leaving_player then slot - 'playerId' - 'memberId' else slot end order by (slot->>'position')::integer) from jsonb_array_elements(state->'playerSlots') slot), '[]'::jsonb)) where id = target_run;
  end if;
end;
$$;
grant execute on function public.leave_run(uuid) to authenticated;

create unique index if not exists run_members_one_active_player on public.run_members(run_id, player_id) where active and player_id is not null;

create or replace function public.format_member_recovery_code(raw_code text) returns text
language sql immutable set search_path=public as $$ select regexp_replace(upper(raw_code),'(.{4})(?=.)','\1-','g') $$;

create or replace function public.issue_member_recovery_code(target_run uuid) returns text
language plpgsql security definer set search_path=public as $$
declare raw_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform 1 from public.run_members where run_id=target_run and user_id=auth.uid() and active and role in ('host','player') for update;
  if not found then raise exception 'Active player membership required'; end if;
  if exists(select 1 from public.run_members where run_id=target_run and user_id=auth.uid() and recovery_code_hash is not null) then raise exception 'Recovery code already configured'; end if;
  raw_code:=upper(encode(gen_random_bytes(16),'hex'));
  update public.run_members set recovery_code_hash=digest(raw_code,'sha256'),recovery_code_created_at=now() where run_id=target_run and user_id=auth.uid();
  return public.format_member_recovery_code(raw_code);
end $$;

create or replace function public.rotate_member_recovery_code(target_run uuid) returns text
language plpgsql security definer set search_path=public as $$
declare raw_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform 1 from public.run_members where run_id=target_run and user_id=auth.uid() and active and role in ('host','player') for update;
  if not found then raise exception 'Active player membership required'; end if;
  raw_code:=upper(encode(gen_random_bytes(16),'hex'));
  update public.run_members set recovery_code_hash=digest(raw_code,'sha256'),recovery_code_created_at=now() where run_id=target_run and user_id=auth.uid();
  return public.format_member_recovery_code(raw_code);
end $$;

create or replace function public.recover_run_member(code text,recovery_code text)
returns table(run_id uuid,new_recovery_code text) language plpgsql security definer set search_path=public as $$
declare target public.runs%rowtype; old_member public.run_members%rowtype; normalized text; fresh text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  normalized:=upper(regexp_replace(coalesce(recovery_code,''),'[-[:space:]]','','g'));
  if normalized !~ '^[0-9A-F]{32}$' then raise exception 'Run or recovery code is invalid'; end if;
  select * into target from public.runs where invite_code=upper(trim(code)) for update;
  if not found then raise exception 'Run or recovery code is invalid'; end if;
  if exists(select 1 from public.run_members where run_id=target.id and user_id=auth.uid() and active) then raise exception 'This browser is already connected to this run'; end if;
  select * into old_member from public.run_members where run_id=target.id and active and role in ('host','player') and recovery_code_hash=digest(normalized,'sha256') for update;
  if not found then raise exception 'Run or recovery code is invalid'; end if;
  update public.run_members set active=false,recovery_code_hash=null,inactive_reason='recovered',recovered_at=now() where run_id=old_member.run_id and user_id=old_member.user_id;
  fresh:=upper(encode(gen_random_bytes(16),'hex'));
  insert into public.run_members(run_id,user_id,player_id,display_name,role,color,active,recovery_code_hash,recovery_code_created_at,recovered_at)
  values(old_member.run_id,auth.uid(),old_member.player_id,old_member.display_name,old_member.role,old_member.color,true,digest(fresh,'sha256'),now(),now())
  on conflict(run_id,user_id) do update set player_id=excluded.player_id,display_name=excluded.display_name,role=excluded.role,color=excluded.color,active=true,recovery_code_hash=excluded.recovery_code_hash,recovery_code_created_at=now(),recovered_at=now(),inactive_reason=null;
  update public.runs set owner_id=case when old_member.role='host' then auth.uid() else owner_id end,
    state=jsonb_set(state,'{members}',coalesce((select jsonb_agg(case when item->>'participantId'=old_member.user_id::text then item||jsonb_build_object('participantId',auth.uid()::text,'active',true,'role',old_member.role) else item end) from jsonb_array_elements(coalesce(state->'members','[]'::jsonb)) item),'[]'::jsonb)) where id=old_member.run_id;
  return query select old_member.run_id,public.format_member_recovery_code(fresh);
end $$;

revoke all on function public.format_member_recovery_code(text) from public;
revoke all on function public.issue_member_recovery_code(uuid) from public;
revoke all on function public.rotate_member_recovery_code(uuid) from public;
revoke all on function public.recover_run_member(text,text) from public;
grant execute on function public.issue_member_recovery_code(uuid) to authenticated;
grant execute on function public.rotate_member_recovery_code(uuid) to authenticated;
grant execute on function public.recover_run_member(text,text) to authenticated;

alter table public.runs enable row level security;
alter table public.run_members enable row level security;
alter table public.encounters enable row level security;
alter table public.pokemon enable row level security;

drop policy if exists "runs_insert_owner" on public.runs;
drop policy if exists "runs_select_members" on public.runs;
drop policy if exists "runs_update_members" on public.runs;
drop policy if exists "members_select_members" on public.run_members;
drop policy if exists "members_insert_owner_self" on public.run_members;
drop policy if exists "members_update_self" on public.run_members;
drop policy if exists "members_update_host" on public.run_members;
drop policy if exists "encounters_member_all" on public.encounters;
drop policy if exists "pokemon_member_all" on public.pokemon;

create policy "runs_insert_owner" on public.runs for insert to authenticated
with check (owner_id = auth.uid());
create policy "runs_select_members" on public.runs for select to authenticated
using (public.is_run_member(id) or owner_id = auth.uid());
create policy "runs_update_members" on public.runs for update to authenticated
using (public.run_member_role(id) in ('host','player') or owner_id = auth.uid())
with check (public.run_member_role(id) in ('host','player') or owner_id = auth.uid());

create policy "members_select_members" on public.run_members for select to authenticated
using (public.is_run_member(run_id) or user_id = auth.uid());
create policy "members_insert_owner_self" on public.run_members for insert to authenticated
with check (user_id = auth.uid() and exists (select 1 from public.runs r where r.id = run_id and r.owner_id = auth.uid()));
create policy "members_update_host" on public.run_members for update to authenticated
using (public.run_member_role(run_id) = 'host') with check (public.run_member_role(run_id) = 'host');

revoke select on public.run_members from authenticated;
grant select (run_id,user_id,player_id,display_name,role,color,active,joined_at,recovery_code_created_at,recovered_at,inactive_reason)
  on public.run_members to authenticated;

create policy "encounters_member_all" on public.encounters for all to authenticated
using (public.run_member_role(run_id) in ('host','player'))
with check (public.run_member_role(run_id) in ('host','player'));
create policy "pokemon_member_all" on public.pokemon for all to authenticated
using (public.run_member_role(run_id) in ('host','player'))
with check (public.run_member_role(run_id) in ('host','player'));

-- Realtime tables. If a table is already in the publication, Supabase may report a harmless duplicate-object error.
alter publication supabase_realtime add table public.runs;
alter publication supabase_realtime add table public.run_members;
alter publication supabase_realtime add table public.encounters;
alter publication supabase_realtime add table public.pokemon;
