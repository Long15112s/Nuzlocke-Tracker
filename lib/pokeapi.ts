import type { PokemonApiSummary, PokemonSelection } from "./types";
import pokemonDeData from "./data/pokemon-de.json";

const POKEMON_LIST_CACHE_KEY = "nuzlink_pokemon_list_v2";
const POKEMON_DETAIL_CACHE_KEY_PREFIX = "nuzlink_pokemon_detail_v2_";

export type LocalizedPokemonIndexEntry = { id: number; apiName: string; displayName: string; englishName: string };
export const platinumPokemon = pokemonDeData as LocalizedPokemonIndexEntry[];
export const GAME_POKEDEX_LIMITS = { "Pokémon Platin": 493 } as const;
export const GERMAN_POKEMON_NAMES = Object.fromEntries(platinumPokemon.map((pokemon) => [pokemon.apiName, pokemon.displayName])) as Record<string, string>;
const pokemonByApiName = new Map(platinumPokemon.map((pokemon) => [pokemon.apiName, pokemon]));

export function getPokemonSpriteUrl(id?: number) {
  if (!id) return undefined;
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

function parsePokemonIdFromUrl(url?: string) {
  if (!url) return undefined;
  const match = url.match(/\/pokemon\/(\d+)\/?$/);
  return match ? Number(match[1]) : undefined;
}

function normalizePokemonName(name: string) {
  return name.trim().toLowerCase();
}

export function normalizePokemonSearch(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de").replace(/♀/g, " female ").replace(/♂/g, " male ").replace(/[^a-z0-9]+/g, "").trim();
}

function toDisplayName(name: string) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function getPokemonList(): Promise<PokemonApiSummary[]> {
  if (typeof window !== "undefined") {
    const cached = window.localStorage.getItem(POKEMON_LIST_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as PokemonApiSummary[];
        if (Array.isArray(parsed) && parsed.length === 493 && parsed.every((entry, index) => entry.id === index + 1 && entry.displayName && entry.englishName)) return parsed;
      } catch {
        // ignore broken cache and reload from API
      }
    }
  }

  const list = platinumPokemon.map((pokemon) => ({
    id: pokemon.id,
    name: pokemon.apiName,
    apiName: pokemon.apiName,
    englishName: pokemon.englishName,
    displayName: pokemon.displayName,
    url: `https://pokeapi.co/api/v2/pokemon/${pokemon.id}/`,
    spriteUrl: getPokemonSpriteUrl(pokemon.id),
  } satisfies PokemonApiSummary));

  if (typeof window !== "undefined" && list.length > 0) {
    window.localStorage.setItem(POKEMON_LIST_CACHE_KEY, JSON.stringify(list));
  }

  return list;
}

export async function searchPokemon(query: string, sourceList?: PokemonApiSummary[]): Promise<PokemonApiSummary[]> {
  const normalized = normalizePokemonSearch(query);
  if (!normalized) return [];

  const list = sourceList ?? (await getPokemonList());
  return list
    .filter((pokemon) => [pokemon.name, pokemon.apiName, pokemon.englishName, pokemon.displayName].some((name) => normalizePokemonSearch(name ?? "").includes(normalized)))
    .sort((a, b) => {
      const score = (pokemon: PokemonApiSummary) => {
        const names = [pokemon.displayName, pokemon.englishName, pokemon.apiName, pokemon.name].map((name) => normalizePokemonSearch(name ?? ""));
        if (names.some((name) => name === normalized)) return 0;
        if (names.some((name) => name.startsWith(normalized))) return 1;
        return 2;
      };
      return score(a) - score(b) || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, 10)
    .map((pokemon) => ({
      ...pokemon,
      displayName: pokemon.displayName ?? GERMAN_POKEMON_NAMES[pokemon.name],
      spriteUrl: pokemon.spriteUrl ?? getPokemonSpriteUrl(pokemon.id),
    }));
}

export async function getPokemonDetails(name: string): Promise<PokemonSelection | null> {
  const normalizedName = normalizePokemonName(name);
  if (!normalizedName) return null;

  if (typeof window !== "undefined") {
    const cached = window.localStorage.getItem(`${POKEMON_DETAIL_CACHE_KEY_PREFIX}${normalizedName}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as PokemonSelection;
        if (parsed?.name) return parsed;
      } catch {
        // ignore invalid cache entry
      }
    }
  }

  const payload = await fetchJson<{
    id?: number;
    name?: string;
    sprites?: { front_default?: string };
    types?: Array<{ type?: { name?: string } }>;
    abilities?: Array<{ ability?: { name?: string } }>;
  }>(`https://pokeapi.co/api/v2/pokemon/${normalizedName}`);

  if (!payload?.name) return null;

  const species = await fetchJson<{ names?: Array<{ name?: string; language?: { name?: string } }> }>(`https://pokeapi.co/api/v2/pokemon-species/${payload.id ?? payload.name}`);
  const germanName = species?.names?.find((entry) => entry.language?.name === "de")?.name;
  const selection: PokemonSelection = {
    id: payload.id,
    name: payload.name,
    apiName: payload.name,
    displayName: germanName ?? GERMAN_POKEMON_NAMES[payload.name] ?? toDisplayName(payload.name),
    spriteUrl: payload.sprites?.front_default ?? getPokemonSpriteUrl(payload.id),
    types: (payload.types ?? []).map((entry) => entry.type?.name ?? "").filter(Boolean),
    abilities: (payload.abilities ?? []).map((entry) => entry.ability?.name ?? "").filter(Boolean),
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(`${POKEMON_DETAIL_CACHE_KEY_PREFIX}${normalizedName}`, JSON.stringify(selection));
  }

  return selection;
}

export function getPokemonDisplayName(value: { displayName?: string; species?: string; apiName?: string }) {
  return value.displayName ?? (value.apiName ? pokemonByApiName.get(value.apiName)?.displayName : undefined) ?? value.species ?? value.apiName ?? "Pokémon";
}

export function buildPokemonSelectionFromName(name: string, fallback?: PokemonSelection): PokemonSelection | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const safeName = trimmed.toLowerCase();
  const selected = fallback && fallback.name.toLowerCase() === safeName ? fallback : null;

  return selected ?? {
    id: undefined,
    name: trimmed,
    apiName: safeName,
    displayName: toDisplayName(trimmed),
    spriteUrl: undefined,
    types: [],
    abilities: [],
  };
}
