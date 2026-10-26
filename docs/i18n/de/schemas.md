# Eingabe- und Ausgabeformate (v0.1)

Alle Koordinaten in Metern verwenden das Spielfeld-Koordinatensystem: X quer
über das Spielfeld und Y entlang des Spielfelds, wobei die äußere Begrenzung
des Spielfelds (Außenkanten der Begrenzungslinien) bei X = 0 .. 6.10 und
Y = 0 (fern) .. 13.40 (nah) liegt; Z nach oben (0 = Boden). Die Netzebene ist
Y = 6.70. Linien sind 40 mm breit; geben Sie Bodenpunkte in der Linienmitte
ein: Außenlinien X = 0.02 / 6.08 und Y = 0.02 / 13.38, Einzel-Seitenlinien
X = 0.48 / 5.62, vordere Aufschlaglinien Y = 4.70 / 8.70, hintere
Doppel-Aufschlaglinien Y = 0.78 / 12.62, Mittellinie X = 3.05.
Bildkoordinaten sind Pixel des Quellvideos (x nach rechts, y nach unten).
Zeiten sind Präsentationszeitstempel (PTS) der Quelle in Sekunden, wie sie
FFmpeg/PyAV dekodiert (`frame.pts * time_base`), niemals `frame_index / fps`.

Führen Sie `shuttle-replay demo --out-dir demo` aus, um in `demo/inputs/` ein
vollständiges synthetisches Beispiel jeder unten beschriebenen Datei zu
erhalten.

## Kalibriereingabe — `shuttle-replay/calibration-input/v1`

```json
{
  "schema": "shuttle-replay/calibration-input/v1",
  "segments": [
    {
      "segment_id": 0,
      "image_size": [1280, 720],
      "ground_points": [
        {"name": "far_left_corner", "world_m": [0.02, 0.02], "image_px": [412.0, 188.5], "role": "fit"},
        {"name": "single_left_x_short_far", "world_m": [0.48, 4.70], "image_px": [430.1, 260.2], "role": "heldout"}
      ],
      "net_anchors": [
        {"name": "left_post_top", "world_m": [0.0, 6.7, 1.55], "image_px": [380.2, 250.0], "uncertainty_px": 3.0}
      ]
    }
  ]
}
```

- Punkte mit `role: "fit"` (≥ 4, nicht kollinear, nicht doppelt) schätzen die
  Bodenhomographie. Punkte mit `role: "heldout"` (≥ 1) werden nie angepasst
  und separat als Validierungsfehler in Pixeln und Metern ausgewiesen.
- `net_anchors` (≥ 2, Z > 0,1 m) rekonstruieren die vertikale Spalte der
  Kameramatrix. Mit genau zwei Ankern ist die Spalte fast exakt bestimmt,
  daher sagt ihr Residuum wenig aus; die Ausgabe enthält einen
  Sensitivitätsbericht (vertikale Verschiebung eines Punktes 3 m über dem
  Netz, wenn sich ein Anker um `uncertainty_px` bewegt).
- Nicht endliche Zahlen, kollineare/doppelte Anpassungspunkte, Anker auf
  Bodenhöhe und Kameras unterhalb des Bodens werden abgelehnt.

Die Ausgabe (`shuttle-replay/calibration/v1`) enthält pro Segment `P` (3×4,
Meter → Pixel), `H_world_to_image` / `H_image_to_world` (nur Boden),
`fit_ground_residuals`, `heldout_ground_errors`, `heldout_summary`,
`net_anchor_residuals_px`, `net_anchor_sensitivity` und eine Kopie der
Eingaben.

## Tracks — `shuttle-replay/tracks/v1`

```json
{
  "schema": "shuttle-replay/tracks/v1",
  "source_video": "match.mp4",
  "frames": [
    {"frame_id": 0, "pts_s": 0.0, "segment_id": 0,
     "shuttle": {"u": 315.3, "v": 265.6, "score": 0.91},
     "players": [{"label": "near", "box": [339.8, 350.1, 408.4, 521.7], "score": 0.9}]},
    {"frame_id": 1, "pts_s": 0.0333, "segment_id": 0, "shuttle": null, "players": []}
  ]
}
```

- Ein Eintrag pro dekodiertem Quellframe in Dekodierreihenfolge; `frame_id`
  muss dem Dekodierindex entsprechen (der Renderer prüft dies und den PTS
  jedes Frames).
- `frame_id` und `pts_s` müssen streng monoton steigend und endlich sein.
- `segment_id` kennzeichnet eine durchgehende Kameraeinstellung mit
  Kalibrierung; `null` markiert Kameraschnitte / Nahaufnahmen / Wiederholungen,
  die ausgeschlossen werden. Ein Segment muss zusammenhängend sein; eine
  Segment-ID, die nach einem anderen Segment erneut auftaucht, wird abgelehnt
  (geben Sie der späteren Einstellung eine eigene ID und Kalibrierung).
- `shuttle: null` bedeutet „keine Detektion“. Es bleibt in allen Ausgaben null.

## Prüfannotationen — `shuttle-replay/review/v1`

```json
{
  "schema": "shuttle-replay/review/v1",
  "physics": {"pixel_sigma_px": 3.0, "contact_guard_s": 0.02},
  "contacts": [
    {"id": "c1", "segment_id": 0, "time_s": 0.20, "time_bracket_s": [0.16, 0.24],
     "image_px": [402.0, 300.0], "height_m": 1.05, "height_sigma_m": 0.3,
     "review": "racket contact visible"}
  ],
  "flight_ends": [
    {"contact_id": "c5", "type": "landing_region", "time_bracket_s": [5.1, 5.4],
     "region_xy_m": {"min": [4.2, 0.8], "max": [4.9, 1.6]}, "review": "lands IN"},
    {"contact_id": "c3", "type": "open", "review": "camera cuts away mid-flight"}
  ]
}
```

- Kontakte sind geprüfte Schlägerkontakte. `time_s` ist der geprüfte
  Kontaktzeitstempel und wird zur Flugzeit null, auch wenn die erste
  Federballdetektion später kommt. Er muss innerhalb seines Kamerasegments
  und innerhalb von `time_bracket_s` (≤ 0,5 s breit) liegen. Kontakte in einem
  Segment müssen streng monoton steigend sein. v0.1 verfeinert
  Kontaktzeitpunkte nicht automatisch; verfeinern Sie sie, indem Sie die
  Frames prüfen und `time_s` bearbeiten.
- Positions-Vorannahme: `image_px` (geprüftes Kontaktpixel, geschnitten mit
  der Ebene Z = `height_m` über die vollständige Kameramatrix P) oder
  `court_xy_m`. `height_m` ist eine geprüfte Vorannahme mit
  `height_sigma_m`; `xy_sigma_m` ist optional (Standard 0,5 m).
- Ein Flug reicht von einem Kontakt bis zum nächsten Kontakt desselben
  Segments (`intercepted_by_next_contact`, nie zum Boden gezwungen). Nur der
  letzte Kontakt eines Segments darf einen Eintrag `flight_ends` haben:
  `landing_region` (Bodenkontakt innerhalb des Zeitintervalls auf das
  geprüfte Rechteck beschränkt) oder `open` (Anpassung bis zur letzten
  Beobachtung im Segment oder bis zu einem optionalen geprüften `until_s`).
  Fehlender Eintrag = open.
- Schlüssel von `physics` (alle optional): `gravity_m_s2`, `pixel_sigma_px`,
  `drag_prior_per_m`, `drag_prior_sigma`, `drag_bounds_per_m`,
  `contact_guard_s`, `contact_xy_sigma_m`, `min_observations`,
  `max_accept_rms_px`, `velocity_bound_m_s`.

## Analyseausgabe — `shuttle-replay/analysis/v1`

- `flights[]`: `t0_s` (geprüfter Kontakt), `t_end_s`, `end_type`, `params`
  (`[x, y, z, vx, vy, vz, drag_k]` beim Kontakt), `fit` (Reprojektions-RMS /
  p90 / max in px, Anzahl der Beobachtungen, Optimiererstatus), `gates`
  (Machbarkeit bezüglich Boden und Netz; Netzhöhe ≥ 1,524 m, wenn der Flug das
  Netz überquert), `parameters_at_bound` (eine Anpassung, die an einer
  Optimierergrenze festsitzt, wird abgelehnt), `accepted`,
  `model_speed_km_h` und `model_speed_coarse_km_h`,
  `first_observation_delay_s`, `observation_frame_ids`, `landing` (Flüge mit
  Landung; `exact_coordinate_measured: false`) und
  `unreturned_floor_crossing_prediction` (abgefangene/offene Flüge;
  `kind: counterfactual_if_unreturned`, `observed: false`).
- `frames[]`: `shuttle_observed_px` (gelieferte Detektion oder null),
  `shuttle_model_xyz_m` / `shuttle_model_px` (nur akzeptiertes Modell,
  gleiches Segment), `model_flight_id`, `layer` (`conditional_model`,
  `observed_pixel`, `none`, `excluded_camera_cut`).
- `provenance_vocabulary`, `assumptions`, `calibration_summary`.

## Renderbericht

`render_report.json` protokolliert den Encoder, die Anzahl der Frames, die
maximale Differenz zwischen dekodiertem Quell-PTS und Track-PTS, das Layout
6:4, ob das Audio erhalten wurde, sowie eine vollständige Dekodierung des
geschriebenen MP4.
