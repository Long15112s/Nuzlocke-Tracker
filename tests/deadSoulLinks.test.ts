import test from "node:test";
import assert from "node:assert/strict";
import { deleteEncounter, getDeadSoulLinks, getDeathCountsByPlayer, undoSoulLinkDeath } from "../lib/runLogic";
import { makeRun } from "./fixtures";
function fixture(size: number, links = 1) {
  return makeRun({ soulLinks: Array.from({ length: links }, (_, i) => ({ id: `link-${i}`, encounterIds: [`enc-${i}`], createdAt: "then", status: "dead" as const, deathCausedByPlayerId: "host" })),
    encounters: Array.from({ length: links }, (_, i) => ({ id: `enc-${i}`, encounterGroupId: `group-${i}`, playerId: "host", species: "Glumanda", nickname: "", level: 5, location: `Route ${i}`, status: "caught" as const, createdAt: "then" })),
    pokemon: Array.from({ length: links * size }, (_, i) => ({ id: `pokemon-${i}`, playerId: i % size === 0 ? "host" : `player-${i % size}`, species: "Glumanda", nickname: "", level: 5, location: `Route ${Math.floor(i / size)}`, status: "dead" as const, soulLinkId: `link-${Math.floor(i / size)}` })) });
}
for (const size of [2, 3, 4]) test(`${size} dead Pokémon count as exactly one SoulLink death in every total`, () => {
  const run = fixture(size);
  assert.equal(run.pokemon.filter(p => p.status === "dead").length, size);
  assert.equal(getDeadSoulLinks(run).length, 1); assert.equal(getDeathCountsByPlayer(run).total, 1);
  assert.equal(getDeathCountsByPlayer(run).players.find(p => p.playerId === "host")?.count, 1);
});
test("two 2-player links count as two deaths and undo removes exactly one", () => {
  const run = fixture(2, 2); assert.equal(run.pokemon.length, 4); assert.equal(getDeadSoulLinks(run).length, 2);
  const next = undoSoulLinkDeath(run, "link-0", run.members![0]);
  assert.equal(getDeadSoulLinks(next).length, 1); assert.equal(getDeathCountsByPlayer(next).total, 1);
});
test("soft deletion preserves one death; full group deletion removes exactly one", () => {
  const run = fixture(2, 2); run.soulLinks[0].deletedAt = "today";
  assert.equal(getDeadSoulLinks(run).length, 2); assert.equal(getDeathCountsByPlayer(run).total, 2);
  const next = deleteEncounter(run, "enc-0", run.members![0]);
  assert.equal(getDeadSoulLinks(next).length, 1); assert.equal(getDeathCountsByPlayer(next).total, 1);
});
test("shared definition supports legacy inferred death, rejects extinguished links and deduplicates IDs", () => {
  const run = fixture(2); run.soulLinks[0].status = undefined;
  assert.equal(getDeadSoulLinks(run).length, 1);
  run.soulLinks.push({ ...run.soulLinks[0] }); assert.equal(getDeadSoulLinks(run).length, 1); assert.equal(getDeathCountsByPlayer(run).total, 1);
  run.soulLinks.forEach(l => { l.status = "extinguished"; }); assert.equal(getDeadSoulLinks(run).length, 0);
});
test("unlinked dead Pokémon do not count as SoulLink deaths", () => {
  const run = fixture(2); run.pokemon.forEach(p => { p.soulLinkId = undefined; }); run.soulLinks = [];
  assert.equal(getDeadSoulLinks(run).length, 0); assert.equal(getDeathCountsByPlayer(run).total, 0);
});
