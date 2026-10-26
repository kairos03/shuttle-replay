# Rendering e sicurezza dell'output

Il renderer produce un MP4 di replay: il fotogramma originale a sinistra e una
vista dall'alto del campo a destra. Ha due compiti importanti quanto il
disegno stesso: mantenere intatta la temporizzazione dell'originale e non
danneggiare né sovrascrivere mai un file. Tutto ciò che è in questa pagina si
trova in
[`render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py).

## Decodificare, disegnare, codificare

PyAV incapsula le librerie FFmpeg dentro il processo Python. Il renderer apre
l'originale, prende il primo stream video e, se presente, il primo stream
audio, e ne demultiplexa i pacchetti nell'ordine del file
([`render`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L128-L279)).

```text
 source.mp4 --demux--> video packets --decode--> frame k --check--> draw --encode--> staging.mp4
                  \--> audio packets ----------------------------- copy ----------/
```

Per ogni fotogramma video decodificato `k`, prima di disegnare, verifica che:

- l'analisi abbia un fotogramma `k`, e che il suo `frame_id` sia uguale a `k`,
- il fotogramma decodificato abbia un PTS, e
- il tempo decodificato differisca dal `pts_s` dell'analisi al massimo di
  `1e-3` s.

Qualsiasi errore solleva `RenderError`, indicando il fotogramma. Dopo
l'ultimo pacchetto, il numero di fotogrammi decodificati deve essere uguale al
numero di fotogrammi dell'analisi.

La codifica prova `libx264`, poi `h264`, poi `mpeg4`, quello che la build
locale di FFmpeg riesce ad aprire, con formato pixel `yuv420p`
([`_open_encoder`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L77-L90)).
L'encoder usa il `time_base` del video originale; solo per `mpeg4` con un
denominatore di `time_base` superiore a 65535 ripiega su 1/60000 s. Ogni
fotogramma di output riceve il tempo del fotogramma originale convertito in
quel `time_base`, quindi un frame rate variabile resta variabile. Il `rate=30`
passato alla creazione dello stream è un valore nominale; i tempi dei
fotogrammi vengono dall'originale.

I timestamp del video di output sono arrotondati ai tick dell'encoder. La
verifica controlla il numero di fotogrammi di output, ma non confronta ogni
PTS video di output decodificato con l'originale. La verifica dell'audio
confronta i tempi di presentazione dei pacchetti e il primo offset A/V
decodificato
([codice](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L213-L242)).

## Layout

```text
 +--------------------------+------------------+
 |                          |  TOP VIEW        |
 |  source frame, unscaled  |  (court scaled   |
 |  W x H                   |   to fit, 4/6 W) |
 +--------------------------+------------------+
            6                        4
```

`W` e `H` sono larghezza e altezza dell'originale arrotondate per eccesso a
numeri pari (H.264 richiede dimensioni pari); la larghezza della vista
dall'alto è `2 * round(W * 4 / 6 / 2)`. Il fotogramma originale viene
incollato in scala 1.0 nell'angolo in alto a sinistra; l'arrotondamento per
eccesso aggiunge al massimo una riga o una colonna di pixel neri. La vista
dall'alto
([`TopView`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L49-L69))
scala il campo di 6.10 x 13.40 m per adattarlo al suo pannello con un margine
e mantiene le proporzioni del campo.

Pillow disegna le sovrapposizioni
([`_compose`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L282-L336)):

- anello verde: la tua rilevazione (`shuttle_observed_px`);
- anello arancione: la proiezione del modello (`shuttle_model_px`);
- riquadri dei giocatori, se i tuoi tracks li contengono;
- vista dall'alto: linee del campo, la rete, la scia del modello del volo
  corrente, un punto la cui dimensione cresce con l'altezza del modello, `z` e
  la velocità approssimata del modello;
- voli con atterraggio: la zona revisionata come rettangolo tratteggiato e, a
  partire dal tempo di atterraggio, una croce arancione nel punto di
  atterraggio del modello.

I fotogrammi di cambio inquadratura mostrano "camera cut: excluded from
replay" e nessuna sovrapposizione del volano. Gli input sintetici aggiungono
`SYNTHETIC` al titolo della vista dall'alto.

## Audio: copia dello stream, non ricodifica

L'audio non viene decodificato e ricodificato. Ogni pacchetto audio viene
copiato nel nuovo contenitore con i suoi timestamp originali
(`add_stream_from_template`, poi `mux`). I pacchetti senza DTS vengono
saltati. Questo conserva l'offset iniziale dell'audio dell'originale ed
eventuali buchi, il che conta perché i file reali spesso iniziano l'audio una
frazione di secondo dopo il video.

La copia dello stream funziona solo se MP4 accetta il codec audio
dell'originale. Se lo stream non può essere creato o un pacchetto non può
essere multiplexato, il rendering fallisce con un `RenderError` che descrive
l'errore della copia dello stream; gli errori di creazione dello stream
includono il codec. Non c'è ripiego sulla ricodifica, quindi non tutti i
formati audio sono supportati. Un originale senza audio produce un MP4
silenzioso, riportato come `"source has no audio stream; output is silent"`.

## Verifica prima della pubblicazione

Il renderer scrive in un file di staging e lo verifica prima che qualcosa
compaia nel tuo percorso di output:

1. [`verify_mp4`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L339-L361)
   decodifica completamente il file di staging; il numero di fotogrammi video
   decodificati deve essere uguale al numero di fotogrammi dell'analisi.
2. Con l'audio, il primo tempo audio meno il primo tempo video deve
   corrispondere a quello dell'originale entro `1e-3` s
   ([`_first_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L104-L117)).
3. L'elenco dei tempi dei pacchetti audio deve essere identico a quello
   dell'originale
   ([`_audio_packet_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L120-L125)).

Il report di rendering registra questi risultati: `pts_check.max_abs_diff_s`,
`audio.av_offset_error_s`, `audio.packets_copied` e i conteggi di
`verification`.

## Output senza sovrascrittura

Prima di qualsiasi lavoro,
[`_check_paths`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L93-L101)
rifiuta un originale mancante, un output che si risolve nell'originale
(compreso un link simbolico o un hard link a esso) e qualsiasi percorso di
output già esistente, anche un link simbolico pendente. Nulla viene mai
sovrascritto.

Il file di staging viene creato da `tempfile.mkstemp` nella directory di
output con un nome univoco della forma `.<stem>.<random>.staging.mp4`. Dopo la
verifica, `os.link` crea l'output come hard link a esso. Un hard link fallisce
se il nome di destinazione esiste, quindi la pubblicazione non può sostituire
un file comparso durante il rendering. Il nome di staging viene rimosso in un
blocco `finally` sia in caso di successo sia di errore, quindi un file
estraneo nella directory non viene mai toccato. Questo presuppone che il file
system della directory di output supporti gli hard link.

La CLI applica la stessa regola al JSON: `_refuse_existing` controlla ogni
percorso di output in anticipo, e `_dump` apre i file in modalità di
creazione esclusiva
([`cli.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L34-L63)).
`run` pubblica il video prima di scrivere i due file JSON, quindi i tre output
non formano un'unica transazione atomica. Controlla prima tutti e tre gli
output, così un input fornito che si trovi per caso in
`<out-dir>/analysis.json` viene rifiutato invece di essere sovrascritto. I
nomi dei file non arrivano mai a una shell; il test
`test_render_rejects_mismatched_pts_and_handles_hostile_filename` esegue il
rendering da un nome che contiene metacaratteri della shell.

Correlati: [Osservazioni e tempi](observations-timing.md) per `pts_s`,
[Validazione e limiti](validation-limits.md) per ciò che i controlli sui media
dimostrano, [gli schemi](schemas.md) per il report di rendering.
