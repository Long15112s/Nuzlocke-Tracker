import evolutionFamiliesData from "./data/pokemon-evolution-families.json";
import { getPokemonDisplayName, platinumPokemon } from "./pokeapi";
import type { RunState } from "./types";

export type RunPokemonSearchStatus = "team" | "caught" | "dead" | "fled";
export type RunPokemonSearchResult = {
  id: string; source: "pokemon" | "encounter"; pokemonId: number; apiName: string; displayName: string;
  spriteUrl?: string; playerId: string; playerName: string; status: RunPokemonSearchStatus;
  level?: number; location?: string; soulLinkId?: string; soulLinkNumber?: number;
  nickname?: string; createdAt?: string; linkDeleted?: boolean;
};

export const pokemonEvolutionFamilies = evolutionFamiliesData as Record<string, number[]>;
const pokemonById = new Map(platinumPokemon.map((pokemon) => [pokemon.id, pokemon]));
const pokemonBySlug = new Map(platinumPokemon.map((pokemon) => [pokemon.apiName, pokemon]));

function resolvePokemonId(value: { pokemonId?: number; apiName?: string }) {
  return value.pokemonId ?? (value.apiName ? pokemonBySlug.get(value.apiName)?.id : undefined);
}

export function searchRunPokemonFamily(run: RunState, pokemonId: number) {
  const queryPokemon = pokemonById.get(pokemonId);
  const familyIds = pokemonEvolutionFamilies[String(pokemonId)] ?? [pokemonId];
  const familyIdSet = new Set(familyIds);
  const familyNames = familyIds.map((id) => pokemonById.get(id)?.displayName ?? `#${id}`);
  const linkNumber = new Map(run.soulLinks.map((link, index) => [link.id, link.displayNumber ?? index + 1]));
  const linkDeleted = new Map(run.soulLinks.map((link) => [link.id, Boolean(link.deletedAt)]));

  const pokemonResults: RunPokemonSearchResult[] = run.pokemon.flatMap((pokemon) => {
    const id = resolvePokemonId(pokemon);
    if (!id || !familyIdSet.has(id)) return [];
    const meta = pokemonById.get(id)!;
    return [{
      id: pokemon.id, source: "pokemon", pokemonId: id, apiName: pokemon.apiName ?? meta.apiName,
      displayName: getPokemonDisplayName(pokemon), spriteUrl: pokemon.spriteUrl ?? meta.spriteUrl, playerId: pokemon.playerId,
      playerName: run.players.find((player) => player.id === pokemon.playerId)?.name ?? "Ehemaliger Spieler",
      status: pokemon.status === "box" ? "caught" : pokemon.status, level: pokemon.level,
      location: pokemon.location, soulLinkId: pokemon.soulLinkId,
      soulLinkNumber: pokemon.soulLinkId ? linkNumber.get(pokemon.soulLinkId) : undefined,
      nickname: pokemon.nickname, linkDeleted: pokemon.soulLinkId ? linkDeleted.get(pokemon.soulLinkId) : false,
    }];
  });

  const fledResults: RunPokemonSearchResult[] = run.encounters.flatMap((encounter) => {
    const id = resolvePokemonId(encounter);
    if (encounter.status !== "fled" || !id || !familyIdSet.has(id)) return [];
    const meta = pokemonById.get(id)!;
    const link = run.soulLinks.find((entry) => entry.encounterIds.includes(encounter.id));
    return [{ id: encounter.id, source: "encounter", pokemonId: id, apiName: encounter.apiName ?? meta.apiName,
      displayName: getPokemonDisplayName(encounter), spriteUrl: encounter.spriteUrl ?? meta.spriteUrl, playerId: encounter.playerId,
      playerName: run.players.find((player) => player.id === encounter.playerId)?.name ?? "Ehemaliger Spieler",
      status: "fled", level: encounter.level, location: encounter.location, nickname: encounter.nickname,
      createdAt: encounter.createdAt, soulLinkId: link?.id, soulLinkNumber: link ? linkNumber.get(link.id) : undefined,
      linkDeleted: link ? linkDeleted.get(link.id) : false }];
  });

  const results = [...pokemonResults, ...fledResults].sort((a, b) => a.pokemonId - b.pokemonId || a.playerName.localeCompare(b.playerName, "de") || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  return { queryPokemon, familyIds, familyNames, results };
}
