# Validierung und Grenzen

`shuttle-replay` meldet viele Zahlen über seine eigenen Ergebnisse. Jede
beantwortet eine enge Frage. Diese Seite sagt für jede Prüfung, was sie zeigt,
was sie nicht zeigt und welcher Test im Repository sie ausübt. Genauigkeits-
oder Geschwindigkeitswerte für reale Aufnahmen werden hier nicht angegeben,
weil das Projekt keine gemessen hat.

## Was jede Prüfung beweist

**Fehler zurückgehaltener Bodenpunkte** (`heldout_summary`,
[`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L175-L197)).
Beweist: Die Bodenhomographie sagt Spielfeldpunkte voraus, an die sie nicht
angepasst wurde. Beweist nicht: irgendetwas über Höhen, die Netzanker oder den
Shuttle.

**Residuen und Empfindlichkeit der Netzanker** (`net_anchor_residuals_px`,
`net_anchor_sensitivity`). Mit zwei Ankern ist die vertikale Spalte fast exakt
bestimmt, daher ist das Residuum fast schon konstruktionsbedingt nahe null.
Der Empfindlichkeitswert zeigt, wie weit sich ein Referenzpunkt 3 m über dem
Netz bewegt, wenn sich eine Ankerkoordinate um ihre angegebene
Pixelunsicherheit verschiebt. Es ist ein Was-wäre-wenn, kein
Konfidenzintervall. Siehe [Kamerakalibrierung](camera-calibration.md).

**Reprojektionsfehler** (`fit.reprojection_rms_px`, `reprojection_p90_px`,
`reprojection_max_px`). Beweist: Die Projektion des Modells verläuft nahe an
Ihren 2D-Detektionen. Beweist nicht: dass der 3D-Pfad stimmt. Eine andere
Tiefe mit einer anderen Geschwindigkeit kann auf fast dieselben Pixel
projizieren; das ist die in [Flugbahnphysik](trajectory-physics.md)
beschriebene Unterbestimmtheit. Die Standard-Annahmegrenze ist 8.0 px RMS.

**Boden- und Netzprüfungen** (`gates`,
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106)).
Das Bestehen zeigt, dass die 201 abgetasteten Höhen mindestens −0.02 m
betragen, jede erkannte, zwischen benachbarten Stichproben interpolierte
Überquerung mindestens 1.524 m hoch ist und eine Überquerung stattfindet, wenn
sie erforderlich ist. Diese Prüfungen belegen weder allgemeine physikalische
Plausibilität noch Genauigkeit in der realen Welt.

**`parameters_at_bound` und `optimizer_success`**. Eine nicht konvergierte
Anpassung wird abgelehnt. Die sieben Zustands- und Widerstandsparameter werden
markiert, wenn ihr Abstand zu einer Schranke weniger als 0.1 % ihres
zulässigen Bereichs beträgt. Eine markierte Anpassung wird abgelehnt. Die
Landezeit ist in dieser Diagnose nicht enthalten. Das Bestehen belegt weder
Identifizierbarkeit noch Eindeutigkeit noch Freiheit vom Einfluss der Priors.

**Medienprüfungen** (Render-Bericht). Beweisen: Jeder Quellframe wurde nach
Index und PTS zugeordnet, die Ausgabe decodiert mit der richtigen
Frame-Anzahl, und die Audiopakete haben ihre Zeiten behalten. Beweisen nicht:
dass Ihr `pts_s` aus derselben Datei stammt, auf der die Detektionen erstellt
wurden, über die PTS-Übereinstimmung selbst hinaus.

**Synthetische Rekonstruktion** (`demo`, `synthetic_recovery.json`).
`synthetic_recovery.json` meldet Vergleiche mit synthetischer Ground Truth.
Tests prüfen ausgewählte Rekonstruktionstoleranzen für bestimmte synthetische
Fälle; das bloße Erzeugen des Berichts erzwingt diese Toleranzen nicht. Keines
von beiden zeigt Genauigkeit auf echtem Video. Das `label` der Datei sagt es:
"SYNTHETIC ground-truth recovery; not evidence of accuracy on real video".

## Wo Unsicherheit qualitativ ist

Die Anpassung hat Sigmas, aber die Ausgabe macht daraus keine Fehlerbalken. Es
gibt keine Kovarianz, kein Bootstrap und kein Konfidenzintervall für Position,
Geschwindigkeit oder Landepunkt. Unsicherheit wird stattdessen durch Labels
ausgedrückt: `conditional_model`, `exact_coordinate_measured: false`,
`speed_scope` und die `assumptions`-Liste in jeder Analysedatei
([`ASSUMPTIONS`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L39-L46)).
Die grobe Rundung der Geschwindigkeit auf 5 km/h ist eine Anzeigeentscheidung,
keine Fehlerschätzung.

## Warum es nichts anderes ist

- **Kein gemessenes 3D.** Eine Kamera liefert Strahlen, keine Punkte. Die
  Tiefe stammt aus dem physikalischen Modell plus Ihren geprüften Kontakten.
- **Keine dichte Tiefe.** Es gibt keine Tiefenkarte pro Pixel und kein
  gelerntes Tiefennetz. Nur der Shuttle entlang angepasster Flüge erhält eine
  3D-Position.
- **Kein automatisches IN/OUT.** `landing.inside_court` vergleicht einen
  Modellpunkt mit der äußeren Spielfeldgrenze. Der Punkt wird weich zu dem von
  Ihnen gezeichneten Bereich gezogen, daher spiegelt die Antwort überwiegend
  Ihre Prüfung wider; die Zugehörigkeit zum Bereich ist keine harte
  Annahmebedingung (`landing.within_region` meldet sie mit 1 mm Spielraum). Es
  gibt keine Linienrichterlogik, keine Einzel-/Doppelregel und keine Messung,
  wo der Shuttle aufkam.

## Reihenfolge der Fehlersuche

Wenn ein Flug falsch aussieht, lesen Sie die Pipeline von unten nach oben:

1. **Kalibrierung.** Große `heldout_summary`-Fehler oder ein großes
   `max_vertical_shift_m`: Korrigieren Sie zuerst Punkte oder Anker. Nichts
   weiter hinten kann das ausgleichen.
2. **Eingaben.** `observation_frame_ids` und `first_observation_delay_s`:
   Enthält das Fenster die erwarteten Detektionen?
3. **Status.** `insufficient_observations` bedeutet zu wenige Detektionen;
   `rejected_by_gates_or_fit` bedeutet, die nächsten beiden Punkte anzusehen.
4. **Anpassung.** `optimizer_success`, `parameters_at_bound`, Reprojektions-RMS
   und -Maximum. Ein riesiges Maximum bei niedrigem RMS deutet auf eine
   einzelne schlechte Detektion hin.
5. **Prüfungen.** `minimum_height_m`, `net_crossing_required`,
   `net_crossing_occurred`, `net_crossing_height_m`. Eine fehlgeschlagene
   Netzprüfung bedeutet oft einen Kontakt auf der falschen Seite oder eine
   falsche Kontakthöhe.
6. **Render-Bericht.** PTS-Abweichungen oder Fehler bei der Frame-Anzahl
   bedeuten, dass die Tracks nicht zu genau dieser Videodecodierung gehören.

## Belegübersicht

| Aussage | Test |
| --- | --- |
| Zurückgehaltene Punkte getrennt gemeldet; `H` nur für Z=0 gekennzeichnet | `test_calibration_recovers_camera_and_reports_heldout_separately` |
| Schlechte Kalibriereingaben abgelehnt | `test_calibration_rejects_invalid_inputs`, `test_calibration_rejects_collinear_fit_points` |
| Inkonsistente Tracks oder Prüfungen abgelehnt, nicht repariert | `test_inconsistent_inputs_are_rejected_not_repaired`, `test_missing_segment_calibration_is_rejected` |
| Der Kontakt, nicht die erste Detektion, ist Zeitpunkt null | `test_delayed_first_observation_keeps_contact_as_time_zero` |
| Flüge bleiben innerhalb eines Segments | `test_flights_never_bridge_camera_segments` |
| Fehlende Detektionen bleiben null | `test_missing_detection_provenance_is_null_not_filled` |
| Landung ist eine Randbedingung, keine Messung | `test_landing_region_is_a_constraint_not_a_measurement` |
| Abgefangene Flüge werden nicht zur Landung gezwungen | `test_intercepted_flight_is_not_forced_to_land` |
| Netz- und Bodenprüfungen | `test_physical_gates_reject_net_and_floor_violations`, `test_actual_low_net_crossing_rejected_without_expected_crossing` |
| An Schranken festsitzende Anpassungen abgelehnt; `until_s`-Fenster | `test_open_flight_window_and_bound_pinned_fits` |
| Spielfeld-Linienmitten | `test_court_lines_are_line_centres_of_40mm_lines_inside_outer_boundary` |
| PTS- und Frame-Anzahl-Prüfungen; feindliche Dateinamen | `test_render_rejects_mismatched_pts_and_handles_hostile_filename` |
| Spuren bleiben innerhalb eines Flugs | `test_trails_stay_inside_one_flight_and_segment` |
| Kein Überschreiben der Quelle oder vorhandener Dateien | `test_render_never_overwrites_source_or_existing_files`, `test_cli_rejects_output_aliasing_inputs` |
| Audioversatz und Lücken erhalten | `test_audio_is_stream_copied_with_source_relative_offset` |
| End-to-End-Artefakte der Demo | `test_demo_end_to_end_creates_verified_artifacts`, `test_run_command_from_existing_inputs` |

Alle Tests liegen in
[`tests/`](https://github.com/KAIROS03/shuttle-replay/tree/6e9a060b5cc964f02d4017d806e953ffea89c8b4/tests).
Die meisten Flugtests laufen auf der synthetischen Szene aus
[`synthetic.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py),
daher bestätigen sie Verhalten und Verträge, nicht Genauigkeit in der realen
Welt. Nicht durch Tests abgedeckt: Objektivverzeichnung, die das Werkzeug
nicht modelliert, und andere Audiocodecs als das in den Tests verwendete AAC.

Verwandt: [der Arbeitsablauf](workflow.md) zur Liste der Grenzen,
[das Benutzerhandbuch](guide.md) zum Lesen der Ergebnisse.
