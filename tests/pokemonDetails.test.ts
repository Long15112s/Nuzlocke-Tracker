import test from "node:test";
import assert from "node:assert/strict";
import { createPokemonDetailsDraft, selectPokemonDraftSpecies, updatePokemonDetails } from "../lib/runLogic";
import { searchRunPokemonFamily } from "../lib/pokemonSearch";
import { makeRun } from "./fixtures";
import type { Pokemon, PokemonSelection } from "../lib/types";
const original: Pokemon = { id: "pokemon-1", playerId: "host", species: "Garados", displayName: "Garados", pokemonId: 130, apiName: "gyarados", spriteUrl: "garados.png", types: ["water", "flying"], nickname: "Dragon", level: 25, ability: "randomized-ability", status: "dead", location: "Route 201", soulLinkId: "link", item: "item" };
const selection: PokemonSelection = { id: 129, name: "magikarp", apiName: "magikarp", displayName: "Karpador", spriteUrl: "karpador.png", types: ["water"], abilities: ["swift-swim"] };
function fixture(explicit = false) {
  return makeRun({ pokemon: [{ ...original, ...(explicit ? { encounterId: "encounter-1" } : {}) }, { ...original, id: "partner", playerId: "p2", species: "Glutexo", pokemonId: 5 }],
    encounters: [{ id: "encounter-1", encounterGroupId: "group", playerId: "host", species: "Garados", level: 7, location: "Route 201", nickname: "", status: "caught", createdAt: "then" }, { id: "encounter-2", encounterGroupId: "group", playerId: "p2", species: "Glutexo", level: 7, location: "Route 201", nickname: "", status: "caught", createdAt: "then" }],
    soulLinks: [{ id: "link", encounterIds: ["encounter-1", "encounter-2"], createdAt: "then", displayNumber: 3, status: "dead", diedAt: "yesterday", deletedAt: "today", deletedBy: "host-user" }] });
}
test("Garados to Karpador retains instance identity, nickname, level, ability and dead status without duplicates", () => {
  const run = fixture(); const next = updatePokemonDetails(run, original.id, { selection }, run.members![0]); const p = next.pokemon[0];
  assert.equal(p.id, original.id); assert.equal(p.playerId, original.playerId); assert.equal(p.soulLinkId, original.soulLinkId);
  assert.equal(p.species, "Karpador"); assert.equal(p.displayName, "Karpador"); assert.equal(p.apiName, "magikarp"); assert.equal(p.pokemonId, 129);
  assert.equal(p.spriteUrl, selection.spriteUrl); assert.deepEqual(p.types, ["water"]);
  assert.equal(p.nickname, original.nickname); assert.equal(p.level, 25); assert.equal(p.ability, original.ability); assert.equal(p.status, "dead"); assert.equal(p.item, original.item);
  assert.equal(next.pokemon.length, run.pokemon.length); assert.deepEqual(next.pokemon[1], run.pokemon[1]); assert.deepEqual(next.soulLinks, run.soulLinks);
});
test("explicit and legacy SoulLink mapping synchronizes only the corresponding caught encounter", () => {
  for (const explicit of [true, false]) {
    const run = fixture(explicit); const next = updatePokemonDetails(run, original.id, { selection }, run.members![0]);
    assert.equal(next.encounters[0].species, "Karpador"); assert.equal(next.encounters[0].pokemonId, 129); assert.equal(next.encounters[0].spriteUrl, selection.spriteUrl); assert.deepEqual(next.encounters[0].types, ["water"]);
    assert.equal(next.encounters[0].level, 7); assert.equal(next.encounters[0].status, "caught"); assert.equal(next.encounters[0].location, "Route 201"); assert.deepEqual(next.encounters[1], run.encounters[1]);
    assert.equal(next.pokemon[0].encounterId, "encounter-1");
  }
});
test("starter without an encounter changes only the Pokémon and preserves its SoulLink", () => {
  const run = fixture(); run.encounters = []; run.soulLinks[0].encounterIds = []; run.pokemon[0].location = "Starter";
  const next = updatePokemonDetails(run, original.id, { selection }, run.members![0]);
  assert.equal(next.pokemon[0].species, "Karpador"); assert.equal(next.encounters.length, 0); assert.deepEqual(next.soulLinks, run.soulLinks);
});
test("discarding a species draft leaves the original run untouched, including sprite and types", () => {
  const run = fixture(); const snapshot = structuredClone(run);
  const draft = createPokemonDetailsDraft(run.pokemon[0], "Garados"); const editedDraft = selectPokemonDraftSpecies(draft, selection);
  assert.equal(editedDraft.selection?.spriteUrl, "karpador.png"); assert.equal(editedDraft.types, "water");
  assert.equal(editedDraft.nickname, "Dragon"); assert.equal(editedDraft.ability, original.ability); assert.equal(editedDraft.level, 25); assert.equal(editedDraft.status, "dead");
  assert.equal(draft.speciesQuery, "Garados"); assert.deepEqual(run, snapshot);
});
test("species correction is atomic with manual details and unchanged dead status", () => {
  const run = fixture(); const next = updatePokemonDetails(run, original.id, { selection, nickname: "New", level: 30, ability: "manual", types: ["fire"], status: "dead" }, run.members![0]);
  assert.equal(next.pokemon[0].nickname, "New"); assert.equal(next.pokemon[0].level, 30); assert.equal(next.pokemon[0].ability, "manual"); assert.deepEqual(next.pokemon[0].types, ["fire"]); assert.equal(next.encounters[0].species, "Karpador"); assert.deepEqual(next.soulLinks, run.soulLinks);
});
test("ambiguous legacy mapping and invalid explicit IDs refuse synchronization without mutations", () => {
  const run = fixture(); run.encounters.push({ ...run.encounters[0], id: "ambiguous" }); run.soulLinks[0].encounterIds.push("ambiguous");
  const snapshot = structuredClone(run);
  assert.throws(() => updatePokemonDetails(run, original.id, { selection }, run.members![0]), /nicht eindeutig/); assert.deepEqual(run, snapshot);
  run.pokemon[0].encounterId = "missing";
  assert.throws(() => updatePokemonDetails(run, original.id, { selection }, run.members![0]), /ungültig/);
});
test("unlinked legacy mapping resolves by owner and location rather than species", () => {
  const run = fixture(); run.soulLinks = []; run.pokemon = [{ ...original, soulLinkId: undefined }]; run.encounters = [run.encounters[0]];
  assert.equal(updatePokemonDetails(run, original.id, { selection }, run.members![0]).encounters[0].species, "Karpador");
});
test("spectators, other players and resurrection are rejected; owning player can correct species", () => {
  const run = fixture(); const host = run.members![0];
  assert.throws(() => updatePokemonDetails(run, original.id, { selection }, { ...host, role: "spectator" }), /Berechtigung/);
  assert.throws(() => updatePokemonDetails(run, original.id, { selection }, { ...host, role: "player", playerId: "p2" }), /Berechtigung/);
  assert.doesNotThrow(() => updatePokemonDetails(run, original.id, { selection }, { ...host, role: "player" }));
  assert.throws(() => updatePokemonDetails(run, original.id, { selection, status: "box" }, host), /wiederbelebt/);
});
test("separate status edits retain shared death rules, metadata and team limit", () => {
  const run = fixture(); run.pokemon = run.pokemon.map(p => ({ ...p, status: "box" })); run.soulLinks[0].status = "active";
  const next = updatePokemonDetails(run, original.id, { selection, status: "dead" }, run.members![0], "death-time");
  assert.ok(next.pokemon.every(p => p.status === "dead")); assert.equal(next.soulLinks[0].diedAt, "death-time"); assert.equal(next.soulLinks[0].deathPreviousStatus, "box"); assert.equal(next.soulLinks[0].deletedAt, "today");
  run.pokemon.push(...Array.from({ length: 6 }, (_, i) => ({ ...original, id: `team-${i}`, soulLinkId: undefined, status: "team" as const })));
  assert.throws(() => updatePokemonDetails(run, original.id, { status: "team" }, run.members![0]), /mehr als 6/);
});
test("search derives changed species metadata and rejects incomplete detail selections", () => {
  const run = fixture(); const next = updatePokemonDetails(run, original.id, { selection }, run.members![0]);
  const found = searchRunPokemonFamily(next, 129).results.find(p => p.id === original.id);
  // Garados and Karpador intentionally share the same evolution-family search.
  assert.equal(found?.displayName, "Karpador"); assert.equal(found?.apiName, "magikarp");
  assert.equal(searchRunPokemonFamily(next, 130).results.some(p => p.id === original.id && p.displayName === "Garados"), false);
  assert.throws(() => updatePokemonDetails(run, original.id, { selection: { ...selection, types: [] } }, run.members![0]), /Detaildaten/);
});
