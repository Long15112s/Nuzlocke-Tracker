import test from "node:test";
import assert from "node:assert/strict";
import { pokemonEvolutionFamilies, searchRunPokemonFamily } from "../lib/pokemonSearch";
import { platinumPokemon, searchPokemon } from "../lib/pokeapi";
import { makeRun } from "./fixtures";
import type { Pokemon, RunState } from "../lib/types";

const mon = (id: string, playerId: string, pokemonId: number, status: Pokemon["status"], nickname = ""): Pokemon => {
  const meta = platinumPokemon[pokemonId - 1];
  return { id, playerId, pokemonId, apiName: meta.apiName, displayName: meta.displayName, species: meta.displayName, nickname, level: 12, location: "Route 201", status, soulLinkId: `link-${id}` };
};
const players = [{ id: "max", name: "Max", active: true }, { id: "leon", name: "Leon", active: true }, { id: "anna", name: "Anna", active: true }];
const withPokemon = (pokemon: Pokemon[], extra: Partial<RunState> = {}) => makeRun({ players, pokemon, ...extra });

test("finds Karnimani when searching Tyracroc and maps box to Gefangen", () => {
  const result = searchRunPokemonFamily(withPokemon([mon("a", "max", 158, "box")]), 159);
  assert.deepEqual(result.familyIds, [158, 159, 160]);
  assert.deepEqual(result.results.map((entry) => [entry.displayName, entry.status]), [["Karnimani", "caught"]]);
});

test("finds all present family members across players with current statuses", () => {
  const result = searchRunPokemonFamily(withPokemon([mon("a", "max", 158, "team"), mon("b", "leon", 159, "dead"), mon("c", "anna", 160, "box")]), 158);
  assert.deepEqual(result.results.map((entry) => [entry.displayName, entry.playerName, entry.status]), [["Karnimani", "Max", "team"], ["Tyracroc", "Leon", "dead"], ["Impergator", "Anna", "caught"]]);
});

test("includes fled encounters without a Pokémon record", () => {
  const run = withPokemon([], { encounters: [{ id: "fled", encounterGroupId: "g", location: "Route 201", playerId: "leon", species: "Karnimani", nickname: "", level: 7, status: "fled", createdAt: "2026-01-01T00:00:00.000Z", pokemonId: 158, apiName: "totodile", displayName: "Karnimani" }] });
  assert.deepEqual(searchRunPokemonFamily(run, 160).results.map((entry) => [entry.displayName, entry.status]), [["Karnimani", "fled"]]);
});

test("Eevee branches belong to one complete Platinum family", () => {
  const result = searchRunPokemonFamily(withPokemon([mon("e", "max", 133, "box"), mon("u", "leon", 197, "team"), mon("g", "anna", 471, "box")]), 134);
  assert.deepEqual(result.results.map((entry) => entry.displayName), ["Evoli", "Nachtara", "Glaziola"]);
  for (const id of [133, 134, 135, 136, 196, 197, 470, 471]) assert.ok(result.familyIds.includes(id));
});

test("German and English autocomplete names resolve to the same family", async () => {
  for (const query of ["Tyracroc", "Croconaw", "Karnimani", "Totodile"]) {
    const match = (await searchPokemon(query))[0];
    assert.ok(match?.id);
    assert.deepEqual(searchRunPokemonFamily(withPokemon([]), match.id).familyIds, [158, 159, 160]);
  }
});

test("returns an empty result when no family member occurred", () => {
  const result = searchRunPokemonFamily(withPokemon([]), 159);
  assert.deepEqual(result.results, []);
  assert.deepEqual(result.familyNames, ["Karnimani", "Tyracroc", "Impergator"]);
});

test("caught encounter plus Pokémon is returned only once and soft-deleted links stay searchable", () => {
  const pokemon = mon("a", "max", 158, "dead");
  const run = withPokemon([pokemon], { soulLinks: [{ id: "link-a", encounterIds: ["caught"], createdAt: "2026-01-01T00:00:00.000Z", status: "dead", deletedAt: "2026-01-02T00:00:00.000Z" }], encounters: [{ id: "caught", location: "Route 201", playerId: "max", species: "Karnimani", nickname: "", level: 7, status: "caught", createdAt: "2026-01-01T00:00:00.000Z", pokemonId: 158, apiName: "totodile", displayName: "Karnimani" }] });
  const result = searchRunPokemonFamily(run, 159);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, "dead");
  assert.equal(result.results[0].linkDeleted, true);
});

test("all IDs 1 through 493 have a safe evolution family containing themselves", () => {
  for (let id = 1; id <= 493; id += 1) {
    assert.ok(Array.isArray(pokemonEvolutionFamilies[String(id)]));
    assert.ok(pokemonEvolutionFamilies[String(id)].includes(id));
  }
  assert.equal(Object.keys(pokemonEvolutionFamilies).length, 493);
});
