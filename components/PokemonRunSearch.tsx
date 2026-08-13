"use client";

import { useState } from "react";
import PokemonAutocomplete from "./PokemonAutocomplete";
import PokemonSprite from "./PokemonSprite";
import { searchRunPokemonFamily } from "@/lib/pokemonSearch";
import type { PokemonSelection, RunState } from "@/lib/types";

const labels = { team: "Im Team", caught: "Gefangen", dead: "Tot", fled: "Entkommen" } as const;

export default function PokemonRunSearch({ run }: { run: RunState }) {
  const [value, setValue] = useState("");
  const [pokemonId, setPokemonId] = useState<number | null>(null);
  const search = pokemonId ? searchRunPokemonFamily(run, pokemonId) : null;
  const select = (pokemon: PokemonSelection) => { setValue(pokemon.displayName); setPokemonId(pokemon.id ?? null); };

  return <section className="panel pokemonRunSearch">
    <div className="sectionTitleRow"><div><p className="eyebrow">RUNWEIT · ALLE SPIELER</p><h2>Pokémon-Suche</h2></div>{search && <span className="countPill">{search.results.length} Treffer</span>}</div>
    <div className="runSearchInput"><PokemonAutocomplete value={value} onChange={(next) => { setValue(next); setPokemonId(null); }} onSelect={select} loadDetailsOnSelect={false} placeholder="Deutsch oder Englisch suchen …" /><span>Durchsucht Team, Box, Friedhof und entkommene Encounter.</span></div>
    {!search ? <p className="empty">Wähle ein Pokémon, um seine gesamte Entwicklungsreihe im aktuellen Run zu durchsuchen.</p> : <>
      <div className="familyHeader"><span>Suche: {search.queryPokemon?.displayName ?? value} · Entwicklungsreihe</span><strong>{search.familyNames.join(" → ")}</strong></div>
      {search.results.length === 0 ? <p className="empty">Noch kein Pokémon aus der Entwicklungsreihe von {search.queryPokemon?.displayName ?? value} wurde in diesem Run gefunden.</p> : <div className="runSearchResults">{search.results.map((result) => <article className="runSearchCard" key={`${result.source}-${result.id}`}>
        <PokemonSprite spriteUrl={result.spriteUrl} alt={result.displayName} size={54} />
        <div className="runSearchIdentity">{result.nickname && <strong>„{result.nickname}“</strong>}<h3>{result.displayName}</h3><span>{result.playerName}</span></div>
        <div className="runSearchMeta"><span>{result.location || "Ort unbekannt"}</span>{result.level && <span>Lv. {result.level}</span>}{result.soulLinkNumber && <span>SoulLink #{result.soulLinkNumber}</span>}{result.linkDeleted && <small>Link ausgeblendet</small>}</div>
        <b className={`runSearchStatus ${result.status}`}>{labels[result.status]}</b>
      </article>)}</div>}
    </>}
  </section>;
}
