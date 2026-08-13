-- Non-destructive, repeatable migration for fixed 2-4 player slots.
-- Existing runs, encounters, Pokemon and SoulLinks are preserved.

begin;

alter table public.run_members add column if not exists player_id text;
alter table public.run_members add column if not exists color text;
alter table public.run_members add column if not exists active boolean not null default true;

alter table public.run_members drop constraint if exists run_members_role_check;
update public.run_members
set role = case role when 'owner' then 'host' when 'viewer' then 'spectator' else role end
where role in ('owner', 'viewer');
alter table public.run_members
  add constraint run_members_role_check check (role in ('host', 'player', 'spectator'));

-- Add playerCount, playerSlots and runStatus to legacy JSON states.
-- Historical player objects are never removed. At most the first four active
-- players are assigned to slots because supported runs have 2-4 slots.
do $$
declare
  run_row record;
  fixed_count integer;
  active_count integer;
  slot_index integer;
  slots jsonb;
  player_item jsonb;
  member_item jsonb;
  normalized_status text;
begin
  for run_row in select id, game, badges, current_boss, state from public.runs for update loop
    select count(*) into active_count
    from jsonb_array_elements(coalesce(run_row.state->'players', '[]'::jsonb)) player
    where coalesce((player->>'active')::boolean, true);

    fixed_count := case
      when coalesce(run_row.state->>'playerCount', '') ~ '^[234]$'
        then (run_row.state->>'playerCount')::integer
      else least(4, greatest(2, active_count))
    end;

    if jsonb_typeof(run_row.state->'playerSlots') = 'array'
       and jsonb_array_length(run_row.state->'playerSlots') = fixed_count then
      slots := run_row.state->'playerSlots';
    else
      slots := '[]'::jsonb;
      for slot_index in 1..fixed_count loop
        select player into player_item
        from jsonb_array_elements(coalesce(run_row.state->'players', '[]'::jsonb)) player
        where coalesce((player->>'active')::boolean, true)
        offset slot_index - 1 limit 1;

        member_item := null;
        if player_item is not null then
          select member into member_item
          from jsonb_array_elements(coalesce(run_row.state->'members', '[]'::jsonb)) member
          where member->>'playerId' = player_item->>'id'
            and coalesce((member->>'active')::boolean, true)
          limit 1;
        end if;

        slots := slots || jsonb_build_array(
          jsonb_build_object('id', 'slot_' || slot_index, 'position', slot_index)
          || case when player_item is not null
               then jsonb_build_object('playerId', player_item->>'id')
               else '{}'::jsonb end
          || case when member_item is not null
               then jsonb_build_object('memberId', member_item->>'id')
               else '{}'::jsonb end
        );
        player_item := null;
      end loop;
    end if;

    normalized_status := case
      when run_row.state->>'runStatus' in ('setup', 'active', 'finished')
        then run_row.state->>'runStatus'
      when lower(coalesce(run_row.current_boss, '')) like '%liga geschafft%'
        or lower(coalesce(run_row.state->>'currentBoss', '')) like '%liga geschafft%'
        then 'finished'
      else 'active'
    end;

    update public.runs
    set state = jsonb_set(
      jsonb_set(
        jsonb_set(run_row.state, '{playerCount}', to_jsonb(fixed_count), true),
        '{playerSlots}', slots, true
      ),
      '{runStatus}', to_jsonb(normalized_status), true
    )
    where id = run_row.id;
  end loop;
end;
$$;

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

create or replace function public.run_member_role(target_run uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.run_members
  where run_id = target_run and user_id = auth.uid() and active
  limit 1;
$$;

revoke all on function public.is_run_member(uuid) from public;
revoke all on function public.run_member_role(uuid) from public;
grant execute on function public.is_run_member(uuid) to authenticated;
grant execute on function public.run_member_role(uuid) to authenticated;

drop function if exists public.preview_run(text);
create function public.preview_run(code text)
returns table(
  id uuid,
  name text,
  game text,
  player_count bigint,
  max_players integer,
  soul_link_enabled boolean,
  already_joined boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select r.id, r.name, r.game,
    (select count(*)
     from jsonb_array_elements(coalesce(r.state->'playerSlots', '[]'::jsonb)) slot
     where nullif(slot->>'playerId', '') is not null),
    coalesce((r.state->>'playerCount')::integer, 3),
    coalesce((r.state->>'soulLinkEnabled')::boolean, true),
    exists(
      select 1 from public.run_members member
      where member.run_id = r.id and member.user_id = auth.uid() and member.active
    )
  from public.runs r
  where r.invite_code = upper(trim(code));
$$;
grant execute on function public.preview_run(text) to authenticated;

drop function if exists public.join_run(text, text);
create or replace function public.join_run(
  code text,
  player_name text,
  member_role text default 'player',
  player_color text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  current_state jsonb;
  new_player_id text;
  clean_name text;
  free_slot_id text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if member_role not in ('player', 'spectator') then raise exception 'Invalid role'; end if;

  clean_name := coalesce(
    nullif(trim(player_name), ''),
    case when member_role = 'spectator' then 'Zuschauer' end
  );
  if clean_name is null then raise exception 'Name required'; end if;

  select id, state into target, current_state
  from public.runs
  where invite_code = upper(trim(code))
  for update;

  if target is null then raise exception 'Run not found'; end if;
  if exists (
    select 1 from public.run_members
    where run_id = target and user_id = auth.uid() and active
  ) then return target; end if;

  if member_role = 'player' then
    select slot->>'id' into free_slot_id
    from jsonb_array_elements(coalesce(current_state->'playerSlots', '[]'::jsonb)) slot
    where nullif(slot->>'playerId', '') is null
    order by (slot->>'position')::integer
    limit 1;
    if free_slot_id is null then raise exception 'Alle Spielerplätze sind bereits belegt.'; end if;
  end if;

  if exists (
    select 1 from public.run_members
    where run_id = target and active and lower(display_name) = lower(clean_name)
  ) then raise exception 'Dieser Spielername wird bereits verwendet.'; end if;

  new_player_id := case when member_role = 'player'
    then 'player_' || substr(md5(random()::text || clock_timestamp()::text), 1, 8)
  end;

  insert into public.run_members(run_id, user_id, player_id, display_name, role, color, active)
  values (target, auth.uid(), new_player_id, clean_name, member_role, player_color, true)
  on conflict (run_id, user_id) do update
  set player_id = excluded.player_id,
      display_name = excluded.display_name,
      role = excluded.role,
      color = excluded.color,
      active = true;

  if member_role = 'player' then
    current_state := jsonb_set(
      current_state,
      '{players}',
      coalesce(current_state->'players', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
          'id', new_player_id, 'name', clean_name,
          'color', player_color, 'active', true
        )),
      true
    );
    current_state := jsonb_set(
      current_state,
      '{playerSlots}',
      coalesce((
        select jsonb_agg(
          case when slot->>'id' = free_slot_id
            then slot || jsonb_build_object(
              'playerId', new_player_id,
              'memberId', auth.uid()::text
            )
            else slot end
          order by (slot->>'position')::integer
        )
        from jsonb_array_elements(current_state->'playerSlots') slot
      ), '[]'::jsonb),
      true
    );
  end if;

  current_state := jsonb_set(
    current_state,
    '{members}',
    coalesce(current_state->'members', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'id', auth.uid()::text,
        'participantId', auth.uid()::text,
        'displayName', clean_name,
        'role', member_role,
        'playerId', new_player_id,
        'color', player_color,
        'active', true,
        'joinedAt', now()
      )),
    true
  );

  update public.runs set state = current_state where id = target;
  return target;
end;
$$;
grant execute on function public.join_run(text, text, text, text) to authenticated;

create or replace function public.manage_run_member(
  target_run uuid,
  target_user uuid,
  member_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_player text;
begin
  if public.run_member_role(target_run) <> 'host' then
    raise exception 'Host permission required';
  end if;

  if member_action = 'remove' then
    select player_id into target_player
    from public.run_members
    where run_id = target_run and user_id = target_user and role <> 'host';
    if not found then raise exception 'Member not removable'; end if;

    update public.run_members set active = false
    where run_id = target_run and user_id = target_user;

    update public.runs
    set state = jsonb_set(
      jsonb_set(
        jsonb_set(
          state,
          '{members}',
          coalesce((select jsonb_agg(
            case when item->>'participantId' = target_user::text
              then item || '{"active":false}'::jsonb else item end
          ) from jsonb_array_elements(state->'members') item), '[]'::jsonb)
        ),
        '{players}',
        coalesce((select jsonb_agg(
          case when item->>'id' = target_player
            then item || '{"active":false}'::jsonb else item end
        ) from jsonb_array_elements(state->'players') item), '[]'::jsonb)
      ),
      '{playerSlots}',
      coalesce((select jsonb_agg(
        case when slot->>'playerId' = target_player
          then slot - 'playerId' - 'memberId' else slot end
        order by (slot->>'position')::integer
      ) from jsonb_array_elements(state->'playerSlots') slot), '[]'::jsonb)
    )
    where id = target_run;

  elsif member_action = 'transfer_host' then
    if not exists (
      select 1 from public.run_members
      where run_id = target_run and user_id = target_user
        and active and role = 'player'
    ) then raise exception 'Active player required'; end if;

    update public.run_members
    set role = case
      when user_id = target_user then 'host'
      when user_id = auth.uid() then 'player'
      else role end
    where run_id = target_run;

    update public.runs
    set owner_id = target_user,
        state = jsonb_set(
          state,
          '{members}',
          coalesce((select jsonb_agg(
            case
              when item->>'participantId' = target_user::text
                then item || '{"role":"host"}'::jsonb
              when item->>'participantId' = auth.uid()::text
                then item || '{"role":"player"}'::jsonb
              else item end
          ) from jsonb_array_elements(state->'members') item), '[]'::jsonb)
        )
    where id = target_run;
  else
    raise exception 'Invalid action';
  end if;
end;
$$;
grant execute on function public.manage_run_member(uuid, uuid, text) to authenticated;

create or replace function public.leave_run(target_run uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  leaving_role text;
  leaving_player text;
begin
  select role, player_id into leaving_role, leaving_player
  from public.run_members
  where run_id = target_run and user_id = auth.uid() and active;

  if leaving_role is null then return; end if;
  if leaving_role = 'host' and exists (
    select 1 from public.run_members
    where run_id = target_run and user_id <> auth.uid()
      and active and role in ('host', 'player')
  ) then
    raise exception 'Übertrage zuerst die Host-Rolle oder entferne die anderen Spieler.';
  end if;

  update public.run_members set active = false
  where run_id = target_run and user_id = auth.uid();

  update public.runs
  set state = jsonb_set(
    jsonb_set(
      jsonb_set(
        state,
        '{members}',
        coalesce((select jsonb_agg(
          case when item->>'participantId' = auth.uid()::text
            then item || '{"active":false}'::jsonb else item end
        ) from jsonb_array_elements(state->'members') item), '[]'::jsonb)
      ),
      '{players}',
      coalesce((select jsonb_agg(
        case when item->>'id' = leaving_player
          then item || '{"active":false}'::jsonb else item end
      ) from jsonb_array_elements(state->'players') item), '[]'::jsonb)
    ),
    '{playerSlots}',
    coalesce((select jsonb_agg(
      case when slot->>'playerId' = leaving_player
        then slot - 'playerId' - 'memberId' else slot end
      order by (slot->>'position')::integer
    ) from jsonb_array_elements(state->'playerSlots') slot), '[]'::jsonb)
  )
  where id = target_run;
end;
$$;
grant execute on function public.leave_run(uuid) to authenticated;

-- Recreate only policies affected by member roles and spectator write access.
alter table public.runs enable row level security;
alter table public.run_members enable row level security;
alter table public.encounters enable row level security;
alter table public.pokemon enable row level security;

drop policy if exists "runs_select_members" on public.runs;
drop policy if exists "runs_update_members" on public.runs;
drop policy if exists "members_select_members" on public.run_members;
drop policy if exists "members_update_self" on public.run_members;
drop policy if exists "members_update_host" on public.run_members;
drop policy if exists "encounters_member_all" on public.encounters;
drop policy if exists "pokemon_member_all" on public.pokemon;

create policy "runs_select_members" on public.runs for select to authenticated
using (public.is_run_member(id) or owner_id = auth.uid());

create policy "runs_update_members" on public.runs for update to authenticated
using (public.run_member_role(id) in ('host', 'player') or owner_id = auth.uid())
with check (public.run_member_role(id) in ('host', 'player') or owner_id = auth.uid());

create policy "members_select_members" on public.run_members for select to authenticated
using (public.is_run_member(run_id) or user_id = auth.uid());

create policy "members_update_host" on public.run_members for update to authenticated
using (public.run_member_role(run_id) = 'host')
with check (public.run_member_role(run_id) = 'host');

create policy "encounters_member_all" on public.encounters for all to authenticated
using (public.run_member_role(run_id) in ('host', 'player'))
with check (public.run_member_role(run_id) in ('host', 'player'));

create policy "pokemon_member_all" on public.pokemon for all to authenticated
using (public.run_member_role(run_id) in ('host', 'player'))
with check (public.run_member_role(run_id) in ('host', 'player'));

commit;
