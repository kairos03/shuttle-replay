# Validación y límites

`shuttle-replay` informa de muchos números sobre sus propios resultados. Cada
uno responde a una pregunta concreta. Esta página indica, para cada
comprobación, qué muestra, qué no muestra y qué prueba del repositorio la
ejercita. Aquí no se dan cifras de exactitud ni de velocidad para metraje
real, porque el proyecto no ha medido ninguna.

## Qué demuestra cada comprobación

**Error de suelo reservado** (`heldout_summary`,
[`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L175-L197)).
Demuestra: la homografía del suelo predice puntos de la pista con los que no se
ajustó. No demuestra: nada sobre las alturas, los anclajes de la red ni el
volante.

**Residuos y sensibilidad de los anclajes de la red**
(`net_anchor_residuals_px`, `net_anchor_sensitivity`). Con dos anclajes la
columna vertical está casi exactamente determinada, así que el residuo es
cercano a cero casi por construcción. El valor de sensibilidad muestra cuánto
se mueve un punto de referencia situado 3 m por encima de la red cuando una
coordenada de un anclaje se mueve según su incertidumbre en píxeles declarada.
Es un "qué pasaría si", no un intervalo de confianza. Consulta
[Calibración de la cámara](camera-calibration.md).

**Error de reproyección** (`fit.reprojection_rms_px`, `reprojection_p90_px`,
`reprojection_max_px`). Demuestra: la proyección del modelo pasa cerca de tus
detecciones 2D. No demuestra: que la trayectoria 3D sea correcta. Una
profundidad distinta con una velocidad distinta puede proyectarse casi en los
mismos píxeles, que es la infradeterminación descrita en
[Física de la trayectoria](trajectory-physics.md). El límite de aceptación por
defecto es 8.0 px RMS.

**Puertas del suelo y de la red** (`gates`,
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106)).
Superarlas muestra que las 201 alturas muestreadas son de al menos −0.02 m,
que cada cruce detectado, interpolado entre muestras adyacentes, es de al
menos 1.524 m, y que se produce un cruce cuando se requiere. Estas
comprobaciones son verificaciones finitas sobre muestras; no establecen la
plausibilidad física general ni la exactitud en el mundo real.

**`parameters_at_bound` y `optimizer_success`**. Un ajuste no convergido se
rechaza. Los siete parámetros de estado/resistencia se marcan cuando su
distancia a un límite es menor que el 0.1% de su rango permitido. Un ajuste
marcado se rechaza. El tiempo de caída no se incluye en este diagnóstico.
Superarlo no establece la identificabilidad, la unicidad ni la ausencia de
influencia de los priors.

**Comprobaciones de medios** (informe de renderizado). Demuestran: cada
fotograma original se emparejó por índice y PTS, la salida se decodifica con el
número correcto de fotogramas y los paquetes de audio conservaron sus tiempos.
No demuestran: que tu `pts_s` proceda del mismo archivo sobre el que se
hicieron las detecciones, más allá de la propia coincidencia de PTS.

**Recuperación sintética** (`demo`, `synthetic_recovery.json`).
`synthetic_recovery.json` informa de comparaciones con la verdad de referencia
sintética. Las pruebas afirman tolerancias de recuperación seleccionadas para
casos sintéticos concretos; generar el informe por sí solo no impone esas
tolerancias. Ninguna de las dos cosas muestra exactitud en vídeo real. El
`label` del archivo lo dice: "SYNTHETIC ground-truth recovery; not evidence of
accuracy on real video".

## Dónde la incertidumbre es cualitativa

El ajuste tiene sigmas, pero la salida no las convierte en barras de error. No
hay covarianza, ni bootstrap, ni intervalo de confianza sobre la posición, la
velocidad o el punto de caída. En su lugar, la incertidumbre se expresa con
etiquetas: `conditional_model`, `exact_coordinate_measured: false`,
`speed_scope` y la lista `assumptions` de cada archivo de análisis
([`ASSUMPTIONS`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L39-L46)).
El redondeo aproximado de la velocidad a 5 km/h es una decisión de
visualización, no una estimación del error.

## Por qué no es otra cosa

- **No es 3D medido.** Una cámara da rayos, no puntos. La profundidad procede
  del modelo físico más tus contactos revisados.
- **No es profundidad densa.** No hay mapa de profundidad por píxel ni red de
  profundidad aprendida. Solo el volante a lo largo de los vuelos ajustados
  recibe una posición 3D.
- **No es IN/OUT automático.** `landing.inside_court` compara un punto del
  modelo con el límite exterior de la pista. El punto es atraído suavemente
  hacia la zona que dibujaste, así que la respuesta refleja sobre todo tu
  revisión; la pertenencia a la zona no es un requisito estricto de aceptación
  (`landing.within_region` la reporta con una tolerancia de 1 mm). No hay
  lógica de arbitraje de líneas, ni regla de individuales/dobles, ni medición
  de dónde tocó el volante.

## Orden de depuración

Cuando un vuelo parece incorrecto, lee desde la base del pipeline hacia
arriba:

1. **Calibración.** Errores grandes en `heldout_summary` o un
   `max_vertical_shift_m` grande: corrige primero los puntos o los anclajes.
   Nada posterior puede recuperarlo.
2. **Entradas.** `observation_frame_ids` y `first_observation_delay_s`: ¿la
   ventana contiene las detecciones que esperas?
3. **Estado.** `insufficient_observations` significa demasiadas pocas
   detecciones; `rejected_by_gates_or_fit` significa que mires los dos puntos
   siguientes.
4. **Ajuste.** `optimizer_success`, `parameters_at_bound`, RMS y máximo de
   reproyección. Un máximo enorme con un RMS bajo apunta a una sola detección
   mala.
5. **Puertas.** `minimum_height_m`, `net_crossing_required`,
   `net_crossing_occurred`, `net_crossing_height_m`. Una puerta de red fallida
   suele indicar un contacto en el lado equivocado o una altura de contacto
   errónea.
6. **Informe de renderizado.** Discrepancias de PTS o errores en el número de
   fotogramas significan que los tracks no pertenecen a esta decodificación
   exacta del vídeo.

## Mapa de evidencias

| Afirmación | Prueba |
| --- | --- |
| Puntos reservados reportados por separado; `H` etiquetada solo Z=0 | `test_calibration_recovers_camera_and_reports_heldout_separately` |
| Entradas de calibración malas rechazadas | `test_calibration_rejects_invalid_inputs`, `test_calibration_rejects_collinear_fit_points` |
| Tracks o revisión incoherentes rechazados, no reparados | `test_inconsistent_inputs_are_rejected_not_repaired`, `test_missing_segment_calibration_is_rejected` |
| El contacto, no la primera detección, es el tiempo cero | `test_delayed_first_observation_keeps_contact_as_time_zero` |
| Los vuelos se quedan dentro de un segmento | `test_flights_never_bridge_camera_segments` |
| Las detecciones ausentes siguen siendo nulas | `test_missing_detection_provenance_is_null_not_filled` |
| La caída es una restricción, no una medición | `test_landing_region_is_a_constraint_not_a_measurement` |
| Los vuelos interceptados no se fuerzan a caer | `test_intercepted_flight_is_not_forced_to_land` |
| Puertas de la red y del suelo | `test_physical_gates_reject_net_and_floor_violations`, `test_actual_low_net_crossing_rejected_without_expected_crossing` |
| Ajustes pegados a un límite rechazados; ventana `until_s` | `test_open_flight_window_and_bound_pinned_fits` |
| Centros de las líneas de la pista | `test_court_lines_are_line_centres_of_40mm_lines_inside_outer_boundary` |
| Comprobaciones de PTS y número de fotogramas; nombres de archivo hostiles | `test_render_rejects_mismatched_pts_and_handles_hostile_filename` |
| Las estelas se quedan dentro de un vuelo | `test_trails_stay_inside_one_flight_and_segment` |
| Sin sobrescritura del original ni de archivos existentes | `test_render_never_overwrites_source_or_existing_files`, `test_cli_rejects_output_aliasing_inputs` |
| Desfase y huecos del audio conservados | `test_audio_is_stream_copied_with_source_relative_offset` |
| Artefactos de la demo de extremo a extremo | `test_demo_end_to_end_creates_verified_artifacts`, `test_run_command_from_existing_inputs` |

Todas las pruebas están en
[`tests/`](https://github.com/KAIROS03/shuttle-replay/tree/6e9a060b5cc964f02d4017d806e953ffea89c8b4/tests).
La mayoría de las pruebas de vuelo se ejecutan sobre la escena sintética de
[`synthetic.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py),
así que confirman el comportamiento y los contratos, no la exactitud en el
mundo real. No cubiertos por las pruebas: la distorsión de la lente, que la
herramienta no modela, y los códecs de audio distintos del AAC usado en las
pruebas.

Relacionado: [el flujo de trabajo](workflow.md) para la lista de límites,
[la guía de usuario](guide.md) para leer los resultados.
