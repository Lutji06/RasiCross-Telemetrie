'use strict';
// ============================================================
//  karts3d.js — 3D Kart G-Viewer (RasiCross)
//  UMD-style: pure helpers exported via module.exports for
//  node:test; DOM/WebGL wrapper attached to window.RasiKart3D
//  when running in a browser with THREE available.
//  Dependency-free at module top; the DOM part is gated by
//  `typeof THREE !== 'undefined'` (see Task 3).
//  Loaded order in HTML:
//    geo.js -> replay.js -> vendor/three.min.js -> karts3d.js
//      -> rasicross.js
//  Note: Three.js r152 prints a one-time console.warn on load
//  ("Scripts build/three.js and build/three.min.js are deprecated...")
//  — that originates inside vendor/three.min.js and is expected.
// ============================================================

// ── Pure helpers (testable under node:test) ────────────────

// pitchFromG: atan2(gx, sqrt(gy^2 + gz^2)).
// Returns radians. Stillstand (0,0,0) -> 0 (JS atan2(0,0) === 0).
function pitchFromG(gx, gy, gz) {
  var x = Number(gx) || 0, y = Number(gy) || 0, z = Number(gz) || 0;
  return Math.atan2(x, Math.sqrt(y * y + z * z));
}

// rollFromG: atan2(gy, sqrt(gx^2 + gz^2)).
function rollFromG(gx, gy, gz) {
  var x = Number(gx) || 0, y = Number(gy) || 0, z = Number(gz) || 0;
  return Math.atan2(y, Math.sqrt(x * x + z * z));
}

// yawIntegrate: prev + dps * dt/1000 * pi/180, wrapped into (-pi, pi].
// NaN/Inf in dps or dtMs -> returns prev unchanged (no propagation).
function yawIntegrate(prevRad, yawDegPerS, dtMs) {
  var p = Number(prevRad);
  if (!isFinite(p)) p = 0;
  var d = Number(yawDegPerS), t = Number(dtMs);
  if (!isFinite(d) || !isFinite(t)) return p;
  if (d === 0) return p;  // identity: skip wrap to avoid float drift
  var next = p + d * (t / 1000) * (Math.PI / 180);
  // Wrap into [-pi, pi] (both endpoints valid; pi stays pi, not folded to -pi).
  var twoPi = Math.PI * 2;
  // Standard modulo into [0, 2pi), then shift to (-pi, pi].
  next = ((next % twoPi) + twoPi) % twoPi; // now in [0, 2pi)
  if (next > Math.PI) next -= twoPi;        // shift: values above pi become negative
  return next;
}

// gViewReducer: clamp current to '2d'/'3d', then apply action.
// Unknown action -> identity (post-clamp).
function gViewReducer(current, action) {
  var cur = (current === '3d') ? '3d' : '2d';
  if (action === 'toggle') return cur === '2d' ? '3d' : '2d';
  if (action === 'set:2d') return '2d';
  if (action === 'set:3d') return '3d';
  return cur;
}

// computeAutoFitScale: returns the uniform scale factor that fits a
// bounding box of (sx,sy,sz) into a target diagonal. Degenerate inputs
// (NaN, zero, negative) -> 1 (no scaling).
function computeAutoFitScale(sx, sy, sz, targetDiagonal) {
  var x = Number(sx), y = Number(sy), z = Number(sz), t = Number(targetDiagonal);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(t)) return 1;
  if (x <= 0 || y <= 0 || z <= 0 || t <= 0) return 1;
  var diag = Math.sqrt(x * x + y * y + z * z);
  if (diag <= 0) return 1;
  return t / diag;
}

// kartModelYawReducer: clamp current to one of {0,90,180,270}, then apply
// action ('next' / 'prev' / 'set:0' / 'set:90' / 'set:180' / 'set:270').
// Invalid current -> 0. Unknown action -> identity (post-clamp).
function kartModelYawReducer(current, action) {
  var c = (current === 90 || current === 180 || current === 270) ? current : 0;
  if (action === 'next') return (c + 90) % 360;
  if (action === 'prev') return (c + 270) % 360;
  if (action === 'set:0')   return 0;
  if (action === 'set:90')  return 90;
  if (action === 'set:180') return 180;
  if (action === 'set:270') return 270;
  return c;
}

// driftArrowSpec: Darstellungs-Parameter fuer den 3D-Drift-Pfeil aus dem
// Phase-18-Driftzustand. Rein, wirft nie. Laenge ~ Drift-Index (0..2 -> 0..maxLen),
// Richtung = Vorzeichen der gemessenen Gierrate, Farbe je Status. 'n/a'/fehlende
// Daten -> unsichtbar.
var DRIFT_3D_COLOR = {
  grip:       0x3ee08a,   // gruen  (wie _zoneColor green)
  oversteer:  0xffa336,   // amber  (wie _zoneColor orange)
  understeer: 0x7aa2f7,   // blau   (wie 2D-Badge --blue)
  counter:    0xff5470    // rot    (wie _zoneColor red)
};
function driftArrowSpec(status, index, yawRate, opts) {
  opts = opts || {};
  var maxLen = Number(opts.maxLen) || 1.6;
  var minLen = Number(opts.minLen) || 0.06;
  var color = DRIFT_3D_COLOR[status];
  var idx = Number(index);
  if (color == null || index == null || !isFinite(idx)) {
    return { visible: false, length: 0, dirSign: 0, color: 0xffffff };
  }
  var clamped = Math.max(0, Math.min(2, idx));
  var length = clamped / 2 * maxLen;
  var dirSign = (Number(yawRate) || 0) >= 0 ? 1 : -1;
  return {
    visible: length > 0.05,
    length: Math.max(length, minLen),
    dirSign: dirSign,
    color: color
  };
}

// ── DOM/WebGL wrapper (gated by typeof THREE) ──────────────
// All fields prefixed with `_` to mark module-internal state.
var _scene = null;
var _camera = null;
var _renderer = null;
var _canvas = null;
var _kartGroup = null;
var _arrow = null;          // G-vector arrow on the floor
var _gzBar = null;          // Gz-glow vertical bar mesh
var _driftArrow = null;     // Drift yaw-rate arrow (Phase 18 -> 3D)
var _gScale = 3;
var _pitch = 0;             // rad, EMA-smoothed
var _roll = 0;              // rad, EMA-smoothed
var _yaw = 0;               // rad, integrated
var _lastTickMs = 0;
var _rafId = 0;
var _running = false;
var _disposed = false;
var _failed = false;        // true after init failure (no THREE / no WebGL)
var _curW = 0;              // last-applied canvas size (logical CSS px) + DPR;
var _curH = 0;              // resize is keyed off these, never off the floored
var _curDpr = 1;            // backing-buffer size (see update()).
var _tmpEuler = null;       // reused each update() to avoid hot-path allocation
var _tmpArrowDir = null;    // reused each update() to avoid hot-path allocation

var _EMA_ALPHA = 0.2;
var _customModelHeading = 0;  // degrees, applied as Y-Euler offset; from kartModelYawReducer

// Zone color helper — mirrors the 2D G-meter's green/orange/red bands.
// Thresholds are absolute (1G / 2G), matching the 2D meter's behaviour;
// they intentionally do NOT scale with gScale.
function _zoneColor(magnitude) {
  if (magnitude < 1) return 0x3ee08a;          // --green
  if (magnitude < 2) return 0xffa336;          // --orange
  return 0xff5470;                              // --red
}

// Build the primitive kart. Lowpoly, no external assets.
function _buildKart() {
  var group = new THREE.Group();

  var chassisMat = new THREE.MeshStandardMaterial({ color: 0x4cc2ff, roughness: 0.55 });
  var seatMat    = new THREE.MeshStandardMaterial({ color: 0x222a3a, roughness: 0.8 });
  var tireMat    = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  var poleMat    = new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.5 });

  var chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.4, 1.2), chassisMat);
  chassis.position.set(0, 0.4, 0);
  group.add(chassis);

  var seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.7), seatMat);
  seat.position.set(-0.2, 0.9, 0);
  group.add(seat);

  var col = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6), poleMat);
  col.position.set(0.5, 0.8, 0);
  col.rotation.z = Math.PI / 5;
  group.add(col);

  // 4 wheels — Cylinder default-axis is Y; rotate around X to lay flat.
  var wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.25, 16);
  var positions = [[0.8, 0.3,  0.65], [0.8, 0.3, -0.65], [-0.8, 0.3, 0.65], [-0.8, 0.3, -0.65]];
  for (var i = 0; i < positions.length; i++) {
    var w = new THREE.Mesh(wheelGeo, tireMat);
    w.position.set(positions[i][0], positions[i][1], positions[i][2]);
    w.rotation.x = Math.PI / 2;
    group.add(w);
  }

  return group;
}

// Idempotent. Re-init disposes the previous scene first.
function init(canvasEl, opts) {
  if (typeof THREE === 'undefined') { _failed = true; return false; }
  opts = opts || {};
  _gScale = Number(opts.gScale) || 3;
  if (_renderer) { dispose(); }

  try {
    _renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
  } catch (e) {
    _failed = true;
    return false;
  }
  _canvas = canvasEl;
  _curW = canvasEl.clientWidth || 200;
  _curH = canvasEl.clientHeight || 200;
  _curDpr = window.devicePixelRatio || 1;
  _renderer.setPixelRatio(_curDpr);
  _renderer.setSize(_curW, _curH, false);
  _renderer.setClearColor(0x000000, 0);

  _scene = new THREE.Scene();
  _camera = new THREE.PerspectiveCamera(45, _curW / _curH, 0.1, 50);
  _camera.position.set(3, 2.5, 3);
  _camera.lookAt(0, 0.4, 0);

  // Per-frame scratch objects, created here so THREE is guaranteed present.
  _tmpEuler = new THREE.Euler();
  _tmpArrowDir = new THREE.Vector3();

  // Lighting
  _scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  var dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(4, 6, 3);
  _scene.add(dir);

  // Floor plate (semi-transparent, gives a visible shadow surface)
  var floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 3),
    new THREE.MeshBasicMaterial({ color: 0x1a1f2c, transparent: true, opacity: 0.35 })
  );
  floor.rotation.x = -Math.PI / 2;
  _scene.add(floor);

  // Kart
  _kartGroup = _buildKart();
  _scene.add(_kartGroup);

  // G-vector arrow (origin slightly above floor, default dir +X, length tiny)
  _arrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0.01, 0),
    0.01,
    0x3ee08a,
    0.2, 0.12
  );
  _scene.add(_arrow);

  // Gz-glow vertical bar (right of the kart)
  _gzBar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 1.0, 12),
    new THREE.MeshBasicMaterial({ color: 0x3ee08a, transparent: true, opacity: 0.7 })
  );
  _gzBar.position.set(0, 0.5, 1.4);
  _gzBar.scale.y = 0.001;
  _scene.add(_gzBar);

  // Drift yaw-rate arrow (raised above the kart, world-fixed like _arrow).
  _driftArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1.4, 0),
    0.01,
    0x3ee08a,
    0.2, 0.12
  );
  _driftArrow.visible = false;
  _scene.add(_driftArrow);

  _disposed = false;
  _lastTickMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  try {
    _renderer.render(_scene, _camera);  // one initial frame so the canvas isn't empty
  } catch (e) {
    _failed = true;
    dispose();                 // free the scene/renderer built above
    return false;
  }
  _failed = false;
  return true;
}

// One frame. `imu` = { gx, gy, gz, yaw, dtMs? }. dtMs is computed from the
// internal clock if not supplied.
function update(imu) {
  if (_failed || !_renderer || _disposed) return;
  imu = imu || {};
  var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  var dt = Number(imu.dtMs);
  if (!isFinite(dt) || dt <= 0) dt = now - _lastTickMs;
  if (dt > 250) dt = 250;  // clamp on long stalls
  _lastTickMs = now;

  var gx = Number(imu.gx) || 0;
  var gy = Number(imu.gy) || 0;
  var gz = Number(imu.gz) || 0;

  var targetPitch = pitchFromG(gx, gy, gz);
  var targetRoll  = rollFromG(gx, gy, gz);
  _pitch += (targetPitch - _pitch) * _EMA_ALPHA;
  _roll  += (targetRoll  - _roll)  * _EMA_ALPHA;
  _yaw    = yawIntegrate(_yaw, Number(imu.yaw) || 0, dt);

  // YXZ Euler: yaw around Y, pitch around X, roll around Z.
  // Static heading offset (Phase 12) is added on top of the integrated yaw.
  var headingRad = _customModelHeading * Math.PI / 180;
  _tmpEuler.set(_pitch, _yaw + headingRad, _roll, 'YXZ');
  _kartGroup.quaternion.setFromEuler(_tmpEuler);

  // G-vector on the floor: longitudinal Gx -> -Z (forward), lateral Gy -> +X (left).
  var lateralMag = Math.sqrt(gx * gx + gy * gy);
  var lenNorm = Math.min(1, lateralMag / _gScale) * 1.5;
  if (lenNorm < 0.02) {
    _arrow.visible = false;
  } else {
    _arrow.visible = true;
    _tmpArrowDir.set(gy, 0, -gx);
    if (_tmpArrowDir.lengthSq() > 0) _tmpArrowDir.normalize(); else _tmpArrowDir.set(1, 0, 0);
    _arrow.setDirection(_tmpArrowDir);
    _arrow.setLength(lenNorm, 0.2, 0.12);
    _arrow.setColor(_zoneColor(lateralMag));
  }

  // Gz-glow: signed bar.
  var gzMag = Math.abs(gz);
  var scaleY = Math.max(0.001, Math.min(1, gzMag / _gScale));
  _gzBar.scale.y = scaleY;
  _gzBar.position.y = (gz >= 0 ? 0.5 * scaleY : -0.5 * scaleY) + 0.001;
  _gzBar.material.color.setHex(_zoneColor(gzMag));
  _gzBar.material.opacity = 0.3 + 0.6 * scaleY;

  // Drift-Pfeil: gemessene Gierrate-Abweichung. imu.drift = {status,index}
  // aus RasiDrift.analyze; imu.yaw liefert das Vorzeichen (Drehrichtung).
  var dInfo = imu.drift || {};
  var dSpec = driftArrowSpec(dInfo.status, dInfo.index, imu.yaw);
  if (!dSpec.visible) {
    _driftArrow.visible = false;
  } else {
    _driftArrow.visible = true;
    _tmpArrowDir.set(dSpec.dirSign, 0, 0);
    _driftArrow.setDirection(_tmpArrowDir);
    _driftArrow.setLength(dSpec.length, 0.2, 0.12);
    _driftArrow.setColor(dSpec.color);
  }

  // Re-fit if the canvas client size or device pixel ratio changed (cheap
  // check, no listeners). Comparison is against our own last-applied logical
  // size — never the floored backing-buffer size — so a fractional
  // devicePixelRatio (Windows display scaling) cannot trigger a resize on
  // every frame.
  var w = _canvas.clientWidth | 0, h = _canvas.clientHeight | 0;
  var dpr = window.devicePixelRatio || 1;
  if (w && h && (w !== _curW || h !== _curH || dpr !== _curDpr)) {
    _curW = w; _curH = h; _curDpr = dpr;
    _camera.aspect = w / h;
    _camera.updateProjectionMatrix();
    _renderer.setPixelRatio(dpr);
    _renderer.setSize(w, h, false);
  }

  _renderer.render(_scene, _camera);
}

function _loop() {
  if (!_running || _failed) return;
  // The rAF loop is a no-op heartbeat; rendering is driven entirely by
  // consumer-side update() calls (one per telemetry frame). Keeping the
  // chain alive lets future logic hook here (e.g., autonomous pose drift)
  // without churning GPU cycles in the meantime.
  _rafId = (typeof requestAnimationFrame !== 'undefined')
    ? requestAnimationFrame(_loop) : 0;
}

function start() {
  if (_failed || !_renderer || _disposed || _running) return;
  _running = true;
  _lastTickMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (typeof requestAnimationFrame !== 'undefined') {
    _rafId = requestAnimationFrame(_loop);
  }
}

function stop() {
  _running = false;
  if (_rafId && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(_rafId);
  }
  _rafId = 0;
}

function resetYaw() {
  _yaw = 0;
}

function dispose() {
  stop();
  _disposed = true;
  try {
    if (_renderer && _renderer.dispose) _renderer.dispose();
    if (_scene) {
      _scene.traverse(function (obj) {
        if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(function (m) { m.dispose && m.dispose(); });
          } else if (obj.material.dispose) {
            obj.material.dispose();
          }
        }
      });
    }
  } catch (e) { /* ignore */ }
  _scene = _camera = _renderer = _canvas = null;
  _kartGroup = _arrow = _gzBar = _driftArrow = null;
  _tmpEuler = _tmpArrowDir = null;
}

function isFailed() { return _failed; }

// ── Custom-model API (Phase 12) ────────────────────────────
//
// loadCustomModel(arrayBuffer, headingDeg) -> Promise<{ok, error?}>
// Parses a glTF/GLB binary, auto-fits the result to the primitive kart's
// bounding-box diagonal (~2.37), centers X/Z on origin + lifts Y so the
// model's lowest point sits on the floor plane (y=0), wraps any non-
// MeshStandardMaterial meshes with a default standard material so they
// render under our lighting, then replaces the existing _kartGroup.
// Disposes the previous group's geometry/materials before swapping.
function loadCustomModel(arrayBuffer, headingDeg) {
  return new Promise(function (resolve) {
    if (typeof THREE === 'undefined' || typeof THREE.GLTFLoader === 'undefined') {
      return resolve({ ok: false, error: 'no-loader' });
    }
    if (_failed || _disposed || !_scene) {
      return resolve({ ok: false, error: 'not-initialised' });
    }
    var loader = new THREE.GLTFLoader();
    try {
      loader.parse(arrayBuffer, '', function (gltf) {
        try {
          var scene = gltf && gltf.scene ? gltf.scene : null;
          if (!scene) return resolve({ ok: false, error: 'parse-failed' });

          // Bounding box (pre-scale).
          var bbox = new THREE.Box3().setFromObject(scene);
          var size = bbox.getSize(new THREE.Vector3());
          var center = bbox.getCenter(new THREE.Vector3());
          var s = computeAutoFitScale(size.x, size.y, size.z, Math.sqrt(4 + 0.16 + 1.44));
          scene.scale.setScalar(s);
          // Centre X/Z, anchor bottom on floor (y=0).
          scene.position.set(-center.x * s, -bbox.min.y * s, -center.z * s);

          // Material fallback: any Mesh without a proper colored material
          // gets wrapped with a default MeshStandardMaterial so it remains
          // visible under our AmbientLight + DirectionalLight.
          scene.traverse(function (obj) {
            if (obj.isMesh && (!obj.material || !obj.material.color)) {
              if (obj.material && obj.material.dispose) obj.material.dispose();
              obj.material = new THREE.MeshStandardMaterial({ color: 0x4cc2ff, roughness: 0.6 });
            }
          });

          // Dispose old group, swap in the new one.
          _disposeGroup(_kartGroup);
          _scene.remove(_kartGroup);
          _kartGroup = scene;
          _scene.add(_kartGroup);
          _customModelHeading = kartModelYawReducer(headingDeg, 'set:' + headingDeg);
          resolve({ ok: true });
        } catch (e) {
          resolve({ ok: false, error: 'apply-failed' });
        }
      }, function (_err) {
        resolve({ ok: false, error: 'parse-failed' });
      });
    } catch (e) {
      resolve({ ok: false, error: 'parse-failed' });
    }
  });
}

// resetToPrimitive: dispose the current _kartGroup, rebuild the primitive.
// Heading offset is reset to 0.
function resetToPrimitive() {
  if (_failed || _disposed || !_scene) return;
  _disposeGroup(_kartGroup);
  _scene.remove(_kartGroup);
  _kartGroup = _buildKart();
  _scene.add(_kartGroup);
  _customModelHeading = 0;
}

// setHeadingOffset: clamp via kartModelYawReducer and store. Effective on
// the next update() frame (no immediate re-render — the rAF tick handles it).
function setHeadingOffset(headingDeg) {
  _customModelHeading = kartModelYawReducer(headingDeg, 'set:' + headingDeg);
}

// Dispose helper: walk a group and free geometry/material GPU resources.
function _disposeGroup(group) {
  if (!group || !group.traverse) return;
  try {
    group.traverse(function (obj) {
      if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(function (m) { m.dispose && m.dispose(); });
        } else if (obj.material.dispose) {
          obj.material.dispose();
        }
      }
    });
  } catch (e) { /* ignore */ }
}

// ── UMD-style export ───────────────────────────────────────
(function () {
  var api = {
    pitchFromG: pitchFromG,
    rollFromG: rollFromG,
    yawIntegrate: yawIntegrate,
    gViewReducer: gViewReducer,
    computeAutoFitScale: computeAutoFitScale,
    kartModelYawReducer: kartModelYawReducer,
    driftArrowSpec: driftArrowSpec,
    init: init,
    update: update,
    start: start,
    stop: stop,
    resetYaw: resetYaw,
    dispose: dispose,
    isFailed: isFailed,
    loadCustomModel: loadCustomModel,
    resetToPrimitive: resetToPrimitive,
    setHeadingOffset: setHeadingOffset
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.RasiKart3D = api; }
})();
