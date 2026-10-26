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

```{math}
\begin{aligned}
\frac{d\mathbf{r}}{dt} &= \mathbf{v} \\
\frac{d\mathbf{v}}{dt} &= -k \, \lVert \mathbf{v} \rVert \, \mathbf{v} - g \, \mathbf{e}_z
\end{aligned}
```

| Symbol | Bedeutung |
|---|---|
| {math}`g` | Schwerebeschleunigung, Standard 9,81 m/s², per Review gesetzt (`"physics": "gravity_m_s2"`) |
| {math}`k` | Widerstandsbeiwert je Flug, Einheit 1/m |
| {math}`\lVert \mathbf{v} \rVert` | Geschwindigkeitsbetrag in m/s |
| {math}`\mathbf{e}_z` | Einheitsvektor nach oben |

```{figure} assets/technical/de/trajectory.svg
:alt: Synthetisches Beispiel: Höhe über horizontaler Entfernung vom Start, mit Widerstand k = 0,18 1/m und ohne Widerstand k = 0
:class: technical-figure
:width: 100%

Synthetisches Beispiel aus gewählten Anfangsbedingungen, berechnet mit simulate des Pakets; keine Messung, kein angepasster Flug und kein Leistungsbenchmark.
```

```{figure} assets/technical/de/speed.svg
:alt: Synthetisches Beispiel: Geschwindigkeit |v| in m/s über der Zeit, k = 0,18 1/m und ohne Widerstand k = 0
:class: technical-figure
:width: 100%

Geschwindigkeit desselben synthetischen Beispiels aus dem integrierten Geschwindigkeitszustand; die Kurve ohne Widerstand dient nur dem Vergleich.
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

```{math}
\begin{aligned}
\rho_\mathrm{pixels} &= \frac{\operatorname{project}(P, \mathbf{r}(t_i)) - \mathbf{uv}_i}{\mathtt{pixel\_sigma\_px}} \\
\rho_\mathrm{start} &= \frac{\mathbf{r}(0) - \mathtt{contact\_prior}}{\mathtt{start\_sigma}} \\
\rho_\mathrm{drag} &= \frac{k - 0.18}{0.15} \\
\rho_\mathrm{intercept} &= \frac{\mathbf{r}(T) - \mathtt{next\_contact\_prior}}{\mathtt{next\_contact\_sigma}} \\
\mathbf{d}^{-} &= \max\!\left(\mathbf{b}_{\min}-\mathbf{r}_{xy}(T),\mathbf{0}\right) \\
\mathbf{d}^{+} &= \max\!\left(\mathbf{r}_{xy}(T)-\mathbf{b}_{\max},\mathbf{0}\right) \\
\mathbf{d}_\mathrm{out} &= \mathbf{d}^{-}+\mathbf{d}^{+} \\
\rho_\mathrm{landing} &= \left(\frac{z(T)}{0.01},\frac{d_{\mathrm{out},x}}{0.02},\frac{d_{\mathrm{out},y}}{0.02}\right) \\
\rho_\mathrm{floor} &= \frac{\min(z, 0)}{0.01} \\
\rho_\mathrm{net} &= \frac{\max(0,\ 1.55 - h_\mathrm{net})}{0.02}
\end{aligned}
```

| Term | Skala oder Bedingung |
|---|---|
| {math}`\rho_\mathrm{pixels}` | Standard 3,0 px |
| {math}`\rho_\mathrm{start}` | xy 0,5 m, Höhe 0,3 m |
| {math}`\rho_\mathrm{drag}` | immer |
| {math}`\rho_\mathrm{intercept}` | nur abgefangene |
| {math}`\rho_\mathrm{landing}` | nur bei Landung; drei Komponenten: Höhe und Überschreitung der Region je Koordinate. {math}`\mathbf{d}_\mathrm{out}` ist ein zweikomponentiger Vektor; {math}`\mathbf{b}_{\min}` und {math}`\mathbf{b}_{\max}` sind die Regionsgrenzen; max wird komponentenweise angewendet |
| {math}`\rho_\mathrm{floor}` | an 41 Stützstellen von 0 bis {math}`T` |
| {math}`\rho_\mathrm{net}` | nur wenn ein Überqueren gefordert ist |

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

```{math}
\begin{aligned}
x &\in [-3,\ 9.1]\ \mathrm{m} \\
y &\in [-3,\ 16.4]\ \mathrm{m} \\
z &\in [0.05,\ 4.5]\ \mathrm{m} \\
v_x, v_y, v_z &\in [-v_{\max},\ +v_{\max}] \\
k &\in \mathtt{drag\_bounds\_per\_m}
\end{aligned}
```

Standardwerte: {math}`v_{\max}` = `velocity_bound_m_s` 120 m/s; `drag_bounds_per_m` [0.015, 0.6] 1/m. Die Landezeit {math}`T` liegt im geprüften Landeintervall (nur Flüge mit Landung).

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
