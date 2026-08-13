import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRun } from "../lib/storage";
import { canAdvanceBoss, canEditEncounters, canManagePlayers } from "../lib/permissions";
import { getEncounterGroupState, getOccupiedSlotCount, getSoulLinkDeathPreviousStatus, getSoulLinkDeathUndoTarget, getTeamLimitViolation, resolveMembershipAccess, validateQuickEncounter } from "../lib/runLogic";
import { platinumProgress } from "../lib/gameData";
import { makeRun } from "./fixtures";
import { getDeleteRunErrorMessage, isAlreadyDeletedError } from "../lib/cloudErrors";
import { GERMAN_POKEMON_NAMES, getPokemonDisplayName, platinumPokemon, searchPokemon } from "../lib/pokeapi";
import { getPlatinumLocationLabel } from "../lib/gameData";

test("counts only active players assigned to slots for 2/3/4-player runs", () => {
  for (const count of [2, 3, 4] as const) {
    const run = makeRun({ playerCount: count, playerSlots: Array.from({ length: count }, (_, index) => index === 0 ? { id: `slot-${index}`, position: index + 1, playerId: "host" } : { id: `slot-${index}`, position: index + 1 }) });
    assert.equal(getOccupiedSlotCount(run), 1);
  }
});

test("uses German Pokémon display names while retaining API slugs", () => {
  assert.equal(GERMAN_POKEMON_NAMES.bulbasaur, "Bisasam");
  assert.equal(GERMAN_POKEMON_NAMES.charmander, "Glumanda");
  assert.equal(GERMAN_POKEMON_NAMES.squirtle, "Schiggy");
  assert.equal(GERMAN_POKEMON_NAMES.gyarados, "Garados");
  assert.equal(GERMAN_POKEMON_NAMES.garchomp, "Knakrack");
  assert.equal(GERMAN_POKEMON_NAMES.luxray, "Luxtra");
  assert.equal(getPokemonDisplayName({ apiName: "garchomp", species: "Garchomp" }), "Knakrack");
});

test("contains every Nationaldex species from 1 through 493 exactly once", () => {
  assert.equal(platinumPokemon.length, 493);
  assert.deepEqual(platinumPokemon.map((pokemon) => pokemon.id), Array.from({ length: 493 }, (_, index) => index + 1));
  assert.equal(new Set(platinumPokemon.map((pokemon) => pokemon.id)).size, 493);
});

test("contains required German Platinum names and stable English API names", () => {
  const samples: Record<number, [string, string]> = {
    1: ["Bisasam", "bulbasaur"], 4: ["Glumanda", "charmander"], 7: ["Schiggy", "squirtle"], 25: ["Pikachu", "pikachu"], 133: ["Evoli", "eevee"], 150: ["Mewtu", "mewtwo"], 151: ["Mew", "mew"], 152: ["Endivie", "chikorita"], 155: ["Feurigel", "cyndaquil"], 158: ["Karnimani", "totodile"], 252: ["Geckarbor", "treecko"], 255: ["Flemmli", "torchic"], 258: ["Hydropi", "mudkip"], 387: ["Chelast", "turtwig"], 390: ["Panflam", "chimchar"], 393: ["Plinfa", "piplup"], 403: ["Sheinux", "shinx"], 405: ["Luxtra", "luxray"], 443: ["Kaumalat", "gible"], 445: ["Knakrack", "garchomp"], 448: ["Lucario", "lucario"], 483: ["Dialga", "dialga"], 484: ["Palkia", "palkia"], 487: ["Giratina", "giratina"], 491: ["Darkrai", "darkrai"], 492: ["Shaymin", "shaymin"], 493: ["Arceus", "arceus"],
  };
  for (const [id, [displayName, apiName]] of Object.entries(samples)) {
    assert.deepEqual(platinumPokemon[Number(id) - 1] && [platinumPokemon[Number(id) - 1].displayName, platinumPokemon[Number(id) - 1].apiName], [displayName, apiName]);
  }
});

test("searches German names, English names, prefixes and special punctuation locally", async () => {
  for (const [query, expected] of [["Panflam", "Panflam"], ["panf", "Panflam"], ["Chimchar", "Panflam"], ["chim", "Panflam"], ["Plinfa", "Plinfa"], ["plin", "Plinfa"], ["Piplup", "Plinfa"], ["pip", "Plinfa"], ["Knakrack", "Knakrack"], ["Garchomp", "Knakrack"]]) {
    assert.ok((await searchPokemon(query)).some((pokemon) => pokemon.displayName === expected), `${query} should find ${expected}`);
  }
  assert.equal((await searchPokemon("Nidoran♀"))[0]?.id, 29);
  assert.equal((await searchPokemon("Ho Oh"))[0]?.displayName, "Ho-Oh");
  assert.equal((await searchPokemon("Porygon Z"))[0]?.displayName, "Porygon-Z");
});

test("maps legacy Platinum locations without merging split encounter zones", () => {
  assert.equal(getPlatinumLocationLabel("Eterna Forest"), "Ewigwald");
  assert.equal(getPlatinumLocationLabel("Victory Road"), "Siegesstraße");
  assert.equal(getPlatinumLocationLabel("Route 204 South"), "Route 204 – Süd");
  assert.equal(getPlatinumLocationLabel("Route 204 North"), "Route 204 – Nord");
});

test("soft delete metadata preserves SoulLink status and restoration clears only metadata", () => {
  const original = { id: "link", encounterIds: [], createdAt: "2026-01-01T00:00:00.000Z", status: "dead" as const };
  const deleted = { ...original, deletedAt: "2026-01-02T00:00:00.000Z", deletedBy: "host" };
  const restored = { ...deleted, deletedAt: undefined, deletedBy: undefined };
  assert.equal(deleted.status, "dead");
  assert.equal(restored.status, "dead");
  assert.equal(restored.deletedAt, undefined);
});

test("repairs history-free local_slot placeholders but preserves historical players", () => {
  const fakeMember = { id: "fake-member", participantId: "local_slot_fake", displayName: "Spieler 2", role: "player" as const, playerId: "fake", active: true, joinedAt: "2026-01-01T00:00:00.000Z" };
  const broken = makeRun({ players: [{ id: "host", name: "Max", active: true }, { id: "fake", name: "Spieler 2", active: true }], members: [...makeRun().members!, fakeMember], playerSlots: [{ id: "slot-1", position: 1, playerId: "host" }, { id: "slot-2", position: 2, playerId: "fake" }] });
  const repaired = normalizeRun(broken)!;
  assert.equal(repaired.players.find((player) => player.id === "fake")?.active, false);
  assert.equal(repaired.playerSlots?.[1].playerId, undefined);

  const historical = normalizeRun({ ...broken, encounters: [{ id: "enc", playerId: "fake", location: "Route 204", species: "Gible", nickname: "", level: 5, status: "caught", createdAt: "2026-01-01T00:00:00.000Z" }] })!;
  assert.equal(historical.players.find((player) => player.id === "fake")?.active, true);
  assert.equal(historical.playerSlots?.[1].playerId, "fake");
});

test("normalizes Platinum completion and legacy badge overflow", () => {
  const run = normalizeRun(makeRun({ badges: 27 }))!;
  assert.equal(run.badges, platinumProgress.length);
  assert.equal(run.runStatus, "finished");
  assert.equal(run.levelCap, 62);
});

test("derives encounter SoulLink outcomes", () => {
  assert.equal(getEncounterGroupState(["caught", "caught"]), "active");
  assert.equal(getEncounterGroupState(["caught", "defeated"]), "extinguished");
  assert.equal(getEncounterGroupState(["caught", "fled"]), "extinguished");
  assert.equal(getEncounterGroupState(["caught", "reroll"]), "pending");
});

test("validates complete quick encounters for 2, 3 and 4 players", () => {
  for (const count of [2, 3, 4]) {
    const rows = Array.from({ length: count }, (_, index) => ({ playerId: `p${index}`, pokemonId: index + 1, apiName: "bulbasaur", level: 12, status: "caught" as const }));
    assert.equal(validateQuickEncounter("Route 204 – Süd", rows), null);
    assert.equal(getEncounterGroupState(rows.map((row) => row.status)), "active");
  }
});

test("rejects incomplete Pokémon selection and invalid levels", () => {
  assert.deepEqual(validateQuickEncounter("Route 204", [{ playerId: "p1", level: 12, status: "caught" }]), { field: "p1", message: "Bitte Pokémon aus der Liste auswählen." });
  assert.deepEqual(validateQuickEncounter("Route 204", [{ playerId: "p1", pokemonId: 390, apiName: "chimchar", level: 101, status: "caught" }]), { field: "p1", message: "Level muss zwischen 1 und 100 liegen." });
});

test("normalizes linked Pokémon to the strongest shared status", () => {
  const run = normalizeRun(makeRun({ soulLinks: [{ id: "link", encounterIds: [], createdAt: "2026-01-01T00:00:00.000Z", status: "active" }], pokemon: [
    { id: "a", playerId: "host", species: "Gible", nickname: "", level: 5, location: "Route", status: "team", soulLinkId: "link" },
    { id: "b", playerId: "p2", species: "Magikarp", nickname: "", level: 5, location: "Route", status: "dead", soulLinkId: "link" },
  ] }))!;
  assert.ok(run.pokemon.every((pokemon) => pokemon.status === "dead"));
});

test("blocks a SoulLink move that would exceed six team Pokémon", () => {
  const existing = Array.from({ length: 6 }, (_, index) => ({ id: `team-${index}`, playerId: "host", species: "Gible", nickname: "", level: 5, location: "Route", status: "team" as const }));
  const incoming = { id: "incoming", playerId: "host", species: "Magikarp", nickname: "", level: 5, location: "Route", status: "box" as const };
  const run = makeRun({ pokemon: [...existing, incoming] });
  assert.equal(getTeamLimitViolation(run, new Set([incoming.id])), "Max");
});

test("restores dead SoulLinks to their previous team or box status", () => {
  const run = makeRun({ soulLinks: [{ id: "link", encounterIds: [], createdAt: "2026-01-01T00:00:00.000Z", status: "dead", deathPreviousStatus: "team" }], pokemon: [{ id: "a", playerId: "host", species: "Gible", nickname: "", level: 5, location: "Route", status: "dead", soulLinkId: "link" }] });
  assert.equal(getSoulLinkDeathPreviousStatus(["team"]), "team");
  assert.deepEqual(getSoulLinkDeathUndoTarget(run, "link", "team"), { status: "team", teamLimitBlocked: false });
  assert.deepEqual(getSoulLinkDeathUndoTarget(run, "link", "box"), { status: "box", teamLimitBlocked: false });
  assert.deepEqual(getSoulLinkDeathUndoTarget(run, "link", undefined), { status: "box", teamLimitBlocked: false });
});

test("falls back to box when restoring a former team link would exceed the team limit", () => {
  const team = Array.from({ length: 6 }, (_, index) => ({ id: `team-${index}`, playerId: "host", species: "Gible", nickname: "", level: 5, location: "Route", status: "team" as const }));
  const dead = { id: "dead", playerId: "host", species: "Magikarp", nickname: "", level: 5, location: "Route", status: "dead" as const, soulLinkId: "link" };
  assert.deepEqual(getSoulLinkDeathUndoTarget(makeRun({ pokemon: [...team, dead] }), "link", "team"), { status: "box", teamLimitBlocked: true });
});

test("permissions and membership exit states change immediately", () => {
  const host = makeRun().members![0];
  const player = { ...host, id: "p", role: "player" as const };
  const kicked = { ...player, active: false };
  assert.equal(canManagePlayers(host), true);
  assert.equal(canAdvanceBoss(player), false);
  assert.equal(canEditEncounters(kicked), false);
  assert.equal(resolveMembershipAccess(false, true), "kicked");
  assert.equal(resolveMembershipAccess(null, false), "deleted");
});

test("maps delete RPC errors without discarding Supabase metadata", () => {
  assert.match(getDeleteRunErrorMessage({ code: "PGRST202", message: "Could not find public.delete_run" }), /RPC wurde nicht gefunden/);
  assert.equal(getDeleteRunErrorMessage({ code: "42501", message: "Host permission required" }), "Nur der aktuelle Host darf diesen Run löschen.");
  assert.match(getDeleteRunErrorMessage({ code: "XX000", message: "diagnostic detail" }, true), /diagnostic detail/);
  assert.equal(isAlreadyDeletedError({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }), true);
  assert.equal(isAlreadyDeletedError({ code: "42501", message: "Host permission required" }), false);
});
