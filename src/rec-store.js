'use strict';
// ============================================================
//  RasiCross -- rec-store.js  (IndexedDB-Ablage fuer Rennen-Aufnahmen)
//  Persistiert den Aufnahme-Ausschnitt eines beendeten Rennens, damit
//  der Replay-Button auch nach einem App-Neustart funktioniert.
//  Reines IO-Modul (window.RasiRecStore), Promise-API: ohne IndexedDB
//  oder bei Fehlern lehnen die Promises ab und die Aufrufer degradieren
//  auf das bisherige Nur-RAM-Verhalten.
// ============================================================
  var DB_NAME = 'rasicross_recordings';
  var DB_VERSION = 1;
  var STORE = 'race_recordings';
  var MAX_RECORDINGS = 20;   // Speicher-Deckel: aelteste Aufnahmen fliegen raus

  function available() {
    try { return typeof indexedDB !== 'undefined' && !!indexedDB; }
    catch (e) { return false; }
  }

  function _open() {
    return new Promise(function (resolve, reject) {
      if (!available()) { reject(new Error('IndexedDB nicht verfuegbar')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'raceId' });
          os.createIndex('savedAt', 'savedAt');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open fehlgeschlagen')); };
    });
  }

  function _tx(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, mode);
      var out = fn(tx.objectStore(STORE));
      tx.oncomplete = function () { db.close(); resolve(out ? out.result : undefined); };
      tx.onerror = function () { db.close(); reject(tx.error || new Error('IndexedDB Transaktion fehlgeschlagen')); };
      tx.onabort = function () { db.close(); reject(tx.error || new Error('IndexedDB Transaktion abgebrochen')); };
    });
  }

  // Alle gespeicherten Renn-IDs (fuer den Button-Zustand beim Start).
  function keys() {
    return _open().then(function (db) {
      return _tx(db, 'readonly', function (os) { return os.getAllKeys(); });
    });
  }

  // Aufnahme eines Rennens ablegen/ersetzen. Resolved mit der Liste der
  // dabei verdraengten alten Renn-IDs (Deckel MAX_RECORDINGS).
  function put(raceId, packets, meta) {
    meta = meta || {};
    return _open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var os = tx.objectStore(STORE);
        var dropped = [];
        os.put({
          raceId: String(raceId),
          savedAt: Date.now(),
          name: meta.name || '',
          count: packets.length,
          packets: packets
        });
        var cntReq = os.count();
        cntReq.onsuccess = function () {
          var excess = cntReq.result - MAX_RECORDINGS;
          if (excess <= 0) return;
          // savedAt-Index laeuft aufsteigend: aelteste zuerst loeschen.
          var cur = os.index('savedAt').openKeyCursor();
          cur.onsuccess = function () {
            var c = cur.result;
            if (!c || excess <= 0) return;
            if (String(c.primaryKey) !== String(raceId)) {
              dropped.push(String(c.primaryKey));
              os.delete(c.primaryKey);
              excess--;
            }
            c.continue();
          };
        };
        tx.oncomplete = function () { db.close(); resolve(dropped); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('IndexedDB put fehlgeschlagen')); };
        tx.onabort = function () { db.close(); reject(tx.error || new Error('IndexedDB put abgebrochen')); };
      });
    });
  }

  function get(raceId) {
    return _open().then(function (db) {
      return _tx(db, 'readonly', function (os) { return os.get(String(raceId)); });
    });
  }

  function remove(raceId) {
    return _open().then(function (db) {
      return _tx(db, 'readwrite', function (os) { return os.delete(String(raceId)); });
    });
  }

  function clear() {
    return _open().then(function (db) {
      return _tx(db, 'readwrite', function (os) { return os.clear(); });
    });
  }

  // ESM-Export (Phase 42): Default-Objekt = bisheriges window.RasiRecStore
  export default {
    available: available, keys: keys, put: put, get: get,
    remove: remove, clear: clear, MAX_RECORDINGS: MAX_RECORDINGS
  };
