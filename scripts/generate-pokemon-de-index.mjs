import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const limit = 493;
const output = resolve(dirname(fileURLToPath(import.meta.url)), "../lib/data/pokemon-de.json");
const ids = Array.from({ length: limit }, (_, index) => index + 1);

async function loadSpecies(id) {
  const response = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`);
  if (!response.ok) throw new Error(`PokéAPI species ${id}: ${response.status}`);
  const species = await response.json();
  const localized = (language) => species.names.find((entry) => entry.language?.name === language)?.name;
  return {
    id,
    apiName: species.name,
    displayName: localized("de") ?? localized("en") ?? species.name,
    englishName: localized("en") ?? species.name,
  };
}

const result = [];
for (let index = 0; index < ids.length; index += 20) {
  result.push(...await Promise.all(ids.slice(index, index + 20).map(loadSpecies)));
  process.stdout.write(`\r${Math.min(index + 20, limit)} / ${limit}`);
}

result.sort((a, b) => a.id - b.id);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`\nGenerated ${result.length} entries at ${output}`);
