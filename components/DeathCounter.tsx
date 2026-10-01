"use client";
import { useRef, useState } from "react";
import { assignSoulLinkDeathCause, getDeathCauseLabel, getDeathCountsByPlayer } from "@/lib/runLogic";
import { canManageRun } from "@/lib/permissions";
import type { RunMember, RunState } from "@/lib/types";

export default function DeathCounter({ run }: { run: RunState }) {
  const counts = getDeathCountsByPlayer(run);
  return <section className="panel deathCounter"><div className="sectionTitleRow"><div><p className="eyebrow">☠ DEATH COUNTER</p><h2>Verursachte SoulLink-Tode</h2></div></div>
    <ol className="deathCounterList">{counts.players.map(player => <li key={player.playerId}><span>{player.playerName}{!player.active ? " (ehemalig)" : ""}</span><strong>{player.count} <span aria-hidden="true">☠</span></strong></li>)}</ol>
    <div className="deathCounterUnassigned"><span>Nicht zugeordnet</span><strong>{counts.unassigned}</strong></div>
    <div className="deathCounterTotal"><span>Gesamte SoulLink-Tode</span><strong>{counts.total}</strong></div>
  </section>;
}

export function DeathCause({ run, linkId, member, setRun }: { run: RunState; linkId: string; member: RunMember | null; setRun: (run: RunState) => void }) {
  const [editing, setEditing] = useState(false);
  const [playerId, setPlayerId] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const link = run.soulLinks.find(l => l.id === linkId);
  const participants = Array.from(new Set([...run.pokemon.filter(p => p.soulLinkId === linkId).map(p => p.playerId), ...run.encounters.filter(e => link?.encounterIds.includes(e.id)).map(e => e.playerId)]));
  return <div className="deathCause"><small>Tod verursacht durch: {getDeathCauseLabel(run, linkId)}</small>
    {!link?.deathCausedByPlayerId && canManageRun(member) && <>{!editing ? <button type="button" className="textButton" onClick={() => setEditing(true)}>Todesursache zuordnen</button> : <div className="deathCauseEditor"><label>Verantwortlicher Spieler<select value={playerId} onChange={e => setPlayerId(e.target.value)}><option value="">Spieler auswählen</option>{participants.map(id => <option key={id} value={id}>{run.players.find(p => p.id === id)?.name ?? "Ehemaliger Spieler"}</option>)}</select></label><button type="button" className="ghostButton" disabled={!playerId} onClick={() => {
      if (lock.current) return; lock.current = true;
      try { setRun(assignSoulLinkDeathCause(run, linkId, playerId, member)); setEditing(false); setError(""); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Zuordnung fehlgeschlagen."); }
      finally { queueMicrotask(() => { lock.current = false; }); }
    }}>Zuordnen</button><button type="button" className="textButton" onClick={() => { setEditing(false); setError(""); }}>Abbrechen</button></div>}</>}
    {error && <p className="errorText" role="alert">{error}</p>}
  </div>;
}
