# Calibración de la cámara

La calibración responde a una pregunta: para un punto de la pista, en metros,
¿en qué píxel lo muestra la cámara? `shuttle-replay` la responde con una cámara
estenopeica lineal estimada a partir de puntos que localizaste a mano. Esta
página explica los sistemas de coordenadas, las dos matrices que calcula la
herramienta, el algoritmo exacto y lo que significan los errores reportados.

## Dos sistemas de coordenadas

**Las coordenadas de imagen** `(u, v)` son píxeles del vídeo original: `u`
crece hacia la derecha, `v` crece hacia abajo.

**Las coordenadas del mundo** `(X, Y, Z)` son metros en un sistema de la pista
fijado por las dimensiones de pista de la BWF
([`court.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L1-L24)):

```text
      X = 0                X = 6.10
 Y = 0  +--------------------+   far baseline (outer edge)
        |                    |
        |                    |
 Y=6.70 |====== net =========|   net plane; posts 1.55 m, centre 1.524 m
        |                    |
        |                    |
Y=13.40 +--------------------+   near baseline (outer edge)

 Z is up; Z = 0 is the court surface.
```

Las líneas miden 40 mm de ancho y los puntos de calibración usan **los centros
de las líneas**: líneas exteriores en X = 0.02 / 6.08 e Y = 0.02 / 13.38,
líneas laterales de individuales en X = 0.48 / 5.62, líneas de servicio corto
en Y = 4.70 / 8.70, líneas de servicio largo de dobles en Y = 0.78 / 12.62,
línea central X = 3.05
([`court_lines`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L27-L52)).
Introducir un borde exterior donde se espera un centro desplaza ese punto 2 cm.

## Proyección estenopeica

Una cámara estenopeica asigna un punto del mundo a un píxel con una matriz 3x4
`P`:

```text
 [a]       [X]
 [b] = P * [Y]        u = a / c ,  v = b / c
 [c]       [Z]
           [1]
```

La división por `c` es la perspectiva: lo lejano se ve pequeño. `P` combina
dónde está la cámara y cómo está girada (los parámetros extrínsecos) con su
distancia focal y el centro de la imagen (los intrínsecos). El proyecto nunca
separa `P` en esas partes; usa `P` como una sola matriz
([`project`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L12-L15)).
El centro de la cámara `C` es el único punto con `P * [C, 1] = 0`, así que
`C = -inverse(P[:, :3]) * P[:, 3]`
([`camera_center`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L24-L26)).

## Paso 1: la homografía del suelo (solo Z = 0)

Para puntos en el suelo, `Z = 0`, así que la tercera columna de `P` se
multiplica por cero y desaparece:

```text
 P = [ p1  p2  p3  p4 ]          (four columns)
 floor point (X, Y, 0):  P * [X, Y, 0, 1] = [ p1 p2 p4 ] * [X, Y, 1] = H * [X, Y, 1]
```

La matriz 3x3 `H = [p1 p2 p4]` es una **homografía**. Se ajusta a partir de tus
puntos de suelo `role: "fit"` con la transformación lineal directa (DLT)
normalizada en
[`fit_homography`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L58-L78):

1. Cada conjunto de puntos se traslada a su centroide y se escala para que su
   distancia media al centroide sea `sqrt(2)`
   ([`_normalize`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L36-L39)).
   Esto mantiene bien condicionado el sistema lineal cuando los valores en
   píxeles están en los cientos y los metros tienen una sola cifra.
2. Cada correspondencia añade dos filas a un sistema lineal `A h = 0`.
3. `h` es el vector singular derecho de `A` para el valor singular más pequeño;
   se deshace la normalización y `H` se escala para que `H[2, 2] = 1`.

Las entradas degeneradas se rechazan con `CalibrationError` en lugar de
producir una matriz mala: menos de cuatro puntos de ajuste, coordenadas
duplicadas, conjuntos de puntos colineales, tres puntos colineales de
exactamente cuatro, un segundo valor singular más pequeño por debajo de `1e-9`
veces el mayor (solución no única), o un número de condición superior a `1e12`
([`_check_spread`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L42-L78)).

El ajuste es una DLT normalizada que minimiza un residuo algebraico sobre todos
los puntos de ajuste, sin refinamiento no lineal de la reproyección. No hay
rechazo de valores atípicos (no hay RANSAC) ni modelo de distorsión de la
lente: un punto mal escrito o una fuerte distorsión de barril arrastra todo el
ajuste.

`H` solo describe el suelo. La salida lo indica en `H_scope`
([`H_SCOPE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L22)).
Retroproyectar un píxel del volante a través de `H` responde a "dónde estaría
este píxel si estuviera en el suelo", lo cual es incorrecto para cualquier cosa
en el aire.

## Paso 2: la columna vertical a partir de los anclajes de la red

Los puntos del suelo no dicen nada sobre `p3`, la columna que multiplica la
altura. Para eso hacen falta puntos de altura conocida que no estén en el
suelo: normalmente las dos puntas de los postes de la red a `Z = 1.55`. Para un
anclaje en `(X, Y, Z)` visto en `(u, v)`, escribe `q = H * [X, Y, 1]`. La
condición de proyección se vuelve lineal en `p3`:

```text
 u * (q3 + Z * p3_3) = q1 + Z * p3_1
 v * (q3 + Z * p3_3) = q2 + Z * p3_2

 rearranged per anchor:
   [ Z  0  -u*Z ] * p3 = u*q3 - q1
   [ 0  Z  -v*Z ] * p3 = v*q3 - q2
```

[`camera_from_anchors`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L81-L92)
apila estas filas, exige rango 3, resuelve por mínimos cuadrados y ensambla
`P = [h1 h2 p3 h3]`, donde `h1`, `h2`, `h3` son las columnas de `H`. Tres
incógnitas y dos filas por anclaje significan que dos anclajes dan cuatro
ecuaciones: un sistema casi exactamente determinado. Por eso un residuo de
anclaje pequeño (`net_anchor_residuals_px`) demuestra poco. Los anclajes deben
estar elevados (`Z > 0.1 m`) y debe haber al menos dos.

Por último,
[`_check_camera`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L95-L104)
rechaza una cámara cuyo centro no esté por encima del suelo, o una que dejaría
algunos puntos de la pista delante de ella y otros detrás.

## Puntos de ajuste frente a puntos reservados

Cada punto de suelo tiene un papel
([`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L128-L205)):

- Los puntos `fit` construyen `H`. Sus residuos (`fit_ground_residuals`) son
  error de entrenamiento y se espera que sean pequeños.
- Los puntos `heldout` nunca se usan para el ajuste. Se requiere al menos uno.
  `heldout_ground_errors` informa, por punto, de `error_px` (`H` aplicada al
  punto del mundo, comparada con tu píxel) y `error_m` (la inversa de `H`
  aplicada a tu píxel, comparada con el punto del mundo). `heldout_summary` da
  el recuento, la media y el máximo de ambos.

Un ejemplo conceptual: las cuatro esquinas exteriores como `fit` y dos
intersecciones de líneas de servicio como `heldout`. Si los errores reservados
son mucho mayores que los residuos de ajuste, un punto está mal etiquetado, se
hizo clic en el borde de una línea en vez de en su centro, o la lente curva las
líneas. El error reservado es una comprobación solo de la correspondencia del
suelo; no dice nada sobre las alturas.

## Sensibilidad, no un intervalo de confianza

Las alturas dependen casi por completo de los anclajes.
[`_anchor_sensitivity`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L107-L125)
toma un punto de referencia `(3.05, 6.70, 3.0)`, 3 m por encima de la línea
central de la red, y lo proyecta con `P`. Después, para cada anclaje y para `u`
y `v` por separado, mueve el píxel del anclaje `+uncertainty_px` y
`-uncertainty_px` (por defecto 3.0), vuelve a resolver `P` e interseca el rayo
que pasa por el mismo píxel de referencia con el plano de la red `Y = 6.70`.
`max_vertical_shift_m` es el mayor cambio de altura. Si una perturbación hace
fallar la resolución, el desplazamiento se reporta como infinito.

Es un peor caso de una perturbación a la vez para un solo punto. No es un
intervalo de confianza estadístico, no combina errores de varios anclajes y no
incluye el error de los puntos de suelo.

## Supuestos que estás haciendo

- Una cámara fija por `segment_id`; un movimiento de cámara o un zoom requiere
  un segmento nuevo.
- Las líneas rectas siguen siendo rectas en la imagen (sin distorsión de la
  lente).
- Los anclajes tienen las alturas que introduces. Las puntas de los postes a
  1.55 m y el centro de la red a 1.524 m son alturas distintas.
- El plano del suelo no es el volante. `H` da posiciones en el suelo; la
  profundidad del volante solo procede del ajuste físico descrito en
  [Física de la trayectoria](trajectory-physics.md).

Consulta [los esquemas](schemas.md) para todos los campos de entrada y salida y
[Validación y límites](validation-limits.md) para leer los errores junto con
los diagnósticos de vuelo.
