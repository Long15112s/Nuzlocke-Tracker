"use client";
import { useState } from "react";
import { GEN4_TYPE_CHART, POKEMON_TYPES, TYPE_LABELS, formatTypeMultiplier, getEffectivenessClass, getEffectivenessLabel, getTypeEffectiveness, type PokemonType } from "@/lib/typeChart";

export default function TypeChart() {
  const [hover, setHover] = useState<{ attack: PokemonType; defense: PokemonType } | null>(null);
  const [attack, setAttack] = useState<PokemonType>("fire");
  const [defense, setDefense] = useState<PokemonType>("grass");
  const [second, setSecond] = useState<PokemonType | "">("steel");
  const result = getTypeEffectiveness(attack, defense, second || undefined);
  const options = POKEMON_TYPES.map(type => <option value={type} key={type}>{TYPE_LABELS[type]}</option>);
  return <section className="panel typeChartPanel">
    <div className="sectionTitleRow"><div><p className="eyebrow">TYPENTABELLE</p><h2>Pokémon Platin · Generation IV</h2></div><span className="countPill">17 Typen</span></div>
    <p className="muted">Zeilen = angreifender Typ · Spalten = verteidigender Typ</p>
    <div className="typeChartLegend" aria-label="Legende">{([2, 0.5, 0, 1] as const).map(value => <span key={value}><b className={`typeMultiplier ${getEffectivenessClass(value)}`}>{formatTypeMultiplier(value)}</b> {getEffectivenessLabel(value)}</span>)}</div>
    <p className="typeChartHover" aria-live="polite">{hover ? `${TYPE_LABELS[hover.attack]} → ${TYPE_LABELS[hover.defense]}: ${formatTypeMultiplier(GEN4_TYPE_CHART[hover.attack][hover.defense])} – ${getEffectivenessLabel(GEN4_TYPE_CHART[hover.attack][hover.defense])}` : "Für Details eine Zelle berühren, fokussieren oder mit der Maus markieren."}</p>
    <div className="typeChartScroll" role="region" aria-label="Generation-IV-Typentabelle, horizontal und vertikal scrollbar" tabIndex={0} onMouseLeave={() => setHover(null)}>
      <table className="typeChartTable"><caption className="srOnly">Typenwirkung in Pokémon Platin: Zeilen greifen an, Spalten verteidigen.</caption>
        <thead><tr><th scope="col" className="typeChartCorner">Angreifer ↓<br />Verteidiger →</th>{POKEMON_TYPES.map(type => <th scope="col" className={hover?.defense === type ? "typeAxisActive" : ""} key={type}><span className="typeChip">{TYPE_LABELS[type]}</span></th>)}</tr></thead>
        <tbody>{POKEMON_TYPES.map(attacker => <tr key={attacker}><th scope="row" className={hover?.attack === attacker ? "typeAxisActive" : ""}><span className="typeChip">{TYPE_LABELS[attacker]}</span></th>{POKEMON_TYPES.map(defender => {
          const value = GEN4_TYPE_CHART[attacker][defender];
          const description = `${TYPE_LABELS[attacker]} → ${TYPE_LABELS[defender]}: ${formatTypeMultiplier(value)} – ${getEffectivenessLabel(value)}`;
          return <td key={defender} className={hover?.attack === attacker || hover?.defense === defender ? "typeAxisActive" : ""}><button type="button" className={`typeMultiplier ${getEffectivenessClass(value)}`} title={description} aria-label={description} onMouseEnter={() => setHover({ attack: attacker, defense: defender })} onFocus={() => setHover({ attack: attacker, defense: defender })} onClick={() => setHover({ attack: attacker, defense: defender })}>{formatTypeMultiplier(value)}</button></td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    <p className="muted typeChartNote">Bei Pokémon mit zwei Typen werden die Multiplikatoren beider Typen miteinander multipliziert.</p>
    <p className="muted">Feuer gegen Pflanze/Stahl: 2 × 2 = 4× · Wasser gegen Wasser/Drache: ½ × ½ = ¼×</p>
    <section className="typeCalculator" aria-labelledby="type-calculator-title"><h3 id="type-calculator-title">Typenwirkung prüfen</h3><div className="typeCalculatorFields">
      <label>Angriffstyp<select value={attack} onChange={e => setAttack(e.target.value as PokemonType)}>{options}</select></label>
      <label>Verteidiger Typ 1<select value={defense} onChange={e => { const next = e.target.value as PokemonType; setDefense(next); if (next === second) setSecond(""); }}>{options}</select></label>
      <label>Verteidiger Typ 2<select value={second} onChange={e => setSecond(e.target.value as PokemonType | "")}><option value="">Kein zweiter Typ</option>{POKEMON_TYPES.filter(type => type !== defense).map(type => <option value={type} key={type}>{TYPE_LABELS[type]}</option>)}</select></label>
    </div><output className={`typeCalculatorResult ${getEffectivenessClass(result)}`} aria-live="polite">{formatTypeMultiplier(result)} – {getEffectivenessLabel(result)}</output></section>
  </section>;
}
