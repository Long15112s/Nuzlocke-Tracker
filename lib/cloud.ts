import { getSupabase } from "./supabase";
import { normalizeRun } from "./storage";
import type { RunMemberRole, RunState } from "./types";

async function ensureAnonymousUser() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session?.user) return sessionData.session.user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error("Anonyme Anmeldung fehlgeschlagen.");
  return data.user;
}

export async function getCloudParticipantId() {
  return (await ensureAnonymousUser()).id;
}

export type RunPreview = { id: string; name: string; game: string; playerCount: number; maxPlayers: number; soulLinkEnabled: boolean; alreadyJoined: boolean };

export async function previewCloudRun(code: string): Promise<RunPreview | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  await ensureAnonymousUser();
  const { data, error } = await supabase.rpc("preview_run", { code: code.toUpperCase() });
  if (error) throw error;
  const preview = Array.isArray(data) ? data[0] : data;
  if (!preview) return null;
  return { id: preview.id, name: preview.name, game: preview.game, playerCount: Number(preview.player_count), maxPlayers: Number(preview.max_players), soulLinkEnabled: Boolean(preview.soul_link_enabled), alreadyJoined: Boolean(preview.already_joined) };
}

export async function createCloudRun(run: RunState, ownerName: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const user = await ensureAnonymousUser();
  const hostMember = run.members?.find((member) => member.role === "host");
  const normalized = normalizeRun({ ...run, members: run.members?.map((member) => member === hostMember ? { ...member, participantId: user.id } : member) }) ?? run;
  const { error: runError } = await supabase.from("runs").insert({
    id: normalized.id,
    invite_code: normalized.inviteCode,
    owner_id: user.id,
    name: normalized.name,
    game: normalized.game,
    current_boss: normalized.currentBoss,
    level_cap: normalized.levelCap,
    badges: normalized.badges,
    randomizer: normalized.randomizer,
    state: normalized,
  });
  if (runError) throw runError;
  const { error: memberError } = await supabase.from("run_members").insert({
    run_id: normalized.id,
    user_id: user.id,
    display_name: ownerName || "Host",
    player_id: normalized.players[0]?.id ?? null,
    role: "host",
    color: normalized.players[0]?.color ?? null,
    active: true,
  });
  if (memberError) throw memberError;
  return normalized;
}

export async function joinCloudRun(code: string, displayName: string, role: Exclude<RunMemberRole, "host">, color?: string) {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  await ensureAnonymousUser();
  const { data: runId, error: joinError } = await supabase.rpc("join_run", {
    code: code.toUpperCase(),
    player_name: displayName,
    member_role: role,
    player_color: color ?? null,
  });
  if (joinError) throw joinError;
  const { data, error } = await supabase.from("runs").select("state").eq("id", runId).single();
  if (error) throw error;
  return normalizeRun(data.state as RunState) as RunState;
}

export async function loadCloudRun(id: string) {
  const supabase = getSupabase();
  if (!supabase) return null;
  await ensureAnonymousUser();
  const { data, error } = await supabase.from("runs").select("state").eq("id", id).maybeSingle();
  if (error) throw error;
  return normalizeRun((data?.state ?? null) as RunState | null);
}

export async function saveCloudRun(run: RunState) {
  const supabase = getSupabase();
  if (!supabase) return;
  const normalized = normalizeRun(run) ?? run;
  const { error } = await supabase.from("runs").update({
    name: normalized.name,
    game: normalized.game,
    current_boss: normalized.currentBoss,
    level_cap: normalized.levelCap,
    badges: normalized.badges,
    randomizer: normalized.randomizer,
    state: normalized,
  }).eq("id", normalized.id);
  if (error) throw error;
}

export async function manageCloudMember(runId: string, participantId: string, action: "remove" | "transfer_host") {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc("manage_run_member", { target_run: runId, target_user: participantId, member_action: action });
  if (error) throw error;
}

export async function leaveCloudRun(runId: string) {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc("leave_run", { target_run: runId });
  if (error) throw error;
}

export function subscribeToCloudRun(id: string, onRun: (run: RunState) => void) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`run:${id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${id}` }, (payload) => {
      const state = normalizeRun((payload.new as { state?: RunState }).state);
      if (state) onRun(state);
    })
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
