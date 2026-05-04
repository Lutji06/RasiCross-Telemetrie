; ============================================================
;  RasiCross Telemetry – Custom NSIS Installer Script
;  Installiert CH340 + CP2102 USB-Treiber automatisch
; ============================================================

!macro customInstall
  DetailPrint "Installiere ESP32 USB-Treiber..."

  ; ── CH340 / CH341 Treiber ────────────────────────────────
  IfFileExists "$INSTDIR\resources\drivers\CH341SER.EXE" ch340_found ch340_skip
  ch340_found:
    DetailPrint "  › CH340/CH341 Treiber wird installiert..."
    ExecWait '"$INSTDIR\resources\drivers\CH341SER.EXE" /S' $0
    IntCmp $0 0 ch340_ok ch340_ok ch340_fail
    ch340_ok:
      DetailPrint "  ✓ CH340 Treiber installiert (Code: $0)"
      Goto ch340_done
    ch340_fail:
      DetailPrint "  ! CH340 Treiber: Fehlercode $0 (evtl. bereits vorhanden)"
  ch340_skip:
  ch340_done:

  ; ── CP2102 / CP2104 Treiber (Silicon Labs) ───────────────
  IfFileExists "$INSTDIR\resources\drivers\CP210xVCPInstaller_x64.exe" cp_found cp_skip
  cp_found:
    DetailPrint "  › CP210x Treiber wird installiert..."
    ExecWait '"$INSTDIR\resources\drivers\CP210xVCPInstaller_x64.exe" /S' $0
    IntCmp $0 0 cp_ok cp_ok cp_fail
    cp_ok:
      DetailPrint "  ✓ CP210x Treiber installiert (Code: $0)"
      Goto cp_done
    cp_fail:
      DetailPrint "  ! CP210x Treiber: Fehlercode $0 (evtl. bereits vorhanden)"
  cp_skip:
  cp_done:

  DetailPrint "ESP32 USB-Treiber Schritt abgeschlossen."
!macroend

!macro customUnInstall
  ; Treiber beim Deinstallieren NICHT entfernen
  ; (könnten von anderen Geräten gebraucht werden)
!macroend
