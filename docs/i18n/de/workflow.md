# Arbeitsablauf

## Was Sie bereitstellen

- **Detektionen** (`tracks.json`): ein Eintrag pro dekodiertem Frame mit PTS,
  Kamerasegment-ID, Federballpixel oder null und optionalen Spielerboxen. Es
  gibt keinen eingebauten Detektor. Siehe [](schemas.md).
- **Kalibriereingabe**: pro Segment mindestens 4 Spielfeldpunkte `fit`, einige
  Punkte `heldout` und die Spitzen beider Netzpfosten (1,55 m).
- **Prüfung** (`review.json`): von Ihnen geprüfte Kontaktzeitpunkte, Pixel und
  Höhen sowie optionale Landebereiche. Kontakte werden nicht automatisch
  gefunden.

Jeder Tracker kann die Detektionen erzeugen; Sie können zum Beispiel
TrackNetV3 (MIT) für den Federball und ein Ultralytics-YOLO-Modell (AGPL-3.0)
für die Spieler selbst mit eigenen Checkpoints ausführen und deren Ausgaben
konvertieren. Konvertierungsskripte sind nicht Teil von v0.1.

## Schritte

1. **Kalibrieren.** Messen Sie für jedes Kamerasegment ≥ 4 Schnittpunkte von
   Spielfeldlinien (Rolle `fit`), einige weitere als `heldout` und die Spitzen
   der beiden Netzpfosten.

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Prüfen Sie `heldout_summary` und `net_anchor_sensitivity`, bevor Sie
   fortfahren.
2. **Prüfen.** Schreiben Sie `review.json`: Kontaktzeitpunkte innerhalb
   geprüfter Intervalle, Vorannahmen zu Kontaktpixel und Höhe und für den
   letzten Flug eines Segments optional einen Landebereich oder `open`.
3. **Analysieren und rendern.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Inkonsistente Eingaben (nicht monotoner PTS, nicht zusammenhängende
   Segmente, Kontakte außerhalb ihres Segments oder Intervalls, PTS, der nicht
   zum Video passt, …) führen zum Abbruch mit Exit-Code 2 und einer Meldung;
   nichts wird stillschweigend repariert.

## Was die einzelnen Befehle tun

- **`calibrate`**: Homographie aus ≥ 4 geprüften Bodenpunkten sowie die
  vertikale Spalte der Kameramatrix aus ≥ 2 erhöhten Netzankern.
  Zurückgehaltene Bodenpunkte werden nie zur Anpassung verwendet und separat
  ausgewiesen. Degenerierte, doppelte, kollineare und nicht endliche Eingaben
  werden abgelehnt. Die Bodenhomographie wird nie für Punkte in der Luft
  verwendet.
- **`analyze`**: ein Flug pro geprüftem Kontakt, zeitlich ab dem geprüften
  Kontakt gemessen. Kameraschnitte werden ausgeschlossen, und Flüge
  überbrücken nie Segmente. Jeder Flug endet am nächsten Kontakt, in einem
  geprüften Landebereich (eine Nebenbedingung, keine gemessene Koordinate)
  oder bei der letzten Beobachtung des Segments. Boden- und Netzprüfungen
  verwerfen unmögliche Anpassungen. Fehlende Detektionen bleiben null.
- **`render`**: gleicht jeden dekodierten Quellframe mit dem Track-PTS ab und
  zeichnet die gelieferten Spielerboxen, beobachtete Federballringe (grün),
  Modellringe (orange) und eine Draufsicht des Spielfelds im Layout 6:4. Das
  Quellaudio wird ohne Neukodierung als Stream kopiert. Vorhandene Ausgaben
  werden nie überschrieben.
- **`demo`**: erzeugt einen synthetischen Ballwechsel und führt die gesamte
  Pipeline aus.

## Ausgabe lesen

| Ebene | Bedeutung |
| --- | --- |
| `observed_pixel` | gelieferte Detektion, unverändert; null, wenn nicht vorhanden |
| `human_review` | Ihre Kontakte, Landebereiche und Kalibrierpunkte |
| `conditional_model` | Physikmodell, unter Ihren Vorannahmen an die beobachteten Pixel angepasst |
| `display_interpolation` | Linien und Markierungen, die nur der Renderer zeichnet |

Geschwindigkeiten sind die Anfangsgeschwindigkeit des angepassten Modells
(`model_speed_km_h`, angezeigt gerundet auf 5 km/h). Betrachten Sie sie als
grobe Modellwerte, nicht als Messungen.

## Grenzen

- Keine Federball- oder Spielerdetektion und keine mitgelieferten Gewichte.
- Keine automatische Kontakterkennung und keine Verfeinerung von Kontaktzeitstempeln.
- Keine gelernten dichten Tiefenkarten, keine gelernten Schlagbezeichnungen, keine automatischen IN/OUT-Entscheidungen.
- Die 3D-Ausgabe ist bedingt, nicht gemessen. Synthetische Rekonstruktionsergebnisse sind synthetisch.
