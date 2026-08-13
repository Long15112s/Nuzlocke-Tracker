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
