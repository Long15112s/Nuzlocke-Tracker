export type PokemonStatus = "team" | "box" | "dead";
export type EncounterStatus = "caught" | "defeated" | "fled" | "reroll" | "skipped";

export type PokemonApiSummary = {
  id?: number;
  name: string;
  apiName?: string;
  englishName?: string;
  url: string;
  spriteUrl?: string;
  displayName?: string;
};

export type PokemonSelection = {
  id?: number;
  apiName: string;
  displayName: string;
  name: string;
  spriteUrl?: string;
  types: string[];
  abilities: string[];
};

export type RunMemberRole = "host" | "player" | "spectator";
export type RunStatus = "setup" | "active" | "finished";
export type RunPlayerCount = 2 | 3 | 4;
export type PlayerSlot = { id: string; position: number; playerId?: string; memberId?: string };
export type RunMember = {
  id: string;
  participantId: string;
  displayName: string;
  role: RunMemberRole;
  playerId?: string;
  color?: string;
  active: boolean;
  joinedAt: string;
};
export type Player = { id: string; name: string; color?: string; active?: boolean };
export type Pokemon = {
  id: string;
  playerId: string;
  species: string;
  nickname: string;
  level: number;
  location: string;
  ability?: string;
  item?: string;
  status: PokemonStatus;
  soulLinkId?: string;
  pokemonId?: number;
  spriteUrl?: string;
  types?: string[];
  apiName?: string;
  displayName?: string;
};
export type Encounter = {
  id: string;
  encounterGroupId?: string;
  location: string;
  playerId: string;
  species: string;
  level: number;
  nickname: string;
  status: EncounterStatus;
  createdAt: string;
  ability?: string;
  pokemonId?: number;
  spriteUrl?: string;
  types?: string[];
  apiName?: string;
  displayName?: string;
};
export type SoulLinkState = "active" | "dead" | "extinguished" | "pending";
export type SoulLink = { id: string; encounterIds: string[]; createdAt: string; displayNumber?: number; status?: SoulLinkState; deletedAt?: string; deletedBy?: string; deathPreviousStatus?: "team" | "box"; diedAt?: string; diedBy?: string };
export type RandomizerSettings = {
  wild: boolean;
  trainers: boolean;
  starters: boolean;
  types: boolean;
  abilities: boolean;
  moves: boolean;
  items: boolean;
  seed: string;
  notes: string;
};
export type RunState = {
  id: string;
  inviteCode: string;
  name: string;
  game: string;
  currentBoss: string;
  levelCap: number;
  badges: number;
  players: Player[];
  encounters: Encounter[];
  pokemon: Pokemon[];
  soulLinks: SoulLink[];
  playerCount?: RunPlayerCount;
  playerSlots?: PlayerSlot[];
  runStatus?: RunStatus;
  members?: RunMember[];
  soulLinkEnabled?: boolean;
  randomizer: RandomizerSettings;
};
