import { platinumEncounterLocations } from "./gameData";
import { canEditPokemonOwnedBy, canManageRun } from "./permissions";
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

// Group identity is shared with history and supports pre-group legacy runs.
export function getEncounterGroupKey(entry: import("./types").Encounter) {
  return entry.encounterGroupId ?? `legacy_${entry.createdAt}_${entry.location}`;
}
export function getUsedEncounterLocations(run: RunState) {
  const groups = new Map<string, typeof run.encounters>();
  for (const entry of run.encounters) {
    const key = getEncounterGroupKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return new Set([...groups.values()].filter(entries => getEncounterGroupState(entries.map(e => e.status)) !== "pending")
    .flatMap(entries => entries.map(e => e.location.trim().toLocaleLowerCase("de"))));
}

function associatedPokemon(run: RunState, entry: import("./types").Encounter) {
  const links = run.soulLinks.filter(link => link.encounterIds.includes(entry.id));
  const explicit = run.pokemon.filter(p => p.encounterId === entry.id);
  if (explicit.length) return explicit;
  if (links.length) return run.pokemon.filter(p => p.playerId === entry.playerId && links.some(link => link.id === p.soulLinkId));
  if (entry.status !== "caught") return [];
  const candidates = run.pokemon.filter(p => !p.soulLinkId && !p.encounterId && p.playerId === entry.playerId && p.location === entry.location);
  const encounters = run.encounters.filter(e => e.playerId === entry.playerId && e.location === entry.location && e.status === "caught");
  if (candidates.length && (candidates.length !== 1 || encounters.length !== 1)) throw new Error("Die historischen Pokémon lassen sich nicht eindeutig zuordnen. Änderung aus Sicherheitsgründen blockiert.");
  return candidates;
}

export type EncounterUpdate = { selection?: import("./types").PokemonSelection; level: number; location: string; status: EncounterStatus };
export function updateEncounter(run: RunState, id: string, patch: EncounterUpdate, member: import("./types").RunMember | null): RunState {
  const entry = run.encounters.find(e => e.id === id);
  if (!entry) throw new Error("Encounter existiert nicht mehr.");
  if (!canEditPokemonOwnedBy(member, entry.playerId)) throw new Error("Keine Berechtigung zum Bearbeiten.");
  // V1 deliberately refuses status transitions: creation, death and restoration
  // currently have separate UI paths, not one reversible central transition.
  if (patch.status !== entry.status) throw new Error("Statusänderungen sind in Version 1 gesperrt, damit SoulLink- und Todesdaten erhalten bleiben.");
  if (!Number.isInteger(patch.level) || patch.level < 1 || patch.level > 100) throw new Error("Level muss zwischen 1 und 100 liegen.");
  const location = patch.location.trim();
  if (!location) throw new Error("Bitte einen Ort auswählen.");
  if (location !== entry.location) {
    if (run.soulLinks.some(l => l.encounterIds.includes(id)) || run.encounters.filter(e => getEncounterGroupKey(e) === getEncounterGroupKey(entry)).length > 1) throw new Error("Der Ort einer gemeinsamen Encounter-Gruppe kann nicht einzeln geändert werden.");
    if (getUsedEncounterLocations({ ...run, encounters: run.encounters.filter(e => e.id !== id) }).has(location.toLocaleLowerCase("de"))) throw new Error("Dieser Ort ist bereits verwendet.");
  }
  const selection = patch.selection;
  const speciesPatch = selection ? { species: selection.displayName, displayName: selection.displayName, apiName: selection.apiName, pokemonId: selection.id, spriteUrl: selection.spriteUrl, types: selection.types } : {};
  const pokemonIds = new Set(associatedPokemon(run, entry).map(p => p.id));
  return { ...run,
    encounters: run.encounters.map(e => e.id === id ? { ...e, ...speciesPatch, level: patch.level, location } : e),
    pokemon: run.pokemon.map(p => pokemonIds.has(p.id) ? { ...p, ...speciesPatch, level: patch.level, location, encounterId: id } : p),
  };
}

export function deleteEncounter(run: RunState, id: string, member: import("./types").RunMember | null): RunState {
  if (!canManageRun(member)) throw new Error("Nur der Host darf Encounter-Gruppen löschen.");
  const entry = run.encounters.find(e => e.id === id);
  if (!entry) throw new Error("Encounter existiert nicht mehr.");
  const ids = new Set(run.encounters.filter(e => getEncounterGroupKey(e) === getEncounterGroupKey(entry)).map(e => e.id));
  const links = new Set<string>();
  // Expand to a fixed point so even legacy links spanning groups stay atomic.
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of run.soulLinks) if (link.encounterIds.some(e => ids.has(e))) {
      links.add(link.id);
      for (const encounterId of link.encounterIds) if (!ids.has(encounterId)) { ids.add(encounterId); changed = true; }
    }
    for (const e of run.encounters) if (ids.has(e.id)) for (const sibling of run.encounters) {
      if (getEncounterGroupKey(sibling) === getEncounterGroupKey(e) && !ids.has(sibling.id)) { ids.add(sibling.id); changed = true; }
    }
  }
  const pokemonIds = new Set(run.encounters.filter(e => ids.has(e.id)).flatMap(e => associatedPokemon(run, e).map(p => p.id)));
  return { ...run, encounters: run.encounters.filter(e => !ids.has(e.id)), soulLinks: run.soulLinks.filter(l => !links.has(l.id)), pokemon: run.pokemon.filter(p => !pokemonIds.has(p.id) && !links.has(p.soulLinkId ?? "") && !ids.has(p.encounterId ?? "")) };
}

export type PokemonDetailsDraft = {
  deathCausedByPlayerId: string;
  speciesQuery: string;
  selection?: import("./types").PokemonSelection;
  nickname: string;
  level: number;
  ability: string;
  types: string;
  status: import("./types").PokemonStatus;
};
export function createPokemonDetailsDraft(pokemon: import("./types").Pokemon, displayName: string, run?: RunState): PokemonDetailsDraft {
  const cause = run?.soulLinks.find(l => l.id === pokemon.soulLinkId)?.deathCausedByPlayerId;
  return { deathCausedByPlayerId: pokemon.status === "dead" ? cause ?? "" : pokemon.playerId, speciesQuery: displayName, nickname: pokemon.nickname, level: pokemon.level, ability: pokemon.ability ?? "", types: pokemon.types?.join(", ") ?? "", status: pokemon.status };
}
export function selectPokemonDraftSpecies(draft: PokemonDetailsDraft, selection: import("./types").PokemonSelection): PokemonDetailsDraft {
  return { ...draft, speciesQuery: selection.displayName, selection, types: selection.types.join(", ") };
}

export type PokemonDetailsUpdate = {
  deathCausedByPlayerId?: string;
  undoDeath?: boolean;
  selection?: import("./types").PokemonSelection;
  nickname?: string;
  level?: number;
  ability?: string;
  types?: string[];
  status?: import("./types").PokemonStatus;
};

function resolvePokemonEncounter(run: RunState, pokemon: import("./types").Pokemon) {
  if (pokemon.encounterId) {
    const entry = run.encounters.find(e => e.id === pokemon.encounterId);
    if (!entry || entry.playerId !== pokemon.playerId || entry.status !== "caught") throw new Error("Die Encounter-Zuordnung ist ungültig. Spezieskorrektur wurde nicht gespeichert.");
    return entry;
  }
  const link = pokemon.soulLinkId ? run.soulLinks.find(l => l.id === pokemon.soulLinkId) : undefined;
  const candidates = run.encounters.filter(e => e.playerId === pokemon.playerId && e.status === "caught" &&
    (pokemon.soulLinkId ? link?.encounterIds.includes(e.id) : e.location === pokemon.location));
  if (candidates.length > 1) throw new Error("Der zugehörige Encounter ist nicht eindeutig. Spezieskorrektur wurde nicht gespeichert.");
  if (candidates.length === 1) {
    const competitors = run.pokemon.filter(p => p.id !== pokemon.id && p.playerId === pokemon.playerId &&
      (p.encounterId === candidates[0].id || (!p.encounterId && (pokemon.soulLinkId ? p.soulLinkId === pokemon.soulLinkId : !p.soulLinkId && p.location === pokemon.location))));
    if (competitors.length) throw new Error("Der zugehörige Encounter ist nicht eindeutig. Spezieskorrektur wurde nicht gespeichert.");
  }
  // Starters and manually created Pokémon may have no encounter at all.
  return candidates[0];
}

export function updatePokemonDetails(run: RunState, id: string, patch: PokemonDetailsUpdate, member: import("./types").RunMember | null, now = new Date().toISOString()): RunState {
  let target = run.pokemon.find(p => p.id === id);
  if (!target) throw new Error("Pokémon existiert nicht mehr.");
  if (!canEditPokemonOwnedBy(member, target.playerId)) throw new Error("Keine Berechtigung zum Bearbeiten.");
  if (patch.undoDeath && target.status === "dead" && patch.status && patch.status !== "dead") {
    if (!target.soulLinkId) throw new Error("Nur ein SoulLink-Tod kann hier rückgängig gemacht werden.");
    run = undoSoulLinkDeath(run, target.soulLinkId, member);
    target = run.pokemon.find(p => p.id === id)!;
  }
  if (patch.level !== undefined && (!Number.isInteger(patch.level) || patch.level < 1 || patch.level > 100)) throw new Error("Level muss zwischen 1 und 100 liegen.");
  const selection = patch.selection;
  if (selection && (!selection.id || !selection.apiName || !selection.displayName || !selection.spriteUrl || !selection.types.length)) throw new Error("Bitte eine Spezies mit vollständig geladenen Detaildaten auswählen.");
  const encounter = selection ? resolvePokemonEncounter(run, target) : undefined;
  const speciesPatch = selection ? { pokemonId: selection.id, apiName: selection.apiName, displayName: selection.displayName, species: selection.displayName, spriteUrl: selection.spriteUrl, types: selection.types } : {};
  const status = patch.status ?? target.status;
  const affected = target.soulLinkId ? run.pokemon.filter(p => p.soulLinkId === target.soulLinkId) : [target];
  const changedStatus = status !== target.status;
  const affectedIds = new Set(affected.map(p => p.id));
  const link = run.soulLinks.find(l => l.id === target.soulLinkId);
  const newDeath = changedStatus && status === "dead";
  const cause = newDeath ? patch.deathCausedByPlayerId ?? target.playerId : patch.deathCausedByPlayerId ?? link?.deathCausedByPlayerId;
  const causeChanged = status === "dead" && patch.deathCausedByPlayerId !== undefined && cause !== (link?.deathCausedByPlayerId ?? "");
  if (target.soulLinkId && status === "dead") {
    if (newDeath && !cause) throw new Error("Bitte wähle aus, wessen Pokémon den Tod verursacht hat.");
    if (cause && !affected.some(p => p.playerId === cause)) throw new Error("Der ausgewählte Spieler gehört nicht zu diesem SoulLink.");
    if (!newDeath && causeChanged && !canManageRun(member)) throw new Error("Nur der Host darf eine bestehende Todesursache ändern.");
    if (!link) throw new Error("Der zugehörige SoulLink existiert nicht mehr.");
  }

  if (changedStatus && status !== "dead" && affected.some(p => p.status === "dead")) throw new Error("Tote SoulLinks können nicht über die normale Teamverwaltung wiederbelebt werden.");
  if (changedStatus && status === "team") {
    const violatingPlayer = getTeamLimitViolation(run, affectedIds);
    if (violatingPlayer) throw new Error(`Spieler ${violatingPlayer} hätte dadurch mehr als 6 Pokémon im Team.`);
  }
  const details = {
    ...(patch.nickname !== undefined ? { nickname: patch.nickname } : {}),
    ...(patch.level !== undefined ? { level: patch.level } : {}),
    ...(patch.ability !== undefined ? { ability: patch.ability } : {}),
    ...(patch.types !== undefined ? { types: patch.types } : {}),
  };
  return { ...run,
    pokemon: run.pokemon.map(p => p.id === id ? { ...p, ...speciesPatch, ...details, status, ...(encounter ? { encounterId: encounter.id } : {}) }
      : changedStatus && affectedIds.has(p.id) ? { ...p, status } : p),
    encounters: encounter ? run.encounters.map(e => e.id === encounter.id ? { ...e, ...speciesPatch } : e) : run.encounters,
    soulLinks: changedStatus && status === "dead" && target.soulLinkId ? run.soulLinks.map(l => l.id === target.soulLinkId ? { ...l, status: "dead", deathPreviousStatus: getSoulLinkDeathPreviousStatus(affected.map(p => p.status)), diedAt: now, diedBy: member?.participantId, deathCausedByPlayerId: cause } : l)
      : causeChanged && target.soulLinkId ? run.soulLinks.map(l => l.id === target.soulLinkId ? { ...l, deathCausedByPlayerId: cause || undefined } : l) : run.soulLinks,
  };
}

export function isSoulLinkDead(run: RunState, link: import("./types").SoulLink) {
  if (link.status) return link.status === "dead";
  return run.pokemon.some(p => p.soulLinkId === link.id && p.status === "dead");
}
export function getDeadSoulLinks(run: RunState) {
  const seen = new Set<string>();
  return run.soulLinks.filter(link => {
    if (!isSoulLinkDead(run, link) || seen.has(link.id)) return false;
    seen.add(link.id);
    return true;
  });
}

export function getDeathCountsByPlayer(run: RunState) {
  const counts = new Map<string, number>();
  const deadLinks = getDeadSoulLinks(run);
  const total = deadLinks.length;
  let unassigned = 0;
  for (const link of deadLinks) {
    const playerId = link.deathCausedByPlayerId;
    if (!playerId) unassigned += 1;
    else counts.set(playerId, (counts.get(playerId) ?? 0) + 1);
  }
  const players = run.players.map(p => ({ playerId: p.id, playerName: p.name, count: counts.get(p.id) ?? 0, active: p.active !== false }));
  for (const [playerId, count] of counts) if (!run.players.some(p => p.id === playerId)) players.push({ playerId, playerName: "Ehemaliger Spieler", count, active: false });
  return { total, unassigned, players: players.filter(p => p.active || p.count > 0).sort((a, b) => b.count - a.count) };
}
export function getDeathCauseLabel(run: RunState, linkId: string) {
  const id = run.soulLinks.find(l => l.id === linkId)?.deathCausedByPlayerId;
  if (!id) return "Nicht zugeordnet";
  const player = run.players.find(p => p.id === id);
  return player ? `${player.name}${player.active === false ? " (ehemalig)" : ""}` : "Ehemaliger Spieler";
}
export function assignSoulLinkDeathCause(run: RunState, linkId: string, playerId: string, member: import("./types").RunMember | null): RunState {
  if (!canManageRun(member)) throw new Error("Nur der Host darf eine Todesursache zuordnen.");
  const link = run.soulLinks.find(l => l.id === linkId);
  if (!link || !isSoulLinkDead(run, link)) throw new Error("Dieser SoulLink ist nicht tot.");
  if (link.deathCausedByPlayerId) throw new Error("Die Todesursache ist bereits zugeordnet.");
  const participant = run.pokemon.some(p => p.soulLinkId === linkId && p.playerId === playerId) || run.encounters.some(e => link.encounterIds.includes(e.id) && e.playerId === playerId);
  if (!participant) throw new Error("Der Spieler gehört nicht zu diesem SoulLink.");
  return { ...run, soulLinks: run.soulLinks.map(l => l.id === linkId ? { ...l, deathCausedByPlayerId: playerId } : l) };
}
export function undoSoulLinkDeath(run: RunState, linkId: string, member: import("./types").RunMember | null): RunState {
  if (!canManageRun(member)) throw new Error("Nur der Host darf einen Tod rückgängig machen.");
  const link = run.soulLinks.find(l => l.id === linkId);
  if (!link || !isSoulLinkDead(run, link) || link.deletedAt) throw new Error("Dieser Tod kann nicht rückgängig gemacht werden.");
  const target = getSoulLinkDeathUndoTarget(run, linkId, link.deathPreviousStatus);
  return { ...run,
    soulLinks: run.soulLinks.map(l => l.id === linkId ? { ...l, status: "active", deathPreviousStatus: undefined, diedAt: undefined, diedBy: undefined, deathCausedByPlayerId: undefined } : l),
    pokemon: run.pokemon.map(p => p.soulLinkId === linkId ? { ...p, status: target.status } : p),
  };
}

export function getSoulLinkDeathMembers(run: RunState, pokemon: import("./types").Pokemon) {
  return pokemon.soulLinkId ? run.pokemon.filter(p => p.soulLinkId === pokemon.soulLinkId) : [];
}

export function getAvailablePlatinumEncounterLocations(run: RunState) {
  const used = getUsedEncounterLocations(run);
  return platinumEncounterLocations.filter(place => !used.has(place.label.toLocaleLowerCase("de")));
}
