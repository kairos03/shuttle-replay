<p align="center">
  <img src="docs/assets/header.svg" alt="shuttle-replay" width="100%">
</p>

<p align="center"><b>Aus einem lokalen Badmintonvideo, Ihren Detektionen und Ihrer Prüfung wird eine Spielfeld-Wiederholung in Nebeneinander-Ansicht. Offline.</b></p>

<p align="center">
  <a href="https://github.com/kairos03/shuttle-replay/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/kairos03/shuttle-replay/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/python-3.12%2B-3776ab?style=flat-square" alt="Python 3.12+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-c6f04a?style=flat-square" alt="AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/runs-offline-0d2a1f?style=flat-square" alt="Offline">
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ru.md">Русский</a> | <a href="README.ko.md">한국어</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.de.md">Deutsch</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.it.md">Italiano</a>
</p>

<p align="center">
  <a href="#quick-start">Schnellstart</a> |
  <a href="#workflow">Arbeitsablauf</a> |
  <a href="#user-guide">Anleitung</a> |
  <a href="docs/schemas.md">Datenformate (Englisch)</a> |
  <a href="https://kairos03.github.io/shuttle-replay/de/">Dokumentation</a>
</p>

## Überblick

`shuttle-replay` kalibriert eine Kamera anhand von Spielfeldpunkten, die Sie
geprüft haben, passt Flugbahnen mit Schwerkraft und quadratischem Luftwiderstand
an die von Ihnen gelieferten 2D-Federballdetektionen an und rendert ein MP4, in
dem das Quellvideo neben einer Draufsicht des Spielfelds steht.

Es ist ein Werkzeug für Forschung und Prüfung, kein Linienrichtersystem, kein
Schlagklassifikator, kein Federballdetektor und keine gemessene 3D-Geschwindigkeitsmessung.
Jede 3D-Position und jede Geschwindigkeit ist eine bedingte Modellausgabe, die von
Ihrer Kalibrierung und Ihren Annotationen abhängt.

## Installation

Erfordert Python 3.12+ und [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Die PyAV-Wheels enthalten FFmpeg, daher ist kein System-FFmpeg erforderlich.

## Warum dieses Werkzeug

- **Vollständig offline.** Kein Detektor, keine Modellgewichte, keine Netzwerkaufrufe.
- **Menschliche Prüfung zuerst.** Kontakte, Landebereiche und Kalibrierpunkte stammen von Ihnen; nichts wird stillschweigend repariert.
- **Ehrliche Ebenen.** Beobachtete Pixel, Ihre Prüfung und das bedingte Modell bleiben in der Ausgabe getrennt.
- **Sicheres Rendern.** Das Quellaudio wird ohne Neukodierung per Stream-Copy übernommen, und vorhandene Dateien werden nie überschrieben.

<a id="quick-start"></a>
## Schnellstart

```bash
uv run shuttle-replay demo --out-dir demo
```

Schreibt `demo/inputs/` (synthetisches Video, Tracks, Prüfung, Kalibriereingabe),
`demo/calibration.json`, `demo/analysis.json`, `demo/replay.mp4`,
`demo/render_report.json` und `demo/synthetic_recovery.json`.

<p align="center">
  <img src="docs/assets/demo.gif" alt="Synthetische Demo-Wiederholung: Quellansicht neben der Draufsicht des Spielfelds" width="90%">
  <br><sub>Synthetische Demonstration, erzeugt mit <code>demo</code>. Kein Maß für die Genauigkeit in der realen Welt.</sub>
</p>

<a id="workflow"></a>
## Arbeitsablauf

Was Sie für Ihr eigenes Video bereitstellen müssen:

- **Detektionen** (`tracks.json`): ein Eintrag pro dekodiertem Frame mit PTS,
  Kamerasegment-ID, Federballpixel oder null und optionalen Spielerboxen. Es gibt
  keinen eingebauten Detektor.
- **Kalibriereingabe**: pro Segment mindestens 4 Spielfeldpunkte mit `fit`,
  einige `heldout`-Punkte und beide Netzpfostenspitzen (1,55 m).
- **Prüfung** (`review.json`): von Ihnen geprüfte Kontaktzeiten, Pixel und Höhen
  sowie optionale Landebereiche. Kontakte werden nicht automatisch gefunden.

```bash
uv run shuttle-replay calibrate calibration_input.json -o calibration.json
uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
    --calibration calibration.json --out-dir out
```

<a id="user-guide"></a>

<details>
<summary><b>Schritt-für-Schritt-Anleitung für Ihr eigenes Video</b></summary>

1. **Detektionen.** Erzeugen Sie pro dekodiertem Frame einen Eintrag in
   `tracks.json` mit der PTS des Frames, einer Kamerasegment-ID (null für
   Schnitte und Nahaufnahmen), dem Federballpixel (oder null) und optionalen
   Spielerboxen. Siehe [docs/schemas.md](docs/schemas.md) (Englisch).
   Jeder Tracker ist möglich; Sie können zum Beispiel selbst TrackNetV3 (MIT) für
   den Federball und ein Ultralytics-YOLO-Modell (AGPL-3.0) für die Spieler mit
   eigenen Checkpoints ausführen und deren Ausgaben konvertieren.
   Konvertierungsskripte sind nicht Teil von v0.1.
2. **Kalibriereingabe.** Messen Sie für jedes Kamerasegment ≥ 4
   Linienschnittpunkte des Spielfelds (Rolle `fit`), einige weitere als
   `heldout` sowie die beiden Netzpfostenspitzen (1,55 m).

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Prüfen Sie `heldout_summary` und `net_anchor_sensitivity`, bevor Sie fortfahren.
3. **Prüfung.** Schreiben Sie `review.json`: Kontaktzeiten innerhalb geprüfter
   Intervalle, Priors für Kontaktpixel und Kontakthöhe sowie für den letzten
   Flug eines Segments optional einen Landebereich oder `open`.
4. **Analysieren und rendern.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Inkonsistente Eingaben (nicht monotone PTS, nicht zusammenhängende Segmente,
   Kontakte außerhalb ihres Segments oder Intervalls, PTS, die nicht zum Video
   passen, …) brechen mit Exit-Code 2 und einer Meldung ab; nichts wird
   stillschweigend repariert.

</details>

<details>
<summary><b>Was die einzelnen Befehle tun</b></summary>

- **Kalibrierung** (`calibrate`): Homographie aus ≥ 4 geprüften Bodenpunkten
  sowie die vertikale Kameraspalte aus ≥ 2 erhöhten Netzankern. Zurückgehaltene
  Bodenpunkte werden nie zur Anpassung verwendet und separat ausgewiesen (in
  Pixeln und Metern). Degenerierte, doppelte, kollineare und nicht endliche
  Eingaben werden abgelehnt. Die Bodenhomographie wird nie für Punkte in der
  Luft verwendet.
- **Analyse** (`analyze`): ein Flug pro geprüftem Kontakt, zeitlich ab dem
  geprüften Kontakt gemessen (Zeitpunkt null), auch wenn die erste Detektion
  später eintrifft. Verwendet Quell-PTS, Frame-IDs und Kamerasegment-IDs;
  Kameraschnitte werden ausgeschlossen, und Flüge überbrücken nie Segmente.
  Jeder Flug endet beim nächsten Kontakt (abgefangen, nicht zur Landung
  gezwungen), in einem geprüften Landebereich (eine Nebenbedingung, keine
  gemessene Koordinate) oder bei der letzten Beobachtung des Segments. Boden-
  und Netzprüfungen verwerfen unmögliche Anpassungen. Wurde ein Flug abgefangen,
  wird der Bodenpunkt, den er erreicht *hätte*, separat als kontrafaktischer
  Wert ausgewiesen. Fehlende Detektionen bleiben null.
- **Rendern** (`render`): gleicht jeden dekodierten Quellframe mit der PTS der
  Tracks ab, zeichnet gelieferte Spielerboxen, beobachtete Federballringe (grün)
  und Modellringe (orange) sowie eine Draufsicht des Spielfelds in einem
  6:4-Layout aus Quelle und Draufsicht. Frames mit Kameraschnitt erhalten keine
  Federballeinblendung. Quellaudiopakete werden unverändert per Stream-Copy
  übernommen (keine Neukodierung), sodass Startversatz und Lücken des
  Quellaudios erhalten bleiben; das Rendern schlägt fehl, wenn sich das Audio
  nicht in MP4 kopieren lässt oder sich sein Timing ändert. Aus Dateinamen
  werden keine Shell-Befehle gebaut. Ausgaben werden nie überschrieben: Das
  Rendern schlägt fehl, wenn die Ausgabe existiert oder auf die Quelle verweist,
  schreibt in eine eindeutige Staging-Datei und veröffentlicht sie erst nach
  einer vollständigen Dekodierprüfung.
- **Demo** (`demo`): erzeugt einen vollständig synthetischen Ballwechsel (zwei
  virtuelle Kameras, ein Kameraschnitt, verrauschte Detektionen mit Lücken, ein
  Testton) und führt die gesamte Pipeline aus, einschließlich eines Berichts zur
  Rekonstruktion der synthetischen Ground Truth.

</details>

<details>
<summary><b>Die Ausgabe lesen</b></summary>

| Ebene | Bedeutung |
| --- | --- |
| `observed_pixel` | gelieferte Detektion, unverändert; null, wenn nicht vorhanden |
| `human_review` | Ihre Kontakte, Landebereiche und Kalibrierpunkte |
| `conditional_model` | physikalisches Modell, unter Ihren Priors an beobachtete Pixel angepasst |
| `display_interpolation` | Linien und Markierungen, die nur der Renderer zeichnet |

Geschwindigkeiten sind die Anfangsgeschwindigkeit des angepassten Modells
(`model_speed_km_h`, angezeigt gerundet auf 5 km/h). Betrachten Sie sie als
grobe Modellwerte.

</details>

<details>
<summary><b>Grenzen</b></summary>

- Keine Federball- oder Spielererkennung. Sie liefern die Detektionen im
  [Tracks-Format](docs/schemas.md) (Englisch); es werden keine Modellgewichte heruntergeladen.
- Keine automatische Kontaktfindung und keine Verfeinerung von Kontaktzeitstempeln.
- Keine gelernten dichten Tiefenkarten, keine gelernten Schlagbezeichnungen, keine automatischen IN/OUT-Entscheidungen.
- Die 3D-Ausgabe ist bedingt, nicht gemessen. Ein geringer Reprojektionsfehler
  zeigt Konsistenz mit den 2D-Detektionen, keinen unabhängigen Nachweis der
  3D-Genauigkeit. Ergebnisse der synthetischen Rekonstruktion sind synthetisch.

</details>

<details>
<summary><b>Entwicklung</b></summary>

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

</details>

<details>
<summary><b>Lizenz</b></summary>

GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). Siehe
[LICENSE](LICENSE) und [NOTICE.md](NOTICE.md) für Hinweise zu Drittanbietern.

</details>
