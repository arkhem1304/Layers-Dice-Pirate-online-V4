# Layers Dice Online — Pirate Dark Fantasy

Mobile-friendly browser multiplayer Liar's Dice with private 5-character rooms, 2–10 players, pirate-themed styling, animated dice, local session resume, and the custom rules described below.

## Rules implemented
- In normal rounds, bids can be changed freely: neither quantity nor face value has to be higher than the previous bid. Any valid quantity and face can be announced, as long as quantity is between 1 and the total number of active dice.
- If any active player has exactly one die and has not used their one-die special round before, a special round starts with an eligible one-die player opening. Their first bid must be a number 2–6 and locks the face for the round. In this special round only, later bids must use that same face and strictly increase quantity.
- In this one-die special round, Jokers are not counted as a number and do not act as wildcards. Only the exact announced face is counted.
- In ordinary rounds, a bid on 2–6 counts matching dice plus Jokers; a Joker bid counts Jokers only.
- Each player starts with five dice. A challenge loser loses one die; the last player with dice wins.
- Dice hide/restore controls only change the local visual display, not the actual game.

## Run locally
1. Install Node.js 18 or newer.
2. In this folder run `npm install`.
3. Run `npm start` and open `http://localhost:3000`.

## Deploy on Render
- Build command: `npm install`
- Start command: `npm start`
- Root directory: leave empty when `package.json`, `server.js` and `public/` are at repository root.
- Upload/commit all files, then use Render **Manual Deploy → Deploy latest commit**.

## Session saving caveat
Room state is written to `rooms-data.json` on the server and the browser stores a player token so refreshing the page can rejoin the same seat. This is best-effort persistence: Render's default ephemeral filesystem can be cleared during restarts/deploys. For reliable long-term persistence, attach a persistent disk or use a database. The JSON file is intended for a single server instance.


## Neue Änderungen
- Dunkleres Piraten-Design mit Geisterschiff-Hintergrund und verwitterten, leicht durchscheinenden Würfeln.
- Der Knopf **„Runde beenden & zum Hauptmenü“** beendet die Partie für alle Spieler im Raum. Alle verbundenen Spieler werden ins Hauptmenü zurückgeführt und ihre gespeicherte Sitzungszuordnung wird gelöscht, sodass ein Neuladen sie nicht automatisch wieder in die beendete Partie bringt.


## Aktualisierte Gebotsregeln

- **Normale Gebote dürfen frei geändert werden:** Anzahl und Augenzahl müssen im Vergleich zum vorherigen Gebot weder höher noch gleich sein. Jedes gültige Gebot ist erlaubt, sofern die Anzahl zwischen 1 und der Gesamtzahl aktiver Würfel liegt. Nur in der Ein-Würfel-Sonderrunde gilt weiterhin: gleiche Augenzahl und eine strikt höhere Anzahl.
- Jeder Spieler kann die Ein-Würfel-Sonderrunde höchstens einmal pro Partie nutzen. Nach Nutzung wird sie für diesen Spieler nicht erneut ausgelöst, auch wenn er später wieder nur einen Würfel hat. Wenn ein anderer Spieler mit einem Würfel seine Sonderrunde noch nicht genutzt hat, kann diese Sonderrunde für ihn weiterhin ausgelöst werden.


## Start-Würfel einstellen
In der Lobby kann der Gastgeber vor dem Start zwischen 1 und 15 Start-Würfeln pro Spieler wählen. Die Auswahl wird auf alle Spieler im Raum übertragen und beim Start für alle übernommen. Neu beitretende Spieler erhalten ebenfalls die eingestellte Anzahl.
