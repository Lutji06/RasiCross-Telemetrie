# OLED-Diagnose Skript
# In der REPL (Thonny) ausfuehren um zu sehen was beim OLED schief geht.
# Schritt fuer Schritt - bricht beim ersten Fehler ab und sagt was los ist.

print("=" * 50)
print("OLED-Diagnose")
print("=" * 50)

# Test 1: ssd1306.py vorhanden?
print("\n[1/4] Pruefe ob ssd1306.py installiert ist...")
try:
    import ssd1306
    print("  OK - ssd1306 Modul gefunden")
except ImportError:
    print("  FEHLT! ssd1306.py muss auf den ESP kopiert werden.")
    print("  Loesung: esp_libs/ssd1306.py ins Root des ESP32 kopieren.")
    raise SystemExit

# Test 2: I2C-Bus initialisieren
print("\n[2/4] Initialisiere I2C-Bus (SDA=21, SCL=22)...")
try:
    from machine import Pin, I2C
    i2c = I2C(0, sda=Pin(21), scl=Pin(22), freq=400_000)
    print("  OK - I2C-Bus laeuft")
except Exception as e:
    print("  FEHLER:", e)
    print("  Loesung: Pruefe ob Pin 21/22 nicht anders belegt sind.")
    raise SystemExit

# Test 3: I2C-Scan - welche Geraete antworten?
print("\n[3/4] I2C-Scan: welche Adressen antworten?")
devices = i2c.scan()
if not devices:
    print("  KEINE Geraete gefunden!")
    print("  Moegliche Ursachen:")
    print("   - OLED nicht angeschlossen")
    print("   - SDA/SCL vertauscht")
    print("   - VCC nicht angeschlossen (3.3V)")
    print("   - GND nicht angeschlossen")
    print("   - Kabel/Lötstellen defekt")
    raise SystemExit
else:
    print("  Gefundene Adressen:", [hex(a) for a in devices])
    has_oled = 0x3C in devices or 0x3D in devices
    has_mpu = 0x68 in devices or 0x69 in devices
    if has_oled:
        print("  OK - OLED gefunden")
    else:
        print("  KEIN OLED auf 0x3C oder 0x3D!")
        print("  Loesung: pruefe Verkabelung oder OLED-Modell.")
    if has_mpu:
        print("  Bonus - MPU-6050 auch gefunden auf", hex(0x68 if 0x68 in devices else 0x69))

# Test 4: OLED tatsaechlich initialisieren
print("\n[4/4] OLED initialisieren und Test-Bild zeichnen...")
try:
    addr = 0x3C if 0x3C in devices else 0x3D
    oled = ssd1306.SSD1306_I2C(128, 64, i2c, addr=addr)
    oled.fill(0)
    oled.text("OLED OK!", 32, 8, 1)
    oled.text("Diagnose", 32, 24, 1)
    oled.text("bestanden", 28, 40, 1)
    oled.rect(0, 0, 128, 64, 1)
    oled.show()
    print("  OK - OLED zeigt jetzt 'OLED OK!'")
    print()
    print("=" * 50)
    print("ALLES OK! Die Hardware ist in Ordnung.")
    print("Wenn die main.py trotzdem nichts anzeigt, liegt es am Code.")
    print("=" * 50)
except Exception as e:
    print("  FEHLER:", e)
    print("  Komische Sache - I2C-Geraet antwortet aber Init schlaegt fehl.")
    print("  Vielleicht inkompatibler OLED-Chip oder Treiber-Mismatch.")
