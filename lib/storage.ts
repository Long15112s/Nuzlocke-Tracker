import { isPlatinum, platinumProgress } from "./gameData";
import type { PokemonStatus, RunPlayerCount, RunState } from "./types";

const KEY = "nuzlink_run_v1";
const PARTICIPANT_KEY = "nuzlink_participant_v1";
const PLAYER_COLORS = ["#7dd3fc", "#86efac", "#c4b5fd", "#fb923c", "#f9a8d4", "#67e8f9"];

export function getLocalParticipantId() {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(PARTICIPANT_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(PARTICIPANT_KEY, id);
  return id;
}

export function normalizeRun(run: RunState | null | undefined): RunState | null {
  if (!run) return null;

  const next = { ...run };
  const placeholderPlayerIds = new Set(
    (run.members ?? [])
      .filter((member) => {
        if (member.role === "host" || !member.playerId || !member.participantId.startsWith("local_slot_")) return false;
        return !run.pokemon.some((pokemon) => pokemon.playerId === member.playerId)
          && !run.encounters.some((encounter) => encounter.playerId === member.playerId);
      })
      .map((member) => member.playerId!),
  );

  next.players = run.players.map((player, index) => ({ ...player, color: player.color ?? PLAYER_COLORS[index % PLAYER_COLORS.length], active: placeholderPlayerIds.has(player.id) ? false : player.active !== false }));
  const activePlayers = next.players.filter((player) => player.active !== false);
  const normalizedPlayerCount = Math.min(4, Math.max(2, Number(run.playerCount) || activePlayers.length || 2)) as RunPlayerCount;
  next.playerCount = normalizedPlayerCount;
  next.playerSlots = Array.from({ length: normalizedPlayerCount }, (_, index) => {
    const existingSlot = run.playerSlots?.[index];
    if (existingSlot) {
      if (!existingSlot.playerId || !placeholderPlayerIds.has(existingSlot.playerId)) return existingSlot;
      const { playerId: _playerId, memberId: _memberId, ...freeSlot } = existingSlot;
      return freeSlot;
    }
    const player = activePlayers[index];
    return { id: `slot_${index + 1}`, position: index + 1, playerId: player?.id, memberId: run.members?.find((member) => member.playerId === player?.id && member.active)?.id };
  });
  next.runStatus = run.runStatus ?? (isPlatinum(run.game) && run.badges >= platinumProgress.length ? "finished" : "active");

  const legacyMembers = run.players.map((player, index) => ({
    id: `legacy_member_${player.id}`,
    participantId: index === 0 ? "legacy_host" : `legacy_${player.id}`,
    displayName: player.name,
    role: index === 0 ? "host" as const : "player" as const,
    playerId: player.id,
    color: player.color,
    active: player.active !== false,
    joinedAt: new Date(0).toISOString(),
  }));
  next.members = (run.members?.length ? run.members : legacyMembers).map((member) => ({ ...member, active: member.playerId && placeholderPlayerIds.has(member.playerId) ? false : member.active, color: member.color ?? next.players.find((player) => player.id === member.playerId)?.color }));
  next.soulLinkEnabled = run.soulLinkEnabled ?? true;

  next.encounters = run.encounters.map((encounter) => ({
    ...encounter,
    encounterGroupId: encounter.encounterGroupId ?? `legacy_${encounter.createdAt}_${encounter.location}`,
  }));
  const encounterById = new Map(next.encounters.map((encounter) => [encounter.id, encounter]));
  next.soulLinks = run.soulLinks.map((soulLink, index) => {
    const linkedEntries = soulLink.encounterIds.map((id) => encounterById.get(id)).filter(Boolean);
    const groupId = linkedEntries[0]?.encounterGroupId;
    const groupEntries = groupId ? next.encounters.filter((encounter) => encounter.encounterGroupId === groupId) : linkedEntries;
    const linkedPokemon = run.pokemon.filter((pokemon) => pokemon.soulLinkId === soulLink.id);
    const inferredStatus = groupEntries.some((entry) => entry?.status === "defeated" || entry?.status === "fled") ? "extinguished" as const
      : linkedPokemon.some((pokemon) => pokemon.status === "dead") ? "dead" as const
      : groupEntries.length > 0 && groupEntries.every((entry) => entry?.status === "caught") ? "active" as const
      : linkedPokemon.length > 0 ? "active" as const : "pending" as const;
    return { ...soulLink, encounterIds: groupEntries.map((entry) => entry!.id), displayNumber: soulLink.displayNumber ?? index + 1, status: soulLink.status === "extinguished" ? "extinguished" : inferredStatus };
  });

  const sharedStatuses = new Map<string, PokemonStatus>();
  const statusPriority: Record<PokemonStatus, number> = { team: 0, box: 1, dead: 2 };
  run.pokemon.forEach((pokemon) => {
    if (!pokemon.soulLinkId) return;
    const current = sharedStatuses.get(pokemon.soulLinkId);
    if (!current || statusPriority[pokemon.status] > statusPriority[current]) sharedStatuses.set(pokemon.soulLinkId, pokemon.status);
  });
  const unusableLinks = new Set(next.soulLinks.filter((link) => link.status === "extinguished" || link.status === "pending").map((link) => link.id));
  next.pokemon = run.pokemon.filter((pokemon) => !pokemon.soulLinkId || !unusableLinks.has(pokemon.soulLinkId)).map((pokemon) => pokemon.soulLinkId ? { ...pokemon, status: sharedStatuses.get(pokemon.soulLinkId) ?? pokemon.status } : pokemon);

  if (isPlatinum(next.game)) {
    const safeBadges = Math.min(Math.max(Number(next.badges) || 0, 0), platinumProgress.length);
    next.badges = safeBadges;

    if (safeBadges >= platinumProgress.length) {
      next.runStatus = "finished";
      next.currentBoss = "Pokémon Liga geschafft";
      next.levelCap = platinumProgress[platinumProgress.length - 1]?.levelCap ?? next.levelCap;
    } else {
      next.runStatus = "active";
      const nextBoss = platinumProgress[safeBadges];
      next.currentBoss = nextBoss.name;
      next.levelCap = nextBoss.levelCap;
    }
  }

  return next;
}

export function loadRun(): RunState | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RunState;
    return normalizeRun(parsed);
  } catch {
    return null;
  }
}

export function saveRun(run: RunState) {
  if (typeof window !== "undefined") {
    const normalized = normalizeRun(run);
    if (normalized) localStorage.setItem(KEY, JSON.stringify(normalized));
  }
}

export function clearRun() {
  if (typeof window !== "undefined") localStorage.removeItem(KEY);
}
