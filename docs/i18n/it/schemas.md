# Formati di input e output (v0.1)

Tutte le coordinate in metri usano il sistema di riferimento del campo: X
lungo la larghezza e Y lungo la lunghezza, con il confine esterno del campo
(bordi esterni delle linee di confine) a X = 0 .. 6.10 e Y = 0 (lontano) ..
13.40 (vicino); Z verso l'alto (0 = pavimento). Il piano della rete è
Y = 6.70. Le linee sono larghe 40 mm; inserisci i punti a terra al centro
delle linee: linee esterne X = 0.02 / 6.08 e Y = 0.02 / 13.38, linee laterali
del singolo X = 0.48 / 5.62, linee di servizio corto Y = 4.70 / 8.70, linee di
servizio lungo del doppio Y = 0.78 / 12.62, linea centrale X = 3.05.
Le coordinate immagine sono pixel del video originale (x verso destra, y verso
il basso). I tempi sono timestamp di presentazione (PTS) dell'originale in
secondi, come decodificati da FFmpeg/PyAV (`frame.pts * time_base`), mai
`frame_index / fps`.

Esegui `shuttle-replay demo --out-dir demo` per ottenere in `demo/inputs/` un
esempio sintetico completo di ciascun file descritto sotto.

## Input di calibrazione — `shuttle-replay/calibration-input/v1`

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

- I punti `role: "fit"` (≥ 4, non collineari, non duplicati) stimano
  l'omografia del pavimento. I punti `role: "heldout"` (≥ 1) non vengono mai
  adattati e sono riportati separatamente come errori di controllo in pixel e
  metri.
- Le `net_anchors` (≥ 2, Z > 0.1 m) ricostruiscono la colonna verticale della
  matrice della telecamera. Con esattamente due ancore la colonna è quasi
  esattamente determinata, quindi il loro residuo dice poco; l'output include
  un report di sensibilità (spostamento verticale di un punto 3 m sopra la
  rete quando un'ancora si sposta di `uncertainty_px`).
- Numeri non finiti, punti di adattamento collineari/duplicati, ancore a
  livello del pavimento e telecamere sotto il pavimento vengono rifiutati.

L'output (`shuttle-replay/calibration/v1`) contiene per segmento `P` (3×4,
metri → pixel), `H_world_to_image` / `H_image_to_world` (solo pavimento),
`fit_ground_residuals`, `heldout_ground_errors`, `heldout_summary`,
`net_anchor_residuals_px`, `net_anchor_sensitivity` e una copia degli input.

## Tracce — `shuttle-replay/tracks/v1`

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

- Una voce per fotogramma originale decodificato, in ordine di decodifica;
  `frame_id` deve essere uguale all'indice di decodifica (il renderer
  controlla questo e il PTS di ogni fotogramma).
- `frame_id` e `pts_s` devono essere strettamente crescenti e finiti.
- `segment_id` identifica un'inquadratura continua che ha una calibrazione;
  `null` contrassegna cambi di inquadratura / primi piani / replay, che
  vengono esclusi. Un segmento deve essere contiguo; un id di segmento che
  ricompare dopo un altro segmento viene rifiutato (assegna all'inquadratura
  successiva un proprio id e una propria calibrazione).
- `shuttle: null` significa "nessuna rilevazione". Resta null in tutti gli
  output.

## Annotazioni di revisione — `shuttle-replay/review/v1`

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

- I contatti sono contatti di racchetta revisionati. `time_s` è il timestamp
  revisionato del contatto e diventa il tempo zero del volo, anche quando la
  prima rilevazione del volano arriva più tardi. Deve trovarsi all'interno del
  suo segmento di telecamera e all'interno di `time_bracket_s` (≤ 0.5 s di
  ampiezza). I contatti di un segmento devono essere strettamente crescenti.
  La v0.1 non affina automaticamente gli istanti di contatto; affinali
  revisionando i fotogrammi e modificando `time_s`.
- Prior di posizione: `image_px` (pixel di contatto revisionato, intersecato
  con il piano Z = `height_m` tramite la telecamera P completa) oppure
  `court_xy_m`. `height_m` è un prior revisionato con `height_sigma_m`;
  `xy_sigma_m` è opzionale (predefinito 0.5 m).
- Un volo va da un contatto al contatto successivo dello stesso segmento
  (`intercepted_by_next_contact`, mai forzato a terra). Solo l'ultimo
  contatto di un segmento può avere una voce `flight_ends`: `landing_region`
  (contatto con il pavimento vincolato nel riquadro revisionato entro
  l'intervallo di tempo) oppure `open` (adattamento fino all'ultima
  osservazione del segmento, o fino a un `until_s` revisionato opzionale).
  Voce assente = open.
- Chiavi di `physics` (tutte opzionali): `gravity_m_s2`, `pixel_sigma_px`,
  `drag_prior_per_m`, `drag_prior_sigma`, `drag_bounds_per_m`,
  `contact_guard_s`, `contact_xy_sigma_m`, `min_observations`,
  `max_accept_rms_px`, `velocity_bound_m_s`.

## Output dell'analisi — `shuttle-replay/analysis/v1`

- `flights[]`: `t0_s` (contatto revisionato), `t_end_s`, `end_type`, `params`
  (`[x, y, z, vx, vy, vz, drag_k]` al contatto), `fit` (RMS / p90 / massimo di
  riproiezione in px, numero di osservazioni, stato dell'ottimizzatore),
  `gates` (fattibilità rispetto a pavimento e rete; altezza sopra la rete
  ≥ 1.524 m quando il volo attraversa la rete), `parameters_at_bound` (un
  adattamento bloccato su un limite dell'ottimizzatore viene rifiutato),
  `accepted`, `model_speed_km_h` e `model_speed_coarse_km_h`,
  `first_observation_delay_s`, `observation_frame_ids`, `landing` (voli con
  atterraggio; `exact_coordinate_measured: false`) e
  `unreturned_floor_crossing_prediction` (voli intercettati/aperti;
  `kind: counterfactual_if_unreturned`, `observed: false`).
- `frames[]`: `shuttle_observed_px` (rilevazione fornita o null),
  `shuttle_model_xyz_m` / `shuttle_model_px` (solo modello accettato, stesso
  segmento), `model_flight_id`, `layer` (`conditional_model`, `observed_pixel`,
  `none`, `excluded_camera_cut`).
- `provenance_vocabulary`, `assumptions`, `calibration_summary`.

## Report di rendering

`render_report.json` registra l'encoder, il numero di fotogrammi, la
differenza massima tra il PTS originale decodificato e il PTS delle tracce, il
layout 6:4, se l'audio è stato preservato e una decodifica completa dell'MP4
scritto.
