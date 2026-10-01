export const POKEMON_TYPES = ["normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel"] as const;
export type PokemonType = typeof POKEMON_TYPES[number];
export type TypeMultiplier = 0 | 0.5 | 1 | 2;
export const TYPE_LABELS: Record<PokemonType, string> = { normal: "Normal", fire: "Feuer", water: "Wasser", electric: "Elektro", grass: "Pflanze", ice: "Eis", fighting: "Kampf", poison: "Gift", ground: "Boden", flying: "Flug", psychic: "Psycho", bug: "Käfer", rock: "Gestein", ghost: "Geist", dragon: "Drache", dark: "Unlicht", steel: "Stahl" };

// Generation II–V chart, including Platinum's Ghost/Dark resistances on Steel.
// Verified against https://pokemondb.net/type/old . Rows attack, columns defend.
// Neutral pairs default to 1; all historical exceptions are listed explicitly.
const matchups: Record<PokemonType, Partial<Record<PokemonType, TypeMultiplier>>> = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5, steel: 0.5 },
  dragon: { dragon: 2, steel: 0.5 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, steel: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5 },
};
export const GEN4_TYPE_CHART = Object.fromEntries(POKEMON_TYPES.map(attack => [attack,
  Object.freeze(Object.fromEntries(POKEMON_TYPES.map(defense => [defense, matchups[attack][defense] ?? 1])))
])) as Readonly<Record<PokemonType, Readonly<Record<PokemonType, TypeMultiplier>>>>;
Object.freeze(GEN4_TYPE_CHART);

export function getTypeEffectiveness(attack: PokemonType, defense: PokemonType, secondDefense?: PokemonType) {
  return GEN4_TYPE_CHART[attack][defense] * (secondDefense && secondDefense !== defense ? GEN4_TYPE_CHART[attack][secondDefense] : 1);
}
export function formatTypeMultiplier(multiplier: number) {
  return `${multiplier === 0.5 ? "½" : multiplier === 0.25 ? "¼" : multiplier}×`;
}
export function getEffectivenessLabel(multiplier: number) {
  return multiplier === 0 ? "Keine Wirkung" : multiplier < 1 ? "Nicht sehr effektiv" : multiplier > 1 ? "Sehr effektiv" : "Neutral";
}
export function getEffectivenessClass(multiplier: number) {
  return multiplier === 0 ? "immune" : multiplier < 1 ? "resisted" : multiplier > 1 ? "super" : "neutral";
}
