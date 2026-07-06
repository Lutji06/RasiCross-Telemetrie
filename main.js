const { app, BrowserWindow, ipcMain, powerSaveBlocker } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
// Geteilte Tile-Mathe (Bbox -> Tile-Liste) — dieselbe wie im Renderer
const RasiTiles = require("./tiles.js");

let SerialPort, ReadlineParser;
try {
  ({ SerialPort } = require("serialport"));
  ({ ReadlineParser } = require("@serialport/parser-readline"));
} catch(e) {
  console.error("serialport not available:", e.message);
}

let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch(e) {
  console.error("electron-updater not available:", e.message);
}

// Test-Isolation (Phase 41): Die Playwright-Smoke-Suite setzt
// RASI_TEST_USERDATA auf ein Wegwerf-Verzeichnis, damit localStorage,
// Tile-Cache und Crash-Aufnahme echte Nutzerdaten nie beruehren.
// Muss vor app.whenReady() laufen.
if (process.env.RASI_TEST_USERDATA) {
  app.setPath("userData", process.env.RASI_TEST_USERDATA);
}

let currentPort = null;
let mainWindow = null;

ipcMain.handle("serial:list", async () => {
  if (!SerialPort) return [];
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      friendlyName: p.friendlyName || p.manufacturer || p.path,
      manufacturer: p.manufacturer || ""
    }));
  } catch(e) { return []; }
});

ipcMain.handle("serial:open", async (event, portPath, baud) => {
  if (!SerialPort) throw new Error("serialport Modul nicht verfuegbar");
  if (currentPort && currentPort.isOpen) {
    try { await new Promise(r => currentPort.close(r)); } catch(e) {}
  }
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: portPath, baudRate: Number(baud) }, (err) => {
      if (err) { reject(new Error(err.message)); return; }
      currentPort = port;
      const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
      parser.on("data", (line) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("serial:line", line.trim());
      });
      port.on("close", () => {
        currentPort = null;
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("serial:close");
      });
      port.on("error", (err) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("serial:error", err.message);
      });
      resolve(true);
    });
  });
});

ipcMain.handle("serial:close", async () => {
  if (!currentPort) return true;
  return new Promise((resolve) => {
    currentPort.close(() => { currentPort = null; resolve(true); });
  });
});

ipcMain.handle("serial:write", async (event, line) => {
  if (currentPort && currentPort.isOpen) currentPort.write(line + "\n");
});

// ──────────────────────────────────────────────────────────────
// 3D-Kart-Modell file I/O (Phase 12)
// ──────────────────────────────────────────────────────────────
function kartPaths() {
  var dir = path.join(app.getPath("userData"), "karts");
  return { dir: dir, file: path.join(dir, "active.glb"), tmp: path.join(dir, "active.glb.tmp") };
}

ipcMain.handle("rasi-kart:save", async (event, uint8) => {
  try {
    var p = kartPaths();
    await fsp.mkdir(p.dir, { recursive: true });
    await fsp.writeFile(p.tmp, Buffer.from(uint8.buffer || uint8));
    await fsp.rename(p.tmp, p.file);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle("rasi-kart:load", async () => {
  try {
    var p = kartPaths();
    if (!fs.existsSync(p.file)) return { ok: false, error: "not-found" };
    var buf = await fsp.readFile(p.file);
    return { ok: true, buffer: new Uint8Array(buf) };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle("rasi-kart:clear", async () => {
  try {
    var p = kartPaths();
    if (fs.existsSync(p.file)) await fsp.unlink(p.file);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

// ──────────────────────────────────────────────────────────────
// Crash-sichere Aufnahme (Phase 24): der Renderer streamt NDJSON-
// Zeilen, Main haengt sie an eine Datei im userData-Verzeichnis an.
// before-quit loescht die Datei -- liegt sie beim naechsten Start
// noch da, war es ein Absturz und init() bietet Recovery an.
// ──────────────────────────────────────────────────────────────
function recCrashPath() {
  return path.join(app.getPath("userData"), "crash-recording.ndjson");
}
const REC_CRASH_MAX_BYTES = 256 * 1024 * 1024;
let recCrashBytes = 0;

ipcMain.handle("rasi-rec:start", async (event, headerLine) => {
  try {
    await fsp.writeFile(recCrashPath(), headerLine ? String(headerLine) + "\n" : "");
    recCrashBytes = 0;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle("rasi-rec:append", async (event, text) => {
  try {
    if (recCrashBytes > REC_CRASH_MAX_BYTES) return { ok: false, error: "limit" };
    const t = String(text || "");
    await fsp.appendFile(recCrashPath(), t);
    recCrashBytes += t.length;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle("rasi-rec:check", async () => {
  try {
    const p = recCrashPath();
    if (!fs.existsSync(p)) return { exists: false };
    const st = await fsp.stat(p);
    return { exists: true, size: st.size, mtimeMs: st.mtimeMs };
  } catch (e) {
    return { exists: false };
  }
});

ipcMain.handle("rasi-rec:read", async () => {
  try {
    return { ok: true, text: await fsp.readFile(recCrashPath(), "utf8") };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle("rasi-rec:clear", async () => {
  try {
    if (fs.existsSync(recCrashPath())) await fsp.unlink(recCrashPath());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
});

app.on("before-quit", () => {
  // Regulaeres Beenden: Crash-Datei entfernen. Nach einem Absturz
  // laeuft dieser Handler nie -> Datei bleibt fuer die Recovery liegen.
  try { fs.unlinkSync(recCrashPath()); } catch (e) {}
});

// ---------- OSM tile cache (Phase 17) ----------
const TILE_FETCH_TIMEOUT_MS = 5000;
const TILE_RATE_LIMIT_MS = 500;
const TILE_429_PAUSE_MS = 30000;

let _tileCancelFlag = false;
let _lastTileFetchAt = 0;

function _tileDir(host, z, x) {
  return path.join(app.getPath("userData"), "tiles", host, String(z), String(x));
}
function _tilePath(host, z, x, y) {
  return path.join(_tileDir(host, z, x), String(y) + ".png");
}

function _userAgent() {
  // package.json version is best-effort; fallback constant if read fails
  let v = "0.0.0";
  try { v = require("./package.json").version || v; } catch (_) {}
  return "RasiCross-Telemetry/" + v + " (+https://github.com/Lutji06/RasiCross-Telemetrie)";
}

function _httpGet(url) {
  return new Promise(function (resolve) {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? require("https") : require("http");
    const req = lib.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { "User-Agent": _userAgent(), "Accept": "image/png,image/*" },
      timeout: TILE_FETCH_TIMEOUT_MS,
    }, function (res) {
      if (res.statusCode === 429) {
        res.resume();
        return resolve({ ok: false, status: 429 });
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve({ ok: false, status: res.statusCode });
      }
      const chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () { resolve({ ok: true, buf: Buffer.concat(chunks) }); });
      res.on("error", function () { resolve({ ok: false, status: -1 }); });
    });
    req.on("timeout", function () { req.destroy(); resolve({ ok: false, status: -2 }); });
    req.on("error", function () { resolve({ ok: false, status: -3 }); });
  });
}

function _expandUrl(template, z, x, y) {
  return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

// Gemeinsamer Kern fuer rasi-tiles:fetch und rasi-tiles:cacheArea:
// Cache-Lookup, Rate-Limit-Gap, HTTP-GET, Best-Effort-Cache-Write.
// -> { ok:true, buf, fromCache } | { ok:false, status }
async function _fetchTileToCache(host, template, z, x, y) {
  const filePath = _tilePath(host, z, x, y);
  try {
    const buf = await fsp.readFile(filePath);
    return { ok: true, buf: buf, fromCache: true };
  } catch (_) { /* miss -> fetch */ }

  const sinceLast = Date.now() - _lastTileFetchAt;
  if (sinceLast < TILE_RATE_LIMIT_MS) {
    await new Promise(function (r) { setTimeout(r, TILE_RATE_LIMIT_MS - sinceLast); });
  }
  _lastTileFetchAt = Date.now();

  const res = await _httpGet(_expandUrl(template, z, x, y));
  if (!res.ok) return { ok: false, status: res.status };
  try {
    await fsp.mkdir(_tileDir(host, z, x), { recursive: true });
    await fsp.writeFile(filePath, res.buf);
  } catch (_) { /* disk error -> still return the data so render works */ }
  return { ok: true, buf: res.buf, fromCache: false };
}

// Tile-Liste fuer einen Zoom-Bereich — dieselbe Mathe wie der Renderer
// (RasiTiles.tilesForBbox, 1-Tile-Pad-Ring).
function _tilesForArea(bbox, zMin, zMax) {
  const out = [];
  for (let z = zMin; z <= zMax; z++) {
    const tiles = RasiTiles.tilesForBbox(bbox, z, 1);
    for (const t of tiles) out.push(t);
  }
  return out;
}

ipcMain.handle("rasi-tiles:fetch", async function (_e, args) {
  const host = String(args.host || "").trim();
  const z = args.z | 0, x = args.x | 0, y = args.y | 0;
  const template = String(args.urlTemplate || "");
  if (!host || !template) return { ok: false, error: "missing host or urlTemplate" };
  const r = await _fetchTileToCache(host, template, z, x, y);
  if (!r.ok) {
    if (r.status === 429) return { ok: false, retryAfterMs: TILE_429_PAUSE_MS };
    return { ok: false, error: "http " + r.status };
  }
  return { ok: true, dataUrl: "data:image/png;base64," + r.buf.toString("base64"), fromCache: r.fromCache };
});

ipcMain.handle("rasi-tiles:cacheArea", async function (e, args) {
  _tileCancelFlag = false;
  const host = String(args.host || "");
  const template = String(args.urlTemplate || "");
  const tilesToFetch = _tilesForArea(args.bbox || {}, args.zMin | 0, args.zMax | 0);
  let done = 0, errors = 0;
  const total = tilesToFetch.length;
  for (const t of tilesToFetch) {
    if (_tileCancelFlag) break;
    let r = await _fetchTileToCache(host, template, t.z, t.x, t.y);
    if (!r.ok && r.status === 429) {
      // 429: Pause, dann genau ein Retry (wie bisher)
      await new Promise(function (rr) { setTimeout(rr, TILE_429_PAUSE_MS); });
      r = await _fetchTileToCache(host, template, t.z, t.x, t.y);
    }
    if (r.ok) done++; else errors++;
    try { e.sender.send("rasi-tiles:progress", { done, total, errors }); } catch (_) {}
  }
  return { done, total, errors, cancelled: _tileCancelFlag };
});

ipcMain.handle("rasi-tiles:cancel", async function () {
  _tileCancelFlag = true;
  return { ok: true };
});

ipcMain.handle("rasi-tiles:areaStats", async function (_e, args) {
  const host = String(args.host || "");
  const tiles = _tilesForArea(args.bbox || {}, args.zMin | 0, args.zMax | 0);
  let cached = 0, missing = 0, bytes = 0;
  for (const t of tiles) {
    try {
      const st = await fsp.stat(_tilePath(host, t.z, t.x, t.y));
      cached++;
      bytes += st.size;
    } catch (_) {
      missing++;
    }
  }
  return { cached, missing, bytes, total: tiles.length };
});

ipcMain.handle("rasi-tiles:clearAll", async function () {
  const root = path.join(app.getPath("userData"), "tiles");
  let deleted = 0, bytes = 0;
  async function walk(dir) {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(p);
        try { await fs.promises.rmdir(p); } catch (_) {}
      } else {
        try {
          const st = await fs.promises.stat(p);
          bytes += st.size;
          await fs.promises.unlink(p);
          deleted++;
        } catch (_) {}
      }
    }
  }
  await walk(root);
  return { deleted, bytes };
});

// ──────────────────────────────────────────────────────────────
// Auto-Update (Phase 25): prueft beim Start GitHub-Releases, laedt im
// Hintergrund, installiert beim Beenden oder per Button (quitAndInstall).
// Guards: Dev-Modus (nicht gepackt) und Portable-EXE koennen sich nicht
// selbst updaten -- der manuelle Check meldet den Grund an den Renderer.
// ──────────────────────────────────────────────────────────────
function updateGuardReason() {
  if (!autoUpdater) return "unavailable";
  if (!app.isPackaged) return "dev";
  if (process.env.PORTABLE_EXECUTABLE_FILE) return "portable";
  return null;
}

function sendUpdateStatus(s) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("rasi-update:status", s);
}

function initAutoUpdate() {
  if (updateGuardReason()) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (i) =>
    sendUpdateStatus({ state: "downloading", version: i && i.version }));
  autoUpdater.on("update-not-available", () =>
    sendUpdateStatus({ state: "uptodate", version: app.getVersion() }));
  autoUpdater.on("download-progress", (p) =>
    sendUpdateStatus({ state: "downloading", percent: Math.round(p.percent || 0) }));
  autoUpdater.on("update-downloaded", (i) =>
    sendUpdateStatus({ state: "ready", version: i && i.version }));
  autoUpdater.on("error", (e) =>
    sendUpdateStatus({ state: "error", message: String(e && e.message || e).slice(0, 200) }));
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 5000);
}

ipcMain.handle("rasi-update:check", async () => {
  const guard = updateGuardReason();
  if (guard) return { ok: false, reason: guard };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "error", message: String(e && e.message || e).slice(0, 200) };
  }
});

ipcMain.handle("rasi-update:install", async () => {
  if (updateGuardReason()) return { ok: false };
  // Installer wird VOR dem Quit gespawnt -- kompatibel mit dem
  // before-quit-Handler unten (saveData + app.exit).
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

ipcMain.handle("rasi-update:version", async () => ({
  version: app.getVersion(),
  guard: updateGuardReason(),
}));

// ============================================================
//  Display-Standby unterdruecken (Pit-Wall-Modus)
// ============================================================
let powerBlockerId = null;
ipcMain.handle("rasi-power:keepAwake", async (_e, on) => {
  if (on) {
    if (powerBlockerId == null || !powerSaveBlocker.isStarted(powerBlockerId)) {
      powerBlockerId = powerSaveBlocker.start("prevent_display_sleep");
    }
  } else if (powerBlockerId != null) {
    if (powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
  return powerBlockerId != null;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "RasiCross Telemetry",
    icon: path.join(__dirname, "icon.ico"),
    backgroundColor: "#08080a",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile("RasiCross_Telemetry.html");
}

app.whenReady().then(() => {
  createWindow();
  initAutoUpdate();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => { app.quit(); });

let isQuitting = false;
app.on("before-quit", async (event) => {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  try {
    // Renderer Zeit geben, saveData() durchlaufen zu lassen
    const saves = BrowserWindow.getAllWindows().map(w =>
      w.webContents
        .executeJavaScript('if(typeof saveData==="function") saveData();')
        .catch(() => {})
    );
    await Promise.all(saves);
    // Erst danach den seriellen Port sauber schliessen
    if (currentPort && currentPort.isOpen) {
      await new Promise(r => currentPort.close(() => r()));
    }
  } catch(e) { /* still proceed with quit */ }
  app.exit(0);
});
