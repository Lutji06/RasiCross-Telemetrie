const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;

let SerialPort, ReadlineParser;
try {
  ({ SerialPort } = require("serialport"));
  ({ ReadlineParser } = require("@serialport/parser-readline"));
} catch(e) {
  console.error("serialport not available:", e.message);
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

ipcMain.handle("rasi-tiles:fetch", async function (_e, args) {
  const host = String(args.host || "").trim();
  const z = args.z | 0, x = args.x | 0, y = args.y | 0;
  const template = String(args.urlTemplate || "");
  if (!host || !template) return { ok: false, error: "missing host or urlTemplate" };

  const filePath = _tilePath(host, z, x, y);
  try {
    const buf = await fs.promises.readFile(filePath);
    return { ok: true, dataUrl: "data:image/png;base64," + buf.toString("base64"), fromCache: true };
  } catch (_) { /* miss -> fetch */ }

  // Rate-limit gap
  const sinceLast = Date.now() - _lastTileFetchAt;
  if (sinceLast < TILE_RATE_LIMIT_MS) {
    await new Promise(function (r) { setTimeout(r, TILE_RATE_LIMIT_MS - sinceLast); });
  }
  _lastTileFetchAt = Date.now();

  const url = _expandUrl(template, z, x, y);
  const res = await _httpGet(url);
  if (!res.ok) {
    if (res.status === 429) return { ok: false, retryAfterMs: TILE_429_PAUSE_MS };
    return { ok: false, error: "http " + res.status };
  }
  try {
    await fs.promises.mkdir(_tileDir(host, z, x), { recursive: true });
    await fs.promises.writeFile(filePath, res.buf);
  } catch (e) { /* disk error -> still return the data so render works */ }
  return { ok: true, dataUrl: "data:image/png;base64," + res.buf.toString("base64"), fromCache: false };
});

ipcMain.handle("rasi-tiles:cacheArea", async function (e, args) {
  _tileCancelFlag = false;
  const host = String(args.host || "");
  const template = String(args.urlTemplate || "");
  const bbox = args.bbox || {};
  const zMin = args.zMin | 0, zMax = args.zMax | 0;
  // Build the tile list inline (same math as renderer's RasiTiles.tilesForBbox + 1-tile pad)
  const tilesToFetch = [];
  for (let z = zMin; z <= zMax; z++) {
    const m = Math.pow(2, z);
    const x0 = Math.floor(((bbox.minLon + 180) / 360) * 256 * m / 256) - 1;
    const x1 = Math.floor(((bbox.maxLon + 180) / 360) * 256 * m / 256) + 1;
    const lat2y = function (lat) {
      const r = lat * Math.PI / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * m);
    };
    const y0 = lat2y(bbox.maxLat) - 1;
    const y1 = lat2y(bbox.minLat) + 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= m || y >= m) continue;
        tilesToFetch.push({ z, x, y });
      }
    }
  }
  let done = 0, errors = 0;
  const total = tilesToFetch.length;
  for (const t of tilesToFetch) {
    if (_tileCancelFlag) break;
    const r = await new Promise(function (resolve) {
      // Reuse the fetch handler logic by invoking the same internal path
      (async function () {
        const filePath = _tilePath(host, t.z, t.x, t.y);
        try {
          await fs.promises.access(filePath);
          resolve({ ok: true, fromCache: true });
          return;
        } catch (_) {}
        const sinceLast = Date.now() - _lastTileFetchAt;
        if (sinceLast < TILE_RATE_LIMIT_MS) {
          await new Promise(function (rr) { setTimeout(rr, TILE_RATE_LIMIT_MS - sinceLast); });
        }
        _lastTileFetchAt = Date.now();
        const httpRes = await _httpGet(_expandUrl(template, t.z, t.x, t.y));
        if (!httpRes.ok) {
          if (httpRes.status === 429) {
            await new Promise(function (rr) { setTimeout(rr, TILE_429_PAUSE_MS); });
            const retry = await _httpGet(_expandUrl(template, t.z, t.x, t.y));
            if (!retry.ok) { resolve({ ok: false }); return; }
            try {
              await fs.promises.mkdir(_tileDir(host, t.z, t.x), { recursive: true });
              await fs.promises.writeFile(filePath, retry.buf);
            } catch (_) {}
            resolve({ ok: true, fromCache: false });
            return;
          }
          resolve({ ok: false });
          return;
        }
        try {
          await fs.promises.mkdir(_tileDir(host, t.z, t.x), { recursive: true });
          await fs.promises.writeFile(filePath, httpRes.buf);
        } catch (_) {}
        resolve({ ok: true, fromCache: false });
      })();
    });
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
  const bbox = args.bbox || {};
  const zMin = args.zMin | 0, zMax = args.zMax | 0;
  let cached = 0, missing = 0, bytes = 0, total = 0;
  for (let z = zMin; z <= zMax; z++) {
    const m = Math.pow(2, z);
    const x0 = Math.floor(((bbox.minLon + 180) / 360) * m) - 1;
    const x1 = Math.floor(((bbox.maxLon + 180) / 360) * m) + 1;
    const lat2y = function (lat) {
      const r = lat * Math.PI / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * m);
    };
    const y0 = lat2y(bbox.maxLat) - 1;
    const y1 = lat2y(bbox.minLat) + 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= m || y >= m) continue;
        total++;
        try {
          const st = await fs.promises.stat(_tilePath(host, z, x, y));
          cached++;
          bytes += st.size;
        } catch (_) {
          missing++;
        }
      }
    }
  }
  return { cached, missing, bytes, total };
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
