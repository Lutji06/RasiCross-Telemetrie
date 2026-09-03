// ============================================================
//  RasiCross — kart-roster.js  (pure Kart-Stammdaten-Logik, Phase 46)
// ============================================================
//  Roster-Mechanik ohne DOM/State: Meta-Defaults, Migration des alten
//  rasi.kartMeta.v1-Keys, Anzeige-Sortierung, Klemmen. Persistenz und
//  Maps besitzt rasicross.js (_persistedKarts.meta); hier nur Funktionen.
//  Laeuft unter node:test und im Browser. Wirft nie.
// ============================================================

  const PALETTE = ['#3aa0e8', '#e8a13a', '#5ad17a', '#e85a7a', '#b07ae8'];

  function isDemoMac(mac) { return String(mac || '').indexOf('DE:MO:') === 0; }

  function metaDefaults(idx) {
    const i = Math.max(0, Number(idx) || 0);
    return { name: 'Kart ' + (i + 1), color: PALETTE[i % PALETTE.length], lastSeenAt: null,
             equip: equipDefaults(), equipSet: false };
  }

  // Ausstattung (Phase 57): Alt-Metas ohne equip-Feld gelten als voll
  // ausgestattet; fehlende oder unbrauchbare Einzel-Flags fallen auf true.
  // Phase 58: nur noch das RPM-Flag — das Display ist entfernt; alte
  // Saves mit equip.display bleiben ladbar (Feld wird ignoriert).
  function equipDefaults() { return { rpm: true }; }

  function equipFor(meta) {
    const e = meta && meta.equip;
    return {
      rpm: (e && typeof e.rpm === 'boolean') ? e.rpm : true,
    };
  }

  // Erst-Verbindungs-Dialog nur fuer echte, unbestaetigte Karts —
  // nie Demo (DE:MO:*), nie der default-Platzhalter-Bucket.
  function needsEquipDialog(meta, mac) {
    if (!meta || meta.equipSet) return false;
    if (isDemoMac(mac) || mac === 'default') return false;
    return true;
  }

  // Der Index ist nur ein Wunsch. Die Aufrufer reichen die Position in der
  // Registry durch, und die ist nicht eindeutig: ein Kart, das gerade nicht
  // funkt, hat indexOf() === -1 und landet auf 0 -- so hiessen zwei Karts
  // "Kart 1" und waren in der Chip-Leiste nicht mehr zu unterscheiden.
  // Deshalb rueckt der Default auf die naechste freie Nummer (Farbe folgt
  // mit). Selbst vergebene Namen bleiben unangetastet.
  function freeIdx(map, idx) {
    // Der 'default'-Platzhalter zaehlt nicht mit: er ist kein Kart, haelt aber
    // einen Meta-Eintrag "Kart 1" -- sonst finge die Nummerierung der echten
    // Karts (und der Demo) bei 2 an.
    const taken = Object.keys(map).filter(m => m !== 'default').map(m => map[m] && map[m].name);
    let i = Math.max(0, Number(idx) || 0);
    while (taken.indexOf('Kart ' + (i + 1)) >= 0) i++;
    return i;
  }

  function ensureMeta(map, mac, idx) {
    if (!map[mac]) return { entry: (map[mac] = metaDefaults(freeIdx(map, idx))), created: true };
    return { entry: map[mac], created: false };
  }

  // Phase 65: Der 'default'-Bucket ist ein Alt-Datum aus der Zeit vor
  // Multi-Kart, kein Kart. Stehen im Save daneben echte MACs, ist die
  // Adoption durch das erste echte Kart (store.js kartFor) nie mehr faellig
  // -- beide sind beim Laden schon da. Der Platzhalter blieb dann fuer immer
  // als zweiter Chip stehen, meist mit demselben Namen wie das echte Kart,
  // und belegte einen der vier Plaetze.
  // Hier erbt der erste echte MAC, was er nicht selbst hat, danach ist der
  // Platzhalter aus allen Maps weg. Gibt es noch kein echtes Kart, bleibt
  // alles stehen: dann ist die Adoption beim ersten Paket weiter zustaendig.
  // maps wird an Ort und Stelle bereinigt; -> true, wenn sich etwas geaendert
  // hat (der Aufrufer speichert dann).
  function mergeDefaultBucket(maps, defaultMac) {
    const dm = defaultMac || 'default';
    const m = maps || {};
    const all = [];
    for (const key of Object.keys(m)) {
      const map = m[key];
      if (!map || typeof map !== 'object') continue;
      for (const mac of Object.keys(map)) if (all.indexOf(mac) === -1) all.push(mac);
    }
    const heir = all.filter(mac => mac !== dm && !isDemoMac(mac))[0];
    if (!heir) return false;
    let changed = false;
    for (const key of Object.keys(m)) {
      const map = m[key];
      if (!map || typeof map !== 'object' || !map[dm]) continue;
      // Nur Luecken fuellen: eigene Kalibrierung, Motorstunden und
      // Statistik des echten Karts sind juenger als der Platzhalter.
      if (!map[heir]) map[heir] = map[dm];
      delete map[dm];
      changed = true;
    }
    return changed;
  }

  // Alt-Key rasi.kartMeta.v1 (kart-bar.js bis Phase 45): { mac: {name,color} }.
  // Nur in ein LEERES Ziel migrieren (idempotent); unbrauchbare Eintraege
  // ueberspringen; korruptes JSON -> false (Aufrufer laesst den Key stehen).
  function migrateLegacyMeta(map, legacyJson) {
    if (Object.keys(map).length || !legacyJson) return false;
    let legacy;
    try { legacy = JSON.parse(legacyJson); } catch (e) { return false; }
    if (!legacy || typeof legacy !== 'object') return false;
    let n = 0;
    for (const mac of Object.keys(legacy)) {
      const m = legacy[mac];
      if (!m || typeof m !== 'object' || typeof m.name !== 'string') continue;
      const color = (typeof m.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(m.color))
        ? m.color : PALETTE[0];
      map[mac] = { name: m.name, color: color, lastSeenAt: null };
      n++;
    }
    return n > 0;
  }

  // Anzeige-Reihenfolge der Karts-Seite: Session-Karts (Registry-Reihenfolge,
  // inkl. Demo) zuerst, dahinter offline-Roster nach lastSeenAt absteigend.
  function rosterMacs(metaMap, registryMacs) {
    // 'default' ist der DEFAULT_MAC-Platzhalter-Bucket der kart-registry
    // (vom ersten echten Kart adoptiert) -- nie ein echtes Kart, nie anzeigen.
    const online = registryMacs.filter(m => m !== 'default');
    const offline = Object.keys(metaMap)
      .filter(m => m !== 'default' && online.indexOf(m) === -1)
      .sort((a, b) => (metaMap[b].lastSeenAt || 0) - (metaMap[a].lastSeenAt || 0));
    return online.concat(offline);
  }

  function clampServiceH(v) { return Math.max(0, Math.min(500, Number(v) || 0)); }

  // Bewusst dupliziert zu kart-registry.makeKartState().calibration —
  // kart-registry bleibt dependency-frei; bei Feldaenderungen BEIDE pflegen.
  function calDefaults() {
    return { gxZero: 0, gyZero: 0, swapG: false, invertGx: false,
             invertGy: false, invertYaw: false, invertRollRate: false, rollZero: 0,
             mountUpsideDown: false };
  }

  // Phase 59: Karts aus bridge_status.karts[] nur uebernehmen, wenn die MAC
  // schon bekannt ist (Registry/Roster) oder laut age kuerzlich gefunkt hat.
  // Die Bridge meldet 99999 fuer "nie seit Boot" — reine NVS-Altlasten
  // erzeugen sonst bei jedem Connect Geister-Eintraege in der App.
  var ADOPT_MAX_AGE_MS = 60000;
  function shouldAdoptBridgeKart(info) {
    if (!info) return false;
    if (info.known) return true;
    return typeof info.age === 'number' && info.age < ADOPT_MAX_AGE_MS;
  }

  // config_ack-Zustellung (Phase 48): from_mac bestimmt das Fenster; Acks
  // alter Firmware ohne from_mac gehen an das zuletzt anfragende Fenster.
  // Kein passendes offenes Fenster -> null (Ack verwerfen).
  function ackTargetMac(fromMac, lastMac, openMacs) {
    const list = Array.isArray(openMacs) ? openMacs : [];
    const mac = fromMac || lastMac || null;
    return (mac && list.indexOf(mac) >= 0) ? mac : null;
  }

  // ESM-Export: Default-Objekt (Konvention der Objekt-Module, Phase 42)
  export default { PALETTE, isDemoMac, metaDefaults, ensureMeta, mergeDefaultBucket,
                   migrateLegacyMeta, rosterMacs, clampServiceH, calDefaults, ackTargetMac,
                   equipDefaults, equipFor, needsEquipDialog, shouldAdoptBridgeKart };
