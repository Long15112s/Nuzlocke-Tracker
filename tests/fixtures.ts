import type { RunState } from "../lib/types";

export function makeRun(overrides: Partial<RunState> = {}): RunState {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    inviteCode: "TESTCODE",
    name: "Test Run",
    game: "Pokémon Platin",
    currentBoss: "Roark",
    levelCap: 14,
    badges: 0,
    playerCount: 2,
    players: [{ id: "host", name: "Max", active: true }],
    members: [{ id: "host-member", participantId: "host-user", displayName: "Max", role: "host", playerId: "host", active: true, joinedAt: "2026-01-01T00:00:00.000Z" }],
    playerSlots: [{ id: "slot-1", position: 1, playerId: "host", memberId: "host-member" }, { id: "slot-2", position: 2 }],
    encounters: [],
    pokemon: [],
    soulLinks: [],
    soulLinkEnabled: true,
    runStatus: "active",
    randomizer: { wild: true, trainers: true, starters: true, types: false, abilities: true, moves: false, items: true, seed: "", notes: "" },
    ...overrides,
  };
}
