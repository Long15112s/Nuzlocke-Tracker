export type BossProgress = {
  name: string;
  levelCap: number;
};

export const platinumProgress: BossProgress[] = [
  { name: "Roark – 1. Orden", levelCap: 14 },
  { name: "Gardenia – 2. Orden", levelCap: 22 },
  { name: "Fantina – 3. Orden", levelCap: 26 },
  { name: "Maylene – 4. Orden", levelCap: 32 },
  { name: "Crasher Wake – 5. Orden", levelCap: 37 },
  { name: "Byron – 6. Orden", levelCap: 41 },
  { name: "Candice – 7. Orden", levelCap: 44 },
  { name: "Volkner – 8. Orden", levelCap: 50 },

  // Pokémon Liga
  { name: "Aaron – Elite Four", levelCap: 53 },
  { name: "Bertha – Elite Four", levelCap: 55 },
  { name: "Flint – Elite Four", levelCap: 57 },
  { name: "Lucian – Elite Four", levelCap: 59 },
  { name: "Cynthia – Champ", levelCap: 62 },
];

export const platinumEncounterLocations = [
  "Starter", "Route 201", "Verity Lakefront", "Route 202", "Route 203",
  "Oreburgh Gate", "Oreburgh Mine", "Route 204 South", "Ravaged Path",
  "Route 204 North", "Floaroma Meadow", "Valley Windworks", "Route 205 South",
  "Eterna Forest", "Route 205 North", "Old Chateau", "Route 206", "Wayward Cave",
  "Route 207", "Mt. Coronet", "Route 208", "Route 209", "Lost Tower",
  "Solaceon Ruins", "Route 210 South", "Route 215", "Route 214", "Valor Lakefront",
  "Route 213", "Route 212", "Trophy Garden", "Great Marsh", "Route 218",
  "Canalave City", "Iron Island", "Route 216", "Route 217", "Acuity Lakefront",
  "Lake Acuity", "Route 211", "Route 219", "Route 220", "Route 221", "Pal Park",
  "Route 222", "Sunyshore City", "Route 223", "Victory Road", "Pokémon League",
  "Sendoff Spring", "Turnback Cave", "Fuego Ironworks", "Lake Valor", "Lake Verity",
] as const;

export function isPlatinum(game: string) {
  const normalized = game.toLowerCase();

  return (
    normalized.includes("platin") ||
    normalized.includes("platinum")
  );
}

export function getAutoBoss(game: string, completedBosses: number) {
  if (!isPlatinum(game)) {
    return null;
  }

  return platinumProgress[completedBosses] ?? null;
}
