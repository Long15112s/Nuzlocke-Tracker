import type { RunMember } from "./types";

export const MAX_RUN_PLAYERS = 4;
export const MIN_RUN_PLAYERS = 2;

export function canManageRun(member: RunMember | null | undefined) { return member?.active === true && member.role === "host"; }
export function canEditEncounters(member: RunMember | null | undefined) { return member?.active === true && member.role !== "spectator"; }
export function canEditPokemon(member: RunMember | null | undefined) { return member?.active === true && member.role !== "spectator"; }
export function canEditPokemonOwnedBy(member: RunMember | null | undefined, playerId: string) { return canManageRun(member) || (canEditPokemon(member) && member?.playerId === playerId); }
export function canAdvanceBoss(member: RunMember | null | undefined) { return canManageRun(member); }
export function canManagePlayers(member: RunMember | null | undefined) { return canManageRun(member); }
