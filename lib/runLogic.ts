import type { EncounterStatus, RunState, SoulLinkState } from "./types";

export function getOccupiedSlotCount(run: RunState) {
  const activePlayerIds = new Set(run.players.filter((player) => player.active !== false).map((player) => player.id));
  return run.playerSlots?.filter((slot) => slot.playerId && activePlayerIds.has(slot.playerId)).length ?? activePlayerIds.size;
}

export function getEncounterGroupState(statuses: EncounterStatus[]): SoulLinkState {
  if (statuses.some((status) => status === "defeated" || status === "fled")) return "extinguished";
  if (statuses.length > 0 && statuses.every((status) => status === "caught")) return "active";
  return "pending";
}

export function getTeamLimitViolation(run: RunState, affectedPokemonIds: Set<string>) {
  const affected = run.pokemon.filter((pokemon) => affectedPokemonIds.has(pokemon.id));
  for (const player of run.players) {
    const currentTeam = run.pokemon.filter((pokemon) => pokemon.playerId === player.id && pokemon.status === "team" && !affectedPokemonIds.has(pokemon.id)).length;
    const incoming = affected.filter((pokemon) => pokemon.playerId === player.id).length;
    if (currentTeam + incoming > 6) return player.name;
  }
  return null;
}

export function resolveMembershipAccess(active: boolean | null, runExists: boolean) {
  if (active === true) return "active" as const;
  return runExists ? "kicked" as const : "deleted" as const;
}
