# Observaciones y tiempo

Un ajuste de vuelo compara las posiciones del modelo con las detecciones **en
instantes concretos**. Si esos instantes son erróneos, una trayectoria correcta
parece incorrecta y una incorrecta puede parecer correcta. Esta página explica
de dónde vienen los tiempos, qué exigen los contratos de entrada, cómo se
separa la evidencia de la revisión y cómo se muestrea el tiempo para el modelo
y para el dibujo.

## El tiempo viene del PTS, no de contar fotogramas

Los contenedores de vídeo guardan una marca de tiempo de presentación (PTS)
para cada fotograma como un número entero de ticks, con un `time_base` que
indica cuánto dura un tick. El tiempo del fotograma en segundos es:

```text
 time_s = pts * time_base

 example: time_base = 1/30000 s, pts = 3003  ->  0.1001 s
```

Muchas grabaciones de móvil y de pantalla tienen una **tasa de fotogramas
variable** (VFR): las duraciones de los fotogramas difieren. Calcular
`frame_index / fps` entonces se aleja del tiempo real. Por eso el formato de
tracks guarda `pts_s` por fotograma, tal como lo decodifica FFmpeg/PyAV
(consulta [los esquemas](schemas.md)). La demo sintética usa VFR a propósito:
con `time_base` 1/30000 s, uno de cada siete fotogramas dura 1001 ticks en vez
de 1000
([`frame_pts_ticks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py#L52-L58)).

Más adelante, el renderizador comprueba cada fotograma decodificado contra tu
`pts_s`; consulta
[Renderizado y seguridad de la salida](rendering-safety.md).

## Contratos de entrada

[`validate_tracks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L33-L78)
y
[`validate_review`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L81-L149)
lanzan `InputError` ante la primera incoherencia. Nada se reordena, se
deduplica ni se repara.

Tracks (`shuttle-replay/tracks/v1`):

- `frame_id` es un entero estrictamente creciente; `pts_s` es finito y
  estrictamente creciente.
- `segment_id` nombra una toma de cámara continua. `null` marca un corte de
  cámara, un primer plano o una repetición. Un id de segmento que reaparece
  después de un segmento distinto se rechaza, así que cada toma necesita su
  propio id y su propia calibración.
- `shuttle` es `null` (sin detección) o tiene `u` y `v` finitos. Las cajas de
  jugadores deben ser cuatro números finitos.

El rango temporal de cada segmento es el PTS de su primer y su último
fotograma. Cada segmento necesita una calibración
([`validate_inputs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L152-L162)).

Revisión (`shuttle-replay/review/v1`):

- Los ids de contacto son cadenas únicas. Cada contacto está dentro del rango
  PTS de su segmento y dentro de su propio `time_bracket_s`, que puede medir
  como mucho 0.5 s de ancho.
- Los contactos de un segmento son estrictamente crecientes en el tiempo, en el
  orden de la lista.
- `height_m` está en el intervalo abierto (0, 4) m y `height_sigma_m` es
  positivo. Cada contacto necesita `image_px` o `court_xy_m`.
- Solo el último contacto de un segmento puede tener una entrada
  `flight_ends`, de tipo `open` o `landing_region`. Un intervalo de caída debe
  empezar después del contacto; el `min` de la zona debe estar por debajo de su
  `max`. El `until_s` de un final `open` debe seguir al contacto y quedar dentro
  del segmento.

## Evidencia frente a revisión

Dos tipos de entrada desempeñan papeles distintos:

- **Evidencia observada**: tus detecciones. Entran en el ajuste solo como
  residuos en píxeles y se copian sin cambios en `shuttle_observed_px`. Un
  fotograma con `shuttle: null` sigue siendo `null` en todas las salidas.
- **Restricciones revisadas**: contactos, zonas de caída, puntos de
  calibración. Las posiciones y alturas de los contactos entran como priors
  ponderados por sigma; los extremos de caída usan escalas de penalización
  fijas. Los puntos de calibración determinan la cámara de antemano. Los
  instantes de contacto son fijos, y el tiempo de caída se ajusta dentro de su
  intervalo.

Cuando el modelo rellena un fotograma sin detección, la `layer` de ese
fotograma es `conditional_model` mientras `shuttle_observed_px` sigue siendo
`null`. La prueba `test_missing_detection_provenance_is_null_not_filled`
comprueba exactamente esto.

## Segmentación de vuelos

[`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L234)
agrupa los contactos por segmento y convierte cada contacto en un vuelo. Un
vuelo nunca atraviesa un segmento de cámara. Sus observaciones son los
fotogramas del segmento con una detección y

```text
 t0 + contact_guard_s  <  pts_s  <=  t_end - contact_guard_s     (followed by another contact)
 t0 + contact_guard_s  <  pts_s  <=  t_end                       (landing or open end)

 t0             reviewed contact time
 t_end          next contact time, landing bracket end, or min(segment end, until_s)
 contact_guard_s  default 0.02 s
```

La guarda descarta las detecciones justo en un contacto, donde el volante a
menudo se confunde con la raqueta. `observation_frame_ids` y
`observation_time_offsets_s` en cada registro de vuelo muestran exactamente qué
fotogramas se usaron, con desfases medidos desde `t0`.

## Muestreo del modelo frente a visualización

Existen tres muestreos distintos, y solo el primero es por fotograma de vídeo:

1. **Por fotograma.** Para cada fotograma dentro del intervalo temporal de un
   vuelo aceptado, `shuttle_model_xyz_m` es el modelo evaluado en el propio PTS
   de ese fotograma, y `shuttle_model_px` es su proyección a través de `P`
   ([bucle de fotogramas](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L293-L334)).
   Los fotogramas de corte de cámara reciben `layer: "excluded_camera_cut"`,
   sin modelo ni jugadores, aunque exista una detección en bruto
   (`raw_detection_ignored`).
2. **Dentro del ajuste.** 41 muestras equiespaciadas comprueban las
   penalizaciones del suelo y de la red; 201 muestras alimentan las puertas de
   aceptación. Consulta [Física de la trayectoria](trajectory-physics.md).
3. **Visualización.** La estela de la vista cenital es una polilínea que pasa
   solo por muestras del modelo por fotograma anteriores del **mismo** vuelo
   ([`trail_for`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L36-L46)).
   Se detiene en el primer fotograma con un `model_flight_id` distinto, así que
   una estela nunca conecta dos vuelos ni salva un corte de cámara. Estas
   líneas son `display_interpolation`, no datos.

## Tolerancias que se comprueban realmente

```text
 contact bracket width         <= 0.5 s                  inputs.py
 contact guard                 0.02 s (default)          analysis.py
 renderer PTS match            1e-3 s per frame          render.py
 ODE (simulate)                rtol 1e-7, atol 1e-8, max_step 0.02 s
 ODE (floor_crossing)          rtol 1e-9, atol 1e-10, max_step 0.01 s
 floor gate                    lowest point >= -0.02 m
 landing within_region         region widened by 1e-3 m
```

Relacionado: [los esquemas](schemas.md) para cada campo,
[el flujo de trabajo](workflow.md) para producir tracks con tu propio
detector.
