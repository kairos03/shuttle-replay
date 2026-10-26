# Beobachtungen und Zeit

Eine Fluganpassung vergleicht Modellpositionen mit Detektionen **zu
bestimmten Zeiten**. Sind diese Zeiten falsch, sieht eine richtige Flugbahn
falsch aus, und eine falsche kann richtig aussehen. Diese Seite erklärt, woher
die Zeiten stammen, was die Eingabeverträge verlangen, wie Beobachtungen von
der Prüfung getrennt werden und wie die Zeit für das Modell und für das
Zeichnen abgetastet wird.

## Die Zeit stammt aus PTS, nicht aus dem Zählen von Frames

Videocontainer speichern für jeden Frame einen Präsentationszeitstempel (PTS)
als ganzzahlige Tick-Anzahl, zusammen mit einer `time_base`, die angibt, wie
lang ein Tick ist. Die Zeit des Frames in Sekunden ist:

```{math}
\mathrm{time\_s} = \mathrm{pts} \cdot \mathrm{time\_base}
```

Beispiel:

```{math}
\begin{aligned}
\mathrm{time\_base} &= \tfrac{1}{30000}\ \mathrm{s}, \quad \mathrm{pts} = 3003 \\
\Rightarrow \mathrm{time\_s} &= 3003 \cdot \tfrac{1}{30000}\ \mathrm{s} = 0.1001\ \mathrm{s}
\end{aligned}
```

Viele Handy- und Bildschirmaufnahmen haben eine **variable Bildrate** (VFR):
Die Frame-Dauern unterscheiden sich. `frame_index / fps` zu berechnen driftet
dann von der realen Zeit weg. Das Tracks-Format speichert daher `pts_s` pro
Frame, wie von FFmpeg/PyAV decodiert (siehe [die Schemas](schemas.md)). Die
synthetische Demo verwendet absichtlich VFR: Bei `time_base` 1/30000 s dauert
jeder siebte Frame 1001 Ticks statt 1000
([`frame_pts_ticks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py#L52-L58)).

Der Renderer prüft später jeden decodierten Frame gegen Ihr `pts_s`; siehe
[Rendering und Ausgabesicherheit](rendering-safety.md).

## Eingabeverträge

[`validate_tracks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L33-L78)
und
[`validate_review`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L81-L149)
lösen bei der ersten Inkonsistenz `InputError` aus. Nichts wird umsortiert,
dedupliziert oder repariert.

Tracks (`shuttle-replay/tracks/v1`):

- `frame_id` ist eine ganze Zahl und streng steigend; `pts_s` ist endlich und
  streng steigend.
- `segment_id` benennt eine durchgehende Kameraeinstellung. `null` markiert
  einen Kameraschnitt, eine Nahaufnahme oder eine Wiederholung. Eine
  Segment-ID, die nach einem anderen Segment wieder auftaucht, wird abgelehnt;
  jede Einstellung braucht daher ihre eigene ID und Kalibrierung.
- `shuttle` ist entweder `null` (keine Detektion) oder hat endliche `u` und
  `v`. Spielerboxen müssen vier endliche Zahlen sein.

Der Zeitbereich jedes Segments ist der PTS seines ersten und letzten Frames.
Jedes Segment braucht eine Kalibrierung
([`validate_inputs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L152-L162)).

Prüfung (`shuttle-replay/review/v1`):

- Kontakt-IDs sind eindeutige Zeichenketten. Jeder Kontakt liegt innerhalb
  des PTS-Bereichs seines Segments und innerhalb seines eigenen
  `time_bracket_s`, das höchstens 0.5 s breit sein darf.
- Kontakte in einem Segment sind in Listenreihenfolge zeitlich streng
  steigend.
- `height_m` liegt im offenen Intervall (0, 4) m, und `height_sigma_m` ist
  positiv. Jeder Kontakt braucht `image_px` oder `court_xy_m`.
- Nur der letzte Kontakt eines Segments darf einen `flight_ends`-Eintrag vom
  Typ `open` oder `landing_region` haben. Ein Landeintervall muss nach dem
  Kontakt beginnen; das `min` des Bereichs muss unter seinem `max` liegen. Das
  `until_s` eines `open`-Endes muss auf den Kontakt folgen und innerhalb des
  Segments bleiben.

## Beobachtungen und Prüfung

Zwei Arten von Eingaben spielen unterschiedliche Rollen:

- **Beobachtete Daten**: Ihre Detektionen. Sie gehen nur als Pixelresiduen in
  die Anpassung ein und werden unverändert nach `shuttle_observed_px` kopiert.
  Ein Frame mit `shuttle: null` bleibt in jeder Ausgabe `null`.
- **Geprüfte Randbedingungen**: Kontakte, Landebereiche, Kalibrierpunkte.
  Kontaktpositionen und -höhen gehen als sigma-gewichtete Priors ein;
  Landeendpunkte verwenden feste Strafskalen. Kalibrierpunkte bestimmen die
  Kamera vorab. Kontaktzeiten sind fest, und die Landezeit wird innerhalb
  ihres Intervalls angepasst.

Füllt das Modell einen Frame ohne Detektion, ist die `layer` dieses Frames
`conditional_model`, während `shuttle_observed_px` `null` bleibt. Der Test
`test_missing_detection_provenance_is_null_not_filled` prüft genau das.

## Aufteilung in Flüge

[`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L234)
gruppiert Kontakte nach Segment und macht aus jedem Kontakt einen Flug. Ein
Flug überschreitet nie ein Kamerasegment. Seine Beobachtungen sind die Frames
des Segments mit einer Detektion und

```{math}
\begin{aligned}
t_0 + \mathtt{contact\_guard\_s} &< \mathrm{pts\_s} \le t_\mathrm{end} - \mathtt{contact\_guard\_s} && (1) \\
t_0 + \mathtt{contact\_guard\_s} &< \mathrm{pts\_s} \le t_\mathrm{end} && (2)
\end{aligned}
```

(1) auf den Flug folgt ein weiterer Kontakt;
(2) Landung oder offenes Ende.

| Symbol | Bedeutung |
|---|---|
| {math}`t_0` | geprüfter Kontaktzeitpunkt |
| {math}`t_\mathrm{end}` | nächster Kontaktzeitpunkt, Ende des Landeintervalls oder min(Segmentende, `until_s`) |
| `contact_guard_s` | Standard 0,02 s |

Der Schutzabstand verwirft Detektionen direkt am Kontakt, wo der Shuttle oft
mit dem Schläger verschmilzt. `observation_frame_ids` und
`observation_time_offsets_s` im Datensatz jedes Flugs zeigen genau, welche
Frames verwendet wurden, mit von `t0` aus gemessenen Versätzen.

## Modellabtastung und Anzeige

Es gibt drei verschiedene Abtastungen, und nur die erste erfolgt pro
Videoframe:

1. **Pro Frame.** Für jeden Frame innerhalb der Zeitspanne eines angenommenen
   Flugs ist `shuttle_model_xyz_m` das zum eigenen PTS dieses Frames
   ausgewertete Modell und `shuttle_model_px` seine Projektion durch `P`
   ([Frame-Schleife](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L293-L334)).
   Frames mit Kameraschnitt erhalten `layer: "excluded_camera_cut"`, kein
   Modell und keine Spieler, selbst wenn eine Rohdetektion existiert
   (`raw_detection_ignored`).
2. **In der Anpassung.** 41 gleichmäßig verteilte Stichproben prüfen die
   Boden- und Netzstrafterme; 201 Stichproben speisen die Annahmeprüfungen.
   Siehe [Flugbahnphysik](trajectory-physics.md).
3. **Anzeige.** Die Spur in der Draufsicht ist ein Linienzug durch frühere
   Modellstichproben pro Frame ausschließlich **desselben** Flugs
   ([`trail_for`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L36-L46)).
   Sie endet am ersten Frame mit einer anderen `model_flight_id`, sodass eine
   Spur nie zwei Flüge verbindet oder einen Kameraschnitt überbrückt. Diese
   Linien sind `display_interpolation`, keine Daten.

## Toleranzen, die tatsächlich geprüft werden

| Prüfung | Wert | Quelle |
|---|---|---|
| Breite des Kontaktintervalls | ≤ 0.5 s | `inputs.py` |
| Kontakt-Schutzabstand | 0.02 s (Standard) | `analysis.py` |
| PTS-Abgleich im Renderer | 1e-3 s je Frame | `render.py` |
| ODE (`simulate`) | rtol 1e-7, atol 1e-8, max_step 0.02 s | `physics.py` |
| ODE (`floor_crossing`) | rtol 1e-9, atol 1e-10, max_step 0.01 s | `physics.py` |
| Bodenschwelle | tiefster Punkt ≥ -0.02 m | `physics.py` |
| Landung `within_region` | Bereich um 1e-3 m erweitert | `analysis.py` |

Verwandt: [die Schemas](schemas.md) zu jedem Feld,
[der Arbeitsablauf](workflow.md) zum Erzeugen von Tracks mit Ihrem eigenen
Detektor.
