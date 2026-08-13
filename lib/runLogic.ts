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

export type QuickEncounterInput = { playerId: string; pokemonId?: number; apiName?: string; level: number; status?: EncounterStatus };
export function validateQuickEncounter(location: string, rows: QuickEncounterInput[]) {
  if (!location.trim()) return { field: "location" as const, message: "Bitte einen Ort auswählen." };
  for (const row of rows) {
    if (!row.pokemonId || !row.apiName) return { field: row.playerId, message: "Bitte Pokémon aus der Liste auswählen." };
    if (!Number.isFinite(row.level) || row.level < 1 || row.level > 100) return { field: row.playerId, message: "Level muss zwischen 1 und 100 liegen." };
    if (!row.status) return { field: row.playerId, message: "Für alle Spieler muss ein Ergebnis feststehen." };
  }
  return null;
}

export function getSoulLinkDeathPreviousStatus(statuses: Array<"team" | "box" | "dead">) {
  return statuses.includes("team") ? "team" as const : "box" as const;
}

export function getSoulLinkDeathUndoTarget(run: RunState, linkId: string, previousStatus?: "team" | "box") {
  if (previousStatus !== "team") return { status: "box" as const, teamLimitBlocked: false };
  const affectedIds = new Set(run.pokemon.filter((pokemon) => pokemon.soulLinkId === linkId).map((pokemon) => pokemon.id));
  return getTeamLimitViolation(run, affectedIds)
    ? { status: "box" as const, teamLimitBlocked: true }
    : { status: "team" as const, teamLimitBlocked: false };
}
