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

export type EncounterLocationOption = { id: string; label: string; legacyLabels?: readonly string[] };
export const platinumEncounterLocations: readonly EncounterLocationOption[] = [
  { id: "starter", label: "Starter" }, { id: "route-201", label: "Route 201" },
  { id: "verity-lakefront", label: "See der Wahrheit – Ufer", legacyLabels: ["Verity Lakefront"] },
  ...Array.from({ length: 2 }, (_, i) => ({ id: `route-${202 + i}`, label: `Route ${202 + i}` })),
  { id: "oreburgh-gate", label: "Erzelingen-Tor", legacyLabels: ["Oreburgh Gate"] },
  { id: "oreburgh-mine", label: "Erzelingen-Mine", legacyLabels: ["Oreburgh Mine"] },
  { id: "route-204-south", label: "Route 204 – Süd", legacyLabels: ["Route 204 South"] },
  { id: "ravaged-path", label: "Verwüsteter Pfad", legacyLabels: ["Ravaged Path"] },
  { id: "route-204-north", label: "Route 204 – Nord", legacyLabels: ["Route 204 North"] },
  { id: "floaroma-meadow", label: "Flori-Wiese", legacyLabels: ["Floaroma Meadow"] },
  { id: "valley-windworks", label: "Windkraftwerk", legacyLabels: ["Valley Windworks"] },
  { id: "route-205-south", label: "Route 205 – Süd", legacyLabels: ["Route 205 South"] },
  { id: "eterna-forest", label: "Ewigwald", legacyLabels: ["Eterna Forest"] },
  { id: "route-205-north", label: "Route 205 – Nord", legacyLabels: ["Route 205 North"] },
  { id: "old-chateau", label: "Alte Villa", legacyLabels: ["Old Chateau"] },
  { id: "route-206", label: "Route 206" }, { id: "wayward-cave", label: "Bizarre Höhle", legacyLabels: ["Wayward Cave"] },
  { id: "route-207", label: "Route 207" }, { id: "mt-coronet", label: "Kraterberg", legacyLabels: ["Mt. Coronet"] },
  ...Array.from({ length: 16 }, (_, i) => ({ id: `route-${208 + i}`, label: `Route ${208 + i}` })),
  { id: "lost-tower", label: "Turm der Ruhenden", legacyLabels: ["Lost Tower"] },
  { id: "solaceon-ruins", label: "Trostu-Ruinen", legacyLabels: ["Solaceon Ruins"] },
  { id: "trophy-garden", label: "Trophäengarten", legacyLabels: ["Trophy Garden"] },
  { id: "great-marsh", label: "Großmoor", legacyLabels: ["Great Marsh"] },
  { id: "canalave-city", label: "Fleetburg", legacyLabels: ["Canalave City"] },
  { id: "iron-island", label: "Eiseninsel", legacyLabels: ["Iron Island"] },
  { id: "victory-road", label: "Siegesstraße", legacyLabels: ["Victory Road"] },
  { id: "pokemon-league", label: "Pokémon-Liga", legacyLabels: ["Pokémon League"] },
  { id: "sendoff-spring", label: "Scheidequelle", legacyLabels: ["Sendoff Spring"] },
  { id: "turnback-cave", label: "Höhle der Umkehr", legacyLabels: ["Turnback Cave"] },
  { id: "fuego-ironworks", label: "Feuriohütte", legacyLabels: ["Fuego Ironworks"] },
  { id: "lake-valor", label: "See der Kühnheit", legacyLabels: ["Lake Valor"] },
  { id: "lake-verity", label: "See der Wahrheit", legacyLabels: ["Lake Verity"] },
] as const;

export function getPlatinumLocationLabel(value: string) {
  return platinumEncounterLocations.find((place) => place.id === value || place.label === value || place.legacyLabels?.includes(value))?.label ?? value;
}

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
