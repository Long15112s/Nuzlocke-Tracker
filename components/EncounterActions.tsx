"use client";
import { useRef, useState } from "react";
import PokemonAutocomplete from "./PokemonAutocomplete";
import { canEditPokemonOwnedBy, canManageRun } from "@/lib/permissions";
import { deleteEncounter, getEncounterGroupKey, getUsedEncounterLocations, updateEncounter } from "@/lib/runLogic";
import { isPlatinum, platinumEncounterLocations } from "@/lib/gameData";
import type { Encounter, PokemonSelection, RunMember, RunState } from "@/lib/types";

const labels = { caught: "Gefangen", defeated: "Besiegt", fled: "Geflohen", reroll: "Dupe / Reroll", skipped: "Übersprungen" };
export default function EncounterActions({ run, entry, member, setRun }: { run: RunState; entry: Encounter; member: RunMember | null; setRun: (run: RunState) => void }) {
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [selection, setSelection] = useState<PokemonSelection>();
  const [level, setLevel] = useState(entry.level);
  const [location, setLocation] = useState(entry.location);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const linked = run.soulLinks.some(l => l.encounterIds.includes(entry.id));
  const shared = linked || run.encounters.filter(e => getEncounterGroupKey(e) === getEncounterGroupKey(entry)).length > 1;
  const used = getUsedEncounterLocations({ ...run, encounters: run.encounters.filter(e => e.id !== entry.id) });
  const open = (next: "edit" | "delete") => {
    setError(""); setSelection(undefined); setName(entry.displayName ?? entry.species); setLevel(entry.level); setLocation(entry.location); setMode(next);
  };
  const submit = () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (mode === "edit" && !selection && name !== (entry.displayName ?? entry.species)) throw new Error("Bitte Pokémon aus der Liste auswählen.");
      setRun(mode === "delete" ? deleteEncounter(run, entry.id, member) : updateEncounter(run, entry.id, { selection, level, location, status: entry.status }, member));
      setMode(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Änderung fehlgeschlagen."); }
    finally { queueMicrotask(() => { lock.current = false; setBusy(false); }); }
  };
  if (!canEditPokemonOwnedBy(member, entry.playerId) && !canManageRun(member)) return null;
  return <div className="encounterActions">
    {canEditPokemonOwnedBy(member, entry.playerId) && <button type="button" className="textButton" disabled={busy} onClick={() => open("edit")}>Bearbeiten</button>}
    {canManageRun(member) && <button type="button" className="textButton dangerText" disabled={busy} onClick={() => open("delete")}>Löschen</button>}
    {mode && <div className="dialogBackdrop" role="presentation"><section className="pokemonDialog compactDialog" role="dialog" aria-modal="true" aria-label={mode === "edit" ? "Encounter bearbeiten" : "Encounter löschen"}>
      <header className="pokemonDialogHeader"><h2>{mode === "edit" ? "Encounter bearbeiten" : "Encounter wirklich löschen?"}</h2><button type="button" className="dialogClose" disabled={busy} aria-label="Dialog schließen" onClick={() => setMode(null)}>×</button></header>
      {mode === "edit" ? <div className="formStack">
        <PokemonAutocomplete label="Pokémon" value={name} disabled={busy} onChange={value => { setName(value); setSelection(undefined); }} onSelect={value => { setSelection(value); setName(value.displayName); }} />
        <label>Level<input type="number" min={1} max={100} value={level} disabled={busy} onChange={e => setLevel(Number(e.target.value))} /></label>
        <label>Status<select disabled value={entry.status}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <p className="muted">Statusänderungen sind in Version 1 gesperrt, damit SoulLink- und Todesdaten erhalten bleiben.</p>
        <label>Ort<input value={location} disabled={busy || shared} list={`edit-locations-${entry.id}`} onChange={e => setLocation(e.target.value)} /></label>
        {isPlatinum(run.game) && <datalist id={`edit-locations-${entry.id}`}>{platinumEncounterLocations.filter(p => p.label === entry.location || !used.has(p.label.toLocaleLowerCase("de"))).map(p => <option key={p.id} value={p.label} />)}</datalist>}
        {shared && <p className="muted">Der gemeinsame Ort kann nicht für einen einzelnen Spieler geändert werden.</p>}
      </div> : <><p>{linked ? "Dadurch wird der gesamte zugehörige SoulLink-Encounter entfernt und der Ort wieder freigegeben." : "Die gesamte Encounter-Gruppe und ihre erzeugten Pokémon werden entfernt."}</p><p className="muted">Auch tote Pokémon und ausgeblendete Links werden dauerhaft entfernt. Andere Encounter am selben Ort bleiben erhalten und können den Ort weiterhin belegen.</p></>}
      {error && <p className="errorText" role="alert">{error}</p>}
      <footer className="pokemonDialogFooter"><button type="button" className="ghostButton" disabled={busy} onClick={() => setMode(null)}>Abbrechen</button><button type="button" className={mode === "delete" ? "dangerButton" : "primaryButton"} disabled={busy} onClick={submit}>{busy ? "Wird gespeichert …" : mode === "delete" ? "Encounter löschen" : "Speichern"}</button></footer>
    </section></div>}
  </div>;
}
