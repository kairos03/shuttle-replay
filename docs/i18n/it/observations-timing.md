# Osservazioni e tempi

Un fit di volo confronta le posizioni del modello con le rilevazioni **in
istanti specifici**. Se quegli istanti sono sbagliati, una traiettoria
corretta sembra sbagliata e una sbagliata può sembrare corretta. Questa pagina
spiega da dove vengono i tempi, cosa richiedono i contratti di input, come le
evidenze sono separate dalla revisione e come il tempo viene campionato per il
modello e per il disegno.

## Il tempo viene dal PTS, non dal conteggio dei fotogrammi

I contenitori video memorizzano un timestamp di presentazione (PTS) per ogni
fotogramma come numero intero di tick, con un `time_base` che indica quanto
dura un tick. Il tempo del fotogramma in secondi è:

```{math}
\mathrm{time\_s} = \mathrm{pts} \cdot \mathrm{time\_base}
```

Esempio:

```{math}
\begin{aligned}
\mathrm{time\_base} &= \tfrac{1}{30000}\ \mathrm{s}, \quad \mathrm{pts} = 3003 \\
\Rightarrow \mathrm{time\_s} &= 3003 \cdot \tfrac{1}{30000}\ \mathrm{s} = 0.1001\ \mathrm{s}
\end{aligned}
```

Molte registrazioni da smartphone e dello schermo hanno un **frame rate
variabile** (VFR): le durate dei fotogrammi differiscono. Calcolare
`frame_index / fps` allora si allontana dal tempo reale. Per questo il formato
tracks memorizza `pts_s` per fotogramma, così come decodificato da
FFmpeg/PyAV (vedi [gli schemi](schemas.md)). La demo sintetica usa
deliberatamente il VFR: con `time_base` 1/30000 s, un fotogramma ogni sette
dura 1001 tick invece di 1000
([`frame_pts_ticks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py#L52-L58)).

In seguito il renderer confronta ogni fotogramma decodificato con il tuo
`pts_s`; vedi [Rendering e sicurezza dell'output](rendering-safety.md).

## Contratti di input

[`validate_tracks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L33-L78)
e
[`validate_review`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L81-L149)
sollevano `InputError` alla prima incoerenza. Nulla viene riordinato,
deduplicato o corretto.

Tracks (`shuttle-replay/tracks/v1`):

- `frame_id` è un intero strettamente crescente; `pts_s` è finito e
  strettamente crescente.
- `segment_id` identifica un'inquadratura continua della telecamera. `null`
  indica un cambio di inquadratura, un primo piano o un replay. Un id di
  segmento che ricompare dopo un segmento diverso viene rifiutato, quindi ogni
  inquadratura richiede un proprio id e una propria calibrazione.
- `shuttle` è `null` (nessuna rilevazione) oppure ha `u` e `v` finiti. I
  riquadri dei giocatori devono essere quattro numeri finiti.

L'intervallo temporale di ogni segmento è il PTS del suo primo e del suo
ultimo fotogramma. Ogni segmento richiede una calibrazione
([`validate_inputs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L152-L162)).

Revisione (`shuttle-replay/review/v1`):

- Gli id dei contatti sono stringhe uniche. Ogni contatto si trova
  nell'intervallo PTS del proprio segmento e nel proprio `time_bracket_s`, che
  può essere largo al massimo 0.5 s.
- I contatti in un segmento sono strettamente crescenti nel tempo, nell'ordine
  della lista.
- `height_m` è nell'intervallo aperto (0, 4) m e `height_sigma_m` è positivo.
  Ogni contatto richiede `image_px` o `court_xy_m`.
- Solo l'ultimo contatto di un segmento può avere una voce `flight_ends`, di
  tipo `open` o `landing_region`. Un intervallo di atterraggio deve iniziare
  dopo il contatto; il `min` della zona deve essere inferiore al suo `max`. Lo
  `until_s` di una fine `open` deve seguire il contatto e restare dentro il
  segmento.

## Evidenze e revisione

Due tipi di input svolgono ruoli diversi:

- **Evidenze osservate**: le tue rilevazioni. Entrano nel fit solo come
  residui in pixel e vengono copiate invariate in `shuttle_observed_px`. Un
  fotogramma con `shuttle: null` resta `null` in ogni output.
- **Vincoli revisionati**: contatti, zone di atterraggio, punti di
  calibrazione. Posizioni e altezze dei contatti entrano come prior pesati
  dalle sigma; gli estremi di atterraggio usano scale di penalità fisse. I
  punti di calibrazione determinano la telecamera in anticipo. Gli istanti di
  contatto sono fissi, mentre il tempo di atterraggio viene stimato dentro il
  suo intervallo.

Quando il modello riempie un fotogramma senza rilevazione, il `layer` di quel
fotogramma è `conditional_model` mentre `shuttle_observed_px` resta `null`. Il
test `test_missing_detection_provenance_is_null_not_filled` verifica
esattamente questo.

## Segmentazione dei voli

[`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L234)
raggruppa i contatti per segmento e trasforma ogni contatto in un volo. Un
volo non attraversa mai un segmento di telecamera. Le sue osservazioni sono i
fotogrammi del segmento con una rilevazione e

```{math}
\begin{aligned}
t_0 + \mathtt{contact\_guard\_s} &< \mathrm{pts\_s} \le t_\mathrm{end} - \mathtt{contact\_guard\_s} && (1) \\
t_0 + \mathtt{contact\_guard\_s} &< \mathrm{pts\_s} \le t_\mathrm{end} && (2)
\end{aligned}
```

(1) il volo è seguito da un altro contatto;
(2) atterraggio o fine aperta.

| Simbolo | Significato |
|---|---|
| {math}`t_0` | istante di contatto revisionato |
| {math}`t_\mathrm{end}` | istante del contatto successivo, fine dell'intervallo di atterraggio o min(fine segmento, `until_s`) |
| `contact_guard_s` | predefinito 0,02 s |

La guardia scarta le rilevazioni proprio al contatto, dove il volano è spesso
fuso con la racchetta. `observation_frame_ids` e `observation_time_offsets_s`
in ogni record di volo mostrano esattamente quali fotogrammi sono stati usati,
con scostamenti misurati da `t0`.

## Campionamento del modello e visualizzazione

Esistono tre campionamenti diversi, e solo il primo è per fotogramma video:

1. **Per fotogramma.** Per ogni fotogramma dentro l'intervallo temporale di un
   volo accettato, `shuttle_model_xyz_m` è il modello valutato al PTS proprio
   di quel fotogramma, e `shuttle_model_px` è la sua proiezione tramite `P`
   ([ciclo dei fotogrammi](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L293-L334)).
   I fotogrammi di cambio inquadratura ricevono
   `layer: "excluded_camera_cut"`, nessun modello e nessun giocatore, anche se
   esiste una rilevazione grezza (`raw_detection_ignored`).
2. **Dentro il fit.** 41 campioni equidistanti verificano le penalità di
   pavimento e rete; 201 campioni alimentano i gate di accettazione. Vedi
   [Fisica della traiettoria](trajectory-physics.md).
3. **Visualizzazione.** La scia della vista dall'alto è una polilinea che
   passa solo per campioni del modello per fotogramma precedenti dello
   **stesso** volo
   ([`trail_for`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L36-L46)).
   Si ferma al primo fotogramma con un `model_flight_id` diverso, quindi una
   scia non collega mai due voli né scavalca un cambio di inquadratura. Queste
   linee sono `display_interpolation`, non dati.

## Tolleranze effettivamente verificate

| Controllo | Valore | Sorgente |
|---|---|---|
| ampiezza dell'intervallo di contatto | ≤ 0.5 s | `inputs.py` |
| margine di contatto | 0.02 s (predefinito) | `analysis.py` |
| corrispondenza PTS del renderer | 1e-3 s per fotogramma | `render.py` |
| ODE (`simulate`) | rtol 1e-7, atol 1e-8, max_step 0.02 s | `physics.py` |
| ODE (`floor_crossing`) | rtol 1e-9, atol 1e-10, max_step 0.01 s | `physics.py` |
| soglia del pavimento | punto più basso ≥ -0.02 m | `physics.py` |
| atterraggio `within_region` | regione allargata di 1e-3 m | `analysis.py` |

Correlati: [gli schemi](schemas.md) per ogni campo,
[il flusso di lavoro](workflow.md) per produrre tracks dal tuo rilevatore.
