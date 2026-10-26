# Technologieüberblick

`shuttle-replay` macht aus drei Arten von Daten eine Wiederholung: einem
lokalen Quellvideo, 2D-Detektionen des Federballs, die Sie liefern, und
Vorgaben, die eine Person geprüft hat (Kalibrierpunkte, Kontakte und
Landebereiche). Diese Seite ist die Landkarte. Die fünf folgenden Seiten
erklären jede Stufe im Detail, und jede Seite verlinkt auf genau die
Quellcodezeilen, die sie beschreibt, festgelegt auf Commit
`6e9a060b5cc964f02d4017d806e953ffea89c8b4`.

## Datenfluss

```{figure} assets/technical/de/pipeline.svg
:alt: Datenfluss: Kalibrierung, Tracks und Review speisen analyze; Video und Analyse speisen render, das MP4 und Render-Bericht schreibt
:class: technical-figure
:width: 100%

Ein- und Ausgaben der drei Befehle.
```

Die CLI stellt jeden Pfeil als Befehl bereit: `calibrate`, `analyze`, `render`
und `run` (analyze + render in einem Schritt). `demo` baut eine vollständig
synthetische Szene und führt dieselbe Pipeline darauf aus
([`cli.py` `build_parser`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L154-L191)).
Bei `run` wird das Video gerendert und verifiziert, bevor `analysis.json` und
`render_report.json` geschrieben werden, sodass JSON-Ergebnisse nie ein Video
beschreiben, dessen Erzeugung fehlgeschlagen ist
([`_run_pipeline`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L55-L63)).

Was jede Stufe hinzufügt:

1. **Kalibrierung** macht aus geprüften Pixelpositionen bekannter Spielfeldpunkte
   eine Bodenhomographie `H` und eine 3x4-Kameramatrix `P` je Kamerasegment.
   Siehe [Kamerakalibrierung](camera-calibration.md).
2. **Eingabevalidierung** prüft Zeitstempel, Segmente, Kontakte und Flugenden
   und weist Inkonsistenzen zurück, statt sie zu reparieren. Siehe
   [Beobachtungen und Zeit](observations-timing.md).
3. **Flugschätzung** passt ein Modell mit Schwerkraft und quadratischem
   Luftwiderstand an die 2D-Detektionen zwischen geprüften Kontakten an. Siehe
   [Flugbahnphysik](trajectory-physics.md).
4. **Rendering** dekodiert die Quelle, zeichnet Overlays und eine
   Spielfeld-Draufsicht, kopiert die Audiopakete und verifiziert das Ergebnis,
   bevor es veröffentlicht wird. Siehe
   [Rendering und Ausgabesicherheit](rendering-safety.md).
5. **Validierung** ist über alle Stufen verteilt. Was jede Prüfung beweist und
   was nicht, ist in [Validierung und Grenzen](validation-limits.md)
   zusammengefasst.

## Software-Stack

| Komponente | Rolle in diesem Projekt |
| --- | --- |
| Python 3.12+ | Sprache; `requires-python = ">=3.12"` in `pyproject.toml` |
| NumPy | Lineare Algebra: Homographie-DLT, SVD, Projektion, Ankerlösung nach kleinsten Quadraten |
| SciPy | `solve_ivp` integriert die Flug-ODE; `least_squares` passt Flüge an |
| PyAV (`av`) | FFmpeg-Bindings im selben Prozess: Dekodieren, Kodieren, Audio-Stream-Kopie, Verifikation |
| Pillow | Zeichnet Ringe, Spuren, das Spielfeld und Text auf jedes Bild |
| uv | Installiert die gesperrte Umgebung (`uv.lock`) und führt Befehle aus |
| Sphinx + MyST + Furo | Baut diese Dokumentationsseite (die Abhängigkeitsgruppe `docs`) |

Die Laufzeitabhängigkeiten sind genau `numpy`, `scipy`, `av` und `pillow`
([`pyproject.toml`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/pyproject.toml#L10-L15)).
Kein Unterprozess und kein Shell-Befehl wird aus Dateinamen gebaut; die
Videoverarbeitung läuft über PyAV im selben Python-Prozess
([Moduldocstring von `render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L1-L7)).

## Warum es kein mitgeliefertes Modell gibt

Einen Federball in einem Bild zu finden (Detektion) und zu bestimmen, wo er
sich in 3D befindet (Rekonstruktion), sind getrennte Probleme. Dieses Projekt
löst nur das zweite, und nur unter expliziten Annahmen. Es gibt keinen
Detektor, kein neuronales Netz und keine Modellgewichte zum Herunterladen. Sie
bringen Detektionen aus einem beliebigen Werkzeug Ihres Vertrauens mit, im
Format `shuttle-replay/tracks/v1`, das in [den Schemas](schemas.md)
beschrieben ist.

So bleibt jede Zahl nachvollziehbar. Jedes Analysebild kennzeichnet die
Federballposition mit einer Herkunftsebene
([`PROVENANCE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L33-L38)):

- `observed_pixel`: Ihre Detektion, unverändert, oder null, wenn es keine gab.
- `human_review`: ein Kontakt, Landebereich oder Kalibrierpunkt, den eine
  Person eingegeben hat.
- `conditional_model`: das angepasste Physikmodell, das nur so gut ist wie die
  Kalibrierung und Prüfung, auf denen es bedingt ist.
- `display_interpolation`: Linien, die der Renderer zwischen Modellabtastungen
  zeichnet.

Eine fehlende Detektion wird nie so aufgefüllt, als wäre sie beobachtet
worden, und das Modell wird nie als Messung gekennzeichnet.

## Empfohlene Lesereihenfolge

Wenn Computer Vision neu für Sie ist, lesen Sie in dieser Reihenfolge:

1. [Kamerakalibrierung](camera-calibration.md): wie Pixel mit Metern
   zusammenhängen und warum eine einzelne Kamera allein keine Tiefe sieht.
2. [Flugbahnphysik](trajectory-physics.md): wie Physik und geprüfte Kontakte
   die fehlende Tiefe ergänzen.
3. [Beobachtungen und Zeit](observations-timing.md): warum Zeitstempel aus
   dem Videocontainer stammen und nicht aus einem Bildzähler.
4. [Rendering und Ausgabesicherheit](rendering-safety.md): wie das MP4 erzeugt
   und geschützt wird.
5. [Validierung und Grenzen](validation-limits.md): wie man die Diagnosen
   liest und wo sie enden.

Praktische Schritte finden Sie unter [Erste Schritte](getting-started.md),
[im Benutzerhandbuch](guide.md) und [im Arbeitsablauf](workflow.md).
