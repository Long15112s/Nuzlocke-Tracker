"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import PokemonAutocomplete from "@/components/PokemonAutocomplete";
import PokemonSprite from "@/components/PokemonSprite";
import { clearRun, getLocalParticipantId, loadRun, saveRun } from "@/lib/storage";
import { cloudEnabled, isSupabaseConfigured } from "@/lib/supabase";
import { createCloudRun, getCloudParticipantId, joinCloudRun, leaveCloudRun, loadCloudRun, manageCloudMember, previewCloudRun, saveCloudRun, subscribeToCloudRun, type RunPreview } from "@/lib/cloud";
import type { EncounterStatus, PokemonSelection, PokemonStatus, RunMember, RunMemberRole, RunPlayerCount, RunState, SoulLinkState } from "@/lib/types";
import { canAdvanceBoss, canEditEncounters, canEditPokemonOwnedBy, canManagePlayers, canManageRun, MAX_RUN_PLAYERS, MIN_RUN_PLAYERS } from "@/lib/permissions";
import { getAutoBoss, isPlatinum, platinumEncounterLocations, platinumProgress } from "@/lib/gameData";
import { getPokemonDetails } from "@/lib/pokeapi";

const encounterLabels: Record<EncounterStatus, string> = {
  caught: "Gefangen",
  defeated: "Besiegt",
  fled: "Geflohen",
  reroll: "Dupe / Reroll",
  skipped: "Übersprungen",
};

const statusLabels: Record<PokemonStatus, string> = {
  team: "Team",
  box: "Box",
  dead: "Tot",
};

const defaultRandomizer = {
  wild: true,
  trainers: true,
  starters: true,
  types: false,
  abilities: true,
  moves: false,
  items: true,
  seed: "",
  notes: "",
};

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function makeCode() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
}

function Setup({ onCreate }: { onCreate: (run: RunState) => void | Promise<void> }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("Randomizer SoulLink");
  const [game, setGame] = useState("Pokémon Platin");
  const [boss, setBoss] = useState("1. Arena / Boss");
  const [cap, setCap] = useState(14);
  const [hostName, setHostName] = useState("Spieler 1");
  const [hostColor, setHostColor] = useState("#7dd3fc");
  const [playerCount, setPlayerCount] = useState<RunPlayerCount>(3);
  const [slotNames, setSlotNames] = useState(["Spieler 1", "", ""]);
  const [slotColors, setSlotColors] = useState(["#7dd3fc", "#86efac", "#c4b5fd"]);
  const [soulLinkEnabled, setSoulLinkEnabled] = useState(true);
  const [randomizer, setRandomizer] = useState(defaultRandomizer);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (step < 4) { setStep(step + 1); return; }
    const cleanHostName = slotNames[0]?.trim() || hostName.trim();
    if (!cleanHostName) { setStep(2); return; }

    const selectedGame = game.trim() || "Pokémon";
    const automaticBoss = getAutoBoss(selectedGame, 0);

    const participantId = getLocalParticipantId();
    const configuredSlots = Array.from({ length: playerCount }, (_, index) => ({ name: (slotNames[index] ?? "").trim(), color: slotColors[index] ?? ["#7dd3fc", "#86efac", "#c4b5fd", "#fb923c"][index] }));
    const configuredPlayers = configuredSlots.map((slot, index) => slot.name ? { id: makeId("player"), name: slot.name, color: slot.color, active: true, index } : null);
    const players = configuredPlayers.filter((player): player is NonNullable<typeof player> => player !== null).map(({ index: _index, ...player }) => player);
    const members = configuredPlayers.filter((player): player is NonNullable<typeof player> => player !== null).map((player, index) => ({ id: makeId("member"), participantId: player.index === 0 ? participantId : `local_slot_${player.id}`, displayName: player.name, role: player.index === 0 ? "host" as const : "player" as const, playerId: player.id, color: player.color, active: true, joinedAt: new Date().toISOString(), index }));
    const memberByPlayer = new Map(members.map((member) => [member.playerId, member]));
    await onCreate({
      id: crypto.randomUUID(),
      inviteCode: makeCode(),
      name: name.trim() || "Randomizer SoulLink",
      game: selectedGame,

      currentBoss:
        automaticBoss?.name ??
        boss.trim() ??
        "Nächster Boss",

      levelCap:
        automaticBoss?.levelCap ??
        Math.max(1, cap),

      badges: 0,
      players,
      members: members.map(({ index: _index, ...member }) => member),
      playerCount,
      playerSlots: Array.from({ length: playerCount }, (_, index) => { const player = configuredPlayers[index]; return { id: makeId("slot"), position: index + 1, playerId: player?.id, memberId: player ? memberByPlayer.get(player.id)?.id : undefined }; }),
      runStatus: "active",
      soulLinkEnabled,
      encounters: [],
      pokemon: [],
      soulLinks: [],
      randomizer,
    });
  };

  return (
    <main className="setupShell">
      <section className="setupCard">
        <div className="brandRow">
          <div className="logo">NL</div>
          <div>
            <p className="eyebrow">NUZLINK</p>
            <h1>Randomizer SoulLink Tracker</h1>
          </div>
        </div>
        <p className="lead">Schritt {step} von 4 · {step === 1 ? "Run-Informationen" : step === 2 ? "Host" : step === 3 ? "Randomizer" : "Zusammenfassung"}</p>

        <form onSubmit={submit} className="formStack">
          {step === 1 && <div className="twoCols">
            <label>Run-Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>Spiel<input value={game} onChange={(e) => setGame(e.target.value)} /></label>
            <label>Spieleranzahl<select value={playerCount} onChange={(e) => { const count = Number(e.target.value) as RunPlayerCount; setPlayerCount(count); setSlotNames((old) => Array.from({ length: count }, (_, index) => old[index] ?? "")); setSlotColors((old) => Array.from({ length: count }, (_, index) => old[index] ?? ["#7dd3fc", "#86efac", "#c4b5fd", "#fb923c"][index])); }}><option value={2}>2 Spieler</option><option value={3}>3 Spieler</option><option value={4}>4 Spieler</option></select></label>
            <label className="checkCard"><input type="checkbox" checked={soulLinkEnabled} onChange={(e) => setSoulLinkEnabled(e.target.checked)} /><span>SoulLink aktiv</span></label>
          </div>}
          {step === 2 && <div className="setupSlots">{Array.from({ length: playerCount }, (_, index) => <div className="setupSlot" key={index}><div><span>Spieler {index + 1}</span>{index === 0 && <strong>Host</strong>}</div><label>Name<input autoFocus={index === 0} value={slotNames[index] ?? ""} onChange={(e) => { const values = [...slotNames]; values[index] = e.target.value; setSlotNames(values); if (index === 0) setHostName(e.target.value); }} placeholder={index === 0 ? "Host-Name" : "Noch nicht beigetreten"} /></label><label>Akzentfarbe<input type="color" value={slotColors[index]} onChange={(e) => { const values = [...slotColors]; values[index] = e.target.value; setSlotColors(values); if (index === 0) setHostColor(e.target.value); }} /></label></div>)}</div>}

          {step === 3 && <div className="sectionBlock">
            <h2>Randomizer</h2>
            <div className="checkGrid">
              {([
                ["wild", "Wilde Pokémon"], ["trainers", "Trainer-Pokémon"], ["starters", "Starter"],
                ["types", "Typen"], ["abilities", "Fähigkeiten"], ["moves", "Attacken"], ["items", "Items"],
              ] as const).map(([key, label]) => (
                <label className="checkCard" key={key}><input type="checkbox" checked={randomizer[key]} onChange={(e) => setRandomizer({ ...randomizer, [key]: e.target.checked })} /><span>{label}</span></label>
              ))}
            </div>
            <div className="twoCols compactTop">
              <label>Seed (optional)<input value={randomizer.seed} onChange={(e) => setRandomizer({ ...randomizer, seed: e.target.value })} /></label>
              <label>Notizen<input value={randomizer.notes} onChange={(e) => setRandomizer({ ...randomizer, notes: e.target.value })} placeholder="z. B. gleiche Stärke, keine Legendaries ..." /></label>
            </div>
          </div>}

          {step === 4 && <div className="setupSummary"><div><span>Run</span><strong>{name}</strong></div><div><span>Spiel</span><strong>{game}</strong></div><div><span>Spielerplätze</span><strong>{playerCount}</strong></div><div><span>Host</span><strong>{slotNames[0]}</strong></div><div><span>Modus</span><strong>{soulLinkEnabled ? "SoulLink aktiv" : "Nuzlocke"}</strong></div></div>}

          <div className="setupActions">{step > 1 && <button className="ghostButton" type="button" onClick={() => setStep(step - 1)}>Zurück</button>}<button className="primaryButton big" type="submit">{step === 4 ? "Run starten" : "Weiter"}</button></div>
        </form>
      </section>
    </main>
  );
}

type EncounterRow = {
  species: string;
  nickname: string;
  level: number;
  status: EncounterStatus;
  ability?: string;
  spriteUrl?: string;
  types?: string[];
  pokemonId?: number;
  apiName?: string;
  displayName?: string;
};

function createEncounterRow(): EncounterRow {
  return {
    species: "",
    nickname: "",
    level: 1,
    status: "caught",
    ability: "",
    spriteUrl: undefined,
    types: [],
    pokemonId: undefined,
    apiName: undefined,
    displayName: undefined,
  };
}

function EncounterForm({ run, setRun, readOnly = false, onEvent }: { run: RunState; setRun: (next: RunState) => void; readOnly?: boolean; onEvent?: (message: string) => void }) {
  const activePlayers = run.players.filter((player) => player.active !== false);
  const [location, setLocation] = useState("");
  const [customLocation, setCustomLocation] = useState("");
  const [showLocationWarning, setShowLocationWarning] = useState(false);
  const [slotWarning, setSlotWarning] = useState("");
  const [rows, setRows] = useState<Record<string, EncounterRow>>(() => Object.fromEntries(activePlayers.map((p) => [p.id, createEncounterRow()])));
  const actualLocation = location === "Anderer Ort…" ? customLocation.trim() : location.trim();
  const usedLocations = useMemo(() => {
    const groups = new Map<string, typeof run.encounters>();
    run.encounters.forEach((encounter) => {
      const key = encounter.encounterGroupId ?? `legacy_${encounter.createdAt}_${encounter.location}`;
      groups.set(key, [...(groups.get(key) ?? []), encounter]);
    });
    return new Set(Array.from(groups.values()).filter((entries) => entries.some((entry) => entry.status === "defeated" || entry.status === "fled") || (entries.length > 0 && entries.every((entry) => entry.status === "caught"))).map((entries) => entries[0].location.toLocaleLowerCase("de")));
  }, [run.encounters]);
  const locationAlreadyUsed = actualLocation ? usedLocations.has(actualLocation.toLocaleLowerCase("de")) : false;

  useEffect(() => {
    setRows((old) => Object.fromEntries(activePlayers.map((p) => [p.id, old[p.id] ?? createEncounterRow()])));
  }, [run.players]);

  const updateRow = (playerId: string, patch: Partial<EncounterRow>) => {
    setRows((current) => ({
      ...current,
      [playerId]: { ...(current[playerId] ?? createEncounterRow()), ...patch },
    }));
  };

  const saveEncounter = () => {
    if (readOnly) return;
    if (activePlayers.length !== (run.playerCount ?? activePlayers.length)) { setSlotWarning("Nicht alle Spielerplätze sind belegt."); return; }
    if (!actualLocation) return;
    const now = new Date().toISOString();
    const encounterGroupId = makeId("group");
    const entries = activePlayers.map((player) => {
      const row = rows[player.id] ?? createEncounterRow();
      return {
        id: makeId("enc"),
        encounterGroupId,
        location: actualLocation,
        playerId: player.id,
        species: row.species.trim() || "Unbekannt",
        nickname: row.nickname.trim() || "",
        level: Math.max(1, Number(row.level || 1)),
        status: row.status || ("skipped" as EncounterStatus),
        createdAt: now,
        ability: row.ability?.trim() || undefined,
        spriteUrl: row.spriteUrl,
        types: row.types?.length ? row.types : undefined,
        pokemonId: row.pokemonId,
        apiName: row.apiName,
        displayName: row.displayName,
      };
    });
    const caught = entries.filter((entry) => entry.status === "caught");
    const hasLostEncounter = entries.some((entry) => entry.status === "defeated" || entry.status === "fled");
    const allCaught = entries.length > 0 && entries.every((entry) => entry.status === "caught");
    const soulLinkState: SoulLinkState = hasLostEncounter ? "extinguished" : allCaught ? "active" : "pending";
    const soulLinkId = run.soulLinkEnabled !== false ? makeId("link") : undefined;
    const nextSoulLinkNumber = Math.max(0, ...run.soulLinks.map((link, index) => link.displayNumber ?? index + 1)) + 1;
    const newPokemon = (run.soulLinkEnabled === false || soulLinkState === "active") ? caught.map((entry) => ({
      id: makeId("pkm"),
      playerId: entry.playerId,
      species: entry.species,
      nickname: entry.nickname,
      level: entry.level,
      location: entry.location,
      status: "box" as PokemonStatus,
      soulLinkId,
      ability: entry.ability,
      spriteUrl: entry.spriteUrl,
      types: entry.types,
      pokemonId: entry.pokemonId,
      apiName: entry.apiName,
      displayName: entry.displayName,
    })) : [];
    setRun({
      ...run,
      encounters: [...run.encounters, ...entries],
      pokemon: [...run.pokemon, ...newPokemon],
      soulLinks: soulLinkId ? [...run.soulLinks, { id: soulLinkId, encounterIds: entries.map((x) => x.id), createdAt: now, displayNumber: nextSoulLinkNumber, status: soulLinkState }] : run.soulLinks,
    });
    if (soulLinkId && soulLinkState === "extinguished") {
      const loss = entries.find((entry) => entry.status === "defeated" || entry.status === "fled");
      onEvent?.(`SoulLink #${nextSoulLinkNumber} ist erloschen. ${loss?.species ?? "Ein Pokémon"} ${loss?.status === "fled" ? `ist auf ${actualLocation} geflohen` : `wurde auf ${actualLocation} besiegt`}. Die Pokémon dieses Links dürfen nicht verwendet werden.`);
    }
    setLocation("");
    setCustomLocation("");
    setShowLocationWarning(false);
    setRows(Object.fromEntries(activePlayers.map((p) => [p.id, createEncounterRow()])));
  };

  const addEncounter = (e: FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!actualLocation) return;
    if (activePlayers.length !== (run.playerCount ?? activePlayers.length)) { setSlotWarning("Nicht alle Spielerplätze sind belegt."); return; }
    if (locationAlreadyUsed) {
      setShowLocationWarning(true);
      return;
    }
    saveEncounter();
  };

  return (
    <form onSubmit={addEncounter} className="panel encounterForm">
      <fieldset className="encounterFieldset" disabled={readOnly}>
      <div className="sectionTitleRow">
        <div><p className="eyebrow">NEUER ENCOUNTER</p><h2>Route / Gebiet erfassen</h2></div>
        <div className="locationPicker">
          {isPlatinum(run.game) ? <><input className="locationInput" list="platinum-locations" value={location} onChange={(e) => { setLocation(e.target.value); setShowLocationWarning(false); }} placeholder="Ort suchen oder auswählen" /><datalist id="platinum-locations">{platinumEncounterLocations.map((place) => <option key={place} value={place} label={`${place}${usedLocations.has(place.toLocaleLowerCase("de")) ? " ✓" : ""}`} />)}<option value="Anderer Ort…" /></datalist></> : <input className="locationInput" value={location} onChange={(e) => { setLocation(e.target.value); setShowLocationWarning(false); }} placeholder="z. B. Route 204" />}
          {location === "Anderer Ort…" && <input className="locationInput" autoFocus value={customLocation} onChange={(e) => { setCustomLocation(e.target.value); setShowLocationWarning(false); }} placeholder="Eigenen Ort eingeben" />}
          {locationAlreadyUsed && !showLocationWarning && <span className="locationUsedHint">Für diesen Ort existiert bereits ein Encounter.</span>}
        </div>
      </div>
      {showLocationWarning && <div className="encounterWarning"><div><strong>Für {actualLocation} wurde bereits ein Encounter eingetragen.</strong><span>Je nach euren Randomizer-Regeln kannst du trotzdem einen weiteren Versuch speichern.</span></div><div><button type="button" className="ghostButton" onClick={() => setShowLocationWarning(false)}>Abbrechen</button><button type="button" className="primaryButton" onClick={saveEncounter}>Trotzdem eintragen</button></div></div>}
      {slotWarning && <div className="encounterWarning"><div><strong>{slotWarning}</strong><span>Der Encounter kann erst gespeichert werden, wenn alle festen Slots belegt sind.</span></div></div>}
      <div className="encounterGrid">
        {activePlayers.map((player) => {
          const row = rows[player.id] ?? createEncounterRow();
          return <div className="encounterPlayer" key={player.id} style={{ borderTopColor: player.color }}>
            <h3>{player.name}</h3>
            <div className="pokemonInputWrap">
              <PokemonAutocomplete
                value={row.species}
                onChange={(nextValue) => updateRow(player.id, { species: nextValue, spriteUrl: undefined, pokemonId: undefined, types: [], apiName: undefined, displayName: undefined })}
                onSelect={(selection: PokemonSelection) => {
                  updateRow(player.id, {
                    species: selection.displayName || selection.name,
                    spriteUrl: selection.spriteUrl,
                    pokemonId: selection.id,
                    types: selection.types,
                    apiName: selection.apiName,
                    displayName: selection.displayName,
                    ability: row.ability || "",
                  });
                }}
                placeholder="z. B. Garchomp"
              />
              {row.spriteUrl && <div className="pokemonMetaPill"><PokemonSprite spriteUrl={row.spriteUrl} alt={row.species || "Pokémon"} size={32} /> <span>{row.displayName || row.species || "Pokémon"}</span></div>}
            </div>
            <div className="miniCols">
              <label>Level<input type="number" min={1} value={row.level ?? 1} onChange={(e) => updateRow(player.id, { level: Number(e.target.value) })} /></label>
              <label>Status<select value={row.status ?? "caught"} onChange={(e) => updateRow(player.id, { status: e.target.value as EncounterStatus })}>{Object.entries(encounterLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            </div>
            <label>Nickname<input value={row.nickname ?? ""} onChange={(e) => updateRow(player.id, { nickname: e.target.value })} placeholder="optional" /></label>
            <label>Ability<input value={row.ability ?? ""} onChange={(e) => updateRow(player.id, { ability: e.target.value })} placeholder="optional" /></label>
            <div className="typeRow">
              {(row.types?.length ? row.types : []).map((type) => <span key={`${row.species}-${type}`} className="typeChip">{type}</span>)}
              {(!row.types || row.types.length === 0) && <span className="typeChip mutedChip">Kein Typ</span>}
            </div>
          </div>;
        })}
      </div>
      <div className="formFooter"><span>Gefangene Pokémon derselben Route werden automatisch als SoulLink verknüpft.</span><button className="primaryButton" type="submit">Encounter speichern</button></div>
      </fieldset>
    </form>
  );
}

function Dashboard({ run, setRun, cloudMode, currentMember }: { run: RunState; setRun: (next: RunState) => void; cloudMode: boolean; currentMember: RunMember | null }) {
  type DashboardTab = "overview" | "encounters" | "pokemon" | "boss" | "settings" | "notes";
  type DashboardEvent = { id: string; message: string; timestamp: string; type?: "boss-defeated" | "system"; bossIndex?: number };

  const [tab, setTab] = useState<DashboardTab>("overview");
  const [copied, setCopied] = useState(false);
  const [bossUpdating, setBossUpdating] = useState(false);
  const bossUpdatingRef = useRef(false);
  const [editingPokemonId, setEditingPokemonId] = useState<string | null>(null);
  const [pokemonDraft, setPokemonDraft] = useState<{ nickname: string; level: number; ability: string; types: string; status: PokemonStatus } | null>(null);
  const [pokemonDialogError, setPokemonDialogError] = useState("");
  const [confirmingDeath, setConfirmingDeath] = useState(false);
  const [showSoulLinkInfo, setShowSoulLinkInfo] = useState(false);
  const [showTeamManager, setShowTeamManager] = useState(false);
  const [pokemonActionError, setPokemonActionError] = useState("");
  const deathUpdatingRef = useRef(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>(run.players[0]?.id ?? "");
  const [events, setEvents] = useState<DashboardEvent[]>([
    { id: makeId("event"), message: "SoulLink Mode aktiv: Verknüpfte Pokémon teilen dasselbe Schicksal.", timestamp: new Date().toISOString(), type: "system" },
  ]);
  const spectatorMode = currentMember?.role === "spectator";

  const deaths = run.pokemon.filter((p) => p.status === "dead").length;
  const caught = run.encounters.filter((e) => e.status === "caught").length;
  const activeBossProgress = isPlatinum(run.game) ? platinumProgress : null;
  const totalBosses = platinumProgress.length;
  const completedBosses = isPlatinum(run.game) ? Math.min(Math.max(run.badges, 0), totalBosses) : run.badges;
  const isPlatinumFinished = isPlatinum(run.game) && completedBosses >= totalBosses;
  const bossDisplayValue = isPlatinum(run.game) ? `${completedBosses} / ${totalBosses}` : String(run.badges);

  const playerAccent = useMemo(() => {
    const palette = ["#7dd3fc", "#c4b5fd", "#86efac", "#f9a8d4", "#fcd34d", "#fb7185"];
    return Object.fromEntries(run.players.map((player, index) => [player.id, palette[index % palette.length]]));
  }, [run.players]);

  useEffect(() => {
    if (!run.players.some((player) => player.id === selectedPlayerId)) {
      setSelectedPlayerId(run.players[0]?.id ?? "");
    }
  }, [run.players, selectedPlayerId]);

  useEffect(() => {
    bossUpdatingRef.current = false;
    setBossUpdating(false);
  }, [run.badges, run.currentBoss, run.levelCap]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (showSoulLinkInfo) setShowSoulLinkInfo(false);
      else if (showTeamManager) setShowTeamManager(false);
      else if (editingPokemonId) closePokemonDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showSoulLinkInfo, showTeamManager, editingPokemonId]);

  const appendEvent = (message: string, options?: { type?: "boss-defeated" | "system"; bossIndex?: number }) => {
    const event = {
      id: makeId("event"),
      message,
      timestamp: new Date().toISOString(),
      type: options?.type ?? "system",
      bossIndex: options?.bossIndex,
    } satisfies DashboardEvent;

    setEvents((current) => {
      if (options?.type === "boss-defeated" && options.bossIndex !== undefined && current.some((entry) => entry.type === "boss-defeated" && entry.bossIndex === options.bossIndex)) {
        return current;
      }
      return [event, ...current].slice(0, 6);
    });
  };

  const shareLink = typeof window !== "undefined" ? `${window.location.origin}/?join=${run.inviteCode}` : run.inviteCode;
  const copyLink = async () => {
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const getSoulLinkNumber = (id: string) => {
    const index = run.soulLinks.findIndex((link) => link.id === id);
    return index >= 0 ? run.soulLinks[index].displayNumber ?? index + 1 : null;
  };

  const openPokemonDialog = (id: string) => {
    const target = run.pokemon.find((p) => p.id === id);
    if (!target || !canEditPokemonOwnedBy(currentMember, target.playerId)) return;
    setEditingPokemonId(id);
    setPokemonDraft({ nickname: target.nickname, level: target.level, ability: target.ability ?? "", types: target.types?.join(", ") ?? "", status: target.status });
    setPokemonDialogError("");
    setConfirmingDeath(false);
  };

  const closePokemonDialog = () => {
    setEditingPokemonId(null);
    setPokemonDraft(null);
    setPokemonDialogError("");
    setConfirmingDeath(false);
  };

  const updatePokemonStatus = (id: string, status: PokemonStatus, details?: { nickname: string; level: number; ability: string; types: string[] }) => {
    const target = run.pokemon.find((p) => p.id === id);
    if (!target || !canEditPokemonOwnedBy(currentMember, target.playerId)) return false;

    const linkedGroupId = target.soulLinkId;
    const affected = linkedGroupId ? run.pokemon.filter((p) => p.soulLinkId === linkedGroupId) : [target];
    const affectedIds = new Set(affected.map((p) => p.id));

    if (status === "dead" && affected.every((pokemon) => pokemon.status === "dead")) return false;
    if (status !== "dead" && affected.some((pokemon) => pokemon.status === "dead")) {
      const message = "Tote SoulLinks können nicht über die normale Teamverwaltung wiederbelebt werden.";
      setPokemonDialogError(message); setPokemonActionError(message); return false;
    }

    if (status === "team") {
      for (const player of run.players) {
        const unaffectedTeamCount = run.pokemon.filter((p) => p.playerId === player.id && p.status === "team" && !affectedIds.has(p.id)).length;
        const incomingCount = affected.filter((p) => p.playerId === player.id).length;
        if (unaffectedTeamCount + incomingCount > 6) {
          setPokemonDialogError(`Spieler ${player.name} hätte dadurch mehr als 6 Pokémon im Team.`);
          setPokemonActionError(`${player.name} hätte dadurch mehr als 6 Pokémon im Team.`);
          return false;
        }
      }
    }

    setRun({
      ...run,
      soulLinks: linkedGroupId && status === "dead" ? run.soulLinks.map((link) => link.id === linkedGroupId ? { ...link, status: "dead" } : link) : run.soulLinks,
      pokemon: run.pokemon.map((p) => {
        const nextStatus = affectedIds.has(p.id) ? status : p.status;
        if (p.id === id && details) return { ...p, ...details, status: nextStatus };
        if (affectedIds.has(p.id)) return { ...p, status: nextStatus };
        return p;
      }),
    });
    setPokemonActionError("");

    if (status === "dead") {
      if (linkedGroupId) appendEvent(`SoulLink #${getSoulLinkNumber(linkedGroupId) ?? "—"} ist gestorben. ${affected.map((p) => p.species).join(", ")} wurden auf Tot gesetzt.`);
      else appendEvent(`${target.nickname || target.species} ist gestorben.`);
    }
    return true;
  };

  const savePokemonDraft = () => {
    if (!editingPokemonId || !pokemonDraft) return;
    const target = run.pokemon.find((p) => p.id === editingPokemonId);
    if (!target) return;
    if (pokemonDraft.status === "dead" && target.status !== "dead" && !confirmingDeath) {
      setConfirmingDeath(true);
      return;
    }
    if (confirmingDeath && deathUpdatingRef.current) return;
    if (confirmingDeath) deathUpdatingRef.current = true;
    const saved = updatePokemonStatus(editingPokemonId, pokemonDraft.status, {
      nickname: pokemonDraft.nickname.trim(),
      level: Math.max(1, Number(pokemonDraft.level) || 1),
      ability: pokemonDraft.ability.trim(),
      types: pokemonDraft.types.split(",").map((type) => type.trim()).filter(Boolean),
    });
    if (saved) closePokemonDialog();
    deathUpdatingRef.current = false;
  };

  const handleBossDefeated = () => {
    if (!canAdvanceBoss(currentMember)) return;
    if (bossUpdatingRef.current) return;

    if (!isPlatinum(run.game)) {
      setRun({ ...run, badges: run.badges + 1 });
      appendEvent(`Boss „${run.currentBoss}“ wurde als besiegt markiert.`);
      return;
    }

    const totalBosses = platinumProgress.length;
    const completedBosses = Math.min(Math.max(run.badges, 0), totalBosses);
    const isFinished = completedBosses >= totalBosses;

    if (isFinished) return;

    bossUpdatingRef.current = true;
    setBossUpdating(true);

    const defeatedBoss = platinumProgress[completedBosses];
    const nextCompletedBosses = Math.min(completedBosses + 1, totalBosses);
    const finishedNow = nextCompletedBosses >= totalBosses;

    if (finishedNow) {
      setRun({
        ...run,
        badges: totalBosses,
        runStatus: "finished",
        currentBoss: "Pokémon Liga geschafft",
        levelCap: defeatedBoss.levelCap,
      });
      appendEvent(`${defeatedBoss.name} wurde besiegt. Pokémon Liga geschafft!`, { type: "boss-defeated", bossIndex: completedBosses });
      return;
    }

    const nextBoss = platinumProgress[nextCompletedBosses];
    setRun({
      ...run,
      badges: nextCompletedBosses,
      currentBoss: nextBoss.name,
      levelCap: nextBoss.levelCap,
    });
    appendEvent(`${defeatedBoss.name} wurde besiegt. Neues Level Cap: ${nextBoss.levelCap}.`, { type: "boss-defeated", bossIndex: completedBosses });
  };

  const removeMember = async (member: RunMember) => {
    if (!canManagePlayers(currentMember) || member.role === "host" || !window.confirm(`${member.displayName} wirklich aus diesem Run entfernen?`)) return;
    if (cloudMode) await manageCloudMember(run.id, member.participantId, "remove");
    setRun({ ...run, members: run.members?.map((entry) => entry.id === member.id ? { ...entry, active: false } : entry), players: run.players.map((player) => player.id === member.playerId ? { ...player, active: false } : player), playerSlots: run.playerSlots?.map((slot) => slot.playerId === member.playerId ? { ...slot, playerId: undefined, memberId: undefined } : slot) });
  };

  const transferHost = async (member: RunMember) => {
    if (!canManagePlayers(currentMember) || member.role !== "player" || !window.confirm(`Host-Rolle an ${member.displayName} übertragen?`)) return;
    if (cloudMode) await manageCloudMember(run.id, member.participantId, "transfer_host");
    setRun({ ...run, members: run.members?.map((entry) => entry.id === member.id ? { ...entry, role: "host" } : entry.role === "host" ? { ...entry, role: "player" } : entry) });
  };


  const leaveRun = async () => {
    if (!currentMember?.active) return;
    if (currentMember.role === "host" && run.members?.some((member) => member.active && member.id !== currentMember.id && member.role !== "spectator")) {
      window.alert("Übertrage zuerst die Host-Rolle oder entferne die anderen Spieler."); return;
    }
    if (!window.confirm("Diesen Run wirklich verlassen?")) return;
    if (cloudMode) await leaveCloudRun(run.id);
    clearRun(); window.history.replaceState({}, "", "/"); location.reload();
  };

  const selectedPlayer = run.players.find((player) => player.id === selectedPlayerId) ?? run.players[0];

  const playerTeamCards = run.players.filter((player) => player.active !== false).map((player) => {
    const team = run.pokemon.filter((p) => p.playerId === player.id && p.status === "team");
    const dead = run.pokemon.filter((p) => p.playerId === player.id && p.status === "dead");
    const soulLinks = new Set(run.pokemon.filter((p) => p.playerId === player.id && p.soulLinkId).map((p) => p.soulLinkId));

    return {
      player,
      team,
      deadCount: dead.length,
      soulLinkCount: soulLinks.size,
    };
  });

  const soulLinkGroups = useMemo(() => {
    const groups = new Map<string, { id: string; members: typeof run.pokemon }>();

    run.pokemon.forEach((pokemon) => {
      if (!pokemon.soulLinkId) return;
      const current = groups.get(pokemon.soulLinkId);
      if (current) {
        current.members.push(pokemon);
        return;
      }

      groups.set(pokemon.soulLinkId, { id: pokemon.soulLinkId, members: [pokemon] });
    });

    return Array.from(groups.values()).map((group) => ({
      id: group.id,
      members: [...group.members].sort((a, b) => a.species.localeCompare(b.species)),
      status: group.members[0]?.status ?? "box",
      linkState: run.soulLinks.find((link) => link.id === group.id)?.status ?? "active",
    }));
  }, [run.pokemon, run.soulLinks]);
  const teamGroups = useMemo(() => {
    const sections: Record<PokemonStatus, typeof run.pokemon> = { team: [], box: [], dead: [] };
    run.pokemon.forEach((pokemon) => sections[pokemon.status].push(pokemon));
    return sections;
  }, [run.pokemon]);

  const editableGroupMember = (members: typeof run.pokemon) => canManageRun(currentMember) ? members[0] : members.find((pokemon) => pokemon.playerId === currentMember?.playerId);
  const openGroupDeathDialog = (members: typeof run.pokemon) => {
    const target = editableGroupMember(members);
    if (!target || members.every((pokemon) => pokemon.status === "dead")) return;
    openPokemonDialog(target.id);
    setPokemonDraft({ nickname: target.nickname, level: target.level, ability: target.ability ?? "", types: target.types?.join(", ") ?? "", status: "dead" });
    setConfirmingDeath(true);
  };

  const encounterGroups = useMemo(() => {
    const groups = new Map<string, { id: string; location: string; createdAt: string; entries: typeof run.encounters; soulLinkId?: string }>();
    run.encounters.forEach((encounter) => {
      const groupId = encounter.encounterGroupId ?? `legacy_${encounter.createdAt}_${encounter.location}`;
      const current = groups.get(groupId);
      if (current) current.entries.push(encounter);
      else groups.set(groupId, { id: groupId, location: encounter.location, createdAt: encounter.createdAt, entries: [encounter] });
    });
    const linksByEncounter = new Map(run.soulLinks.flatMap((link) => link.encounterIds.map((encounterId) => [encounterId, link.id] as const)));
    return Array.from(groups.values()).map((group) => {
      const soulLinkId = group.entries.map((entry) => linksByEncounter.get(entry.id)).find(Boolean);
      return { ...group, soulLinkId, soulLinkState: run.soulLinks.find((link) => link.id === soulLinkId)?.status };
    }).reverse();
  }, [run.encounters, run.soulLinks]);
  const recentEncounterGroups = encounterGroups.slice(0, 3);
  const extinguishedLinks = run.soulLinks.filter((link) => link.status === "extinguished").map((link) => ({ link, entries: link.encounterIds.map((id) => run.encounters.find((encounter) => encounter.id === id)).filter((entry) => entry !== undefined) }));
  const bossPortrait = run.pokemon.find((pokemon) => pokemon.status === "team") ?? run.pokemon[0] ?? null;
  const editingPokemon = editingPokemonId ? run.pokemon.find((pokemon) => pokemon.id === editingPokemonId) ?? null : null;
  const editingOwner = editingPokemon ? run.players.find((player) => player.id === editingPokemon.playerId) ?? null : null;
  const editingSoulLinkMembers = editingPokemon?.soulLinkId ? run.pokemon.filter((pokemon) => pokemon.soulLinkId === editingPokemon.soulLinkId) : [];

  const renderOverview = () => (
    <>
      {isPlatinumFinished ? (
        <section className="bossHero panel">
          <div className="bossHeroContent">
            <div className="bossPortrait">
              {bossPortrait ? <PokemonSprite spriteUrl={bossPortrait.spriteUrl} alt={bossPortrait.species} size={56} /> : <div className="portraitPlaceholder">?</div>}
            </div>
            <div className="bossMeta">
              <span className="eyebrow accent">POKÉMON PLATIN</span>
              <h2>Pokémon Liga geschafft ✓</h2>
              <p className="muted">Cynthia besiegt</p>
              <p className="muted">{totalBosses} / {totalBosses} Bosse besiegt</p>
            </div>
          </div>

          <div className="bossCapBlock">
            <span>LETZTES LEVEL CAP</span>
            <strong>{platinumProgress[platinumProgress.length - 1]?.levelCap ?? run.levelCap}</strong>
            <div className="bossProgressDots">
              {activeBossProgress?.map((boss, index) => (
                <span key={boss.name} className={index <= platinumProgress.length - 1 ? "active" : ""} title={boss.name} />
              ))}
            </div>
          </div>

          <button className="primaryButton big" onClick={handleBossDefeated} disabled={true}>Run abgeschlossen ✓</button>
        </section>
      ) : (
        <section className="bossHero panel">
          <div className="bossHeroContent">
            <div className="bossPortrait">
              {bossPortrait ? <PokemonSprite spriteUrl={bossPortrait.spriteUrl} alt={bossPortrait.species} size={56} /> : <div className="portraitPlaceholder">?</div>}
            </div>
            <div className="bossMeta">
              <span className="eyebrow accent">NÄCHSTER BOSS</span>
              <h2>{run.currentBoss}</h2>
              <p className="muted">Level Cap aktuell</p>
            </div>
          </div>

          <div className="bossCapBlock">
            <span>LEVEL CAP</span>
            <strong>{run.levelCap}</strong>
            <div className="bossProgressDots">
              {activeBossProgress?.map((boss, index) => (
                <span key={boss.name} className={index <= (activeBossProgress.findIndex((item) => item.name === run.currentBoss) >= 0 ? activeBossProgress.findIndex((item) => item.name === run.currentBoss) : 0) ? "active" : ""} title={boss.name} />
              ))}
            </div>
          </div>

          <button className="primaryButton big" onClick={handleBossDefeated} disabled={!canAdvanceBoss(currentMember) || bossUpdating || isPlatinumFinished}>{bossUpdating ? "Wird verarbeitet …" : "Boss als besiegt markieren"}</button>
        </section>
      )}

      <section className="playerGrid">
        {playerTeamCards.map(({ player, team, deadCount, soulLinkCount }) => (
          <article key={player.id} className={`playerCard panel ${selectedPlayerId === player.id ? "selected" : ""}`} style={{ borderTopColor: player.color ?? playerAccent[player.id] }} onClick={() => setSelectedPlayerId(player.id)}>
            <div className="playerCardHeader">
              <div className="avatar" style={{ background: playerAccent[player.id] }}>{player.name.slice(0, 2).toUpperCase()}</div>
              <div>
                <h3>{player.name}</h3>
                <small>{team.length} aktive Pokémon</small>
              </div>
            </div>

            <div className="playerMonList">
              {team.length ? team.map((pokemon) => (
                <button type="button" key={pokemon.id} className="playerMonItem" onClick={(event) => { event.stopPropagation(); openPokemonDialog(pokemon.id); }}>
                  <div className="playerMonIdentity">
                    <PokemonSprite spriteUrl={pokemon.spriteUrl} alt={pokemon.species} size={32} />
                    <div>
                      <strong>{pokemon.nickname || pokemon.species}</strong>
                      <small>{pokemon.species} · Lv. {pokemon.level}</small>
                    </div>
                  </div>
                  <span className={`miniBadge ${pokemon.status}`}>{pokemon.status === "dead" ? "☠" : statusLabels[pokemon.status]}</span>
                </button>
              )) : <p className="empty">Noch kein Pokémon im Team.</p>}
            </div>

            <div className="playerCardFooter">
              <span>{team.length} Team</span>
              <span>{deadCount} Tot</span>
              <span>{soulLinkCount} SoulLinks</span>
            </div>
          </article>
        ))}
      </section>

      <section className="dashboardLowerGrid">
        <article className="panel activityCard">
          <div className="sectionTopline">
            <div><p className="eyebrow">LIVE-VERLAUF</p><h2>Kürzliche Ereignisse</h2></div>
            <span className="livePill"><i /> LIVE</span>
          </div>
          <div className="eventTimeline">
            {events.map((event) => (
              <div key={event.id} className="timelineEvent">
                <span className={`eventIcon ${event.type === "boss-defeated" ? "boss" : "system"}`}>{event.type === "boss-defeated" ? "★" : "↗"}</span>
                <div><strong>{event.message}</strong><small>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} Uhr</small></div>
              </div>
            ))}
          </div>
        </article>

        <div className="dashboardUtilityStack">
          <article className="panel quickActions compactActions">
            <div className="sectionTopline"><div><p className="eyebrow">DIREKT LOSLEGEN</p><h2>Schnellaktionen</h2></div></div>
            <div className="actionGrid">
              <button className="actionButton primaryAction" onClick={() => setTab("encounters")}><span>＋</span> Neuen Encounter eintragen</button>
              <button className="actionButton" onClick={() => setTab("pokemon")}><span>◇</span> Pokémon hinzufügen</button>
              <button className="actionButton" onClick={handleBossDefeated} disabled={!canAdvanceBoss(currentMember) || isPlatinumFinished || bossUpdating}><span>★</span>{isPlatinumFinished ? "Run abgeschlossen ✓" : bossUpdating ? "Wird verarbeitet …" : "Boss als besiegt markieren"}</button>
              <button className="actionButton" onClick={() => setTab("notes")}><span>✎</span> Notiz schreiben</button>
            </div>
          </article>

          <article className="panel runNoteCard">
            <div className="sectionTopline"><p className="eyebrow">RUN-NOTIZ</p><button className="textButton" onClick={() => setTab("settings")}>BEARBEITEN</button></div>
            <p>{run.randomizer.notes || "Noch keine Notiz hinterlegt. Haltet hier Regeln, Ziele oder wichtige Hinweise fest."}</p>
          </article>
        </div>
      </section>
    </>
  );

  const renderEncounters = () => (
    <div className="stack">
      <EncounterForm run={run} setRun={setRun} readOnly={!canEditEncounters(currentMember)} onEvent={appendEvent} />
      <section className="panel">
        <div className="sectionTitleRow">
          <div>
            <p className="eyebrow">VERLAUF</p>
            <h2>Encounter-Historie</h2>
          </div>
          <span className="countPill">{encounterGroups.length} Vorgänge</span>
        </div>

        {encounterGroups.length === 0 ? (
          <p className="empty">Noch keine Encounters eingetragen.</p>
        ) : (
          <div className="historyList">
            {encounterGroups.map((group) => {
              const linkNumber = group.soulLinkId ? getSoulLinkNumber(group.soulLinkId) : null;
              const caughtCount = group.entries.filter((entry) => entry.status === "caught").length;
              const linkState = group.soulLinkState ?? (caughtCount === run.players.filter((player) => player.active !== false).length ? "active" : "pending");
              return <div className="historyGroup encounterHistoryCard" key={group.id}>
                <div className="encounterHistoryHeader"><div><p className="eyebrow">{group.location}</p><h3>{linkNumber ? `SoulLink #${linkNumber}` : "Encounter ohne Fang"}</h3></div>{linkNumber && <span className={`linkStateBadge ${linkState}`}>{linkState === "extinguished" ? "Erloschen" : linkState === "pending" ? "Ausstehend" : linkState === "dead" ? "Tot" : "Aktiv"}</span>}</div>
                <div className="historyRows">
                  {group.entries.map((encounter) => {
                    const player = run.players.find((entry) => entry.id === encounter.playerId);
                    return (
                      <div className="historyRow" key={encounter.id} style={{ borderLeft: `2px solid ${player?.color ?? "transparent"}` }}>
                        <span>{player?.name}</span>
                        <div className="historyNameCell">
                          <PokemonSprite spriteUrl={encounter.spriteUrl} alt={encounter.species} size={28} />
                          <strong>{encounter.species}{encounter.nickname ? ` „${encounter.nickname}“` : ""}</strong>
                        </div>
                        <span>Lv. {encounter.level}</span>
                        <span className={`status ${encounter.status}`}>{encounterLabels[encounter.status]}{linkState === "extinguished" && encounter.status === "caught" ? " · Ungültig" : ""}</span>
                      </div>
                    );
                  })}
                </div>
              </div>;
            })}
          </div>
        )}
      </section>
    </div>
  );

  const renderPokemon = () => {
    return (
      <section className="panel">
        <div className="sectionTitleRow">
          <div>
            <p className="eyebrow">POKÉMON</p>
            <h2>Teams, Box & Friedhof</h2>
          </div>
          <div className="sectionHeaderActions"><span className="countPill">{run.pokemon.length} Pokémon</span><button type="button" className="primaryButton" onClick={() => { setPokemonActionError(""); setShowTeamManager(true); }}>Team verwalten</button></div>
        </div>

        <div className="soulLinkBoard">
          {pokemonActionError && <p className="dialogError pokemonBoardError">{pokemonActionError}</p>}
          {(["team", "box", "dead"] as PokemonStatus[]).map((status) => (
            <div key={status} className="statusSection">
              <div className="statusSectionHeader">
                <h3>{status === "dead" ? "FRIEDHOF" : statusLabels[status].toUpperCase()}</h3>
                <span>{teamGroups[status].length}</span>
              </div>

              <div className="soulGroupList">
                {teamGroups[status].filter((entry) => entry.soulLinkId).length === 0 && teamGroups[status].filter((entry) => !entry.soulLinkId).length === 0 ? (
                  <p className="empty">{status === "team" ? "Noch keine Pokémon im Team." : status === "box" ? "Noch keine Pokémon in der Box." : "Zum Glück noch leer."}</p>
                ) : (
                  <>
                    {soulLinkGroups.filter((group) => group.status === status).map((group) => (
                      <div key={group.id} className="soulGroupCard">
                        <div className="soulGroupHeader">
                          <span>SoulLink #{getSoulLinkNumber(group.id) ?? "—"}</span>
                          <span className="groupStatus">{statusLabels[status]}</span>
                        </div>
                        <div className="soulGroupMembers">
                          {group.members.map((pokemon) => {
                            const player = run.players.find((entry) => entry.id === pokemon.playerId);
                            return (
                              <div key={pokemon.id} className="soulMemberRow">
                                <div className="memberMeta">
                                  <PokemonSprite spriteUrl={pokemon.spriteUrl} alt={pokemon.species} size={34} />
                                  <div>
                                    <strong>{player?.name}</strong>
                                    <span>{pokemon.nickname || pokemon.species}</span>
                                  </div>
                                </div>
                                <div className="memberMeta right">
                                  <strong>{pokemon.species}</strong>
                                  <span>Lv. {pokemon.level}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="soulGroupActions"><button type="button" className="ghostButton" onClick={() => { const target = editableGroupMember(group.members); if (target) openPokemonDialog(target.id); }}>Bearbeiten</button>{status === "team" && <button type="button" className="ghostButton" onClick={() => { const target = editableGroupMember(group.members); if (target) updatePokemonStatus(target.id, "box"); }}>In Box verschieben</button>}{status === "box" && <button type="button" className="ghostButton" onClick={() => { const target = editableGroupMember(group.members); if (target) updatePokemonStatus(target.id, "team"); }}>Ins Team verschieben</button>}{status !== "dead" && <button type="button" className="dangerButton" onClick={() => openGroupDeathDialog(group.members)}>☠ Als tot markieren</button>}</div>
                      </div>
                    ))}

                    {teamGroups[status].filter((entry) => !entry.soulLinkId).map((pokemon) => {
                      const player = run.players.find((entry) => entry.id === pokemon.playerId);
                      return (
                        <div key={pokemon.id} className="soloPokemonCard">
                          <div className="soloMeta">
                            <PokemonSprite spriteUrl={pokemon.spriteUrl} alt={pokemon.species} size={32} />
                            <div>
                              <strong>{pokemon.nickname || pokemon.species}</strong>
                              <span>{player?.name}</span>
                            </div>
                          </div>
                          <div className="soloMeta right">
                            <span>{pokemon.species}</span>
                            <span>Lv. {pokemon.level}</span>
                            <button type="button" className="textButton" onClick={() => openPokemonDialog(pokemon.id)}>Bearbeiten</button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        {extinguishedLinks.length > 0 && <section className="extinguishedSection"><div className="sectionTitleRow"><div><p className="eyebrow">DOKUMENTATION</p><h2>Erloschene Links</h2></div><span className="countPill">{extinguishedLinks.length}</span></div><div className="extinguishedGrid">{extinguishedLinks.map(({ link, entries }) => <article className="extinguishedCard" key={link.id}><div className="activeLinkHeader"><strong>SoulLink #{link.displayNumber ?? getSoulLinkNumber(link.id)}</strong><span className="linkStateBadge extinguished">Erloschen</span></div><span>{entries[0]?.location ?? "Unbekannter Ort"}</span><div>{entries.map((entry) => { const owner = run.players.find((player) => player.id === entry.playerId); return <p key={entry.id}><strong>{entry.species}</strong> — {owner?.name ?? "Ehemaliger Spieler"} <small>{encounterLabels[entry.status]}</small></p>; })}</div><em>Grund: Encounter verloren</em></article>)}</div></section>}
      </section>
    );
  };

  const renderBoss = () => (
    <section className="panel settingsGrid singleColumn">
      <div className="formSection">
        <p className="eyebrow">FORTSCHRITT</p>
        <h2>Boss & Level-Cap</h2>
        <div className="stack tight">
          <label>
            Nächster Boss
            <input value={run.currentBoss} onChange={(event) => { if (canAdvanceBoss(currentMember)) setRun({ ...run, currentBoss: event.target.value }); }} disabled={!canAdvanceBoss(currentMember) || isPlatinumFinished} />
          </label>
          <label>
            Level-Cap
            <input type="number" min={1} value={run.levelCap} onChange={(event) => { if (canAdvanceBoss(currentMember)) setRun({ ...run, levelCap: Math.max(1, Number(event.target.value)) }); }} disabled={!canAdvanceBoss(currentMember) || isPlatinumFinished} />
          </label>
        </div>
      </div>

      {isPlatinum(run.game) && (
        <div className="formSection">
          <p className="eyebrow">PLATIN</p>
          <h2>Automatische Reihenfolge</h2>
          <div className="bossSequenceList">
            {platinumProgress.map((boss) => (
              <div key={boss.name} className={boss.name === run.currentBoss ? "bossSequenceItem active" : "bossSequenceItem"}>
                <span>{boss.name}</span>
                <strong>{boss.levelCap}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );

  const renderSettings = () => (
    <section className="settingsGrid">
      <div className="panel">
        <p className="eyebrow">RANDOMIZER</p>
        <h2>Run-Einstellungen</h2>
        <div className="settingList">
          {Object.entries(run.randomizer).filter(([key]) => !["seed", "notes"].includes(key)).map(([key, value]) => (
            <div key={key}><span>{key}</span><strong>{value ? "An" : "Aus"}</strong></div>
          ))}
          <div><span>Seed</span><strong>{run.randomizer.seed || "—"}</strong></div>
          <div><span>Notizen</span><strong>{run.randomizer.notes || "—"}</strong></div>
        </div>
      </div>

      <div className="panel memberManagement">
        <p className="eyebrow">MITGLIEDER</p><h2>Spieler & Zuschauer</h2>
        <div className="memberManagementList">{run.members?.filter((member) => member.active).map((member) => <div key={member.id} className="memberManagementRow"><div><strong>{member.displayName}</strong><span>{member.role === "host" ? "Host" : member.role === "player" ? "Spieler" : "Zuschauer"}{member.participantId === currentMember?.participantId ? " · Du" : ""}</span></div>{canManagePlayers(currentMember) && member.role === "player" && <div><button className="textButton" onClick={() => transferHost(member)}>Zum Host machen</button><button className="textButton dangerText" onClick={() => removeMember(member)}>Entfernen</button></div>}</div>)}</div>
      </div>

      <div className="panel fixedSlotsPanel">
        <p className="eyebrow">SPIELERANZAHL</p><h2>{run.playerCount ?? run.playerSlots?.length ?? run.players.length} Spieler</h2><span className="lockedSetting">🔒 Gesperrt nach Run-Start</span>
        <div className="fixedSlotList">{run.playerSlots?.map((slot) => { const player = run.players.find((entry) => entry.id === slot.playerId && entry.active !== false); const member = run.members?.find((entry) => entry.playerId === player?.id && entry.active); return <div key={slot.id}><span>{slot.position}.</span><strong>{player?.name ?? "Noch nicht beigetreten"}</strong>{member?.role === "host" && <span className="memberBadge">♕ Host</span>}<small>{player ? "Belegt" : "Frei"}</small></div>; })}</div>
      </div>

      <div className="panel dangerZone">
        <p className="eyebrow">LOKAL</p>
        <h2>Run zurücksetzen</h2>
        <p className="muted">Löscht diesen Prototyp-Run aus deinem Browser.</p>
        <button className="dangerButton" disabled={!canManageRun(currentMember)} onClick={() => { if (!canManageRun(currentMember)) return; if (confirm("Run wirklich löschen?")) { clearRun(); location.reload(); } }}>Lokale Daten löschen</button>
        <button className="ghostButton" onClick={leaveRun}>Run verlassen</button>
      </div>
    </section>
  );

  const renderNotes = () => (
    <section className="panel notePanel">
      <p className="eyebrow">NOTIZEN</p>
      <h2>Run-Notiz</h2>
      <div className="noteBox">
        <p>{run.randomizer.notes || "Noch keine Notizen für diesen Run."}</p>
      </div>
      <button className="primaryButton" onClick={() => setTab("settings")}>Bearbeiten</button>
    </section>
  );

  return (
    <>
      <header className="appTopHeader">
        <div className="brandRow small dashboardBrand">
          <div className="logo">NL</div>
          <div className="brandTextWrap">
            <p className="eyebrow">NUZLINK</p>
            <strong>Nuzlocke SoulLink Tracker</strong>
          </div>
        </div>

        <div className="topHeaderActions">
          <span className="codePill">Run-Code {run.inviteCode}</span>
          <button className="ghostButton" onClick={copyLink}>{copied ? "Kopiert ✓" : "Einladungslink kopieren"}</button>
          <span className="playerHeaderLabel">{run.players.length} Spieler</span>
          <div className="avatarStack">
            {run.players.filter((player) => player.active !== false).map((player) => (
              <span key={player.id} className="avatar" style={{ background: playerAccent[player.id] }} title={player.name}>{player.name.slice(0, 2).toUpperCase()}</span>
            ))}
          </div>
          <button className="iconButton round" onClick={() => setTab("settings")} aria-label="Einstellungen">⚙</button>
          <button className="iconButton round" aria-label="Dunkles Farbschema">☾</button>
        </div>
      </header>

      <main className="dashboardShell">
        <aside className="dashboardSidebar">
          <div className="brandRow small dashboardBrand">
            <div className="logo">NL</div>
            <div>
              <p className="eyebrow">NUZLINK</p>
              <strong>{run.name}</strong>
            </div>
          </div>

        <nav className="sidebarNav">
          {[
            ["overview", "Dashboard"],
            ["encounters", "Encounters"],
            ["pokemon", "Teams & Friedhof"],
            ["boss", "Boss & Level Cap"],
            ["settings", "Run-Einstellungen"],
            ["notes", "Notizen"],
          ].map(([value, label]) => (
            <button key={value} className={tab === value ? "sideNavItem active" : "sideNavItem"} onClick={() => setTab(value as DashboardTab)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebarSection">
          <div className="sectionTopline">
            <h3>Spieler</h3>
            <button className="textButton" onClick={copyLink}>{run.players.filter((player) => player.active !== false).length >= (run.playerCount ?? MAX_RUN_PLAYERS) ? "Alle Spieler beigetreten" : copied ? "Link kopiert ✓" : "Offene Plätze einladen"}</button>
          </div>

          <div className="playerList">
            {run.members?.filter((member) => member.active && member.role !== "spectator").map((member) => (
              <button key={member.id} className={selectedPlayerId === member.playerId ? "playerListItem selected" : "playerListItem"} onClick={() => member.playerId && setSelectedPlayerId(member.playerId)}>
                <span className="avatar tiny" style={{ background: member.color ?? playerAccent[member.playerId ?? ""] }}>{member.displayName.slice(0, 2).toUpperCase()}</span>
                <span>{member.displayName}</span>{member.role === "host" && <span className="memberBadge">♕ Host</span>}{member.participantId === currentMember?.participantId && <span className="memberBadge self">Du</span>}
              </button>
            ))}
            {run.playerSlots?.filter((slot) => !slot.playerId).map((slot) => <div className="playerListItem emptySlot" key={slot.id}><span className="avatar tiny">{slot.position}</span><span>Noch nicht beigetreten</span><span className="memberBadge">Frei</span></div>)}
          </div>
          {!!run.members?.some((member) => member.active && member.role === "spectator") && <><div className="memberSectionLabel">ZUSCHAUER</div><div className="playerList">{run.members.filter((member) => member.active && member.role === "spectator").map((member) => <div className="playerListItem" key={member.id}><span className="avatar tiny">ZU</span><span>{member.displayName}</span>{member.participantId === currentMember?.participantId && <span className="memberBadge self">Du</span>}</div>)}</div></>}
        </div>

        <div className="sidebarInfoCard">
          <p className="eyebrow">SOULLINK MODE</p>
          <strong>Alle verbundenen Pokémon teilen dasselbe Schicksal.</strong>
          <button className="textButton" onClick={() => setShowSoulLinkInfo(true)}>Mehr erfahren →</button>
        </div>
      </aside>

      <div className="dashboardMain">
        <header className="dashboardHeader">
          <div className="headerIdentity">
            <p className="eyebrow">{run.game}</p>
            <h1>{run.name}</h1>

          </div>

          <div className="headerActions">
            <span className="modePill">{cloudMode ? "● Online synchronisiert" : "● Lokal gespeichert"}</span>
            {spectatorMode && <span className="spectatorPill">Zuschauermodus</span>}
          </div>
        </header>

        <section className="statGrid">
          <div className="statCard"><span>Orden / Bosse</span><strong>{bossDisplayValue}</strong></div>
          <div className="statCard"><span>Gefangen</span><strong>{caught}</strong></div>
          <div className="statCard"><span>SoulLinks</span><strong>{soulLinkGroups.length}</strong></div>
          <div className="statCard danger"><span>Tode</span><strong>{deaths}</strong></div>
        </section>

        {tab === "overview" && renderOverview()}
        {tab === "encounters" && renderEncounters()}
        {tab === "pokemon" && renderPokemon()}
        {tab === "boss" && renderBoss()}
        {tab === "settings" && renderSettings()}
        {tab === "notes" && renderNotes()}
      </div>

      <aside className="dashboardRail">
        <div className="railCard">
          <div className="sectionTopline">
            <p className="eyebrow">LETZTE ENCOUNTER</p>
          </div>

          {recentEncounterGroups.length ? (
            <div className="recentEncounterGroups">
              {recentEncounterGroups.map((group) => <div className="recentEncounterGroup" key={group.id}>
                <div className="recentEncounterHeading"><h3>{group.location}</h3>{group.soulLinkId && <><span>#{getSoulLinkNumber(group.soulLinkId)}</span><b className={`linkStateBadge ${group.soulLinkState ?? "pending"}`}>{group.soulLinkState === "extinguished" ? "Erloschen" : group.soulLinkState === "active" ? "Aktiv" : group.soulLinkState === "dead" ? "Tot" : "Ausstehend"}</b></>}</div>
                <div className="encounterSummaryList">
                {group.entries.map((encounter) => {
                  const player = run.players.find((entry) => entry.id === encounter.playerId);
                  return (
                    <div key={encounter.id} className="encounterSummaryItem">
                      <PokemonSprite spriteUrl={encounter.spriteUrl} alt={encounter.species} size={38} />
                      <div><span>{player?.name}</span><strong>{encounter.species}</strong><small>Lv. {encounter.level}</small></div>
                      <em className={`status ${encounter.status}`}>{encounter.status === "caught" ? "Gefangen" : encounter.status === "defeated" ? "Verloren" : encounterLabels[encounter.status]}</em>
                    </div>
                  );
                })}
              </div>
              </div>)}
            </div>
          ) : (
            <p className="empty">Noch keine Encounters.</p>
          )}

          <button className="ghostButton fullWidth" onClick={() => setTab("encounters")}>Alle Encounters ansehen</button>
        </div>

        <div className="railCard">
          <div className="sectionTopline">
            <p className="eyebrow">AKTIVE SOULLINKS</p>
          </div>
          <div className="activeLinkList">
            {soulLinkGroups.filter((group) => group.linkState === "active" && group.status !== "dead").length === 0 ? (
              <p className="empty">Noch keine SoulLink-Gruppen.</p>
            ) : (
              soulLinkGroups.filter((group) => group.linkState === "active" && group.status !== "dead").map((group) => (
                <div key={group.id} className="activeLinkItem">
                  <div className="activeLinkHeader"><span className="activeLinkTag">SoulLink #{getSoulLinkNumber(group.id) ?? "—"}</span>{group.members.length < run.players.length && <span className="incompleteBadge">Unvollständig</span>}</div>
                  <div className="activeLinkNames">
                    {group.members.map((member, index) => (
                      <div key={member.id} className="activeLinkName">
                        <PokemonSprite spriteUrl={member.spriteUrl} alt={member.species} size={32} />
                        <span>{member.nickname || member.species}</span>
                        {index < group.members.length - 1 && <span className="arrow">↔</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </aside>
      </main>

      {showTeamManager && <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowTeamManager(false); }}><section className="pokemonDialog teamManagerDialog" role="dialog" aria-modal="true" aria-labelledby="team-manager-title"><header className="pokemonDialogHeader"><div><p className="eyebrow">TEAM VERWALTEN</p><h2 id="team-manager-title">SoulLinks zusammenstellen</h2></div><button type="button" className="dialogClose" onClick={() => setShowTeamManager(false)} aria-label="Dialog schließen">×</button></header><div className="teamSlotGrid">{run.players.filter((player) => player.active !== false).map((player) => <div key={player.id} style={{ borderColor: player.color }}><strong>{player.name}</strong><span>{run.pokemon.filter((pokemon) => pokemon.playerId === player.id && pokemon.status === "team").length} / 6</span></div>)}</div>{pokemonActionError && <p className="dialogError">{pokemonActionError}</p>}{(["team", "box"] as PokemonStatus[]).map((status) => <section className="managerSection" key={status}><div className="sectionTopline"><p className="eyebrow">{status === "team" ? "AKTUELLES TEAM" : "VERFÜGBARE SOULLINKS"}</p><span className="countPill">{soulLinkGroups.filter((group) => group.status === status).length}</span></div><div className="managerLinkList">{soulLinkGroups.filter((group) => group.status === status).length ? soulLinkGroups.filter((group) => group.status === status).map((group) => <article className="managerLinkCard" key={group.id}><div className="activeLinkHeader"><strong>SoulLink #{getSoulLinkNumber(group.id) ?? "—"}</strong>{group.members.length < run.players.filter((player) => player.active !== false).length && <span className="incompleteBadge">Unvollständig</span>}</div><div className="managerMembers">{group.members.map((pokemon, index) => { const owner = run.players.find((player) => player.id === pokemon.playerId); return <div key={pokemon.id}>{index > 0 && <i>↔</i>}<PokemonSprite spriteUrl={pokemon.spriteUrl} alt={pokemon.species} size={34} /><span><strong>{pokemon.nickname || pokemon.species}</strong><small>{owner?.name ?? "Ehemaliger Spieler"}</small></span></div>; })}</div><button type="button" className={status === "team" ? "ghostButton" : "primaryButton"} onClick={() => { const target = editableGroupMember(group.members); if (target) updatePokemonStatus(target.id, status === "team" ? "box" : "team"); }}>{status === "team" ? "In Box verschieben" : `SoulLink #${getSoulLinkNumber(group.id) ?? "—"} ins Team nehmen`}</button></article>) : <p className="empty">{status === "team" ? "Noch kein SoulLink im Team." : "Keine SoulLinks in der Box verfügbar."}</p>}</div></section>)}</section></div>}

      {showSoulLinkInfo && <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSoulLinkInfo(false); }}><section className="pokemonDialog soulLinkInfoDialog" role="dialog" aria-modal="true" aria-labelledby="soullink-info-title"><header className="pokemonDialogHeader"><div><p className="eyebrow">SOULLINK MODE</p><h2 id="soullink-info-title">Was ist ein SoulLink?</h2></div><button type="button" className="dialogClose" onClick={() => setShowSoulLinkInfo(false)} aria-label="Dialog schließen">×</button></header><p>Pokémon, die beim selben Encounter von verschiedenen Spielern gefangen werden, gehören zu einer gemeinsamen SoulLink-Gruppe.</p><div className="soulLinkExample"><span><strong>Max</strong>Garchomp</span><i>↔</i><span><strong>Leon</strong>Magikarp</span><i>↔</i><span><strong>Anna</strong>Regice</span></div><strong>Diese Pokémon teilen dasselbe Schicksal.</strong><section className="soulLinkRules"><p className="eyebrow">REGELN</p><ul><li>Ein Link wird nur aktiv, wenn alle teilnehmenden Spieler ihr Pokémon fangen.</li><li>Wird ein Pokémon besiegt oder flieht, erlischt der gesamte SoulLink. Auch bereits gefangene Pokémon dürfen dann nicht verwendet werden.</li><li>Ein Dupe/Reroll lässt den SoulLink nicht erlöschen und gilt nicht als finales Ergebnis.</li><li>Team- und Boxwechsel gelten immer für alle verbundenen Pokémon.</li><li>Stirbt ein Pokémon später im Run, gilt der aktive SoulLink als tot.</li><li>Ein Spieler darf maximal 6 Pokémon gleichzeitig im Team haben.</li></ul></section><footer className="pokemonDialogFooter"><button type="button" className="primaryButton" onClick={() => setShowSoulLinkInfo(false)}>Verstanden</button></footer></section></div>}

      {editingPokemon && pokemonDraft && (
        <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePokemonDialog(); }}>
          <section className="pokemonDialog" role="dialog" aria-modal="true" aria-labelledby="pokemon-dialog-title">
            <header className="pokemonDialogHeader">
              <div className="pokemonDialogIdentity">
                <div className="dialogSprite"><PokemonSprite spriteUrl={editingPokemon.spriteUrl} alt={editingPokemon.species} size={72} /></div>
                <div><p className="eyebrow">POKÉMON-DETAILS</p><h2 id="pokemon-dialog-title">{editingPokemon.species}</h2><span>{editingOwner?.name ?? "—"} · {editingPokemon.location || "—"}</span></div>
              </div>
              <button type="button" className="dialogClose" onClick={closePokemonDialog} aria-label="Dialog schließen">×</button>
            </header>

            <div className="pokemonFacts">
              <div><span>Spezies</span><strong>{editingPokemon.species || "—"}</strong></div>
              <div><span>Besitzer</span><strong>{editingOwner?.name ?? "—"}</strong></div>
              <div><span>Fangort</span><strong>{editingPokemon.location || "—"}</strong></div>
              <div><span>SoulLink</span><strong>{editingPokemon.soulLinkId ? `#${getSoulLinkNumber(editingPokemon.soulLinkId) ?? "—"}` : "—"}</strong></div>
            </div>

            <div className="pokemonEditGrid">
              <label>Nickname<input value={pokemonDraft.nickname} onChange={(event) => setPokemonDraft({ ...pokemonDraft, nickname: event.target.value })} placeholder="—" /></label>
              <label>Level<input type="number" min={1} value={pokemonDraft.level} onChange={(event) => setPokemonDraft({ ...pokemonDraft, level: Number(event.target.value) })} /></label>
              <label>Ability<input value={pokemonDraft.ability} onChange={(event) => setPokemonDraft({ ...pokemonDraft, ability: event.target.value })} placeholder="—" /></label>
              <label>Status<select value={pokemonDraft.status} onChange={(event) => { setPokemonDraft({ ...pokemonDraft, status: event.target.value as PokemonStatus }); setPokemonDialogError(""); setConfirmingDeath(false); }}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              {run.randomizer.types ? <label className="dialogFullWidth">Typen (kommagetrennt)<input value={pokemonDraft.types} onChange={(event) => setPokemonDraft({ ...pokemonDraft, types: event.target.value })} placeholder="z. B. Drache, Boden" /></label> : <div className="dialogTypes dialogFullWidth"><span>Typen</span><div>{editingPokemon.types?.length ? editingPokemon.types.map((type) => <span className="typeChip" key={type}>{type}</span>) : "—"}</div></div>}
            </div>

            {editingSoulLinkMembers.length > 0 && (
              <section className="dialogSoulLink">
                <div className="sectionTopline"><div><p className="eyebrow">VERBUNDENE GRUPPE</p><h3>SoulLink #{editingPokemon.soulLinkId ? getSoulLinkNumber(editingPokemon.soulLinkId) ?? "—" : "—"}</h3></div><span className={`dialogStatus ${pokemonDraft.status}`}>{statusLabels[pokemonDraft.status]}</span></div>
                {pokemonDraft.status !== editingPokemon.status && <p className="sharedStatusNotice">Diese Änderung betrifft den gesamten SoulLink #{editingPokemon.soulLinkId ? getSoulLinkNumber(editingPokemon.soulLinkId) ?? "—" : "—"}.</p>}
                <div className="dialogMemberList">
                  {editingSoulLinkMembers.map((member, index) => {
                    const owner = run.players.find((player) => player.id === member.playerId);
                    return <div key={member.id} className="dialogMember">{index > 0 && <span className="dialogLinkArrow">↔</span>}<PokemonSprite spriteUrl={member.spriteUrl} alt={member.species} size={38} /><div><strong>{member.nickname || member.species}</strong><span>{member.species} — {owner?.name ?? "—"}</span></div></div>;
                  })}
                </div>
              </section>
            )}

            {confirmingDeath && (
              <div className="deathConfirmation">
                <strong>{editingPokemon.soulLinkId ? `SoulLink #${getSoulLinkNumber(editingPokemon.soulLinkId) ?? "—"} als tot markieren?` : `${editingPokemon.nickname || editingPokemon.species} als tot markieren?`}</strong>
                <p>Wenn ein Pokémon stirbt, gelten alle verbundenen Pokémon als tot. Betroffen:</p>
                <div>{(editingSoulLinkMembers.length > 0 ? editingSoulLinkMembers : [editingPokemon]).map((member) => { const owner = run.players.find((player) => player.id === member.playerId); return <span key={member.id}>{member.species} – {owner?.name ?? "—"}</span>; })}</div>
                <p>Alle Pokémon werden in den Friedhof verschoben.</p>
              </div>
            )}

            {pokemonDialogError && <p className="dialogError">{pokemonDialogError}</p>}
            <footer className="pokemonDialogFooter">
              <button type="button" className="ghostButton" onClick={confirmingDeath ? () => setConfirmingDeath(false) : closePokemonDialog}>Abbrechen</button>
              <button type="button" className={confirmingDeath ? "dangerConfirmButton" : "primaryButton"} onClick={savePokemonDraft}>{confirmingDeath ? (editingPokemon.soulLinkId ? "Alle als tot markieren" : "Als tot markieren") : editingPokemon.soulLinkId && pokemonDraft.status !== editingPokemon.status ? (pokemonDraft.status === "dead" ? "SoulLink als tot markieren" : `Gesamten SoulLink ${pokemonDraft.status === "team" ? "ins Team" : "in die Box"} verschieben`) : "Änderungen speichern"}</button>
            </footer>
          </section>
        </div>
      )}
      </>
  );
}

function JoinRun({ code, cachedRun, onJoin, onDashboard, onCancel }: { code: string; cachedRun: RunState | null; onJoin: (name: string, role: Exclude<RunMemberRole, "host">, color: string) => Promise<void>; onDashboard: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#c4b5fd");
  const [role, setRole] = useState<Exclude<RunMemberRole, "host"> | null>(null);
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => { if (!isSupabaseConfigured) { setLoading(false); return; } previewCloudRun(code).then(setPreview).catch(() => setPreview(null)).finally(() => setLoading(false)); }, [code]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!role || (role === "player" && !name.trim())) return;
    setBusy(true); setError("");
    try { await onJoin(name.trim() || "Zuschauer", role, color); } catch (err) { setError(err instanceof Error ? err.message : "Beitritt fehlgeschlagen."); setBusy(false); }
  };
  return <main className="setupShell"><section className="setupCard joinCard">
    <div className="brandRow"><div className="logo">NL</div><div><p className="eyebrow">EINLADUNG · {code}</p><h1>Nuzlocke SoulLink Tracker</h1></div></div>
    {!isSupabaseConfigured && process.env.NODE_ENV === "development" && <p className="errorText">Supabase ist nicht konfiguriert. Ergänze NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local und starte den Dev-Server neu.</p>}
    {!cloudEnabled ? <><p className="lead">Dieser Link benötigt den Online-Modus. Trage zuerst die Supabase-Variablen ein.</p><button className="ghostButton" onClick={onCancel}>Zur Startseite</button></> : loading ? <p className="lead">Run wird geladen …</p> : !preview ? <div className="joinErrorState"><h2>Run nicht gefunden</h2><p>Der Einladungslink ist ungültig oder der Run existiert nicht mehr.</p><button className="ghostButton" onClick={onCancel}>Zur Startseite</button></div> : preview.alreadyJoined ? <div className="joinRunInfo"><h2>Du bist diesem Run bereits beigetreten.</h2><p>{preview.name} · {preview.game}</p><button className="primaryButton big" disabled={busy} onClick={async () => { if (cachedRun) onDashboard(); else { setBusy(true); try { await onJoin("Zuschauer", "spectator", color); } catch (err) { setError(err instanceof Error ? err.message : "Run konnte nicht geladen werden."); setBusy(false); } } }}>{busy ? "Lade …" : "Zum Dashboard"}</button>{error && <p className="errorText">{error}</p>}</div> : <form onSubmit={submit} className="formStack"><div className="joinRunInfo"><p>Du wurdest zu folgendem Run eingeladen:</p><h2>{preview.name}</h2><span>{preview.game} · {preview.playerCount} / {preview.maxPlayers} Spielerplätze · {preview.soulLinkEnabled ? "SoulLink aktiv" : "Nuzlocke"}</span></div>{!role ? <div className="joinRoleGrid">{preview.playerCount < preview.maxPlayers && <button type="button" onClick={() => setRole("player")}><strong>Freier Spielerplatz verfügbar</strong><span>Als Spieler beitreten und den nächsten freien Slot übernehmen</span></button>}<button type="button" onClick={() => setRole("spectator")}><strong>Nur zuschauen</strong><span>{preview.playerCount >= preview.maxPlayers ? "Alle Spielerplätze sind bereits belegt." : "Run live und schreibgeschützt verfolgen"}</span></button></div> : <><label>Dein Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={role === "spectator" ? "Zuschauer" : "z. B. Max"} /></label>{role === "player" && <label>Spielerfarbe<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>}{error && <p className="errorText">{error}</p>}<div className="setupActions"><button type="button" className="ghostButton" onClick={() => setRole(null)}>Zurück</button><button className="primaryButton big" disabled={busy}>{busy ? "Verbinde …" : "Run beitreten"}</button></div></>}</form>}
  </section></main>;
}

export default function Home() {
  const [run, setRun] = useState<RunState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [cloudMode, setCloudMode] = useState(false);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [joinAccepted, setJoinAccepted] = useState(false);
  const [participantId, setParticipantId] = useState("");
  const lastRemote = useRef("");

  useEffect(() => {
    const localParticipantId = getLocalParticipantId();
    setParticipantId(localParticipantId);
    const cached = loadRun();
    const code = new URLSearchParams(window.location.search).get("join");
    const normalizedCode = code?.toUpperCase() ?? null;
    setJoinCode(normalizedCode);
    const rawMatchingCached = !normalizedCode || cached?.inviteCode === normalizedCode ? cached : null;
    const matchingCached = rawMatchingCached && !isSupabaseConfigured && !rawMatchingCached.members?.some((member) => member.participantId === localParticipantId)
      ? { ...rawMatchingCached, members: rawMatchingCached.members?.map((member) => member.role === "host" ? { ...member, participantId: localParticipantId } : member) }
      : rawMatchingCached;
    setRun(matchingCached ?? null);
    setHydrated(true);
    if (matchingCached && isSupabaseConfigured) {
      loadCloudRun(matchingCached.id).then((remote) => {
        if (remote) {
          const normalizedRemote = remote;
          lastRemote.current = JSON.stringify(normalizedRemote);
          setRun(normalizedRemote);
          setCloudMode(true);
          getCloudParticipantId().then(setParticipantId).catch(() => undefined);
        }
      }).catch(() => setCloudMode(false));
    }
  }, []);

  useEffect(() => {
    if (!hydrated || !run) return;
    saveRun(run);
    if (!cloudMode) return;
    const serialized = JSON.stringify(run);
    if (serialized === lastRemote.current) return;
    const timer = window.setTimeout(() => {
      saveCloudRun(run).then(() => { lastRemote.current = serialized; }).catch(console.error);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [run, hydrated, cloudMode]);

  useEffect(() => {
    if (!run || !cloudMode) return;
    return subscribeToCloudRun(run.id, (remote) => {
      const serialized = JSON.stringify(remote);
      if (serialized === lastRemote.current) return;
      lastRemote.current = serialized;
      setRun(remote);
      saveRun(remote);
    });
  }, [run?.id, cloudMode]);

  const createRun = async (next: RunState) => {
    const normalized = next;
    if (isSupabaseConfigured) {
      const online = await createCloudRun(normalized, normalized.players[0]?.name ?? "Host");
      lastRemote.current = JSON.stringify(online);
      setCloudMode(true);
      setRun(online);
      setParticipantId(await getCloudParticipantId());
      window.history.replaceState({}, "", "/");
    } else {
      setCloudMode(false);
      setRun(normalized);
    }
  };

  const joinRun = async (name: string, role: Exclude<RunMemberRole, "host">, color: string) => {
    if (!joinCode) return;
    const online = await joinCloudRun(joinCode, name, role, color);
    lastRemote.current = JSON.stringify(online);
    setCloudMode(true);
    setRun(online);
    setParticipantId(await getCloudParticipantId());
    setJoinAccepted(true);
    saveRun(online);
    window.history.replaceState({}, "", "/");
    setJoinCode(null);
  };

  const cancelJoin = () => {
    window.history.replaceState({}, "", "/");
    setJoinCode(null);
  };

  if (!hydrated) return <main className="loading">Nuzlink wird geladen …</main>;
  if (joinCode && !joinAccepted) return <JoinRun code={joinCode} cachedRun={run} onJoin={joinRun} onDashboard={() => { setJoinAccepted(true); window.history.replaceState({}, "", "/"); setJoinCode(null); }} onCancel={cancelJoin} />;
  if (!run) return <Setup onCreate={createRun} />;
  const currentMember = run.members?.find((member) => member.active && member.participantId === participantId) ?? (run.members?.length === 1 ? run.members[0] : null);
  return <Dashboard run={run} setRun={setRun} cloudMode={cloudMode} currentMember={currentMember} />;
}
