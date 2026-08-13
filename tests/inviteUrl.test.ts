import test from "node:test";
import assert from "node:assert/strict";
import { getInviteUrl } from "../lib/inviteUrl";

test("uses NEXT_PUBLIC_APP_URL first and removes trailing slashes", () => {
  assert.equal(getInviteUrl("8CB82A5B", { appUrl: "https://nuzlocke-tracker-iota.vercel.app///", vercelProductionUrl: "other.vercel.app", origin: "https://preview.vercel.app", production: true }), "https://nuzlocke-tracker-iota.vercel.app/?join=8CB82A5B");
});

test("URL-encodes invite codes", () => {
  assert.equal(getInviteUrl("CODE +/?", { appUrl: "https://example.test/" }), "https://example.test/?join=CODE%20%2B%2F%3F");
});

test("uses the Vercel production domain before the current origin", () => {
  assert.equal(getInviteUrl("ABC", { vercelProductionUrl: "nuzlocke-tracker-iota.vercel.app/", origin: "https://random-preview.vercel.app", production: true }), "https://nuzlocke-tracker-iota.vercel.app/?join=ABC");
});

test("uses localhost only as development fallback", () => {
  assert.equal(getInviteUrl("LOCAL", { origin: "http://localhost:3000/", production: false }), "http://localhost:3000/?join=LOCAL");
});

test("never uses a random deployment origin in production", () => {
  assert.equal(getInviteUrl("PROD", { origin: "https://random-deployment.vercel.app", production: true }), "https://nuzlocke-tracker-iota.vercel.app/?join=PROD");
});
