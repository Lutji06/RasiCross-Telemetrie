'use strict';
/*!
 * dom-targets.js — pure lookup of logical telemetry keys to DOM IDs.
 *
 * Why: Several values (Speed, RPM, lap time, …) live on both #tab-live and
 * #tab-detail. DOM IDs are unique per document, so the Live copies get an
 * "Live" suffix. Renderers in rasicross.js call setTextShared / setHtmlShared
 * which use this map to write to every relevant DOM node.
 *
 * Pure module — no DOM access, no side effects, safe to unit-test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DomTargets = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const SHARED_ID_MAP = Object.freeze({
    speed:    ['kSpeed',    'kSpeedLive'],
    speedMax: ['kSpeedMax', 'kSpeedMaxLive'],
    spdSrc:   ['spdSrcTag', 'spdSrcTagLive'],
    rpm:      ['kRpm',      'kRpmLive'],
    rpmMax:   ['kRpmMax',   'kRpmMaxLive'],
    lap:      ['kLap',      'liveLapBig',  'detailHeroLapCurrent'],
    lapBest:  ['kLapBest',  'liveLapBest', 'detailHeroLapBest'],
  });

  function targetIdsFor(key) {
    const v = SHARED_ID_MAP[key];
    return v ? v.slice() : [];
  }

  return { SHARED_ID_MAP, targetIdsFor };
}));
