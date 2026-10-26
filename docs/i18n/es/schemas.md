# Formatos de entrada y salida (v0.1)

Todas las coordenadas en metros usan el sistema de la pista: X a lo ancho de
la pista e Y a lo largo, con el límite exterior de la pista (bordes exteriores
de las líneas de límite) en X = 0 .. 6.10 e Y = 0 (fondo) .. 13.40 (cerca); Z
hacia arriba (0 = suelo). El plano de la red es Y = 6.70. Las líneas miden
40 mm de ancho; introduce los puntos del suelo en el centro de las líneas:
líneas exteriores X = 0.02 / 6.08 e Y = 0.02 / 13.38, líneas laterales de
individuales X = 0.48 / 5.62, líneas de saque corto Y = 4.70 / 8.70, líneas de
saque largo de dobles Y = 0.78 / 12.62, línea central X = 3.05.
Las coordenadas de imagen son píxeles del vídeo original (x a la derecha, y
hacia abajo). Los tiempos son marcas de tiempo de presentación (PTS) del
original en segundos, tal como las decodifica FFmpeg/PyAV
(`frame.pts * time_base`), nunca `frame_index / fps`.

Ejecuta `shuttle-replay demo --out-dir demo` para obtener en `demo/inputs/` un
ejemplo sintético completo de cada archivo descrito abajo.

## Entrada de calibración — `shuttle-replay/calibration-input/v1`

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

- Los puntos `role: "fit"` (≥ 4, no colineales, no duplicados) estiman la
  homografía del suelo. Los puntos `role: "heldout"` (≥ 1) nunca se ajustan y
  se informan por separado como errores reservados en píxeles y metros.
- Los `net_anchors` (≥ 2, Z > 0.1 m) recuperan la columna vertical de la
  matriz de la cámara. Con exactamente dos anclajes la columna queda casi
  exactamente determinada, así que su residuo dice poco; la salida incluye un
  informe de sensibilidad (desplazamiento vertical de un punto 3 m por encima
  de la red cuando un anclaje se mueve `uncertainty_px`).
- Se rechazan los números no finitos, los puntos de ajuste
  colineales/duplicados, los anclajes a nivel del suelo y las cámaras por
  debajo del suelo.

La salida (`shuttle-replay/calibration/v1`) contiene por segmento `P` (3×4,
metros → píxeles), `H_world_to_image` / `H_image_to_world` (solo suelo),
`fit_ground_residuals`, `heldout_ground_errors`, `heldout_summary`,
`net_anchor_residuals_px`, `net_anchor_sensitivity` y una copia de las
entradas.

## Pistas — `shuttle-replay/tracks/v1`

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

- Una entrada por fotograma original decodificado, en orden de
  decodificación; `frame_id` debe ser igual al índice de decodificación (el
  renderizador comprueba esto y el PTS de cada fotograma).
- `frame_id` y `pts_s` deben ser estrictamente crecientes y finitos.
- `segment_id` identifica una toma de cámara continua que tiene calibración;
  `null` marca cortes de cámara / primeros planos / repeticiones, que se
  excluyen. Un segmento debe ser contiguo; un id de segmento que reaparece
  después de otro segmento se rechaza (da a la toma posterior su propio id y
  calibración).
- `shuttle: null` significa "sin detección". Sigue siendo null en todas las
  salidas.

## Anotaciones de revisión — `shuttle-replay/review/v1`

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

- Los contactos son contactos de raqueta revisados. `time_s` es la marca de
  tiempo revisada del contacto y se convierte en el tiempo cero del vuelo,
  incluso cuando la primera detección del volante llega más tarde. Debe estar
  dentro de su segmento de cámara y dentro de `time_bracket_s` (≤ 0.5 s de
  ancho). Los contactos de un segmento deben ser estrictamente crecientes. La
  v0.1 no refina automáticamente los instantes de contacto; refínalos
  revisando los fotogramas y editando `time_s`.
- Prior de posición: `image_px` (píxel de contacto revisado, intersecado con
  el plano Z = `height_m` mediante la cámara P completa) o `court_xy_m`.
  `height_m` es un prior revisado con `height_sigma_m`; `xy_sigma_m` es
  opcional (por defecto 0.5 m).
- Un vuelo va desde un contacto hasta el siguiente contacto del mismo
  segmento (`intercepted_by_next_contact`, nunca forzado al suelo). Solo el
  último contacto de un segmento puede tener una entrada `flight_ends`:
  `landing_region` (contacto con el suelo restringido a la caja revisada
  dentro del intervalo de tiempo) u `open` (ajuste hasta la última observación
  del segmento, o hasta un `until_s` revisado opcional). Entrada ausente =
  open.
- Claves de `physics` (todas opcionales): `gravity_m_s2`, `pixel_sigma_px`,
  `drag_prior_per_m`, `drag_prior_sigma`, `drag_bounds_per_m`,
  `contact_guard_s`, `contact_xy_sigma_m`, `min_observations`,
  `max_accept_rms_px`, `velocity_bound_m_s`.

## Salida del análisis — `shuttle-replay/analysis/v1`

- `flights[]`: `t0_s` (contacto revisado), `t_end_s`, `end_type`, `params`
  (`[x, y, z, vx, vy, vz, drag_k]` en el contacto), `fit` (RMS / p90 / máximo
  de reproyección en px, número de observaciones, estado del optimizador),
  `gates` (viabilidad respecto al suelo y la red; altura sobre la red
  ≥ 1.524 m cuando el vuelo cruza la red), `parameters_at_bound` (se rechaza
  un ajuste fijado en un límite del optimizador), `accepted`,
  `model_speed_km_h` y `model_speed_coarse_km_h`,
  `first_observation_delay_s`, `observation_frame_ids`, `landing` (vuelos con
  caída; `exact_coordinate_measured: false`) y
  `unreturned_floor_crossing_prediction` (vuelos interceptados/abiertos;
  `kind: counterfactual_if_unreturned`, `observed: false`).
- `frames[]`: `shuttle_observed_px` (detección proporcionada o null),
  `shuttle_model_xyz_m` / `shuttle_model_px` (solo modelo aceptado, mismo
  segmento), `model_flight_id`, `layer` (`conditional_model`, `observed_pixel`,
  `none`, `excluded_camera_cut`).
- `provenance_vocabulary`, `assumptions`, `calibration_summary`.

## Informe de renderizado

`render_report.json` registra el codificador, el número de fotogramas, la
diferencia máxima entre el PTS original decodificado y el PTS de las pistas,
el diseño 6:4, si se conservó el audio y una decodificación completa del MP4
escrito.
