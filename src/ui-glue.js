// ============================================================
//  RasiCross — ui-glue.js  (Sidebar-Layout-Spiegel + Tab-Titel, Phase 44)
//  Herausgeloest aus rasicross.js (via app-init.js) — NUR bewegt, nicht geaendert.
//  Laeuft als Seiteneffekt beim Import — app.js importiert NACH app-init.js
//  (entspricht der bisherigen Position nach dem init()-Aufruf).
// ============================================================

import { activeRace, activePart } from './races.js';
import { state, activeKart } from './store.js';
import { rcAudio } from './rasicross.js';

// =============== UI GLUE für neues Sidebar-Layout ===============
(function(){
  function $$(id){return document.getElementById(id);}
  function txt(id,v){const e=$$(id);if(e&&e.textContent!==String(v))e.textContent=v;}

  // Spiegelt KPI/Pit-Wall-Daten ins neue Layout
  setInterval(()=>{
    try{
      // Pit-Wall (das Original updated nur wenn .show-Klasse, das ist OK)
      // Footer / Hz-Pill / Total km
      // Phase 56: #connHz ist entfallen -- Hz direkt aus dem State spiegeln.
      txt('hzText', String(state._lastHz || 0));
      const tk = $$('totalDistance');
      if (tk) {
        // Einheit aus dem <small>-Element der Hero-Kachel mitnehmen,
        // sonst wechselt der Footer flickrig zwischen "750 km" (falsch)
        // und "750 m" (richtig), weil der Hero in m anzeigt < 1 km.
        const numMatch = (tk.textContent || '').match(/[\d.,]+/);
        const unit = tk.querySelector('small')?.textContent?.trim() || 'km';
        if (numMatch) txt('footerKm', numMatch[0] + ' ' + unit);
      }
      // Fahrername im Haupt-Layout spiegeln. Die pw*-Felder gehoeren
      // allein updatePitWall() (pit-wall.js) -- der fruehere Spiegel hier
      // ueberschrieb sekuendlich Lap-Hold, Rundenziel und Status-Farbe
      // (u.a. mit dem Race-Status statt der Verbindung).
      try {
        {
          const r = activeRace();
          if (r) {
            const stints = activePart(r).stints || [];
            const last = stints[stints.length-1];
            if (last && !last.endAt) {
              const driver = state.drivers.find(d=>d.id===last.driverId);
              txt('currentDriverName', driver ? driver.name : '--');
            }
          }
        }
      } catch(e){}
      // Strecke-Tab Live-Stats
      if (state.track) {
        const pts = state.track.points?.length || 0;
        txt('trackPointsValue', pts);
        const len = state.track.totalDistance || 0;
        txt('trackLengthValue', len < 1000 ? Math.round(len) + ' m' : (len/1000).toFixed(2) + ' km');
        const sb = state.sectors?.boundaries || [];
        const sCount = sb.filter(b=>b).length;
        txt('trackSectorsValue', sCount === 0 ? '--' : (sCount + 1) + ' Sektoren');
        txt('trackClosedValue', state.track.closed ? 'geschlossen' : (state.track.scanning ? 'scannt …' : 'offen'));

        // Sektor-Status Pillen
        const s2 = sb[0], s3 = sb[1];
        const s2el = $$('sectorStatus2'), s3el = $$('sectorStatus3');
        if (s2el) {
          s2el.textContent = s2 ? '✓ gesetzt' : 'nicht gesetzt';
          s2el.style.color = s2 ? 'var(--blue)' : 'var(--mut)';
        }
        if (s3el) {
          s3el.textContent = s3 ? '✓ gesetzt' : 'nicht gesetzt';
          s3el.style.color = s3 ? 'var(--orange)' : 'var(--mut)';
        }
        // Gate
        const gw = state.startGate?.width;
        txt('gateBreiteDisplay', (gw || 14) + ' m');
        const gh = state.startGate?.heading;
        txt('gateHeadingDisplay', (gh != null && state.startGate?.enabled) ? Math.round(gh) + '°' : '--°');

        // Empty-State Overlay
        const emptyEl = $$('trackEmptyState');
        if (emptyEl) emptyEl.style.display = (pts > 0 || state.track.scanning) ? 'none' : 'flex';

        // Workflow-Stepper
        const step1 = $$('step1'), step2 = $$('step2'), step3 = $$('step3');
        if (step1 && step2 && step3) {
          step1.classList.remove('active','done');
          step2.classList.remove('active','done');
          step3.classList.remove('active','done');
          if (pts === 0 && !state.track.scanning) {
            step1.classList.add('active');
          } else if (state.track.scanning || (!state.track.closed && pts > 0)) {
            step1.classList.add('active');
          } else if (state.track.closed && sCount < 2) {
            step1.classList.add('done');
            step2.classList.add('active');
          } else {
            step1.classList.add('done');
            step2.classList.add('done');
            step3.classList.add('active');
          }
        }

        // GPS Bar Fill (statusGpsDot ist jetzt eine Bar, kein Dot)
        const gpsBar = $$('statusGpsDot');
        if (gpsBar) {
          const hasFix = activeKart().gps?.lat != null;
          gpsBar.style.width = hasFix ? '100%' : '30%';
          gpsBar.style.background = hasFix ? 'var(--green)' : 'var(--orange)';
          gpsBar.style.boxShadow = '0 0 8px ' + (hasFix ? 'var(--green-glow)' : 'var(--orange-glow)');
        }
      }
    }catch(e){}
  }, 200);

  // Top-bar Title pro Tab
  document.addEventListener('DOMContentLoaded',()=>{
    const titles = {
      live:['Live Telemetrie','Echtzeit-Daten von Mäher & Bridge'],
      detail:['Detail','Verlauf, Stints & Rundentabelle des aktiven Rennens'],
      track:['Strecke','Aufnahme, Sektoren & gespeicherte Strecken'],
      races:['Rennen','Erstellen, starten und auswerten'],
      drivers:['Fahrer','Statistiken & Gesamtstrecke'],
      // Ohne Eintrag behielte der Header den Titel des zuvor geklickten
      // Tabs (reihenfolgeabhaengig -- stiller E2E-Flake bis Phase 50).
      karts:['Karts','Flotte & Wartung'],
      connection:['Verbindung','USB-Bridge, Demo-Modus & Diagnose'],
      settings:['Einstellungen','Skalen, Kalibrierung, ESP32 & Daten']
    };
    document.querySelectorAll('.nav-item[data-tab]').forEach(b=>{
      b.addEventListener('click',()=>{
        const t = b.dataset.tab;
        if(titles[t]){ txt('topTitle', titles[t][0]); txt('topSub', titles[t][1]); }
        $$('sidebar')?.classList.remove('open');
      });
    });
    // Theme-Toggle wird bereits in init() via $('themeBtn').onclick = toggleTheme
    // verdrahtet. KEIN zweiter Listener hier — sonst zaehlt ein Klick doppelt
    // und ueberspringt jedes zweite Theme.
    // Audio-Cues toggle
    const audioBtnEl = $$('audioBtn');
    const updateAudioIcon = () => {
      // CSS blendet je nach .muted das passende SVG ein (statt Emoji-Swap)
      audioBtnEl?.classList.toggle('muted', !rcAudio.isEnabled());
    };
    updateAudioIcon();
    $$('audioBtn')?.addEventListener('click',()=>{
      rcAudio.setEnabled(!rcAudio.isEnabled());
      updateAudioIcon();
      if (rcAudio.isEnabled()) rcAudio.sectorBest();
    });
    // Mobile burger
    $$('openMobileBtn')?.addEventListener('click', ()=>$$('sidebar').classList.add('open'));
    $$('closeMobileBtn')?.addEventListener('click', ()=>$$('sidebar').classList.remove('open'));
    // pitwallBtn / pwCloseBtn / modeSerialBtn / modeDemoBtn sowie das Theme
    // werden bereits in init() verdrahtet: openPitWall/closePitWall verwalten
    // dort zusaetzlich den Escape-Listener, applyTheme() setzt data-theme.
    // Daher hier KEINE zweiten Listener — sonst feuern Klicks doppelt.
  });
})();
