import test from "node:test";
import assert from "node:assert/strict";
import { GEN4_TYPE_CHART, POKEMON_TYPES, TYPE_LABELS, formatTypeMultiplier, getTypeEffectiveness, type PokemonType } from "../lib/typeChart";

test("Generation IV has exactly 17 types and every one of its 289 cells is valid", () => {
  assert.equal(POKEMON_TYPES.length, 17); assert.equal(new Set(POKEMON_TYPES).size, 17);
  assert.deepEqual(Object.keys(GEN4_TYPE_CHART), [...POKEMON_TYPES]);
  assert.equal("fairy" in GEN4_TYPE_CHART, false);
  for (const attack of POKEMON_TYPES) {
    assert.deepEqual(Object.keys(GEN4_TYPE_CHART[attack]), [...POKEMON_TYPES]);
    assert.ok(TYPE_LABELS[attack]);
    for (const defense of POKEMON_TYPES) assert.ok([0, 0.5, 1, 2].includes(GEN4_TYPE_CHART[attack][defense]), `${attack} -> ${defense}`);
  }
});

const cases: [PokemonType, PokemonType, number][] = [
  ["normal", "ghost", 0], ["ghost", "normal", 0], ["electric", "ground", 0], ["ground", "flying", 0], ["poison", "steel", 0], ["psychic", "dark", 0], ["fighting", "ghost", 0],
  ["fire", "grass", 2], ["fire", "steel", 2], ["water", "fire", 2], ["electric", "water", 2], ["ice", "dragon", 2], ["fighting", "normal", 2], ["ghost", "psychic", 2], ["dark", "psychic", 2],
  ["fire", "water", 0.5], ["dragon", "steel", 0.5], ["normal", "normal", 1],
];
for (const [attack, defense, expected] of cases) test(`${attack} -> ${defense} = ${expected}`, () => {
  assert.equal(getTypeEffectiveness(attack, defense), expected);
});
test("Generation-IV Steel still resists Ghost and Dark", () => {
  assert.equal(GEN4_TYPE_CHART.ghost.steel, 0.5); assert.equal(GEN4_TYPE_CHART.dark.steel, 0.5);
});
const duals: [PokemonType, PokemonType, PokemonType, number][] = [
  ["fire", "grass", "steel", 4], ["electric", "water", "flying", 4], ["ground", "electric", "flying", 0], ["ice", "dragon", "flying", 4], ["water", "water", "dragon", 0.25],
];
for (const [attack, first, second, expected] of duals) test(`${attack} -> ${first}/${second} = ${expected}`, () => {
  assert.equal(getTypeEffectiveness(attack, first, second), expected);
  assert.equal(getTypeEffectiveness(attack, second, first), expected);
});
test("duplicate defense type does not apply twice and fraction labels remain visible", () => {
  assert.equal(getTypeEffectiveness("fire", "grass", "grass"), 2);
  assert.equal(formatTypeMultiplier(0.25), "¼×"); assert.equal(formatTypeMultiplier(0.5), "½×");
  assert.equal(formatTypeMultiplier(0), "0×"); assert.equal(formatTypeMultiplier(1), "1×"); assert.equal(formatTypeMultiplier(4), "4×");
});
