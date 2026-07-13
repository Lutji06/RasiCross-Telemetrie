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
    return { name: 'Kart ' + (i + 1), color: PALETTE[i % PALETTE.length], lastSeenAt: null };
  }

  function ensureMeta(map, mac, idx) {
    if (!map[mac]) return { entry: (map[mac] = metaDefaults(idx)), created: true };
    return { entry: map[mac], created: false };
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
             invertGy: false, invertYaw: false, invertRollRate: false, rollZero: 0 };
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
  export default { PALETTE, isDemoMac, metaDefaults, ensureMeta,
                   migrateLegacyMeta, rosterMacs, clampServiceH, calDefaults, ackTargetMac };
