import type { PokemonApiSummary, PokemonSelection } from "./types";

const POKEMON_LIST_CACHE_KEY = "nuzlink_pokemon_list_v1";
const POKEMON_DETAIL_CACHE_KEY_PREFIX = "nuzlink_pokemon_detail_v1_";

function getSpriteUrlFromId(id?: number) {
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
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // ignore broken cache and reload from API
      }
    }
  }

  const payload = await fetchJson<{ results?: Array<{ name: string; url: string }> }>("https://pokeapi.co/api/v2/pokemon?limit=1025");
  const list = (payload?.results ?? []).map((pokemon) => {
    const id = parsePokemonIdFromUrl(pokemon.url);
    return {
      name: pokemon.name,
      url: pokemon.url,
      spriteUrl: getSpriteUrlFromId(id),
      id,
    } satisfies PokemonApiSummary;
  });

  if (typeof window !== "undefined" && list.length > 0) {
    window.localStorage.setItem(POKEMON_LIST_CACHE_KEY, JSON.stringify(list));
  }

  return list;
}

export async function searchPokemon(query: string, sourceList?: PokemonApiSummary[]): Promise<PokemonApiSummary[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const list = sourceList ?? (await getPokemonList());
  return list
    .filter((pokemon) => pokemon.name.toLowerCase().includes(normalized))
    .slice(0, 10)
    .map((pokemon) => ({
      ...pokemon,
      spriteUrl: pokemon.spriteUrl ?? getSpriteUrlFromId(pokemon.id),
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

  const selection: PokemonSelection = {
    id: payload.id,
    name: payload.name,
    apiName: payload.name,
    displayName: toDisplayName(payload.name),
    spriteUrl: payload.sprites?.front_default ?? getSpriteUrlFromId(payload.id),
    types: (payload.types ?? []).map((entry) => entry.type?.name ?? "").filter(Boolean),
    abilities: (payload.abilities ?? []).map((entry) => entry.ability?.name ?? "").filter(Boolean),
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(`${POKEMON_DETAIL_CACHE_KEY_PREFIX}${normalizedName}`, JSON.stringify(selection));
  }

  return selection;
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
