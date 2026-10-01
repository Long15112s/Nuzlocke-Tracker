import test from "node:test";
import assert from "node:assert/strict";
import { assignSoulLinkDeathCause, deleteEncounter, getDeathCountsByPlayer, undoSoulLinkDeath, updatePokemonDetails } from "../lib/runLogic";
import { normalizeRun } from "../lib/storage";
import { makeRun } from "./fixtures";
function fixture(count = 2) {
  return makeRun({ players: Array.from({ length: count }, (_, i) => ({ id: i === 0 ? "host" : `player-${i + 1}`, name: ["Max", "Leon", "Anna", "Tim"][i], active: true })),
    soulLinks: [{ id: "link", encounterIds: ["encounter"], createdAt: "then", status: "active" }],
    encounters: [{ id: "encounter", encounterGroupId: "group", playerId: "host", species: "Garados", level: 5, nickname: "", location: "Route", status: "caught", createdAt: "then" }],
    pokemon: Array.from({ length: count }, (_, i) => ({ id: `pokemon-${i + 1}`, playerId: i === 0 ? "host" : `player-${i + 1}`, species: i === 0 ? "Garados" : "Glutexo", nickname: "", level: 5, location: "Route", status: "box" as const, soulLinkId: "link" })) });
}
test("each 2/3/4-player SoulLink death counts once for the triggering owner, even when host reports it", () => {
  for (const size of [2, 3, 4]) for (let trigger = 0; trigger < size; trigger++) {
    const run = fixture(size); const next = updatePokemonDetails(run, run.pokemon[trigger].id, { status: "dead" }, run.members![0]);
    const counts = getDeathCountsByPlayer(next);
    assert.equal(counts.total, 1); assert.equal(counts.unassigned, 0); assert.equal(counts.players.length, size);
    for (const p of counts.players) assert.equal(p.count, p.playerId === run.pokemon[trigger].playerId ? 1 : 0);
    assert.equal(next.soulLinks[0].deathCausedByPlayerId, run.pokemon[trigger].playerId);
    assert.equal(next.soulLinks[0].diedBy, "host-user"); assert.ok(next.pokemon.every(p => p.status === "dead"));
    const repeated = updatePokemonDetails(next, run.pokemon[(trigger + 1) % size].id, { status: "dead" }, run.members![0]);
    assert.equal(repeated.soulLinks[0].deathCausedByPlayerId, run.pokemon[trigger].playerId); assert.equal(getDeathCountsByPlayer(repeated).total, 1);
  }
});
test("undo removes a death; a later death attributes the same link to its new trigger", () => {
  const run = fixture(); const dead = updatePokemonDetails(run, "pokemon-1", { status: "dead" }, run.members![0]);
  const alive = undoSoulLinkDeath(dead, "link", run.members![0]); assert.equal(getDeathCountsByPlayer(alive).total, 0); assert.equal(alive.soulLinks[0].deathCausedByPlayerId, undefined);
  const again = updatePokemonDetails(alive, "pokemon-2", { status: "dead" }, run.members![0]);
  assert.equal(getDeathCountsByPlayer(again).players.find(p => p.playerId === "player-2")?.count, 1);
  assert.equal(getDeathCountsByPlayer(again).players.find(p => p.playerId === "host")?.count, 0);
});
test("undo decreases three attributed deaths to two without persisted counters", () => {
  const run = fixture(); run.soulLinks = ["a", "b", "c"].map(id => ({ id, encounterIds: [], createdAt: "then", status: "dead", deathCausedByPlayerId: "host" })); run.pokemon = [];
  assert.equal(getDeathCountsByPlayer(run).players[0].count, 3);
  assert.equal(getDeathCountsByPlayer(undoSoulLinkDeath(run, "b", run.members![0])).players[0].count, 2);
});
test("legacy death is unassigned; diedBy never implies responsibility and host can assign it", () => {
  const run = fixture(); run.soulLinks[0] = { ...run.soulLinks[0], status: "dead", diedBy: "host-user" }; run.pokemon = run.pokemon.map(p => ({ ...p, status: "dead" }));
  const counts = getDeathCountsByPlayer(run); assert.equal(counts.unassigned, 1); assert.ok(counts.players.every(p => p.count === 0));
  const next = assignSoulLinkDeathCause(run, "link", "player-2", run.members![0]);
  assert.equal(getDeathCountsByPlayer(next).unassigned, 0); assert.equal(getDeathCountsByPlayer(next).players[0].playerId, "player-2");
  assert.deepEqual(next.pokemon, run.pokemon); assert.equal(next.soulLinks[0].diedBy, "host-user");
  assert.throws(() => assignSoulLinkDeathCause(run, "link", "outside", run.members![0]), /gehört nicht/);
  assert.throws(() => assignSoulLinkDeathCause(run, "link", "player-2", { ...run.members![0], role: "player" }), /Host/);
  assert.throws(() => assignSoulLinkDeathCause(next, "link", "host", run.members![0]), /bereits/);
});
test("departed player keeps historical death after a new player occupies the slot", () => {
  const run = fixture(); const dead = updatePokemonDetails(run, "pokemon-2", { status: "dead" }, run.members![0]);
  dead.players[1].active = false; dead.players.push({ id: "new-player", name: "New", active: true }); dead.playerSlots![1] = { id: "slot-2", position: 2, playerId: "new-player" };
  const counts = getDeathCountsByPlayer(dead); const leon = counts.players.find(p => p.playerId === "player-2")!;
  assert.equal(leon.count, 1); assert.equal(leon.active, false); assert.equal(counts.players.find(p => p.playerId === "new-player")?.count, 0);
});
test("soft-deleted dead links count; full encounter deletion removes the death", () => {
  const run = fixture(); const dead = updatePokemonDetails(run, "pokemon-2", { status: "dead" }, run.members![0]); dead.soulLinks[0].deletedAt = "today";
  assert.equal(getDeathCountsByPlayer(dead).total, 1); assert.equal(getDeathCountsByPlayer(deleteEncounter(dead, "encounter", run.members![0])).total, 0);
});
test("counter handles legacy inferred deaths, unknown historical players and deterministic ties", () => {
  const run = fixture(4); run.soulLinks[0].status = undefined; run.pokemon[0].status = "dead";
  assert.equal(getDeathCountsByPlayer(run).unassigned, 1);
  run.soulLinks[0].deathCausedByPlayerId = "missing-player";
  const counts = getDeathCountsByPlayer(run); assert.equal(counts.players[0].playerId, "missing-player"); assert.equal(counts.players[0].active, false);
  assert.deepEqual(counts.players.slice(1).map(p => p.playerId), run.players.map(p => p.id));
  assert.equal(counts.total, counts.unassigned + counts.players.reduce((sum, p) => sum + p.count, 0));
});
test("extinguished and pending encounters never count as gameplay deaths", () => {
  const run = fixture(); run.pokemon[0].status = "dead";
  for (const status of ["pending", "extinguished"] as const) { run.soulLinks[0].status = status; assert.equal(getDeathCountsByPlayer(run).total, 0); }
});
test("normalization preserves responsibility and detail corrections do not change a death's cause", () => {
  const run = fixture(); const dead = updatePokemonDetails(run, "pokemon-2", { status: "dead" }, run.members![0]);
  const normalized = normalizeRun(dead)!; assert.equal(normalized.soulLinks[0].deathCausedByPlayerId, "player-2");
  const edited = updatePokemonDetails(normalized, "pokemon-1", { nickname: "Correction", status: "dead" }, run.members![0]);
  assert.equal(edited.soulLinks[0].deathCausedByPlayerId, "player-2"); assert.equal(getDeathCountsByPlayer(edited).total, 1);
});
