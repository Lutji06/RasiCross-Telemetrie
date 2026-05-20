# RasiCross — 3D Kart Custom-Modell Upload (glTF/GLB)

**Date:** 2026-05-20
**Status:** Approved (design); pending implementation plan
**Author:** Brainstorming session (Claude + user)
**Builds on:** Phase 11 (3D Kart G-Viewer) — `docs/superpowers/specs/2026-05-20-3d-gmeter-design.md`

---

## 1. Purpose

Phase 11 lieferte einen 3D-Kart-Viewer mit einem aus Three.js-Primitiven (Boxen + Zylinder) zusammengesetzten Lowpoly-Modell. Phase-11-Spec Section 3 hat bewusst out-of-scope gelegt: *"Echtes glTF/OBJ-Modell des Karts (Primitive bleibt; späteres Drop-In ohne Code-Änderung möglich, aber das ist eine eigene Phase)."* — **das ist diese Phase.**

Ziel: Der Nutzer kann sein eigenes 3D-Modell (`.glb`/`.gltf`) im Settings-Tab hochladen, das den Primitive-Kart im 3D-Viewer ersetzt. Modell wird persistent im Electron-`userData`-Ordner gespeichert, beim App-Start automatisch geladen, kann jederzeit per Heading-Buttons (0°/90°/180°/270°) nachorientiert oder per Klick auf den Standard zurückgesetzt werden. Default bleibt der Primitive-Kart — diese Phase ist **rein additiv**.

## 2. Background / current state (geerdet im Code)

- **Phase 11 verfügbar:** `karts3d.js` (UMD) exportiert `RasiKart3D.{init, update, start, stop, resetYaw, dispose, isFailed, …}`. `init()` baut die Szene + das primitive Kart-Mesh-Group (`_kartGroup` via `_buildKart()`), das `update()` jeden Frame rotiert.
- **Three.js r152** liegt lokal unter `vendor/three.min.js` (UMD-Build, ~633 KB, CSP `script-src 'self'`-konform). Loaded `<script>` vor `karts3d.js`.
- **GLTFLoader fehlt:** Three.js r152 core enthält keinen Loader. `examples/jsm/loaders/GLTFLoader.js` ist ESM-only — inkompatibel mit unserem Classic-Script-Pattern. Lösung in Section 4.2.
- **Settings-Tab Pattern:** Bestehende UI-Konvention: ein `<div class="card">` mit Card-Head + Form-Inhalt. Persistente Settings landen in `state.settings` und werden via `saveData()` / `loadData()` in `localStorage` synchronisiert.
- **Electron IPC Pattern:** `preload.js` exposed `window.rasiSerial` über `contextBridge.exposeInMainWorld(…)`. `main.js` registriert `ipcMain.handle('…', async (e, …) => {})`. Wir spiegeln diesen Pattern für File-I/O.
- **electron-builder file-list:** `package.json` `build.files` listet alle bundle-relevanten Pfade — neue Vendor-Files müssen hier ergänzt werden.

### Confirmed decisions (Brainstorming)

- **Format:** glTF / GLB (single binary file, `.glb` und `.gltf` akzeptiert via Dateiendung).
- **UI-Position:** Neuer Block "Kart-Modell" im Settings-Tab (nach dem Calibration-Block).
- **Persistence:** Electron-Dateisystem — `app.getPath('userData')/karts/active.glb`. IPC: `saveKartModel(buffer)`, `loadKartModel()`, `clearKartModel()` über `window.rasiKart`.
- **Skalierung:** Auto-fit auf die Diagonale der Primitive-Bounding-Box (≈ `sqrt(2.0² + 0.4² + 1.2²) ≈ 2.4` Einheiten), zentriert auf den Ursprung.
- **Orientierung:** Auto-fit + manueller Y-Heading-Offset in 90°-Schritten (`state.settings.kartModelYaw ∈ {0, 90, 180, 270}`, default `0`). Gilt für **beide** Modelle (primitive + custom), damit der Toggle für beide konsistent ist.
- **GLTFLoader-Vendor:** `vendor/three.gltf-loader.min.js` aus `unpkg.com/three@0.147.0/examples/js/loaders/GLTFLoader.js` (~70 KB UMD). API stabil seit r140; kompatibel mit r152-core. Falls Laufzeit-Inkompatibilität: Three.js auf r147 downgraden (single file swap).
- **Default-Verhalten:** Primitive bleibt aktiv, solange `userData/karts/active.glb` nicht existiert. Voll abwärtskompatibel.
- **Branch:** `feat/3d-kart-import` ab `feat/3d-gmeter` — Phase 12. Eigener PR auf top der gerade gemergten Phase 11.

## 3. Scope

### In scope

| Item | Surface |
|------|---------|
| Vendor `vendor/three.gltf-loader.min.js` (Three.js r147 UMD GLTFLoader) | `vendor/`, HTML script tag, `package.json` `build.files` |
| Electron IPC: `saveKartModel` / `loadKartModel` / `clearKartModel` | `main.js`, `preload.js` |
| `karts3d.js` Extension: `loadCustomModel`, `resetToPrimitive`, `setHeadingOffset` | `karts3d.js`, `test/karts3d.test.js` |
| Pure helpers (TDD): `computeAutoFitScale`, `kartModelYawReducer` | `karts3d.js`, `test/karts3d.test.js` |
| Settings-Tab UI: Upload + Filename-Label + Heading-Buttons + Reset | `RasiCross_Telemetry.html`, `rasicross.js` |
| `state.settings.kartModelYaw` (persistiert, default `0`) | `rasicross.js` |
| Auto-load custom model on `init()` (after `initGViewToggle()`) | `rasicross.js` |
| Hardware/Manual Acceptance Checklist erweitert | (Plan-Doc) |

### Out of scope

- Andere Formate (OBJ, STL, FBX) — diese Phase nur glTF/GLB.
- Material-Editor / Texture-Swap / Color-Picker für das custom Modell. Die Materials des hochgeladenen glTFs werden 1:1 übernommen (außer Fallback bei nicht-Standard-Material, siehe 4.10).
- Drag-and-drop Upload — `<input type="file">` reicht für jetzt.
- Multiple-Modelle / Profile / Auswahl-Dropdown. Genau ein aktives custom Modell + Primitive-Fallback.
- glTF-Animation playback. Falls das Modell Animationen enthält, werden sie ignoriert (statisches Mesh).
- Cross-Device-Sync. Modell lebt lokal in `userData`, kein Cloud-Storage.
- Hardware/Sender/Bridge — kein ESP-NOW-Protokoll, kein Telemetrie-Format wird angefasst.

## 4. Detailed design

### 4.1 Electron IPC

**`main.js`** — drei neue `ipcMain.handle` Endpoints. Pfad-Konstante intern:

```javascript
const KART_DIR = path.join(app.getPath('userData'), 'karts');
const KART_FILE = path.join(KART_DIR, 'active.glb');
```

- `'rasi-kart:save'`: nimmt einen `Uint8Array` als Argument, erstellt `KART_DIR` (recursive `mkdir`), schreibt nach `KART_FILE + '.tmp'`, dann `rename(tmp, KART_FILE)` für Atomarität. Returns `{ok: true}` oder `{ok: false, error: <message>}`.
- `'rasi-kart:load'`: prüft `existsSync(KART_FILE)`. Wenn nicht: `{ok: false, error: 'not-found'}`. Wenn ja: `await fs.readFile(KART_FILE)` → `{ok: true, buffer: <Uint8Array>}`. IPC kann Buffer/Uint8Array nativ transportieren.
- `'rasi-kart:clear'`: `unlink` wenn existiert, sonst no-op. Returns `{ok: true}`. (Idempotent.)

**`preload.js`** — bridge expose:

```javascript
contextBridge.exposeInMainWorld('rasiKart', {
  saveKartModel: (buf) => ipcRenderer.invoke('rasi-kart:save', buf),
  loadKartModel: () => ipcRenderer.invoke('rasi-kart:load'),
  clearKartModel: () => ipcRenderer.invoke('rasi-kart:clear')
});
```

Identical pattern to the existing `window.rasiSerial`-bridge. **No** filesystem access in renderer process — only via IPC.

### 4.2 GLTFLoader vendoring

`vendor/three.gltf-loader.min.js` wird als statisches Asset eingecheckt. Quelle: `https://unpkg.com/three@0.147.0/examples/js/loaders/GLTFLoader.js`. Diese Variante registriert sich global als `THREE.GLTFLoader` (Classic-Script-Pattern, kein ESM). Größe: ~70 KB.

`<script>`-Reihenfolge in HTML wird zu:

```html
<script src="geo.js"></script>
<script src="replay.js"></script>
<script src="vendor/three.min.js"></script>
<script src="vendor/three.gltf-loader.min.js"></script>
<script src="karts3d.js"></script>
<script src="rasicross.js"></script>
```

GLTFLoader **nach** Three.js-Core (braucht `THREE` als Globalvariable) und **vor** `karts3d.js`.

**Fallback:** Falls `typeof THREE.GLTFLoader === 'undefined'` zur Laufzeit (vendor-File fehlt, Bundle korrupt), `loadCustomModel` returns `{ok: false, error: 'no-loader'}` und das Upload-UI zeigt einen Toast + bleibt disabled. Primitive-Kart bleibt aktiv.

**Kompatibilitäts-Risiko:** r147-GLTFLoader gegen r152-Core. Three.js GLTFLoader-API ist seit r140 stabil; kein erwarteter Konflikt. Smoke-Test in Manual-Acceptance-Checklist verifiziert das.

### 4.3 `karts3d.js` Extension

**Neue pure Helper (TDD'd):**

- `computeAutoFitScale(sizeX, sizeY, sizeZ, targetDiagonal)` → returns scale factor.
  - `Math.sqrt(sizeX² + sizeY² + sizeZ²)` = current diagonal.
  - Wenn current ≤ 0: returns `1` (degenerate input).
  - Sonst: `targetDiagonal / current`.
  - `targetDiagonal` default in caller = `Math.sqrt(2.0² + 0.4² + 1.2²) ≈ 2.4166`.
- `kartModelYawReducer(currentDeg, action)` → returns next valid yaw in degrees.
  - `currentDeg` clamped to nearest of `{0, 90, 180, 270}` (anything outside snaps to `0`).
  - Actions: `'next'` (advance by 90°, wraps `270 → 0`), `'prev'` (back by 90°, wraps `0 → 270`), `'set:0'`/`'set:90'`/`'set:180'`/`'set:270'`.
  - Unknown action → identity (post-clamp).

**Neue DOM/WebGL-API:**

- `loadCustomModel(arrayBuffer, headingDeg)` — async, returns `Promise<{ok, error?}>`.
  - Gated by `typeof THREE === 'undefined' || typeof THREE.GLTFLoader === 'undefined'` → `{ok:false, error:'no-loader'}`.
  - `const loader = new THREE.GLTFLoader()`; `loader.parse(arrayBuffer, '', onLoad, onError)`.
  - In `onLoad(gltf)`:
    - Extract `gltf.scene` as the new model group.
    - Compute `const bbox = new THREE.Box3().setFromObject(scene)`; derive `size = bbox.getSize(new Vector3())` and `center = bbox.getCenter(new Vector3())`.
    - **Scale:** `const s = computeAutoFitScale(size.x, size.y, size.z, 2.4166)`; `scene.scale.setScalar(s)`.
    - **Recenter + bottom-on-floor:** X and Z centered on the origin; Y aligned so the model's lowest point sits on the floor plane (`y=0`, identical to where the primitive kart's wheels touch). Concretely: `scene.position.set(-center.x * s, -bbox.min.y * s, -center.z * s)`. This pre-multiplies because `scale` is applied before `position` in Three.js's local-to-world transform.
    - **Material fallback:** traverse all Meshes; for each Mesh, if `mesh.material` is missing or doesn't have `.color` (e.g. some glTFs ship raw `MeshBasicMaterial` only), wrap it with `new THREE.MeshStandardMaterial({ color: 0x4cc2ff, roughness: 0.6 })` — keeps the model visible under our directional light.
    - **Dispose** the previous `_kartGroup` (geometry + materials + remove from scene).
    - Assign `_kartGroup = scene`; `_scene.add(_kartGroup)`.
    - `_customModelHeading = headingDeg` (module-internal var, default 0).
    - Resolve `{ok:true}`.
  - In `onError(err)`: resolve `{ok:false, error:'parse-failed'}`. Old `_kartGroup` stays in scene.
- `resetToPrimitive()` — disposes the current `_kartGroup`, builds a fresh primitive group via the existing `_buildKart()`, sets `_customModelHeading = 0`. Returns `void`.
- `setHeadingOffset(headingDeg)` — sets `_customModelHeading` to the value (clamped via `kartModelYawReducer`). Effective immediately on the next `update()` frame (the offset is added to the dynamically integrated `_yaw` when computing the Euler rotation).

**Update to `update()` (existing function in `karts3d.js`):**

The Euler line currently reads:
```javascript
var euler = new THREE.Euler(_pitch, _yaw, _roll, 'YXZ');
```

Becomes:
```javascript
var headingRad = _customModelHeading * Math.PI / 180;
var euler = new THREE.Euler(_pitch, _yaw + headingRad, _roll, 'YXZ');
```

This keeps the dynamic IMU yaw (from `yawIntegrate`) and adds the user-chosen static offset. Works identically for primitive and custom models.

**`api`-export erweitert:**

```javascript
api = {
  …existing 11 entries…,
  loadCustomModel, resetToPrimitive, setHeadingOffset,
  computeAutoFitScale, kartModelYawReducer
};
```

### 4.4 Settings-Tab UI (HTML)

New `<div class="card">` block inserted in the Settings-Tab, immediately after the existing Calibration card. CSS reuses the existing `.card` / `.row` / `.btn` rules — no new CSS classes needed beyond the heading-button group (which can mirror the `.g-view-toggle` styles from Phase 11).

```html
<div class="card">
  <div class="card-head"><span class="card-title">Kart-Modell (3D-Viewer)</span></div>
  <div class="row" style="flex-direction:column;align-items:stretch;gap:10px">
    <div class="stat">
      <div class="t">Aktuell</div>
      <div class="n" id="kartModelName">Standard (Primitive)</div>
    </div>
    <label class="btn primary" style="cursor:pointer">
      Datei wählen…
      <input type="file" id="kartModelFile" accept=".glb,.gltf" style="display:none">
    </label>
    <div class="stat">
      <div class="t">Ausrichtung</div>
      <div class="g-view-toggle" id="kartModelYawToggle">
        <button type="button" data-yaw="0" class="active">0°</button>
        <button type="button" data-yaw="90">90°</button>
        <button type="button" data-yaw="180">180°</button>
        <button type="button" data-yaw="270">270°</button>
      </div>
    </div>
    <button type="button" class="btn" id="kartModelResetBtn">Auf Standard zurücksetzen</button>
  </div>
</div>
```

CSP-konform: file-input + buttons werden via `addEventListener` gebunden (kein `onclick=` Inline-Attribut).

### 4.5 Wiring in `rasicross.js`

**Neuer Setting-Default:**

```javascript
state.settings = { …existing keys…, gView: '2d', kartModelYaw: 0 };
```

**Neue Module-Funktion `initKartModelUploader()`** — gerufen aus `init()` nach `initGViewToggle()`:

1. Resolve DOM refs: `kartModelFile`, `kartModelName`, `kartModelYawToggle`, `kartModelResetBtn`.
2. Wenn `window.rasiKart` nicht existiert (z. B. WebApp-Mode, kein Electron): UI komplett ausblenden via `.hidden`, `return`.
3. **Auto-load** on init: `window.rasiKart.loadKartModel()` →
   - Wenn `{ok:true, buffer}`: `RasiKart3D.loadCustomModel(buffer, state.settings.kartModelYaw)` → if `ok`, set `kartModelName.textContent = 'Eigenes Modell (geladen aus Speicher)'`.
   - Wenn `{ok:false}`: keep primitive, `kartModelName.textContent = 'Standard (Primitive)'`.
4. **File-input change handler:**
   - Reject if `file.size > 10 * 1024 * 1024`: `rcToast('Datei zu groß (max 10 MB)')`, abort.
   - `await file.arrayBuffer()` → `buf` (Uint8Array via `new Uint8Array(buf)` for IPC).
   - Save via `window.rasiKart.saveKartModel(uint8)`: on `{ok:false}`, toast the error, abort.
   - Load via `RasiKart3D.loadCustomModel(uint8.buffer, state.settings.kartModelYaw)`: on `{ok:false}`, toast 'Modell-Datei beschädigt' and call `window.rasiKart.clearKartModel()` to avoid an unloadable file at next start.
   - On success: `kartModelName.textContent = file.name`; `rcToast('Eigenes Modell geladen')`.
5. **Heading-button handlers:** click → read `data-yaw`, set `state.settings.kartModelYaw = Number(data-yaw)`, `saveData()`, update `.active` class, call `RasiKart3D.setHeadingOffset(value)`.
6. **Reset-button handler:** confirm via `rcConfirm('Eigenes Modell auf Standard zurücksetzen?')`. On yes: `window.rasiKart.clearKartModel()`, `RasiKart3D.resetToPrimitive()`, `kartModelName.textContent = 'Standard (Primitive)'`, `state.settings.kartModelYaw = 0`, `saveData()`, reset toggle `.active` to `0°`-button.

### 4.6 Replay integration

Keine Sonder-Behandlung nötig: das custom Modell ist nur eine andere Geometrie unter `_kartGroup`. `update()` rotiert es identisch. `resetYaw()` (Phase-11-Hook) nullt nur `_yaw`, nicht den Heading-Offset — das ist gewünscht (User-Konfig bleibt persistent über Replay-Enter/-Exit).

### 4.7 Daten- / State-Änderungen

- `state.settings.kartModelYaw` (number, persistiert, default `0`) — neue Setting.
- `RasiKart3D` internes Modul-State: `_customModelHeading` (Radians-Cache des Yaw-Settings, default `0`). Nicht in `state` — Modul-private.
- Telemetrie-Felder unverändert. ESP-NOW-Protokoll unverändert.

### 4.8 Fehler-/Edge-Cases

- **GLTFLoader fehlt** (vendor-File 404 oder umbenannt) → `loadCustomModel` rejects `'no-loader'`. UI zeigt Toast `'glTF-Loader nicht verfügbar — vendor/three.gltf-loader.min.js fehlt'`, Upload-Button bleibt disabled. Primitive bleibt aktiv.
- **glb-Parse-Fehler** (corrupt file, wrong format despite `.glb` extension) → `'parse-failed'`. Toast `'Modell-Datei beschädigt — Standard bleibt aktiv'`. Datei wird auf Disk gelöscht (sonst würde sie bei jedem Start neu scheitern); UI fällt auf Primitive.
- **Datei zu groß** (>10 MB) → Pre-check vor IPC. Toast `'Datei zu groß (max 10 MB)'`. Kein Save, kein Load. **(Limit ist softwareseitig — die `app.getPath('userData')`-Quota ist OS-abhängig und meist riesig; 10 MB ist ein Performance-/Sanity-Limit.)**
- **IPC-Fehler** (write/read permission denied, disk full) → Toast mit der Error-Message aus dem `{ok:false, error}`-Return. Settings unchanged.
- **Modell ohne Material** (z. B. raw geometry only) → Material-Fallback in `loadCustomModel` setzt ein default `MeshStandardMaterial`. Modell ist sichtbar (in `--pr`-Farbe).
- **Modell mit Animationen** (`gltf.animations.length > 0`) → ignoriert; nur `gltf.scene` wird verwendet, kein `AnimationMixer`. Kommentar im Code.
- **Modell mit Lights/Cameras im glTF** → ignoriert (wir reusen unsere eigene Camera + Lights aus Phase 11). `gltf.scene` enthält möglicherweise Camera/Light-Nodes; die werden zwar mit kopiert, aber unsere `_camera` und `AmbientLight`/`DirectionalLight` sind in `_scene` direkt — die importierten verdrängen sie nicht.
- **WebGL deaktiviert** (`_failed === true` aus Phase 11) → Upload-UI bleibt verfügbar (man kann das Modell hochladen, es wird in `userData` gespeichert), aber `loadCustomModel` wird nicht aufgerufen (`_failed`-gate). Beim nächsten Start mit funktionierendem WebGL lädt das Modell normal.
- **Replay-Modus aktiv beim Upload** → kein Konflikt; das Modell-Mesh ist orthogonal zur Telemetrie-Pipeline. Upload während Replay funktioniert; das neue Modell tickt sofort mit den replay-fed Daten.
- **`state.settings.kartModelYaw`-Korruption** (z. B. `gView`-style alter `localStorage` mit Müllwert) → `kartModelYawReducer` clamps auf `0`.

## 5. Daten / Protokoll-Änderungen

Keine.

- `state.settings.kartModelYaw` (neu, additiv, alter Code ignoriert ihn).
- `userData/karts/active.glb` (neu, file-on-disk, vor Upload nicht existent — keine Migration nötig).
- Telemetrie, ESP-NOW, Bridge, Sender unverändert.

## 6. Testing-Strategie

**Pure Helper TDD** (`test/karts3d.test.js` erweitert):

- `computeAutoFitScale(2, 2, 2, 4)` → erwarteter Skalierungsfaktor (4 / sqrt(12)).
- `computeAutoFitScale(0, 0, 0, 4)` → `1` (degenerate input).
- `computeAutoFitScale(NaN, 2, 2, 4)` → `1` (NaN guard).
- `kartModelYawReducer(0, 'next')` → `90`; `kartModelYawReducer(270, 'next')` → `0`; `kartModelYawReducer(0, 'prev')` → `270`; etc.
- `kartModelYawReducer(45, 'next')` → `90` (clamp 45 → 0, then advance).
- `kartModelYawReducer(123, 'set:180')` → `180`; unknown action returns clamped current.

Erwartete `npm test`-Summe: **`tests 32`** (10 geo + 12 replay + 6 karts3d existing + 4 karts3d new).

**DOM/WebGL/IPC** (loadCustomModel, resetToPrimitive, setHeadingOffset, IPC-Endpoints):
- Nicht unit-getestet (Project-Precedent Phasen 2–11).
- Verifikation per:
  - `node --check karts3d.js`, `node --check main.js`, `node --check preload.js`, `node --check rasicross.js`
  - Grep-statische Anker (alle erwarteten IDs/Funktionen, CSP-konform, korrekte IPC-Channel-Namen).
- Manuelle Hardware/Smoke-Checklist (siehe unten).

**CI** (`.github/workflows/check.yml`):
- `node --check karts3d.js` ist bereits drin (Phase 11). Keine Änderung nötig.
- `vendor/three.gltf-loader.min.js` wird NICHT gechecked (3rd-party, gleiche Logik wie `vendor/three.min.js`).

### Manuelle Acceptance-Checklist (Hardware/Smoke, vom Nutzer)

1. **Default-Verhalten unverändert**: nach Update auf Phase 12, ohne Upload: 2D + 3D Toggle funktioniert wie in Phase 11. Primitive-Kart unverändert. Yaw-Heading-Default `0°`.
2. **Upload eines test-`.glb`**: Datei wählen → erscheint im 3D-Viewer, ersetzt den Primitive-Kart. `userData/karts/active.glb` existiert auf Disk. KPI/2D-Pfade unbeeinflusst. Zero CSP-Verstöße in DevTools.
3. **Auto-fit**: ein sehr großes Modell (z. B. 100×100×100 Einheiten) und ein sehr kleines (0.01×0.01×0.01) erscheinen beide in ähnlicher Bildschirmgröße — passt in die Primitive-Box.
4. **Heading-Buttons**: jedes der 4 Buttons (0/90/180/270) dreht das Modell sofort um die jeweilige Y-Achse. Setting persistiert über App-Restart.
5. **Restart**: App schließen + neu starten → das hochgeladene Modell wird automatisch geladen (Filename-Label zeigt es an).
6. **Reset-Button**: "Auf Standard zurücksetzen" → Confirm-Dialog → Primitive kehrt zurück, `userData/karts/active.glb` wird gelöscht, Heading wieder `0°`.
7. **Fehlerpfade**:
   - Datei > 10 MB → Toast, kein Save.
   - Korrupte `.glb` → Toast `'Modell-Datei beschädigt'`, Primitive bleibt, File-on-Disk gelöscht.
   - `vendor/three.gltf-loader.min.js` umbenannt → Upload-Button disabled, Toast bei Klick.
8. **Replay-Integration**: NDJSON-Replay starten mit custom Modell → das Modell bewegt sich konsistent zur Replay-Telemetrie; Replay-Enter/-Exit verändert das Modell nicht; nur `yaw` wird per `resetYaw` genullt (Phase 11 Hook).
9. **Material-Fallback**: ein glTF ohne Materials (z. B. raw geometry export) erscheint einfarbig in `--pr`-Farbe, nicht unsichtbar/schwarz.
10. **GitHub Actions `check` workflow** grün.

## 7. Backward Compatibility

- **Voll abwärtskompatibel.** Default: kein custom Modell → kein `userData/karts/active.glb` → Primitive bleibt aktiv. Phase-11-Verhalten unverändert.
- `state.settings.kartModelYaw` (neuer optionaler Key) wird von altem Code ignoriert.
- `localStorage`-Schema kompatibel. Reset-Pfad existiert.
- Telemetrie/Protokoll unverändert. Keine ESP-, Bridge-, Recording-Änderung.

## 8. Sequencing

Eigene Phase 12, ein Plan-Dokument, fünf Tasks:

1. **Pure Helper + Tests**: `computeAutoFitScale`, `kartModelYawReducer` + 4 `node:test` cases.
2. **Vendor GLTFLoader + Electron IPC**: `vendor/three.gltf-loader.min.js` einchecken, `main.js`+`preload.js` IPC-Methoden, HTML script tag, `package.json` `build.files` ergänzt.
3. **`RasiKart3D` Extension**: `loadCustomModel`, `resetToPrimitive`, `setHeadingOffset`. `update()`-Euler erweitert um Heading-Offset. Auto-load-Hook bereit (aber noch nicht aus `init()` gerufen).
4. **Settings-Tab UI + Wiring**: HTML-Block, CSS (reusing `.g-view-toggle`), `initKartModelUploader()`, alle Event-Handler, `state.settings.kartModelYaw` Default, Auto-load-Aufruf in `init()`.
5. **Phase-Verifikation + Plan-Doc-Commit + Push.**

Plan-Doc: `docs/superpowers/plans/2026-05-20-12-3d-kart-import.md`.

## 9. Risiken & Mitigation

| Risiko | Mitigation |
|--------|------------|
| GLTFLoader r147 ↔ Three.js r152 inkompatibel | Smoke-Test in Manual-Acceptance-Item 2. Wenn fehlschlägt: Three.js auf r147 downgraden (single file swap, `vendor/three.min.js` ersetzen). Phase-11-API stays intact (Three.js API stable). |
| Sehr großes Modell sprengt Speicher | 10-MB-Limit am Upload. Three.js rendert auch große Modelle bei 60fps. Falls Probleme: polygon-reduction empfehlen in der README. |
| Modell-Materialien werden nicht im Renderer angezeigt | Material-Fallback in `loadCustomModel` ersetzt ungeeignete Materials durch `MeshStandardMaterial`. Sichtbar gegen `AmbientLight + DirectionalLight`. |
| User lädt nicht-glTF (z. B. .obj, .fbx) hoch | `accept=".glb,.gltf"` am file-input filtert vor. Falls Bypass: `GLTFLoader.parse()` wirft → `'parse-failed'`-Pfad. |
| `userData/karts/active.glb` wird zwischen Sessions corrupted | Auto-load fehler-pfad löscht die Datei; UI fällt auf Primitive zurück; User kann neu hochladen. |
| User-HTML-WIP-Konflikt | Worktree `feat/3d-kart-import` ab `feat/3d-gmeter` — isoliert vom main-Worktree (auf `feat/binary-protocol`). |
| Modell-Animations ignoriert ohne Hinweis | Code-Kommentar dokumentiert; in README/Settings-Help-Text optional Erwähnung. |
| IPC-Pfad bricht in WebApp-Mode (Browser, kein Electron) | `initKartModelUploader` checkt `if (!window.rasiKart) return;` → UI wird ausgeblendet, Primitive bleibt aktiv. |
