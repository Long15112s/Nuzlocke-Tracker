import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeRun } from "../lib/storage";
import { getOccupiedSlotCount } from "../lib/runLogic";
import { makeRun } from "./fixtures";

test("kick frees a slot without deleting historical Pokémon or encounters", () => {
  const run = makeRun({
    players: [{ id: "host", name: "Max", active: true }, { id: "old-player", name: "Leon", active: false }],
    playerSlots: [{ id: "slot-1", position: 1, playerId: "host" }, { id: "slot-2", position: 2 }],
    pokemon: [{ id: "old-mon", playerId: "old-player", species: "Magikarp", nickname: "", level: 5, location: "Route 204", status: "box" }],
    encounters: [{ id: "old-enc", playerId: "old-player", species: "Magikarp", nickname: "", level: 5, location: "Route 204", status: "caught", createdAt: "2026-01-01T00:00:00.000Z" }],
  });
  assert.equal(getOccupiedSlotCount(run), 1);
  assert.equal(normalizeRun(run)!.pokemon.length, 1);
  assert.equal(normalizeRun(run)!.encounters.length, 1);
});

test("SQL serializes joins and authorizes writes through active membership", () => {
  const occupancySql = readFileSync("supabase/migrations/fix-slot-occupancy-preview.sql", "utf8");
  const realtimeSql = readFileSync("supabase/migrations/fix-membership-realtime.sql", "utf8");
  const slotsSql = readFileSync("supabase/migrations/fixed-player-slots.sql", "utf8");
  assert.match(occupancySql, /for update/i);
  assert.match(occupancySql, /on conflict \(run_id, user_id\)/i);
  assert.match(realtimeSql, /user_id = auth\.uid\(\)/i);
  assert.match(slotsSql, /run_member_role\(id\) in \('host', 'player'\)/i);
  assert.match(slotsSql, /update public\.run_members set active = false/i);
});

test("member recovery is hashed, single-use and preserves the logical player", () => {
  const sql = readFileSync("supabase/migrations/player-recovery-codes.sql", "utf8");
  const cloud = readFileSync("lib/cloud.ts", "utf8");
  assert.match(sql, /gen_random_bytes\(16\)/i);
  assert.match(sql, /digest\(raw_code, 'sha256'\)/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /recovery_code_hash = null, inactive_reason = 'recovered'/i);
  assert.match(sql, /old_member\.player_id/i);
  assert.match(sql, /old_member\.role = 'host'[\s\S]*auth\.uid\(\)/i);
  assert.match(sql, /unique index if not exists run_members_one_active_player/i);
  assert.match(sql, /inactive_reason='kicked'|inactive_reason = 'kicked'/i);
  assert.match(sql, /inactive_reason='left'|inactive_reason = 'left'/i);
  assert.doesNotMatch(cloud, /(?:localStorage[\s\S]*recovery|console\.log\([\s\S]*recovery)/i);
});

test("delete RPC is host-scoped, idempotent and relies on run-local cascades", () => {
  const deleteSql = readFileSync("supabase/migrations/fix-delete-run.sql", "utf8");
  const schemaSql = readFileSync("supabase/schema.sql", "utf8");
  assert.match(deleteSql, /create or replace function public\.delete_run\(target_run uuid\)/i);
  assert.match(deleteSql, /run_owner <> auth\.uid\(\)/i);
  assert.match(deleteSql, /member\.active = true[\s\S]*member\.role = 'host'/i);
  assert.match(deleteSql, /if not found then\s+return/i);
  assert.match(deleteSql, /revoke all on function public\.delete_run\(uuid\) from public/i);
  assert.match(deleteSql, /grant execute on function public\.delete_run\(uuid\) to authenticated/i);
  assert.match(schemaSql, /run_id uuid not null references public\.runs\(id\) on delete cascade/g);
  assert.doesNotMatch(deleteSql, /delete from auth\.users/i);
});

test("delete lifecycle guards duplicate requests, pending saves and self realtime deletes", () => {
  const pageSource = readFileSync("app/page.tsx", "utf8");
  const cloudSource = readFileSync("lib/cloud.ts", "utf8");
  assert.match(pageSource, /if \(deletingRunRef\.current\) return;\s+deletingRunRef\.current = true;/);
  assert.match(pageSource, /window\.clearTimeout\(pendingCloudSaveRef\.current\)/);
  assert.match(pageSource, /if \(deletingRunRef\.current\) return;\s+saveCloudRun\(run\)/);
  assert.match(pageSource, /if \(!deletingRunRef\.current\) leaveCloudDashboard\("deleted"/);
  assert.doesNotMatch(cloudSource, /console\.error\("deleteCloudRun failed"/);
});

test("quick encounter UI guards duplicate submits and autocomplete Enter", () => {
  const pageSource = readFileSync("app/page.tsx", "utf8");
  const autocompleteSource = readFileSync("components/PokemonAutocomplete.tsx", "utf8");
  assert.match(pageSource, /if \(readOnly \|\| submitLockRef\.current\) return/);
  assert.match(pageSource, /event\.ctrlKey && event\.key === "Enter"/);
  assert.match(autocompleteSource, /event\.key === "Enter"[\s\S]*event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)/);
});

test("death undo is host-only, atomic and separate from soft delete", () => {
  const pageSource = readFileSync("app/page.tsx", "utf8");
  const permissionsSource = readFileSync("lib/permissions.ts", "utf8");
  assert.match(permissionsSource, /canUndoSoulLinkDeath[\s\S]*canManageRun/);
  assert.match(pageSource, /if \(!canUndoSoulLinkDeath\(currentMember\) \|\| soulLinkMutationRef\.current\) return/);
  assert.match(pageSource, /pokemon\.soulLinkId === linkId \? \{ \.\.\.pokemon, status: target\.status \}/);
  assert.match(pageSource, /deathPreviousStatus: undefined, diedAt: undefined, diedBy: undefined/);
  assert.match(pageSource, /deletedAt: undefined, deletedBy: undefined/);
});
