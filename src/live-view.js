'use strict';
/*!
 * live-view.js — pure Logik fuer die Seiten des Live-Tabs (Phase 65):
 *   Seite 0 = Uebersicht, Seite 1..n = je ein Kart.
 * Loest liveViewAutoReducer aus Phase 55 ab: Die Uebersicht ist jetzt
 * Seite 1 eines Blaetterwerks und braucht keine Start-Automatik mehr.
 * Reines Modul — kein DOM, keine Seiteneffekte, wirft nie.
 */

function _clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Leitet aus Kart-Liste und gewuenschter Seite die gueltige Seite ab.
//   macs    : MAC-Liste in Reihenfolge der Chip-Leiste
//   page    : gewuenschte Seite (0 = Uebersicht)
//   wantMac : optional — dieses Kart anzeigen; gewinnt ueber page
// -> { page, view, mac }
function resolvePage(a) {
  const o = a || {};
  const macs = Array.isArray(o.macs) ? o.macs.filter(m => typeof m === 'string') : [];
  const n = macs.length;
  // Ohne zweites Kart gibt es nichts zu vergleichen -- die Uebersicht
  // entfaellt, damit Einzelfahrer nicht durch eine Ein-Kachel-Seite muessen.
  if (n <= 1) return { page: 1, view: 'single', mac: n ? macs[0] : null };
  let page;
  if (typeof o.wantMac === 'string' && o.wantMac) {
    const i = macs.indexOf(o.wantMac);
    // Unbekanntes Kart (gerade verschwunden): zurueck auf die Uebersicht,
    // statt stumm ein fremdes Kart anzuzeigen.
    page = i < 0 ? 0 : i + 1;
  } else {
    const raw = Number(o.page);
    page = _clamp(isFinite(raw) ? Math.trunc(raw) : 0, 0, n);
  }
  return page === 0
    ? { page: 0, view: 'overview', mac: null }
    : { page: page, view: 'single', mac: macs[page - 1] };
}

export default { resolvePage };
