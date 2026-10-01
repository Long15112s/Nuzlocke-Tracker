import test from "node:test";
import assert from "node:assert/strict";
import { makeRun } from "./fixtures";
import { deleteEncounter, getUsedEncounterLocations, updateEncounter } from "../lib/runLogic";
import { searchRunPokemonFamily } from "../lib/pokemonSearch";
import type { Encounter, PokemonSelection } from "../lib/types";
const encounter: Encounter = { id: "e1", encounterGroupId: "g1", playerId: "host", species: "Karnimani", displayName: "Karnimani", pokemonId: 158, apiName: "totodile", level: 7, location: "Route 201", nickname: "", status: "caught", createdAt: "2026-01-01" };
const selection: PokemonSelection = { id: 155, name: "cyndaquil", apiName: "cyndaquil", displayName: "Feurigel", types: ["fire"], abilities: [] };
function fixture() {
  return makeRun({ encounters: [encounter, { ...encounter, id: "e2", playerId: "p2" }], soulLinks: [{ id: "link", encounterIds: ["e1", "e2"], createdAt: encounter.createdAt, status: "dead", diedAt: "yesterday", deletedAt: "today" }], pokemon: [{ ...encounter, id: "p1", status: "dead", soulLinkId: "link", nickname: "Keep", item: "Keep item" }, { ...encounter, id: "p2", playerId: "p2", status: "dead", soulLinkId: "link" }] });
}
test("group deletion removes dead/soft-deleted link and Pokémon atomically and frees location", () => {
  const run = fixture(); const next = deleteEncounter(run, "e1", run.members![0]);
  assert.equal(next.encounters.length, 0); assert.equal(next.soulLinks.length, 0); assert.equal(next.pokemon.length, 0);
  assert.equal(getUsedEncounterLocations(next).has("route 201"), false);
  assert.equal(run.encounters.length, 2);
});
test("reroll leaves location available; another consuming group retains it after deletion", () => {
  assert.equal(getUsedEncounterLocations(makeRun({ encounters: [{ ...encounter, status: "reroll" }] })).size, 0);
  const run = fixture(); run.encounters.push({ ...encounter, id: "other", encounterGroupId: "other", status: "fled" });
  assert.equal(getUsedEncounterLocations(deleteEncounter(run, "e1", run.members![0])).has("route 201"), true);
});
test("species and level correction preserves IDs, dead status, metadata, other players and updates search", () => {
  const run = fixture(); const next = updateEncounter(run, "e1", { selection, level: 8, location: encounter.location, status: "caught" }, run.members![0]);
  assert.equal(next.encounters[0].species, "Feurigel"); assert.equal(next.pokemon[0].species, "Feurigel");
  assert.equal(next.pokemon[0].id, "p1"); assert.equal(next.pokemon[0].soulLinkId, "link"); assert.equal(next.pokemon[0].status, "dead");
  assert.equal(next.pokemon[0].nickname, "Keep"); assert.equal(next.pokemon[0].item, "Keep item"); assert.equal(next.pokemon[0].level, 8);
  assert.equal(next.encounters[0].level, 8); assert.deepEqual(next.soulLinks, run.soulLinks); assert.deepEqual(next.pokemon[1], run.pokemon[1]);
  assert.equal(searchRunPokemonFamily(next, 158).results.some(p => p.id === "p1"), false);
  assert.equal(searchRunPokemonFamily(next, 155).results.some(p => p.id === "p1"), true);
  assert.equal(searchRunPokemonFamily(deleteEncounter(next, "e1", run.members![0]), 155).results.length, 0);
});
test("single unlinked legacy encounter moves safely and rejects occupied destinations", () => {
  const run = makeRun({ soulLinkEnabled: false, encounters: [encounter], pokemon: [{ ...encounter, id: "p1", status: "team" }] });
  const patch = { level: 8, location: "Route 202", status: "caught" as const };
  const next = updateEncounter(run, "e1", patch, run.members![0]);
  assert.deepEqual([...getUsedEncounterLocations(next)], ["route 202"]); assert.equal(next.pokemon[0].location, "Route 202"); assert.equal(next.pokemon[0].status, "team");
  run.encounters.push({ ...encounter, id: "other", encounterGroupId: "other", location: "Route 202" });
  assert.throws(() => updateEncounter(run, "e1", patch, run.members![0]), /bereits verwendet/);
});
test("permissions, status transitions and shared location moves are enforced centrally", () => {
  const run = fixture(); const host = run.members![0]; const player = { ...host, role: "player" as const };
  const patch = { level: 8, location: encounter.location, status: "caught" as const };
  assert.doesNotThrow(() => updateEncounter(run, "e1", patch, player));
  assert.throws(() => updateEncounter(run, "e2", patch, player), /Berechtigung/);
  assert.throws(() => deleteEncounter(run, "e1", player), /Host/);
  assert.throws(() => updateEncounter(run, "e1", patch, { ...host, role: "spectator" }), /Berechtigung/);
  assert.throws(() => updateEncounter(run, "e1", { ...patch, status: "fled" }, host), /Statusänderungen/);
  assert.throws(() => updateEncounter(run, "e1", { ...patch, location: "Route 202" }, host), /gemeinsamen/);
});
test("ambiguous unlinked legacy Pokémon block destructive mutations", () => {
  const run = makeRun({ encounters: [encounter], pokemon: [{ ...encounter, id: "p1", status: "box" }, { ...encounter, id: "p2", status: "box" }] });
  assert.throws(() => deleteEncounter(run, "e1", run.members![0]), /eindeutig/);
  assert.throws(() => updateEncounter(run, "e1", { level: 8, status: "caught", location: encounter.location }, run.members![0]), /eindeutig/);
});
test("extinguished and legacy groups delete without orphan IDs", () => {
  const run = fixture(); run.soulLinks[0].status = "extinguished"; run.encounters = run.encounters.map(e => ({ ...e, encounterGroupId: undefined }));
  const next = deleteEncounter(run, "e1", run.members![0]); assert.equal(next.soulLinks.length + next.pokemon.length + next.encounters.length, 0);
});
