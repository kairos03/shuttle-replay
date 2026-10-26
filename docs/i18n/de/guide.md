# Benutzerhandbuch für shuttle-replay (v0.1)

`shuttle-replay` ist ein Offline-Werkzeug, das aus einem lokalen Video, bereits
von Ihnen erzeugten Detektionen und von einem Menschen geprüften Annotationen
ein Replay des Federballs erstellt. Es kalibriert die Kamera, passt ein
Flugmodell mit Schwerkraft und quadratischem Luftwiderstand an die
2D-Detektionskoordinaten an und erzeugt ein MP4, das Quellvideo und eine
Draufsicht des Spielfelds im Verhältnis 6:4 nebeneinander zeigt.

Dieses Werkzeug dient Forschung und Analyse. Es ist kein In/Out-
Linienrichtersystem, kein Schlagklassifikator, kein Federballdetektor und kein
gemessenes Geschwindigkeitsmessgerät. Jede 3D-Position und -Geschwindigkeit in
der Ausgabe ist ein bedingter Modellwert, der Ihre Kalibrierung und Ihre
Annotationen voraussetzt.

## Installation

Erfordert Python 3.12 oder neuer und [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Die PyAV-Wheels bringen FFmpeg mit, daher wird kein System-FFmpeg benötigt.

## Synthetische Demo

```bash
uv run shuttle-replay demo --out-dir demo
```

Dies erstellt einen synthetischen Ballwechsel, der zwei virtuelle Kameras,
ein Übergangssegment und fehlende Detektionen kombiniert, und führt dann
Kalibrierung → Analyse → Rendering vollständig aus. Die Werte in
`demo/synthetic_recovery.json` werden mit der synthetischen Ground Truth
verglichen und sagen daher nichts über die Genauigkeit bei echtem Video aus.

## Eigenes Video verwenden

1. **Detektionen (`tracks.json`)**: eine Zeile pro dekodiertem Frame, mit dem
   tatsächlichen PTS dieses Frames (in Sekunden), der Kamerasegment-ID (`null`
   für Übergangs- und Nahaufnahmesegmente), den Pixelkoordinaten des
   Federballs (`null`, wenn er fehlt) und optionalen Spielerboxen. `frame_id`
   muss der Dekodierreihenfolge entsprechen. Das Format ist in
   [docs/schemas.md](schemas.md) beschrieben.
   v0.1 enthält keinen Detektor. Sie können TrackNetV3 (MIT) oder Ultralytics
   YOLO (AGPL-3.0) selbst ausführen und die Ergebnisse konvertieren, aber ein
   Konvertierungsskript ist nicht enthalten. Es werden keine Modellgewichte
   heruntergeladen.
2. **Kalibriereingabe**: Markieren Sie für jedes Kamerasegment in Pixeln vier
   oder mehr Schnittpunkte von Spielfeldlinien (`fit`), einige Schnittpunkte
   zur Validierung (`heldout`) und die Spitzen der beiden Netzpfosten (Höhe
   1,55 m).

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Prüfen Sie zuerst `heldout_summary` (den Fehler an nicht zur Anpassung
   verwendeten Punkten) und `net_anchor_sensitivity` (wie stark sich die Höhe
   ändert, wenn die Netzpfosten um den angegebenen Pixelfehler verschoben
   werden). Die Bodenhomographie wird nur für Bodenpunkte (Z=0) verwendet und
   nie für den Federball in der Luft.
3. **Prüfannotationen (`review.json`)**: Geben Sie den Zeitpunkt des
   Schlägerkontakts (`time_s`), das Prüfintervall, das ihn enthält
   (`time_bracket_s`), das Kontaktpixel und eine Höhenschätzung ein. Der
   Kontaktzeitpunkt ist Sekunde 0 des Flugs. Eine späte erste Detektion
   ändert Sekunde 0 nicht.
   Nur der letzte Kontakt eines Segments kann eine Endbedingung haben: eine
   `landing_region` (Bereich und Zeitintervall, in dem der Federball den
   Boden erreicht) oder `open` (bis zur letzten Beobachtung des Segments oder
   bis zum geprüften `until_s`). Jeder andere Flug endet am nächsten Kontakt
   und wird nicht gezwungen, den Boden zu erreichen. v0.1 korrigiert
   Kontaktzeitpunkte nicht automatisch; korrigieren Sie sie also selbst
   anhand der Frames.
4. **Analyse und Rendering**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # 한 번에:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Der Kommentar `# 한 번에:` bedeutet „alles in einem Schritt:“; `run` führt
   Analyse und Rendering zusammen aus.

   Das Werkzeug bricht mit Exit-Code 2 ab, wenn der PTS rückwärts läuft, wenn
   dasselbe Kamerasegment nach einer Lücke wieder auftaucht, wenn ein Kontakt
   außerhalb seines Kamerasegments oder Prüfintervalls liegt oder wenn der
   PTS des Videos und der PTS der Tracks voneinander abweichen. Es korrigiert
   die Eingabe nie stillschweigend.

## Ergebnisse lesen

- Grüner Kreis: die Eingabe-Detektionskoordinaten wie geliefert. Frames ohne
  Detektion bleiben leer.
- Oranger Kreis/Punkte: das bedingte Physikmodell. Wird nur innerhalb
  desselben Kamerasegments und desselben Flugs gezeichnet.
- Blaues gestricheltes Rechteck: der von einem Menschen angegebene
  Landebereich. Die Markierung × ist der Modell-Landepunkt, der mit diesem
  Bereich als Bedingung angepasst wurde, keine gemessene Koordinate.
- Die Geschwindigkeit ist die Anfangsgeschwindigkeit des Modells, gerundet auf
  5 km/h.
- Bei einem zurückgeschlagenen Flug wird der Punkt „wo er gelandet wäre, wenn
  er nicht zurückgeschlagen worden wäre“ nur im JSON gespeichert
  (`unreturned_floor_crossing_prediction`, eine kontrafaktische Vorhersage).
- Hat die Quelle Audio, werden die Audiopakete unverändert ohne Neukodierung
  kopiert, sodass Startverzögerung und Lücken des Quellaudios erhalten
  bleiben. Kann das Audio nicht in MP4 kopiert werden oder würde sich sein
  Timing ändern, schlägt das Rendering fehl. Das Ergebnis der vollständigen
  Dekodierung der Ausgabedatei zur Überprüfung wird in `render_report.json`
  geschrieben.
- Vorhandene Dateien werden nie überschrieben. Das Werkzeug bricht ab, wenn
  eine Ausgabedatei bereits existiert oder dieselbe Datei wie das Quellvideo
  ist, und das Rendering schreibt in eine temporäre Datei, die erst nach der
  Überprüfung auf den endgültigen Namen umbenannt wird.

## Lizenz

Ausschließlich GNU AGPL-3.0. Siehe [LICENSE](../LICENSE) und [NOTICE.md](../NOTICE.md).
