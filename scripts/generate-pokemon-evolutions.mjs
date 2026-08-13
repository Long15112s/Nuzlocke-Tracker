import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const limit = 493;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pokemon = JSON.parse(await (await import("node:fs/promises")).readFile(resolve(root, "lib/data/pokemon-de.json"), "utf8"));
const idBySlug = new Map(pokemon.map((entry) => [entry.apiName, entry.id]));

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

const species = [];
for (let offset = 0; offset < limit; offset += 25) {
  species.push(...await Promise.all(Array.from({ length: Math.min(25, limit - offset) }, (_, index) => json(`https://pokeapi.co/api/v2/pokemon-species/${offset + index + 1}`))));
}

const chainUrls = [...new Set(species.map((entry) => entry.evolution_chain?.url).filter(Boolean))];
const families = {};
function collect(node, ids = []) {
  const id = idBySlug.get(node.species?.name);
  if (id && id <= limit) ids.push(id);
  for (const child of node.evolves_to ?? []) collect(child, ids);
  return ids;
}

for (let offset = 0; offset < chainUrls.length; offset += 20) {
  const chains = await Promise.all(chainUrls.slice(offset, offset + 20).map(json));
  for (const chain of chains) {
    const ids = [...new Set(collect(chain.chain))].sort((a, b) => a - b);
    for (const id of ids) families[id] = ids;
  }
}

for (let id = 1; id <= limit; id += 1) families[id] ??= [id];
const output = resolve(root, "lib/data/pokemon-evolution-families.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(families, null, 2)}\n`, "utf8");
console.log(`\nGenerated families for ${Object.keys(families).length} Pokémon at ${output}`);
