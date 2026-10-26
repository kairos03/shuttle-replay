# Kamerakalibrierung

Die Kalibrierung beantwortet eine einzige Frage: An welchem Pixel zeigt die
Kamera einen Punkt des Spielfelds, angegeben in Metern? `shuttle-replay`
beantwortet sie mit einem linearen Lochkameramodell, das aus Punkten geschätzt
wird, die Sie von Hand lokalisiert haben. Diese Seite erklärt die
Koordinatensysteme, die beiden Matrizen, die das Werkzeug berechnet, den
genauen Algorithmus und die Bedeutung der gemeldeten Fehler.

## Zwei Koordinatensysteme

**Bildkoordinaten** `(u, v)` sind Pixel des Quellvideos: `u` wächst nach
rechts, `v` wächst nach unten.

**Weltkoordinaten** `(X, Y, Z)` sind Meter in einem Spielfeldsystem, das durch
die BWF-Spielfeldmaße festgelegt ist
([`court.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L1-L24)):

```{figure} assets/technical/de/court.svg
:alt: Spielfeldmodell: X von 0 bis 6,10 m, Y von 0 (ferne Grundlinie) bis 13,40 m (nahe), Netzebene Y = 6,70 m, Pfosten 1,55 m, Mitte 1,524 m, Z nach oben
:class: technical-figure
:width: 100%

Spielfeldkoordinaten in Metern; Z zeigt nach oben, Z = 0 ist der Boden.
```

Linien sind 40 mm breit, und Kalibrierpunkte verwenden **Linienmitten**:
Außenlinien bei X = 0.02 / 6.08 und Y = 0.02 / 13.38, Einzel-Seitenlinien bei
X = 0.48 / 5.62, vordere Aufschlaglinien bei Y = 4.70 / 8.70, hintere
Doppel-Aufschlaglinien bei Y = 0.78 / 12.62, Mittellinie X = 3.05
([`court_lines`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L27-L52)).
Wer eine Außenkante eingibt, wo eine Mitte erwartet wird, verschiebt diesen
Punkt um 2 cm.

## Lochkameraprojektion

Eine Lochkamera bildet einen Weltpunkt mit einer 3x4-Matrix `P` auf ein Pixel
ab:

```{math}
\begin{gathered}
\begin{bmatrix} a \\ b \\ c \end{bmatrix} = P \begin{bmatrix} X \\ Y \\ Z \\ 1 \end{bmatrix} \\
u = \frac{a}{c}, \qquad v = \frac{b}{c}
\end{gathered}
```

Die Division durch `c` ist die Perspektive: Entferntes wirkt klein. `P`
verbindet Position und Drehung der Kamera (die extrinsischen Parameter) mit
ihrer Brennweite und ihrem Bildmittelpunkt (die intrinsischen Parameter). Das
Projekt zerlegt `P` nie in diese Teile; es verwendet `P` als eine einzige
Matrix
([`project`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L12-L15)).
Das Kamerazentrum `C` ist der einzige Punkt mit `P * [C, 1] = 0`, also
`C = -inverse(P[:, :3]) * P[:, 3]`
([`camera_center`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L24-L26)).

## Schritt 1: die Bodenhomographie (nur Z = 0)

Für Punkte auf dem Boden gilt `Z = 0`, daher wird die dritte Spalte von `P`
mit null multipliziert und fällt weg:

```{math}
P = \begin{bmatrix} p_1 & p_2 & p_3 & p_4 \end{bmatrix}
```

{math}`p_1, \dots, p_4` sind die vier Spalten von {math}`P`.

```{math}
\begin{aligned}
P \begin{bmatrix} X \\ Y \\ 0 \\ 1 \end{bmatrix}
&= \begin{bmatrix} p_1 & p_2 & p_4 \end{bmatrix} \begin{bmatrix} X \\ Y \\ 1 \end{bmatrix} \\
&= H \begin{bmatrix} X \\ Y \\ 1 \end{bmatrix}
\end{aligned}
```

Die 3x3-Matrix `H = [p1 p2 p4]` ist eine **Homographie**. Sie wird aus Ihren
Bodenpunkten mit `role: "fit"` mit der normalisierten direkten linearen
Transformation (DLT) in
[`fit_homography`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L58-L78)
angepasst:

1. Jede Punktmenge wird auf ihren Schwerpunkt verschoben und so skaliert, dass
   ihr mittlerer Abstand zum Schwerpunkt `sqrt(2)` beträgt
   ([`_normalize`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L36-L39)).
   Das hält das lineare System gut konditioniert, wenn Pixelwerte im
   Hunderterbereich und Meter einstellig sind.
2. Jede Korrespondenz fügt einem linearen System `A h = 0` zwei Zeilen hinzu.
3. `h` ist der rechte Singulärvektor von `A` zum kleinsten Singulärwert; die
   Normalisierung wird rückgängig gemacht und `H` so skaliert, dass
   `H[2, 2] = 1`.

Degenerierte Eingaben werden mit `CalibrationError` abgelehnt, statt eine
schlechte Matrix zu erzeugen: weniger als vier Anpassungspunkte, doppelte
Koordinaten, kollineare Punktmengen, drei kollineare Punkte von genau vier, ein
zweitkleinster Singulärwert unter dem `1e-9`-fachen des größten (Lösung nicht
eindeutig) oder eine Konditionszahl über `1e12`
([`_check_spread`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L42-L78)).

Die Anpassung ist eine normalisierte DLT, die ein algebraisches Residuum über
alle Anpassungspunkte minimiert, ohne nichtlineare Verfeinerung der
Reprojektion. Es gibt keine Ausreißerunterdrückung (kein RANSAC) und kein
Modell der Objektivverzeichnung: Ein vertippter Punkt oder starke tonnenförmige
Verzeichnung zieht die gesamte Anpassung.

`H` beschreibt nur den Boden. Die Ausgabe sagt das in `H_scope`
([`H_SCOPE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L22)).
Ein Shuttle-Pixel durch `H` zurückzuprojizieren beantwortet die Frage „wo wäre
dieses Pixel, wenn es auf dem Boden läge“, was für alles in der Luft falsch
ist.

## Schritt 2: die vertikale Spalte aus Netzankern

Die Bodenpunkte sagen nichts über `p3`, die Spalte, die mit der Höhe
multipliziert wird. Dafür braucht man Punkte bekannter Höhe, die nicht auf dem
Boden liegen: normalerweise die beiden Netzpfostenspitzen bei `Z = 1.55`. Für
einen Anker bei `(X, Y, Z)`, gesehen bei `(u, v)`, schreibt man
`q = H * [X, Y, 1]`. Die Projektionsbedingung wird linear in `p3`:

```{math}
\begin{aligned}
u \, (q_3 + Z \, p_{3,3}) &= q_1 + Z \, p_{3,1} \\
v \, (q_3 + Z \, p_{3,3}) &= q_2 + Z \, p_{3,2}
\end{aligned}
```

Je Anker umgestellt:

```{math}
\begin{bmatrix} Z & 0 & -u Z \\ 0 & Z & -v Z \end{bmatrix} p_3
= \begin{bmatrix} u \, q_3 - q_1 \\ v \, q_3 - q_2 \end{bmatrix}
```

[`camera_from_anchors`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L81-L92)
stapelt diese Zeilen, verlangt Rang 3, löst nach der Methode der kleinsten
Quadrate und setzt `P = [h1 h2 p3 h3]` zusammen, wobei `h1`, `h2`, `h3` die
Spalten von `H` sind. Drei Unbekannte und zwei Zeilen pro Anker bedeuten, dass
zwei Anker vier Gleichungen liefern: fast exakt bestimmt. Deshalb beweist ein
kleines Ankerresiduum (`net_anchor_residuals_px`) wenig. Anker müssen erhöht
liegen (`Z > 0.1 m`), und es müssen mindestens zwei sein.

Schließlich lehnt
[`_check_camera`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L95-L104)
eine Kamera ab, deren Zentrum nicht über dem Boden liegt, oder eine, die
manche Spielfeldpunkte vor und andere hinter sich platzieren würde.

## Anpassungspunkte und zurückgehaltene Punkte

Jeder Bodenpunkt hat eine Rolle
([`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L128-L205)):

- `fit`-Punkte bauen `H` auf. Ihre Residuen (`fit_ground_residuals`) sind
  Trainingsfehler und sollten klein sein.
- `heldout`-Punkte werden nie zur Anpassung verwendet. Mindestens einer ist
  erforderlich. `heldout_ground_errors` meldet pro Punkt `error_px` (`H` auf
  den Weltpunkt angewendet, verglichen mit Ihrem Pixel) und `error_m` (inverse
  `H` auf Ihr Pixel angewendet, verglichen mit dem Weltpunkt).
  `heldout_summary` gibt Anzahl, Mittelwert und Maximum beider an.

Ein konzeptionelles Beispiel: die vier äußeren Ecken als `fit` und zwei
Schnittpunkte von Aufschlaglinien als `heldout`. Sind die Fehler der
zurückgehaltenen Punkte viel größer als die Anpassungsresiduen, ist ein Punkt
falsch beschriftet, es wurde eine Linienkante statt der Mitte angeklickt, oder
das Objektiv krümmt die Linien. Der Fehler zurückgehaltener Punkte prüft nur
die Bodenabbildung; über Höhen sagt er nichts.

## Empfindlichkeit, kein Konfidenzintervall

Höhen hängen fast vollständig von den Ankern ab.
[`_anchor_sensitivity`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L107-L125)
nimmt einen Referenzpunkt `(3.05, 6.70, 3.0)`, 3 m über der Netzmittellinie,
und projiziert ihn mit `P`. Dann verschiebt sie für jeden Anker und für `u`
und `v` getrennt das Ankerpixel um `+uncertainty_px` und `-uncertainty_px`
(Standard 3.0), löst `P` neu und schneidet den Strahl durch dasselbe
Referenzpixel mit der Netzebene `Y = 6.70`. `max_vertical_shift_m` ist die
größte Höhenänderung. Lässt eine Störung die Lösung scheitern, wird die
Verschiebung als unendlich gemeldet.

Das ist ein ungünstigster Fall bei Änderung jeweils eines Parameters für einen
einzigen Punkt. Es ist kein statistisches Konfidenzintervall, kombiniert keine
Fehler mehrerer Anker und schließt den Fehler der Bodenpunkte nicht ein.

## Annahmen, die Sie treffen

- Eine feste Kamera pro `segment_id`; eine Kamerabewegung oder ein Zoom
  erfordert ein neues Segment.
- Gerade Linien bleiben im Bild gerade (keine Objektivverzeichnung).
- Die Anker haben die Höhen, die Sie eingeben. Pfostenspitzen bei 1.55 m und
  die Netzmitte bei 1.524 m sind unterschiedliche Höhen.
- Die Bodenebene ist nicht der Shuttle. `H` liefert Bodenpositionen; die Tiefe
  des Shuttles stammt ausschließlich aus der physikalischen Anpassung, die in
  [Flugbahnphysik](trajectory-physics.md) beschrieben ist.

Siehe [die Schemas](schemas.md) für alle Ein- und Ausgabefelder und
[Validierung und Grenzen](validation-limits.md) dafür, wie man die Fehler
zusammen mit der Flugdiagnostik liest.
