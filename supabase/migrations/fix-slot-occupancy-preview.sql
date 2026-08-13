-- Non-destructive, idempotent repair for multiplayer slot occupancy.
-- Safe to execute repeatedly in the Supabase SQL Editor.

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
    (
      select count(*)
      from public.run_members member
      where member.run_id = r.id
        and member.active
        and member.role in ('host', 'player')
        and member.player_id is not null
        and exists (
          select 1
          from jsonb_array_elements(coalesce(r.state->'playerSlots', '[]'::jsonb)) slot
          where nullif(slot->>'playerId', '') = member.player_id
        )
    ),
    greatest(2, least(4, coalesce((r.state->>'playerCount')::integer, 3))),
    coalesce((r.state->>'soulLinkEnabled')::boolean, true),
    exists (
      select 1 from public.run_members member
      where member.run_id = r.id and member.user_id = auth.uid() and member.active
    )
  from public.runs r
  where r.invite_code = upper(trim(code));
$$;

revoke all on function public.preview_run(text) from public;
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

  clean_name := coalesce(nullif(trim(player_name), ''), case when member_role = 'spectator' then 'Zuschauer' end);
  if clean_name is null then raise exception 'Name required'; end if;

  select id, state into target, current_state
  from public.runs
  where invite_code = upper(trim(code))
  for update;

  if target is null then raise exception 'Run not found'; end if;
  if exists (select 1 from public.run_members where run_id = target and user_id = auth.uid() and active) then
    return target;
  end if;

  if member_role = 'player' then
    -- A JSON slot without a matching active host/player row is stale and becomes free.
    current_state := jsonb_set(
      current_state,
      '{playerSlots}',
      coalesce((
        select jsonb_agg(
          case
            when nullif(slot->>'playerId', '') is not null
             and exists (
               select 1 from public.run_members member
               where member.run_id = target
                 and member.active
                 and member.role in ('host', 'player')
                 and member.player_id = slot->>'playerId'
             ) then slot
            else slot - 'playerId' - 'memberId'
          end
          order by (slot->>'position')::integer
        )
        from jsonb_array_elements(coalesce(current_state->'playerSlots', '[]'::jsonb)) slot
      ), '[]'::jsonb),
      true
    );

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
  set player_id = excluded.player_id, display_name = excluded.display_name,
      role = excluded.role, color = excluded.color, active = true;

  if member_role = 'player' then
    current_state := jsonb_set(current_state, '{players}',
      coalesce(current_state->'players', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', new_player_id, 'name', clean_name, 'color', player_color, 'active', true
      )), true);
    current_state := jsonb_set(current_state, '{playerSlots}', coalesce((
      select jsonb_agg(
        case when slot->>'id' = free_slot_id
          then slot || jsonb_build_object('playerId', new_player_id, 'memberId', auth.uid()::text)
          else slot end
        order by (slot->>'position')::integer
      ) from jsonb_array_elements(current_state->'playerSlots') slot
    ), '[]'::jsonb), true);
  end if;

  current_state := jsonb_set(current_state, '{members}',
    coalesce(current_state->'members', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id', auth.uid()::text, 'participantId', auth.uid()::text,
      'displayName', clean_name, 'role', member_role, 'playerId', new_player_id,
      'color', player_color, 'active', true, 'joinedAt', now()
    )), true);

  update public.runs set state = current_state where id = target;
  return target;
end;
$$;

revoke all on function public.join_run(text, text, text, text) from public;
grant execute on function public.join_run(text, text, text, text) to authenticated;

create or replace function public.delete_run(target_run uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.runs run
    where run.id = target_run
      and (
        run.owner_id = auth.uid()
        or exists (
          select 1 from public.run_members member
          where member.run_id = run.id and member.user_id = auth.uid()
            and member.active and member.role = 'host'
        )
      )
  ) then raise exception 'Host permission required'; end if;

  delete from public.runs where id = target_run;
end;
$$;

revoke all on function public.delete_run(uuid) from public;
grant execute on function public.delete_run(uuid) to authenticated;
