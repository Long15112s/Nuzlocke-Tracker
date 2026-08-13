import { getSupabase } from "./supabase";
import { normalizeRun } from "./storage";
import type { RunMemberRole, RunState } from "./types";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { isAlreadyDeletedError } from "./cloudErrors";

export type CloudMembership = { runId: string; userId: string; playerId: string | null; displayName: string; role: RunMemberRole; active: boolean; inactiveReason?: "kicked" | "left" | "recovered" | null; recoveryConfigured?: boolean };
export type RecoveryResult = { run: RunState; recoveryCode: string };

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

export async function getCloudMembership(runId: string): Promise<CloudMembership | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const user = await ensureAnonymousUser();
  const { data, error } = await supabase.from("run_members").select("run_id,user_id,player_id,display_name,role,active,inactive_reason,recovery_code_created_at").eq("run_id", runId).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { runId: data.run_id, userId: data.user_id, playerId: data.player_id, displayName: data.display_name, role: data.role as RunMemberRole, active: data.active, inactiveReason: data.inactive_reason, recoveryConfigured: Boolean(data.recovery_code_created_at) };
}

export async function issueRecoveryCode(runId: string) {
  const supabase = getSupabase(); if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  await ensureAnonymousUser();
  const { data, error } = await supabase.rpc("issue_member_recovery_code", { target_run: runId });
  if (error) throw error;
  return String(data);
}

export async function rotateRecoveryCode(runId: string) {
  const supabase = getSupabase(); if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  await ensureAnonymousUser();
  const { data, error } = await supabase.rpc("rotate_member_recovery_code", { target_run: runId });
  if (error) throw error;
  return String(data);
}

export async function recoverCloudMember(runCode: string, recoveryCode: string): Promise<RecoveryResult> {
  const supabase = getSupabase(); if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  await ensureAnonymousUser();
  const { data, error } = await supabase.rpc("recover_run_member", { code: runCode.trim().toUpperCase(), recovery_code: recoveryCode });
  if (error) throw new Error(error.message.includes("already connected") ? "Dieser Browser ist bereits mit einem Spieler dieses Runs verbunden." : "Run oder Wiederherstellungscode ist ungültig.");
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.run_id || !result?.new_recovery_code) throw new Error("Run oder Wiederherstellungscode ist ungültig.");
  const run = await loadCloudRun(result.run_id);
  if (!run) throw new Error("Run oder Wiederherstellungscode ist ungültig.");
  return { run, recoveryCode: result.new_recovery_code };
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

export async function createCloudRun(run: RunState, ownerName: string): Promise<RecoveryResult> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  const user = await ensureAnonymousUser();
  const sourceHostMember = run.members?.find((member) => member.role === "host");
  const hostPlayer = run.players.find((player) => player.id === sourceHostMember?.playerId) ?? run.players[0];
  if (!hostPlayer) throw new Error("Der Run hat keinen Host-Spieler.");
  const playerCount = Math.min(4, Math.max(2, Number(run.playerCount) || 2)) as 2 | 3 | 4;
  const hostMember = { id: sourceHostMember?.id ?? `member_${crypto.randomUUID().slice(0, 8)}`, participantId: user.id, displayName: ownerName || sourceHostMember?.displayName || hostPlayer.name || "Host", role: "host" as const, playerId: hostPlayer.id, color: hostPlayer.color, active: true, joinedAt: sourceHostMember?.joinedAt ?? new Date().toISOString() };
  const normalized = normalizeRun({
    ...run,
    playerCount,
    players: [{ ...hostPlayer, active: true }],
    members: [hostMember],
    playerSlots: Array.from({ length: playerCount }, (_, index) => ({ id: run.playerSlots?.[index]?.id ?? `slot_${index + 1}`, position: index + 1, ...(index === 0 ? { playerId: hostPlayer.id, memberId: hostMember.id } : {}) })),
  }) ?? run;
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
  return { run: normalized, recoveryCode: await issueRecoveryCode(normalized.id) };
}

export async function joinCloudRun(code: string, displayName: string, role: Exclude<RunMemberRole, "host">, color?: string): Promise<RecoveryResult> {
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
  const run = normalizeRun(data.state as RunState) as RunState;
  return { run, recoveryCode: role === "player" ? await issueRecoveryCode(run.id) : "" };
}

export async function loadCloudRun(id: string) {
  const supabase = getSupabase();
  if (!supabase) return null;
  await ensureAnonymousUser();
  const { data, error } = await supabase.from("runs").select("state").eq("id", id).maybeSingle();
  if (error) throw error;
  const raw = (data?.state ?? null) as RunState | null;
  const normalized = normalizeRun(raw);
  if (raw && normalized && JSON.stringify(raw) !== JSON.stringify(normalized)) {
    // Spectators may read but cannot update; a failed best-effort repair must not block loading.
    await saveCloudRun(normalized).catch((repairError) => console.warn("Cloud-State konnte nicht automatisch repariert werden.", repairError));
  }
  return normalized;
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

export type DeleteRunResult = { status: "deleted" | "already_deleted" };

export async function deleteCloudRun(runId: string): Promise<DeleteRunResult> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase ist nicht konfiguriert.");
  await ensureAnonymousUser();
  const { error } = await supabase.rpc("delete_run", { target_run: runId });
  if (error) {
    if (isAlreadyDeletedError(error)) return { status: "already_deleted" };
    throw error;
  }
  return { status: "deleted" };
}

export function subscribeToCloudRun(id: string, onRun: (run: RunState) => void, onDeleted: () => void) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`run:${id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${id}` }, (payload) => {
      const raw = (payload.new as { state?: RunState }).state;
      const state = normalizeRun(raw);
      if (state) {
        onRun(state);
        if (raw && JSON.stringify(raw) !== JSON.stringify(state)) void saveCloudRun(state).catch(console.error);
      }
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "runs" }, (payload) => {
      if ((payload.old as { id?: string }).id === id) onDeleted();
    })
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      void loadCloudRun(id).then((state) => state ? onRun(state) : onDeleted()).catch(() => undefined);
    });
  return () => { void supabase.removeChannel(channel); };
}

export function subscribeToMembership(runId: string, onMembership: (membership: CloudMembership | null) => void) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  let stopped = false;
  let channel: RealtimeChannel | null = null;

  void ensureAnonymousUser().then((user) => {
    if (stopped) return;
    const validate = () => void getCloudMembership(runId).then(onMembership).catch(() => undefined);
    channel = supabase
      .channel(`membership:${runId}:${user.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "run_members", filter: `run_id=eq.${runId}` }, (payload) => {
        const member = payload.new as { run_id?: string; user_id?: string; player_id?: string | null; display_name?: string; role?: RunMemberRole; active?: boolean; inactive_reason?: "kicked" | "left" | "recovered" | null };
        if (member.user_id === user.id) onMembership({ runId, userId: user.id, playerId: member.player_id ?? null, displayName: member.display_name ?? "", role: member.role ?? "player", active: member.active === true, inactiveReason: member.inactive_reason });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "run_members" }, (payload) => {
        const member = payload.old as { run_id?: string; user_id?: string };
        if (member.run_id === runId && member.user_id === user.id) onMembership(null);
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") validate(); });
  }).catch(() => undefined);

  return () => {
    stopped = true;
    if (channel) void supabase.removeChannel(channel);
  };
}
