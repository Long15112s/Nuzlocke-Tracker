# Nuzlink – Randomizer SoulLink Tracker

Ein erster MVP für gemeinsame Pokémon-Randomizer-Nuzlockes / SoulLinks.

## Enthalten

- Run erstellen (Name, Spiel, Spieler, Boss, Level-Cap)
- Randomizer-Einstellungen dokumentieren
- Encounter pro Spieler erfassen
- Gefangene Pokémon automatisch zu SoulLinks gruppieren
- Team / Box / Friedhof verwalten
- Beim Tod eines SoulLink-Pokémon alle verbundenen Pokémon gemeinsam markieren
- Boss-/Orden-Fortschritt
- Responsive Oberfläche
- Lokale Persistenz via `localStorage` als Fallback
- **Echter Online-Modus** via Supabase Anonymous Auth + RLS + Realtime, sobald die Env-Variablen gesetzt sind

## Lokal starten

```bash
npm install
npm run dev
```

Dann `http://localhost:3000` öffnen.

## Online-Modus einrichten

1. `.env.example` als `.env.local` kopieren.
2. `NEXT_PUBLIC_SUPABASE_URL` aus den Supabase-Projekteinstellungen eintragen.
3. Den Publishable Key als `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` eintragen. Niemals einen `service_role` Key verwenden.
4. Unter Supabase Auth die **Anonymous Sign-ins** aktivieren.
5. Bei einem neuen Projekt zuerst `supabase/schema.sql`, danach `supabase/migrations/fixed-player-slots.sql` im SQL Editor ausführen. Bei einem bestehenden Projekt nur die Migration ausführen.
6. Den Dev-Server neu starten. Next.js liest die Variablen beim Start beziehungsweise Build ein.

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Neue Runs werden bei gültiger Konfiguration zuerst in Supabase angelegt. Erst danach wird das Dashboard geöffnet. Ohne Konfiguration bleibt der LocalStorage-Modus aktiv; geräteübergreifende Einladungslinks sind dann nicht verfügbar.

### Multiplayer-Schema aktualisieren

Nach einem Update von einer früheren Version `supabase/migrations/fixed-player-slots.sql` im SQL Editor ausführen. Die nicht-destruktive Migration ergänzt die Rollen `host`, `player` und `spectator`, feste Slots sowie die RPCs für Vorschau, Join, Entfernen, Host-Transfer und Verlassen.

Danach die inkrementellen Migrationen `supabase/migrations/fix-slot-occupancy-preview.sql` und `supabase/migrations/fix-membership-realtime.sql` ausführen. Letztere erlaubt einem Nutzer weiterhin ausschließlich das Lesen seines eigenen inaktiven Membership-Datensatzes, damit ein Kick zuverlässig per Realtime erkannt wird.

## Tests

```bash
npm run typecheck
npm run test:unit
npm run test:e2e
npm run test:all
```

Unit- und lokale Integrationstests benötigen keine Cloud-Zugangsdaten. Browser-/Supabase-E2E-Tests dürfen ausschließlich ein separates Testprojekt über `TEST_SUPABASE_URL` und `TEST_SUPABASE_PUBLISHABLE_KEY` verwenden. Fehlen diese Werte, wird der E2E-Schritt ausdrücklich übersprungen; die produktiven `NEXT_PUBLIC_*`-Werte werden niemals als Ersatz verwendet.

Die MVP-RLS verhindert Schreibzugriffe von Zuschauern und schützt die Mitgliederverwaltung durch Host-geprüfte RPCs. Player-Updates am gemeinsamen JSON-Run-State werden zusätzlich in den App-Handlern eingeschränkt; für eine vollständig feldgenaue serverseitige Autorisierung sollte der JSON-State später in getrennte normalisierte Tabellen aufgeteilt werden.

Alte Runs mit unterschiedlichen Statuswerten innerhalb desselben SoulLinks werden beim Laden sicher vereinheitlicht. Dabei gilt die Priorität `dead > box > team`: Ein totes Mitglied setzt den gesamten Link auf `dead`; gemischte Team-/Box-Gruppen werden vorsichtshalber in die Box verschoben.

Ein SoulLink wird nur `active`, wenn alle Spieler ihren Encounter fangen. Sobald ein Eintrag `defeated` oder `fled` ist, wird die Gruppe `extinguished`; gefangene Teilresultate bleiben in der Historie dokumentiert, erzeugen aber keine nutzbaren Pokémon. Gruppen mit `reroll` oder noch nicht finalen Ergebnissen bleiben `pending` und verbrauchen den Ort noch nicht.

Die Spieleranzahl wird beim Run-Start mit 2, 3 oder 4 festen `playerSlots` gespeichert und danach nicht mehr verändert. Verlässt ein Spieler den Run, wird nur sein Slot frei; seine Player-ID und alle historischen Daten bleiben bestehen. Ein späterer Join belegt den freien Slot mit einer neuen Player-ID. Encounter können erst gespeichert werden, wenn alle vorgesehenen Slots belegt sind.

> Ohne Supabase-Konfiguration fällt derselbe Build automatisch auf den lokalen Demo-Modus zurück.

## Empfohlener nächster Entwicklungsschritt

- Mitglieder explizit einem Spieler-Slot zuordnen
- Konfliktauflösung für gleichzeitige Änderungen an derselben Encounter-Zeile
- echte `/run/[inviteCode]` Route
- PokéAPI Autocomplete für Spezies (optional, frei überschreibbar für Randomizer)
