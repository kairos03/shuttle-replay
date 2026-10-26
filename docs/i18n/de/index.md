# shuttle-replay

```{image} assets/header.svg
:alt: shuttle-replay
:width: 100%
```

**Macht aus einem lokalen Badmintonvideo, Ihren Detektionen und Ihrer Prüfung
ein Replay mit Spielfeld nebeneinander. Offline.**

`shuttle-replay` kalibriert eine Kamera anhand von Spielfeldpunkten, die Sie
geprüft haben, passt Flugbahnen mit Schwerkraft und quadratischem
Luftwiderstand an die von Ihnen gelieferten 2D-Federballdetektionen an und
rendert ein MP4, das das Quellvideo neben einer Draufsicht des Spielfelds
zeigt.

Es ist ein Werkzeug für Forschung und Analyse, kein Linienrichtersystem,
Schlagklassifikator, Federballdetektor und keine gemessene
3D-Geschwindigkeitsmessung:

- **Sie liefern die Detektionen.** Es gibt keinen mitgelieferten Federball-
  oder Spielerdetektor, und es werden keine Modellgewichte heruntergeladen.
- **Sie liefern die Prüfung.** Kontakte, Landebereiche und Kalibrierpunkte
  werden von einem Menschen geprüft; nichts wird automatisch gefunden oder
  repariert.
- **3D ist bedingt, nicht gemessen.** Jede 3D-Position und -Geschwindigkeit ist
  eine Ausgabe eines Physikmodells, die von Ihrer Kalibrierung und Ihren
  Annotationen abhängt. Es gibt keine gelernte Tiefe, und ein niedriger
  Reprojektionsfehler ist kein Beweis für 3D-Genauigkeit.

```{image} assets/demo.gif
:alt: Synthetisches Demo-Replay, Quellansicht neben der Draufsicht des Spielfelds
:width: 90%
```

*Synthetische Demonstration, erzeugt mit `shuttle-replay demo`. Kein Maß für
die Genauigkeit unter realen Bedingungen.*

```{toctree}
:maxdepth: 2
:caption: Anleitung

getting-started
guide
workflow
schemas
```

```{toctree}
:maxdepth: 1
:caption: Technische Erläuterungen

technology
camera-calibration
trajectory-physics
observations-timing
rendering-safety
validation-limits
```

```{toctree}
:maxdepth: 1
:caption: Sprachen

languages
```

```{toctree}
:maxdepth: 1
:caption: Projekt

development
license
```
