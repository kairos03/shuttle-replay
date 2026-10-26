# Física de la trayectoria

Una cámara ve un volante como un píxel. Todos los puntos a lo largo de la línea
de visión que pasa por ese píxel, cerca o lejos, caen en el mismo píxel, así
que un solo fotograma no puede indicar la profundidad. Esta página explica cómo
`shuttle-replay` convierte aun así una secuencia de píxeles en un vuelo 3D,
añadiendo física y restricciones revisadas, y qué significa y qué no significa
el resultado.

## El problema inverso

Piensa en cada detección como un rayo que sale de la cámara. Un vuelo es una
curva que tiene que pasar cerca de cada rayo en el momento adecuado. Muchas
curvas pueden hacerlo: un vuelo lento y cercano y uno rápido y lejano pueden
producir trayectorias de píxeles parecidas. El problema está
infradeterminado. La herramienta elige una curva exigiendo que:

- obedezca la gravedad y la resistencia del aire (el modelo de abajo),
- empiece cerca de la posición y la altura del contacto revisado, en el
  instante del contacto revisado,
- sea atraída suavemente hacia el siguiente contacto revisado o hacia una zona
  de caída revisada, o se detenga al final de la ventana observada (los
  residuos de los extremos son penalizaciones, no requisitos estrictos de
  aceptación), y
- se mantenga por encima del suelo y supere la red cuando deba cruzarla.

La trayectoria 3D ajustada es, por tanto, un **modelo condicional**: la curva
más coherente dadas tu calibración y tu revisión, no una medición
([docstring del módulo `analysis.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L1-L10)).

## El modelo de vuelo

El estado es la posición `r = (x, y, z)` en metros y la velocidad `v` en m/s.
Las ecuaciones del movimiento
([`_rhs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L16-L23)):

```text
 dr/dt = v
 dv/dt = -k * |v| * v  -  g * e_z

 g    gravity, default 9.81 m/s^2 (review "physics": "gravity_m_s2")
 k    drag coefficient per flight, units 1/m
 |v|  speed in m/s
 e_z  unit vector pointing up
```

La resistencia apunta en contra del movimiento y crece con el cuadrado de la
velocidad. Una lectura útil de `k`: un volante que cae en vertical deja de
acelerar cuando la resistencia iguala a la gravedad, a la velocidad terminal
`sqrt(g / k)`. Con el prior por defecto `k = 0.18 1/m` eso son unos 7.4 m/s.
Un volante golpeado a gran velocidad, por tanto, frena bruscamente; el modelo
no tiene efecto (spin), volteo ni viento.

Los siete parámetros ajustados son `[x, y, z, vx, vy, vz, k]` en el **tiempo de
vuelo cero**, que es el instante del contacto revisado, no el de la primera
detección
([docstring del módulo `physics.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L1-L8)).
Las detecciones suelen empezar unos fotogramas después del contacto porque la
raqueta o un jugador ocultan el volante. Esos fotogramas se miden como desfases
desde el contacto, así que una primera detección tardía no mueve el inicio del
vuelo (`first_observation_delay_s` informa del hueco).

## Integración numérica

[`simulate`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L26-L40)
integra las ecuaciones con `solve_ivp` de SciPy (su método Runge-Kutta
explícito por defecto) desde `t = 0`, con `rtol=1e-7`, `atol=1e-8`,
`max_step=0.02` segundos y salida densa, y después evalúa las posiciones en los
instantes pedidos. Se rechazan los tiempos no finitos y los tiempos por debajo
de `-1e-9` s; los valores negativos diminutos por encima de ese límite se
fijan a cero. Las tolerancias del integrador controlan el error de integración
numérica; no son cotas de la exactitud de la reconstrucción.
[`floor_crossing`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L43-L63)
usa una función de evento sobre `z` (solo descendente, terminal) con
tolerancias más estrictas (`rtol=1e-9`, `atol=1e-10`, `max_step=0.01`) en un
horizonte de 10 s.

## Qué se minimiza

[`fit_flight`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L57-L151)
construye un único vector de residuos. Cada entrada es una diferencia dividida
por una escala, de modo que "1" significa "un error esperado":

```text
 pixels    (project(P, r(t_i)) - uv_i) / pixel_sigma_px            default 3.0 px
 start     (r(0) - contact_prior) / start_sigma                     xy 0.5 m, height 0.3 m
 drag      (k - 0.18) / 0.15
 intercept (r(T) - next_contact_prior) / next_contact_sigma         intercepted only
 landing   z(T) / 0.01   and   distance outside region / 0.02       landing only
 floor     min(z, 0) / 0.01 on 41 samples from 0 to T
 net       max(0, 1.55 - h_net) / 0.02                              only if a crossing is required
```

`T` es la duración del vuelo. El prior del contacto procede de
[`_contact_prior`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L49-L54):
si el contacto tiene `image_px`, el rayo que pasa por ese píxel se interseca
con el plano a la `height_m` revisada; si no, se usan directamente
`court_xy_m` y `height_m`. Las sigmas vienen de `xy_sigma_m` y
`height_sigma_m` en cada contacto, y si faltan se usan los valores por defecto
indicados.

En el término de la red, `h_net` es la altura interpolada en la que la
trayectoria de 41 muestras cruza por primera vez `Y = 6.70`; si la trayectoria
nunca cruza, `h_net` cuenta como 0. Este término usa 1.55 m (altura del poste)
tal como está escrito en el código; la puerta de aceptación de más abajo usa
1.524 m (centro de la red).

`least_squares` de SciPy minimiza la suma con `loss="soft_l1"` y
`f_scale=1.5`, de modo que unas pocas detecciones malas tiran menos que con
cuadrados simples. Arranca desde seis puntos iniciales: `k` en `0.1, 0.2, 0.35`
combinado con una velocidad extra hacia arriba de `1.0` o `3.0` m/s añadida a
una estimación balística hacia el objetivo final. Gana el resultado de menor
coste. Los límites mantienen la búsqueda en un rango físico
([código](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L64-L69)):

```text
 x in [-3, 9.1] m     y in [-3, 16.4] m     z in [0.05, 4.5] m
 vx, vy, vz in [-velocity_bound_m_s, +velocity_bound_m_s]    default 120 m/s
 k in drag_bounds_per_m                                      default [0.015, 0.6] 1/m
 landing time T in the reviewed landing bracket (landing flights only)
```

Los siete parámetros de estado/resistencia se marcan en `parameters_at_bound`
cuando su distancia a un límite es menor que el 0.1% de su rango permitido
([código](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L129-L135)).
Un ajuste marcado se rechaza. El tiempo de caída no se incluye en este
diagnóstico. Superarlo no establece la identificabilidad, la unicidad ni la
ausencia de influencia de los priors.

## Cómo termina un vuelo

Los vuelos se construyen por segmento de cámara a partir de los contactos en
orden temporal
([`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L291)):

- **`intercepted_by_next_contact`**: le sigue otro contacto en el mismo
  segmento. La duración es el tiempo entre contactos; el final es atraído hacia
  el prior del siguiente contacto. Se exige un cruce de la red cuando los dos
  priors de contacto están en lados opuestos de la red.
- **`landing_region`**: el último contacto de un segmento tiene un final de
  caída revisado. Los residuos del contacto y del extremo de caída atraen
  suavemente el ajuste hacia el extremo revisado. El tiempo de caída está
  acotado por el intervalo revisado, pero la altura del extremo y la
  pertenencia a la zona no son requisitos estrictos de aceptación.
  `landing.within_region` informa de la pertenencia con una tolerancia de 1 mm;
  no controla la aceptación. Se exige un cruce cuando el inicio y el centro de
  la zona están en lados opuestos de la red.
- **`open_segment_end`**: cualquier otro caso. La ventana termina al final del
  segmento o en `until_s`, la duración del ajuste es el desfase de la última
  observación y no se exige cruce de la red.

Menos de `min_observations` (por defecto 4) detecciones en la ventana da
`status: "insufficient_observations"` sin ajuste.

## Puertas de aceptación

Tras el ajuste, la trayectoria se muestrea en 201 puntos y la comprueba
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106):
`floor_ok` exige que el punto más bajo esté a -0.02 m o por encima. `net_ok`
exige un cruce cuando se requería uno, y **cada** cruce detectado entre
muestras adyacentes debe estar a 1.524 m o por encima, se esperara o no un
cruce. Un vuelo solo se acepta si el optimizador informa de éxito, ambas
puertas se superan, el RMS de reproyección es como mucho `max_accept_rms_px`
(por defecto 8.0 px) y ninguno de los siete parámetros de estado/resistencia
está marcado. Los vuelos rechazados conservan sus parámetros para inspección,
pero no se dibujan como capa del modelo.

## Velocidad y caída contrafactual

`model_speed_km_h` es `|v(0)| * 3.6`, la velocidad inicial del modelo, y
`model_speed_coarse_km_h` la redondea a los 5 km/h más cercanos para mostrarla.
No es una lectura de radar.

Para los vuelos que no terminan en una zona de caída, si el modelo llegara al
suelo después de terminar el vuelo, el análisis añade
`unreturned_floor_crossing_prediction` con
`kind: "counterfactual_if_unreturned"` y `observed: false`. Responde a "dónde
caería este modelo si nadie lo hubiera devuelto", no a dónde fue el volante.
Para los vuelos con caída, `landing.xy_m` es el punto final del modelo atraído
suavemente hacia tu zona (no se garantiza que quede dentro de ella), y
`exact_coordinate_measured` es siempre `false`.

Relacionado: [Calibración de la cámara](camera-calibration.md) para `P`,
[Observaciones y tiempo](observations-timing.md) para la ventana de
observación, [Validación y límites](validation-limits.md) para interpretar
`fit` y `gates`.
