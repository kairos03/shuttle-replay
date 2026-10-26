# Validazione e limiti

`shuttle-replay` riporta molti numeri sui propri risultati. Ognuno risponde a
una domanda specifica. Questa pagina indica, per ogni controllo, cosa mostra,
cosa non mostra e quale test del repository lo esercita. Qui non vengono
forniti dati di accuratezza o di velocità per riprese reali, perché il
progetto non ne ha misurati.

## Cosa dimostra ogni controllo

**Errore a terra sui punti di controllo** (`heldout_summary`,
[`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L175-L197)).
Dimostra: l'omografia del pavimento predice punti del campo su cui non è stata
stimata. Non dimostra: nulla sulle altezze, sugli ancoraggi della rete o sul
volano.

**Residui e sensibilità degli ancoraggi della rete**
(`net_anchor_residuals_px`, `net_anchor_sensitivity`). Con due ancoraggi la
colonna verticale è quasi esattamente determinata, quindi il residuo è vicino
a zero quasi per costruzione. Il valore di sensibilità mostra quanto si sposta
un punto di riferimento 3 m sopra la rete quando una coordinata di un
ancoraggio si sposta della sua incertezza in pixel dichiarata. È un "cosa
succede se", non un intervallo di confidenza. Vedi
[Calibrazione della telecamera](camera-calibration.md).

**Errore di riproiezione** (`fit.reprojection_rms_px`, `reprojection_p90_px`,
`reprojection_max_px`). Dimostra: la proiezione del modello passa vicino alle
tue rilevazioni 2D. Non dimostra: che la traiettoria 3D sia giusta. Una
profondità diversa con una velocità diversa può proiettarsi quasi sugli stessi
pixel, che è la sottodeterminazione descritta in
[Fisica della traiettoria](trajectory-physics.md). Il limite di accettazione
predefinito è 8.0 px RMS.

**Gate di pavimento e rete** (`gates`,
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106)).
Superarli mostra che le 201 altezze campionate sono almeno −0.02 m, che ogni
attraversamento rilevato, interpolato tra campioni adiacenti, è almeno
1.524 m, e che un attraversamento avviene quando richiesto. Questi sono
controlli finiti su campioni; non stabiliscono plausibilità fisica generale né
accuratezza nel mondo reale.

**`parameters_at_bound` e `optimizer_success`**. Un fit non convergente viene
rifiutato. I sette parametri di stato/resistenza vengono segnalati quando la
loro distanza da un limite è inferiore allo 0.1% del loro intervallo
consentito. Un fit segnalato viene rifiutato. Il tempo di atterraggio non è
incluso in questa diagnostica. Superarla non stabilisce identificabilità,
unicità né assenza di influenza dei prior.

**Controlli sui media** (report di rendering). Dimostrano: ogni fotogramma
originale è stato abbinato per indice e PTS, l'output si decodifica con il
numero corretto di fotogrammi e i pacchetti audio hanno mantenuto i loro
tempi. Non dimostrano: che il tuo `pts_s` provenga dallo stesso file su cui
sono state fatte le rilevazioni, oltre alla corrispondenza del PTS stessa.

**Recupero sintetico** (`demo`, `synthetic_recovery.json`).
`synthetic_recovery.json` riporta confronti con la verità di riferimento
sintetica. I test verificano tolleranze di recupero selezionate per casi
sintetici specifici; generare il report da solo non impone quelle tolleranze.
Nessuno dei due mostra accuratezza su video reale. Il `label` del file lo
dice: "SYNTHETIC ground-truth recovery; not evidence of accuracy on real
video".

## Dove l'incertezza è qualitativa

Il fit ha delle sigma, ma l'output non le trasforma in barre di errore. Non ci
sono covarianza, bootstrap né intervalli di confidenza su posizione, velocità
o punto di atterraggio. L'incertezza è invece espressa da etichette:
`conditional_model`, `exact_coordinate_measured: false`, `speed_scope` e la
lista `assumptions` in ogni file di analisi
([`ASSUMPTIONS`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L39-L46)).
L'arrotondamento approssimato della velocità a 5 km/h è una scelta di
visualizzazione, non una stima dell'errore.

## Perché non è qualcos'altro

- **Non è 3D misurato.** Una telecamera fornisce raggi, non punti. La
  profondità deriva dal modello fisico più i tuoi contatti revisionati.
- **Non è profondità densa.** Non c'è mappa di profondità per pixel né rete di
  profondità appresa. Solo il volano lungo i voli stimati riceve una posizione
  3D.
- **Non è IN/OUT automatico.** `landing.inside_court` confronta un punto del
  modello con il confine esterno del campo. Il punto è attratto in modo
  morbido verso la zona che hai disegnato, quindi la risposta riflette
  soprattutto la tua revisione; l'appartenenza alla zona non è un requisito
  rigido di accettazione (`landing.within_region` la riporta con una
  tolleranza di 1 mm). Non c'è logica di giudizio delle linee, né regola
  singolo/doppio, né misura di dove il volano ha toccato.

## Ordine di debug

Quando un volo sembra sbagliato, leggi dal fondo della pipeline verso l'alto:

1. **Calibrazione.** Errori grandi in `heldout_summary` o un
   `max_vertical_shift_m` grande: correggi prima punti o ancoraggi. Nulla a
   valle può recuperare.
2. **Input.** `observation_frame_ids` e `first_observation_delay_s`: la
   finestra contiene le rilevazioni che ti aspetti?
3. **Stato.** `insufficient_observations` significa troppe poche
   rilevazioni; `rejected_by_gates_or_fit` significa guardare i due punti
   successivi.
4. **Fit.** `optimizer_success`, `parameters_at_bound`, RMS e massimo di
   riproiezione. Un massimo enorme con un RMS basso indica una singola
   rilevazione sbagliata.
5. **Gate.** `minimum_height_m`, `net_crossing_required`,
   `net_crossing_occurred`, `net_crossing_height_m`. Un gate di rete fallito
   spesso indica un contatto dal lato sbagliato o un'altezza di contatto
   errata.
6. **Report di rendering.** Discrepanze di PTS o errori nel numero di
   fotogrammi significano che i tracks non appartengono a questa esatta
   decodifica del video.

## Mappa delle evidenze

| Affermazione | Test |
| --- | --- |
| Punti di controllo riportati separatamente; `H` etichettata solo Z=0 | `test_calibration_recovers_camera_and_reports_heldout_separately` |
| Input di calibrazione errati rifiutati | `test_calibration_rejects_invalid_inputs`, `test_calibration_rejects_collinear_fit_points` |
| Tracks o revisione incoerenti rifiutati, non corretti | `test_inconsistent_inputs_are_rejected_not_repaired`, `test_missing_segment_calibration_is_rejected` |
| Il contatto, non la prima rilevazione, è il tempo zero | `test_delayed_first_observation_keeps_contact_as_time_zero` |
| I voli restano dentro un segmento | `test_flights_never_bridge_camera_segments` |
| Le rilevazioni mancanti restano nulle | `test_missing_detection_provenance_is_null_not_filled` |
| L'atterraggio è un vincolo, non una misura | `test_landing_region_is_a_constraint_not_a_measurement` |
| I voli intercettati non sono forzati ad atterrare | `test_intercepted_flight_is_not_forced_to_land` |
| Gate di rete e pavimento | `test_physical_gates_reject_net_and_floor_violations`, `test_actual_low_net_crossing_rejected_without_expected_crossing` |
| Fit bloccati su un limite rifiutati; finestra `until_s` | `test_open_flight_window_and_bound_pinned_fits` |
| Centri delle linee del campo | `test_court_lines_are_line_centres_of_40mm_lines_inside_outer_boundary` |
| Controlli di PTS e numero di fotogrammi; nomi di file ostili | `test_render_rejects_mismatched_pts_and_handles_hostile_filename` |
| Le scie restano dentro un volo | `test_trails_stay_inside_one_flight_and_segment` |
| Nessuna sovrascrittura dell'originale o di file esistenti | `test_render_never_overwrites_source_or_existing_files`, `test_cli_rejects_output_aliasing_inputs` |
| Offset e buchi dell'audio conservati | `test_audio_is_stream_copied_with_source_relative_offset` |
| Artefatti della demo end-to-end | `test_demo_end_to_end_creates_verified_artifacts`, `test_run_command_from_existing_inputs` |

Tutti i test si trovano in
[`tests/`](https://github.com/KAIROS03/shuttle-replay/tree/6e9a060b5cc964f02d4017d806e953ffea89c8b4/tests).
La maggior parte dei test di volo gira sulla scena sintetica di
[`synthetic.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py),
quindi confermano comportamento e contratti, non accuratezza nel mondo reale.
Non coperti dai test: la distorsione dell'obiettivo, che lo strumento non
modella, e i codec audio diversi dall'AAC usato nei test.

Correlati: [il flusso di lavoro](workflow.md) per l'elenco dei limiti,
[la guida utente](guide.md) per leggere i risultati.
