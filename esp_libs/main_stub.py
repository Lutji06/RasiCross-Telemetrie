# Geht als main.py auf BEIDE ESPs (Kart-Sender und Bridge).
# Das eigentliche Programm ist vorkompiliert (app.mpy, siehe README):
# der On-Device-Compile der grossen sender.py/bridge.py wuerde dem
# WiFi-Treiber den RAM wegfressen ("WiFi Out of Memory" beim Boot).
import app  # noqa: F401 -- Side-Effect-Import: startet das Programm
