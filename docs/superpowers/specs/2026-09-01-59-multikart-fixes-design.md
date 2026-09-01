# Phase 59 — Multikart-Bugfixes (Design)

**Datum:** 2026-09-01
**Status:** Freigegeben (User-Report: Bugs bei Verbindung/Registry + Kart-Einstellungsfenster, echte Hardware)
**Branch:** `feat/phase-59-multikart-fixes`, stacked auf `feat/phase-58-display-entfernen` (PR #93)

## Befunde (Root Causes, verifiziert)

1. **Bestätigungsdialog hinter dem ⚙-Fenster:** `rcConfirm`/`rcAlert` rendern
   ausschließlich das statische `#rcAlertOverlay` im Hauptfenster-DOM
   (`rasicross.js`). Das Kart-Einstellungsfenster ist ein eigenes OS-Fenster
   (`window.open`, Phase 48); der Workaround `window.focus()` vor jedem
   Confirm (`kart-settings-window.js`) darf unter Electron/Chromium das
   Hauptfenster nicht zuverlässig über das Kind heben → Dialog liegt hinten.
2. **Beschriftungen brechen buchstabenweise um / Feld überlappt den Text.**
   *Erste Hypothese (Stapelregel greift dauerhaft) war falsch* — die
   440-px-Media-Query feuerte nie, wie der Vergleich mit der committeten
   Baseline `demo-kart-fenster-linux.png` zeigt (Zeilen dort **nicht**
   gestapelt, sondern überlappend). Tatsächliche Ursache: `.settings-row
   input[type=text]` erbt `flex:0 0 auto` (**schrumpft nie**) und
   beansprucht harte `max-width:340px`, während `.settings-row-label`
   `min-width:0` hat und damit auf ~40 px kollabiert. Bei 460 px Viewport
   bleibt für die Beschreibung fast nichts übrig → Umbruch nach einzelnen
   Wörtern, Eingabefeld schiebt sich optisch darüber.
3. **Geisterkarte auf der Verbindungsseite** (2 Karts dort, 1 im Karts-Tab):
   `processTelemetry` behandelt nur `bridge_status`/`config_ack` gesondert —
   `bridge_error`/`bridge_info`/`bridge_hello` (ohne `from_mac`) laufen in
   den Telemetrie-Pfad und buchen `lastPacketAt` auf den `default`-Bucket,
   der damit als eigene Karte neben dem echten Kart erscheint (der Karts-Tab
   filtert `default`, die Verbindungsseite nicht mehr sobald er „Pakete" hat).
4. **Tote Karts bleiben/kommen wieder:** Die Bridge persistiert Kart-MACs im
   NVS und meldet sie alle 2 s in `bridge_status.karts[]`; die App legt für
   jede gemeldete MAC sofort Bucket + Roster-Meta an (`telemetry.js`).
   `forget_kart_mac`/`reset_karts` gehen nur bei bestehender USB-Verbindung
   an die Bridge — sonst NVS-Resurrektion beim nächsten Verbinden.

## Locked Decisions

- **Dialog im aufrufenden Fenster:** `rcAlert`/`rcConfirm` erhalten einen
  optionalen `doc`-Parameter (am Ende der Signatur). Ohne `doc` (oder
  `doc === document`) bleibt der bisherige statische Overlay-Pfad unverändert
  (Screenshot-/e2e-Baselines!). Mit fremdem `doc` wird ein Overlay
  (`div.overlay.show > div.dialog > h3 + p + .dialog-btns`) dynamisch im
  Kind-DOM erzeugt und nach Klick entfernt — die App-Styles sind dorthin
  geklont. Die `window.focus()`-Workarounds entfallen.
- **Layout-Fix an der Wurzel:** `.settings-row-label` bekommt
  `min-width:150px` (statt 0) und `input[type=text]` wird mit
  `flex:0 1 auto; min-width:0` schrumpffähig — das Feld gibt Platz ab,
  bevor die Label-Spalte gequetscht wird. Im Hauptfenster (breite Zeilen)
  bindet weder die Mindestbreite noch das Schrumpfen → dort keine
  Darstellungsänderung.
- **Fensterbreite 460 → 520** als Komfort-Zugabe (mehr Luft für das
  Formular). Der 440-px-Breakpoint bleibt für bewusst schmal gezogene
  Fenster (Electron `minWidth: 380`).
  **Bei der Umsetzung gefunden:** die maßgebliche Breite steht in
  `main.js` (`setWindowOpenHandler` → `overrideBrowserWindowOptions.width`);
  sie gilt in Electron VOR dem Features-String von `window.open`. Beide
  Stellen werden gesetzt, sonst bleibt der Fix wirkungslos.
- **Early-Return** in `processTelemetry` für `type` ∈ {`bridge_error`,
  `bridge_info`, `bridge_hello`} — Paket-Log (conn-ui, eigener Pfad) bleibt
  unberührt; nur die Kart-Zuordnung entfällt.
- **Bridge-gemeldete Karts** (`bridge_status.karts[]`) erzeugen nur noch dann
  einen neuen App-Eintrag, wenn die MAC bereits bekannt ist (Registry oder
  Roster-Meta) **oder** laut `age` kürzlich gefunkt hat (< 60 000 ms; die
  Bridge liefert 99999 für „nie seit Boot"). Reine NVS-Altlasten erscheinen
  nicht mehr. Regel als pure Funktion `shouldAdoptBridgeKart` in
  `kart-roster.js` (node:test-getestet).
- **Pending-Queue für Bridge-Kommandos:** `forget_kart_mac`/`reset_karts`
  werden bei fehlender Verbindung gemerkt (Session-Queue) und beim nächsten
  `bridge_status` (Bridge nachweislich erreichbar) gesendet. Keine
  Persistenz über App-Neustarts — die Adoptions-Regel schützt die App-Sicht
  auch ohne zugestellten Forget.

## Nicht-Ziele

- Kein Umbau des statischen `#rcAlertOverlay`-Pfads im Hauptfenster.
- Keine Firmware-Änderungen (Sender-Neuflash steht ohnehin an, PR #93).
- Keine MAC-Normalisierung (alle Quellen liefern lowercase-Hex).

## Verifikation

- Neue node:tests für `shouldAdoptBridgeKart`; Baselines (222 JS / 64 Py)
  wachsen entsprechend; Lint/CSS-Gate grün.

### Offene Konsequenz: Screenshot-Baseline

Die Breiten-/Layout-Korrektur verändert das ⚙-Fenster sichtbar — die
committete Baseline `e2e/screens.spec.js-snapshots/demo-kart-fenster-linux.png`
schlägt in der CI daher zwangsläufig fehl (genau dafür existiert das Gate).
Die Linux-Baseline entsteht nur in der CI (lokal ist die Suite geskippt,
`RASI_SCREENS=1` erzeugt gitignorete win32-Bilder). Neu-Einfrieren erfolgt
nach Repo-Praxis **erst nach ausdrücklicher User-Freigabe** des neuen
Aussehens (vgl. Commits „Baselines … neu eingefroren — vom User freigegeben").
Die Dialog-Baselines (`dialog-alert`, `dialog-confirm`) sind nicht betroffen:
der statische Hauptfenster-Pfad blieb unverändert.
- Manuell (User, Hardware): ⚙-Fenster-Dialoge erscheinen im Fenster selbst;
  Zeilen nebeneinander in Standardgröße; Verbindungsseite ohne Geisterkarte;
  vergessene Karts bleiben nach Reconnect verschwunden.
