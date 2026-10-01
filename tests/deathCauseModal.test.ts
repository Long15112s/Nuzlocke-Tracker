import test from "node:test";
import assert from "node:assert/strict";
import { createPokemonDetailsDraft, getDeathCountsByPlayer, getSoulLinkDeathMembers, updatePokemonDetails } from "../lib/runLogic";
import { makeRun } from "./fixtures";
function fixture(size = 2) {
  return makeRun({ players: Array.from({ length: size }, (_, i) => ({ id: i === 0 ? "host" : `player-${i}`, name: i === 0 ? "max" : `Spieler ${i}`, active: true })),
    soulLinks: [{ id: "link", encounterIds: [], createdAt: "then", status: "active" }],
    pokemon: Array.from({ length: size }, (_, i) => ({ id: `pokemon-${i}`, playerId: i === 0 ? "host" : `player-${i}`, species: i === 0 ? "Ibitak" : "Glumanda", nickname: "", level: 5, location: "Starter", status: "box" as const, soulLinkId: "link" })) });
}
test("modal draft preselects opened owner for a new death and stores the selected stable player ID", () => {
  const run = fixture(); const draft = createPokemonDetailsDraft(run.pokemon[1], "Glumanda", run);
  assert.equal(draft.deathCausedByPlayerId, "player-1");
  const next = updatePokemonDetails(run, "pokemon-1", { status: "dead", deathCausedByPlayerId: draft.deathCausedByPlayerId }, run.members![0]);
  assert.equal(next.soulLinks[0].deathCausedByPlayerId, "player-1"); assert.equal(getDeathCountsByPlayer(next).players.find(p => p.playerId === "host")?.count, 0);
  assert.equal(getDeathCountsByPlayer(next).players.find(p => p.playerId === "player-1")?.count, 1); assert.equal(getDeathCountsByPlayer(next).total, 1);
});
test("selecting partner max changes attribution without changing member species or owners", () => {
  const run = fixture(); const next = updatePokemonDetails(run, "pokemon-1", { status: "dead", deathCausedByPlayerId: "host" }, run.members![0]);
  assert.equal(getDeathCountsByPlayer(next).players.find(p => p.playerId === "host")?.count, 1);
  assert.ok(next.pokemon.every(p => p.status === "dead"));
  assert.deepEqual(next.pokemon.map(({ status: _status, ...p }) => p), run.pokemon.map(({ status: _status, ...p }) => p));
});
test("new death with explicit empty or foreign attribution is rejected atomically", () => {
  const run = fixture(); const snapshot = structuredClone(run);
  assert.throws(() => updatePokemonDetails(run, "pokemon-1", { status: "dead", deathCausedByPlayerId: "" }, run.members![0]), /Bitte wähle aus/);
  for (const wrong of ["host-user", "host-member", "pokemon-0", "other"]) assert.throws(() => updatePokemonDetails(run, "pokemon-1", { status: "dead", deathCausedByPlayerId: wrong }, run.members![0]), /gehört nicht/);
  assert.deepEqual(run, snapshot);
});
test("legacy dead draft remains unassigned and can be saved without inventing a cause", () => {
  const run = fixture(); run.soulLinks[0].status = "dead"; run.pokemon = run.pokemon.map(p => ({ ...p, status: "dead" }));
  assert.equal(createPokemonDetailsDraft(run.pokemon[1], "Glumanda", run).deathCausedByPlayerId, "");
  const next = updatePokemonDetails(run, "pokemon-1", { status: "dead", deathCausedByPlayerId: "", nickname: "Fixed" }, run.members![0]);
  assert.equal(next.soulLinks[0].deathCausedByPlayerId, undefined); assert.equal(getDeathCountsByPlayer(next).unassigned, 1);
});
test("host assigns and corrects dead cause without a new death transition or metadata timestamp", () => {
  const run = fixture(); let dead = updatePokemonDetails(run, "pokemon-1", { status: "dead", deathCausedByPlayerId: "player-1" }, run.members![0], "original-time");
  dead.soulLinks[0].deathCausedByPlayerId = undefined; dead.soulLinks[0].deletedAt = "soft-delete";
  const assigned = updatePokemonDetails(dead, "pokemon-1", { status: "dead", deathCausedByPlayerId: "player-1" }, run.members![0], "later-time");
  const corrected = updatePokemonDetails(assigned, "pokemon-1", { status: "dead", deathCausedByPlayerId: "host" }, run.members![0], "latest-time");
  assert.equal(corrected.soulLinks[0].diedAt, "original-time"); assert.equal(corrected.soulLinks[0].diedBy, "host-user"); assert.equal(corrected.soulLinks[0].deletedAt, "soft-delete");
  assert.equal(corrected.soulLinks[0].deathPreviousStatus, "box"); assert.deepEqual(corrected.pokemon, dead.pokemon);
  assert.equal(getDeathCountsByPlayer(corrected).total, 1); assert.equal(getDeathCountsByPlayer(corrected).players.find(p => p.playerId === "host")?.count, 1);
  assert.equal(createPokemonDetailsDraft(corrected.pokemon[1], "Glumanda", corrected).deathCausedByPlayerId, "host");
});
test("modal undo dead to box/team clears the cause and uses host-only SoulLink-wide rules", () => {
  for (const status of ["box", "team"] as const) {
    const run = fixture(); const dead = updatePokemonDetails(run, "pokemon-1", { status: "dead", deathCausedByPlayerId: "player-1" }, run.members![0]);
    const restored = updatePokemonDetails(dead, "pokemon-1", { status, undoDeath: true }, run.members![0]);
    assert.ok(restored.pokemon.every(p => p.status === status)); assert.equal(restored.soulLinks[0].deathCausedByPlayerId, undefined); assert.equal(restored.soulLinks[0].diedAt, undefined);
    assert.equal(getDeathCountsByPlayer(restored).total, 0);
    assert.throws(() => updatePokemonDetails(dead, "pokemon-1", { status, undoDeath: true }, { ...run.members![0], role: "player", playerId: "player-1" }), /Host/);
  }
});
test("three/four member dropdown source includes all owners, including inactive partners", () => {
  for (const count of [3, 4]) {
    const run = fixture(count); run.players[1].active = false;
    const members = getSoulLinkDeathMembers(run, run.pokemon[0]);
    assert.equal(members.length, count); assert.deepEqual(members.map(p => p.playerId), run.players.map(p => p.id));
  }
});
test("spectator and other-player edits are rejected; players can report their own death with a partner cause", () => {
  const run = fixture(); const player = { ...run.members![0], role: "player" as const, playerId: "player-1" };
  assert.doesNotThrow(() => updatePokemonDetails(run, "pokemon-1", { status: "dead", deathCausedByPlayerId: "host" }, player));
  assert.throws(() => updatePokemonDetails(run, "pokemon-0", { status: "dead", deathCausedByPlayerId: "host" }, player), /Berechtigung/);
  assert.throws(() => updatePokemonDetails(run, "pokemon-1", { status: "dead", deathCausedByPlayerId: "host" }, { ...player, role: "spectator" }), /Berechtigung/);
  const dead = updatePokemonDetails(run, "pokemon-1", { status: "dead", deathCausedByPlayerId: "player-1" }, run.members![0]);
  assert.throws(() => updatePokemonDetails(dead, "pokemon-1", { status: "dead", deathCausedByPlayerId: "host" }, player), /Host/);
});
