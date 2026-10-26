# Flugbahnphysik

Eine Kamera sieht einen Shuttle als Pixel. Jeder Punkt auf der Sichtlinie
durch dieses Pixel, nah oder fern, landet auf demselben Pixel, daher kann ein
einzelnes Bild keine Tiefe angeben. Diese Seite erklärt, wie `shuttle-replay`
trotzdem eine Folge von Pixeln in einen 3D-Flug verwandelt, indem es Physik und
geprüfte Randbedingungen hinzufügt, und was das Ergebnis bedeutet und was
nicht.

## Das inverse Problem

Stellen Sie sich jede Detektion als Strahl aus der Kamera vor. Ein Flug ist
eine Kurve, die zur richtigen Zeit nahe an jedem Strahl vorbeiführen muss.
Viele Kurven schaffen das: Ein langsamer, naher Flug und ein schneller,
entfernter können ähnliche Pixelspuren erzeugen. Das Problem ist
unterbestimmt. Das Werkzeug wählt eine Kurve, indem es verlangt, dass sie:

- Schwerkraft und Luftwiderstand gehorcht (das Modell unten),
- nahe an der geprüften Kontaktposition und -höhe zur geprüften Kontaktzeit
  beginnt,
- weich zum nächsten geprüften Kontakt oder zu einem geprüften Landebereich
  gezogen wird oder am Ende des beobachteten Fensters endet
  (Endpunktresiduen sind Strafterme, keine harten Annahmebedingungen), und
- über dem Boden bleibt und das Netz überquert, wenn sie es kreuzen soll.

Der angepasste 3D-Pfad ist daher ein **bedingtes Modell**: die
konsistenteste Kurve bei gegebener Kalibrierung und Prüfung, keine Messung
([Docstring des Moduls `analysis.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L1-L10)).

## Das Flugmodell

Der Zustand ist die Position `r = (x, y, z)` in Metern und die
Geschwindigkeit `v` in m/s. Die Bewegungsgleichungen
([`_rhs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L16-L23)):

```text
 dr/dt = v
 dv/dt = -k * |v| * v  -  g * e_z

 g    gravity, default 9.81 m/s^2 (review "physics": "gravity_m_s2")
 k    drag coefficient per flight, units 1/m
 |v|  speed in m/s
 e_z  unit vector pointing up
```

Der Luftwiderstand wirkt gegen die Bewegung und wächst mit dem Quadrat der
Geschwindigkeit. Eine nützliche Deutung von `k`: Ein senkrecht fallender
Shuttle hört auf zu beschleunigen, wenn der Widerstand der Schwerkraft
entspricht, bei der Grenzgeschwindigkeit `sqrt(g / k)`. Mit dem
Standard-Prior `k = 0.18 1/m` sind das etwa 7.4 m/s. Ein mit hoher
Geschwindigkeit geschlagener Shuttle bremst daher stark ab; das Modell kennt
keinen Drall, kein Taumeln und keinen Wind.

Die sieben angepassten Parameter sind `[x, y, z, vx, vy, vz, k]` zur
**Flugzeit null**, also zur geprüften Kontaktzeit, nicht zur Zeit der ersten
Detektion
([Docstring des Moduls `physics.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L1-L8)).
Detektionen beginnen oft einige Frames nach dem Kontakt, weil Schläger oder
Spieler den Shuttle verdecken. Diese Frames werden als Versatz zum Kontakt
gemessen, sodass eine späte erste Detektion den Flugbeginn nicht verschiebt
(`first_observation_delay_s` meldet die Lücke).

## Numerische Integration

[`simulate`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L26-L40)
integriert die Gleichungen mit SciPy `solve_ivp` (dessen explizitem
Standard-Runge-Kutta-Verfahren) ab `t = 0` mit `rtol=1e-7`, `atol=1e-8`,
`max_step=0.02` Sekunden und dichter Ausgabe und wertet dann die Positionen zu
den angeforderten Zeiten aus. Nicht endliche Zeiten und Zeiten unter `-1e-9` s
werden abgelehnt; winzige negative Werte darüber werden auf null gesetzt.
Solver-Toleranzen steuern den numerischen Integrationsfehler; sie sind keine
Schranken für die Rekonstruktionsgenauigkeit.
[`floor_crossing`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L43-L63)
verwendet eine Ereignisfunktion auf `z` (nur absteigend, terminal) mit
strengeren Toleranzen (`rtol=1e-9`, `atol=1e-10`, `max_step=0.01`) über einen
Horizont von 10 s.

## Was minimiert wird

[`fit_flight`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L57-L151)
baut einen Residuenvektor. Jeder Eintrag ist eine Differenz geteilt durch eine
Skala, sodass „1“ „ein erwarteter Fehler“ bedeutet:

```text
 pixels    (project(P, r(t_i)) - uv_i) / pixel_sigma_px            default 3.0 px
 start     (r(0) - contact_prior) / start_sigma                     xy 0.5 m, height 0.3 m
 drag      (k - 0.18) / 0.15
 intercept (r(T) - next_contact_prior) / next_contact_sigma         intercepted only
 landing   z(T) / 0.01   and   distance outside region / 0.02       landing only
 floor     min(z, 0) / 0.01 on 41 samples from 0 to T
 net       max(0, 1.55 - h_net) / 0.02                              only if a crossing is required
```

`T` ist die Flugdauer. Der Kontakt-Prior stammt aus
[`_contact_prior`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L49-L54):
Hat der Kontakt `image_px`, wird der Strahl durch dieses Pixel mit der Ebene in
der geprüften Höhe `height_m` geschnitten; andernfalls werden `court_xy_m` und
`height_m` direkt verwendet. Die Sigmas stammen aus `xy_sigma_m` und
`height_sigma_m` jedes Kontakts, ersatzweise aus den gezeigten
Standardwerten.

Im Netzterm ist `h_net` die interpolierte Höhe, bei der der Pfad aus
41 Stichproben `Y = 6.70` zum ersten Mal kreuzt; kreuzt der Pfad nie, zählt
`h_net` als 0. Dieser Term verwendet 1.55 m (Pfostenhöhe), wie im Quellcode
geschrieben; die Annahmeprüfung unten verwendet 1.524 m (Netzmitte).

SciPy `least_squares` minimiert die Summe mit `loss="soft_l1"` und
`f_scale=1.5`, sodass einige schlechte Detektionen weniger ziehen als bei
reinen Quadraten. Es startet von sechs Startpunkten: `k` aus
`0.1, 0.2, 0.35` kombiniert mit einer zusätzlichen Aufwärtsgeschwindigkeit von
`1.0` oder `3.0` m/s, die zu einer ballistischen Schätzung in Richtung des
Endziels addiert wird. Das Ergebnis mit den geringsten Kosten gewinnt.
Schranken halten die Suche physikalisch
([Quelle](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L64-L69)):

```text
 x in [-3, 9.1] m     y in [-3, 16.4] m     z in [0.05, 4.5] m
 vx, vy, vz in [-velocity_bound_m_s, +velocity_bound_m_s]    default 120 m/s
 k in drag_bounds_per_m                                      default [0.015, 0.6] 1/m
 landing time T in the reviewed landing bracket (landing flights only)
```

Die sieben Zustands- und Widerstandsparameter werden in
`parameters_at_bound` markiert, wenn ihr Abstand zu einer Schranke weniger als
0.1 % ihres zulässigen Bereichs beträgt
([Quelle](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L129-L135)).
Eine markierte Anpassung wird abgelehnt. Die Landezeit ist in dieser Diagnose
nicht enthalten. Das Bestehen belegt weder Identifizierbarkeit noch
Eindeutigkeit noch Freiheit vom Einfluss der Priors.

## Wie ein Flug endet

Flüge werden pro Kamerasegment aus Kontakten in zeitlicher Reihenfolge
aufgebaut
([`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L291)):

- **`intercepted_by_next_contact`**: Im selben Segment folgt ein weiterer
  Kontakt. Die Dauer ist die Zeit zwischen den Kontakten; das Ende wird zum
  Prior des nächsten Kontakts gezogen. Eine Netzüberquerung ist erforderlich,
  wenn die Priors der beiden Kontakte auf verschiedenen Seiten des Netzes
  liegen.
- **`landing_region`**: Der letzte Kontakt eines Segments hat ein geprüftes
  Landeende. Kontakt- und Landeendpunktresiduen ziehen die Anpassung weich zum
  geprüften Endpunkt. Die Landezeit ist durch das geprüfte Intervall
  beschränkt, aber Endpunkthöhe und Zugehörigkeit zum Bereich sind keine
  harten Annahmebedingungen. `landing.within_region` meldet die Zugehörigkeit
  mit 1 mm Spielraum; es steuert die Annahme nicht. Eine Überquerung ist
  erforderlich, wenn Start und Bereichsmitte auf verschiedenen Seiten des
  Netzes liegen.
- **`open_segment_end`**: alles andere. Das Fenster endet am Segmentende oder
  bei `until_s`, die Anpassungsdauer ist der Versatz der letzten Beobachtung,
  und keine Netzüberquerung ist erforderlich.

Weniger als `min_observations` (Standard 4) Detektionen im Fenster ergeben
`status: "insufficient_observations"` ohne Anpassung.

## Annahmeprüfungen

Nach der Anpassung wird der Pfad an 201 Punkten abgetastet und von
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106)
geprüft: `floor_ok` verlangt, dass der tiefste Punkt bei oder über -0.02 m
liegt. `net_ok` verlangt eine Überquerung, wenn eine erforderlich war, und
**jede** zwischen benachbarten Stichproben erkannte Überquerung muss bei oder
über 1.524 m liegen, unabhängig davon, ob eine Überquerung erwartet wurde. Ein
Flug wird nur angenommen, wenn der Optimierer Erfolg meldet, beide Prüfungen
bestanden sind, der Reprojektions-RMS höchstens `max_accept_rms_px`
(Standard 8.0 px) beträgt und keiner der sieben Zustands- und
Widerstandsparameter markiert ist. Abgelehnte Flüge behalten ihre Parameter
zur Inspektion, werden aber nicht als Modellebene gezeichnet.

## Geschwindigkeit und die kontrafaktische Landung

`model_speed_km_h` ist `|v(0)| * 3.6`, die Anfangsgeschwindigkeit des Modells,
und `model_speed_coarse_km_h` rundet sie für die Anzeige auf die nächsten
5 km/h. Das ist kein Radarmesswert.

Für Flüge, die nicht in einem Landebereich enden, fügt die Analyse, falls das
Modell den Boden nach Flugende erreichen würde,
`unreturned_floor_crossing_prediction` mit
`kind: "counterfactual_if_unreturned"` und `observed: false` hinzu. Das
beantwortet „wo würde dieses Modell landen, wenn niemand es zurückgeschlagen
hätte“, nicht, wohin der Shuttle flog. Bei Landeflügen ist `landing.xy_m` der
Modellendpunkt, weich zu Ihrem Bereich gezogen (es ist nicht garantiert, dass
er darin liegt), und `exact_coordinate_measured` ist immer `false`.

Verwandt: [Kamerakalibrierung](camera-calibration.md) zu `P`,
[Beobachtungen und Zeit](observations-timing.md) zum Beobachtungsfenster,
[Validierung und Grenzen](validation-limits.md) zur Deutung von `fit` und
`gates`.
