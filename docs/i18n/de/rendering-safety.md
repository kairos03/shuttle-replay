# Rendering und Ausgabesicherheit

Der Renderer erzeugt ein Replay-MP4: links das Quellbild, rechts eine
Draufsicht des Spielfelds. Er hat zwei Aufgaben, die genauso wichtig sind wie
das Zeichnen selbst: das Timing der Quelle unverändert erhalten und nie eine
Datei beschädigen oder überschreiben. Alles auf dieser Seite steht in
[`render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py).

## Decodieren, zeichnen, codieren

PyAV kapselt die FFmpeg-Bibliotheken im Python-Prozess. Der Renderer öffnet
die Quelle, nimmt den ersten Videostream und, falls vorhanden, den ersten
Audiostream und demultiplext ihre Pakete in Dateireihenfolge
([`render`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L128-L279)).

```text
 source.mp4 --demux--> video packets --decode--> frame k --check--> draw --encode--> staging.mp4
                  \--> audio packets ----------------------------- copy ----------/
```

Für jeden decodierten Videoframe `k` prüft er vor dem Zeichnen, dass:

- die Analyse überhaupt einen Frame `k` hat und dessen `frame_id` gleich `k`
  ist,
- der decodierte Frame einen PTS hat, und
- die decodierte Zeit höchstens `1e-3` s vom `pts_s` der Analyse abweicht.

Jeder Fehler löst `RenderError` aus und nennt den Frame. Nach dem letzten
Paket muss die Anzahl decodierter Frames der Anzahl der Analyseframes
entsprechen.

Die Codierung versucht `libx264`, dann `h264`, dann `mpeg4`, je nachdem, was
der lokale FFmpeg-Build öffnen kann, mit dem Pixelformat `yuv420p`
([`_open_encoder`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L77-L90)).
Der Encoder verwendet die `time_base` des Quellvideos; nur bei `mpeg4` mit
einem `time_base`-Nenner über 65535 weicht er auf 1/60000 s aus. Jeder
Ausgabeframe erhält die Zeit des Quellframes, umgerechnet in diese
`time_base`, sodass eine variable Bildrate variabel bleibt. Das beim Anlegen
des Streams übergebene `rate=30` ist ein Nominalwert; die Framezeiten stammen
aus der Quelle.

Zeitstempel des Ausgabevideos werden auf Encoder-Ticks gerundet. Die
Verifikation prüft die Anzahl der Ausgabeframes, vergleicht aber nicht jeden
decodierten Video-PTS der Ausgabe mit der Quelle. Die Audioverifikation
vergleicht die Präsentationszeiten der Pakete und den ersten decodierten
A/V-Versatz
([Quelle](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L213-L242)).

## Layout

```text
 +--------------------------+------------------+
 |                          |  TOP VIEW        |
 |  source frame, unscaled  |  (court scaled   |
 |  W x H                   |   to fit, 4/6 W) |
 +--------------------------+------------------+
            6                        4
```

`W` und `H` sind Breite und Höhe der Quelle, auf gerade Zahlen aufgerundet
(H.264 braucht gerade Größen); die Breite der Draufsicht ist
`2 * round(W * 4 / 6 / 2)`. Das Quellbild wird im Maßstab 1.0 in die linke
obere Ecke eingefügt; das Aufrunden fügt höchstens eine schwarze Pixelzeile
oder -spalte hinzu. Die Draufsicht
([`TopView`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L49-L69))
skaliert das Spielfeld von 6.10 x 13.40 m mit Rand passend in ihr Feld und
behält die Proportionen des Spielfelds bei.

Pillow zeichnet die Überlagerungen
([`_compose`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L282-L336)):

- grüner Ring: Ihre Detektion (`shuttle_observed_px`);
- oranger Ring: die Projektion des Modells (`shuttle_model_px`);
- Spielerboxen, falls Ihre Tracks sie enthalten;
- Draufsicht: Spielfeldlinien, das Netz, die Modellspur des aktuellen Flugs,
  ein Punkt, dessen Größe mit der Modellhöhe wächst, `z` und die gerundete
  Modellgeschwindigkeit;
- Landeflüge: der geprüfte Bereich als gestricheltes Rechteck und, ab der
  Landezeit, ein oranges Kreuz am Landepunkt des Modells.

Frames mit Kameraschnitt zeigen „camera cut: excluded from replay“ und keine
Shuttle-Überlagerung. Synthetische Eingaben fügen dem Titel der Draufsicht
`SYNTHETIC` hinzu.

## Audio: Stream-Kopie, keine Neucodierung

Audio wird weder decodiert noch neu codiert. Jedes Audiopaket wird mit seinen
ursprünglichen Zeitstempeln in den neuen Container kopiert
(`add_stream_from_template`, dann `mux`). Pakete ohne DTS werden übersprungen.
So bleiben der Audio-Startversatz der Quelle und etwaige Lücken erhalten, was
wichtig ist, weil Audio in echten Dateien oft einen Sekundenbruchteil nach dem
Video beginnt.

Die Stream-Kopie funktioniert nur, wenn MP4 den Audiocodec der Quelle
akzeptiert. Kann der Stream nicht angelegt oder ein Paket nicht gemultiplext
werden, schlägt das Rendering mit einem `RenderError` fehl, der den Fehler der
Stream-Kopie beschreibt; Fehler beim Anlegen des Streams nennen den Codec. Es
gibt keinen Rückfall auf Neucodierung, daher wird nicht jedes Audioformat
unterstützt. Eine Quelle ohne Audio ergibt ein stummes MP4, gemeldet als
`"source has no audio stream; output is silent"`.

## Verifikation vor der Veröffentlichung

Der Renderer schreibt in eine Staging-Datei und prüft sie, bevor irgendetwas
unter Ihrem Ausgabepfad erscheint:

1. [`verify_mp4`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L339-L361)
   decodiert die Staging-Datei vollständig; die Anzahl decodierter
   Videoframes muss der Anzahl der Analyseframes entsprechen.
2. Mit Audio muss die erste Audiozeit minus der ersten Videozeit innerhalb von
   `1e-3` s mit der Quelle übereinstimmen
   ([`_first_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L104-L117)).
3. Die Liste der Audiopaketzeiten muss mit der der Quelle identisch sein
   ([`_audio_packet_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L120-L125)).

Der Render-Bericht hält diese Ergebnisse fest: `pts_check.max_abs_diff_s`,
`audio.av_offset_error_s`, `audio.packets_copied` und die
`verification`-Zähler.

## Ausgabe ohne Überschreiben

Vor jeder Arbeit lehnt
[`_check_paths`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L93-L101)
eine fehlende Quelle ab, eine Ausgabe, die zur Quelle aufgelöst wird
(einschließlich eines symbolischen oder harten Links darauf), und jeden
Ausgabepfad, der bereits existiert, selbst einen verwaisten symbolischen Link.
Nichts wird jemals überschrieben.

Die Staging-Datei wird mit `tempfile.mkstemp` im Ausgabeverzeichnis unter
einem eindeutigen Namen der Form `.<stem>.<random>.staging.mp4` angelegt. Nach
der Verifikation erzeugt `os.link` die Ausgabe als harten Link darauf. Ein
harter Link schlägt fehl, wenn der Zielname existiert, sodass die
Veröffentlichung keine Datei ersetzen kann, die während des Renderns
aufgetaucht ist. Der Staging-Name wird in einem `finally`-Block bei Erfolg und
bei Fehler entfernt, sodass eine fremde Datei im Verzeichnis nie berührt wird.
Das setzt voraus, dass das Dateisystem des Ausgabeverzeichnisses harte Links
unterstützt.

Die CLI wendet dieselbe Regel auf JSON an: `_refuse_existing` prüft vorab
jeden Ausgabepfad, und `_dump` öffnet Dateien im exklusiven Erstellmodus
([`cli.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L34-L63)).
`run` veröffentlicht das Video, bevor die beiden JSON-Dateien geschrieben
werden, daher bilden die drei Ausgaben keine atomare Transaktion. Es prüft
zuerst alle drei Ausgaben, sodass eine übergebene Eingabe, die zufällig unter
`<out-dir>/analysis.json` liegt, abgelehnt statt überschrieben wird.
Dateinamen erreichen nie eine Shell; der Test
`test_render_rejects_mismatched_pts_and_handles_hostile_filename` rendert aus
einem Namen mit Shell-Metazeichen.

Verwandt: [Beobachtungen und Zeit](observations-timing.md) zu `pts_s`,
[Validierung und Grenzen](validation-limits.md) dazu, was die Medienprüfungen
beweisen, [die Schemas](schemas.md) zum Render-Bericht.
