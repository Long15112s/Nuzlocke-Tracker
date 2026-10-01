import test from "node:test";
import assert from "node:assert/strict";
import { getPlatinumLocationLabel, platinumEncounterLocations } from "../lib/gameData";
import { deleteEncounter, getAvailablePlatinumEncounterLocations, getUsedEncounterLocations, updateEncounter } from "../lib/runLogic";
import { makeRun } from "./fixtures";
import type { EncounterStatus } from "../lib/types";
function fixture(status: EncounterStatus = "caught", location = "Fossil") {
  return makeRun({ encounters: [{ id: "enc", playerId: "host", encounterGroupId: "group", species: "Kabuto", level: 20, location, nickname: "", status, createdAt: "then" }] });
}
const fossilAvailable = (run: ReturnType<typeof makeRun>) => getAvailablePlatinumEncounterLocations(run).some(place => place.id === "fossil");
test("new runs offer exactly one stable fossil location with German label", () => {
  assert.equal(platinumEncounterLocations.filter(place => place.id === "fossil").length, 1);
  assert.equal(getPlatinumLocationLabel("fossil"), "Fossil"); assert.equal(fossilAvailable(makeRun()), true);
});
test("caught, defeated and fled consume Fossil; reroll and skipped retain existing pending rules", () => {
  for (const status of ["caught", "defeated", "fled"] as const) assert.equal(fossilAvailable(fixture(status)), false);
  for (const status of ["reroll", "skipped"] as const) assert.equal(fossilAvailable(fixture(status)), true);
});
test("full fossil SoulLink deletion frees the location and removes its group", () => {
  const run = fixture(); run.encounters.push({ ...run.encounters[0], id: "partner", playerId: "p2", species: "Aerodactyl" });
  run.soulLinks = [{ id: "link", encounterIds: ["enc", "partner"], createdAt: "then", status: "active" }];
  run.pokemon = run.encounters.map(e => ({ ...e, id: `pokemon-${e.id}`, encounterId: e.id, status: "box", soulLinkId: "link" }));
  assert.equal(fossilAvailable(run), false);
  const next = deleteEncounter(run, "enc", run.members![0]);
  assert.equal(fossilAvailable(next), true); assert.equal(next.encounters.length + next.soulLinks.length + next.pokemon.length, 0);
});
test("single encounter moves Route 201 to Fossil and back using normal occupancy rules", () => {
  const run = fixture("caught", "Route 201");
  const next = updateEncounter(run, "enc", { level: 20, status: "caught", location: "Fossil" }, run.members![0]);
  assert.equal(getUsedEncounterLocations(next).has("route 201"), false); assert.equal(fossilAvailable(next), false);
  const restored = updateEncounter(next, "enc", { level: 20, status: "caught", location: "Route 201" }, run.members![0]);
  assert.equal(fossilAvailable(restored), true); assert.equal(getUsedEncounterLocations(restored).has("route 201"), true);
  assert.equal(run.encounters[0].location, "Route 201"); assert.equal(next.encounters[0].id, "enc");
});
test("another consuming Fossil encounter retains occupancy and blocks moving into it", () => {
  const run = fixture(); run.encounters.push({ ...run.encounters[0], id: "other", encounterGroupId: "other", location: "Route 201" });
  assert.throws(() => updateEncounter(run, "other", { level: 20, status: "caught", location: "Fossil" }, run.members![0]), /bereits verwendet/);
  run.encounters[1].location = "Fossil";
  assert.equal(fossilAvailable(deleteEncounter(run, "enc", run.members![0])), false);
});
