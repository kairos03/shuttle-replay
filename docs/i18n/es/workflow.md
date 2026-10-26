# Flujo de trabajo

## Qué proporcionas

- **Detecciones** (`tracks.json`): una entrada por fotograma decodificado con
  PTS, id del segmento de cámara, píxel del volante o null, y cajas de
  jugadores opcionales. No hay detector integrado. Consulta [](schemas.md).
- **Entrada de calibración**: por segmento, al menos 4 puntos de pista `fit`,
  algunos puntos `heldout` y la parte superior de ambos postes de la red
  (1.55 m).
- **Revisión** (`review.json`): instantes de contacto, píxeles y alturas que
  has revisado, más zonas de caída opcionales. Los contactos no se encuentran
  automáticamente.

Cualquier rastreador puede producir las detecciones; por ejemplo, puedes
ejecutar tú mismo TrackNetV3 (MIT) para el volante y un modelo Ultralytics
YOLO (AGPL-3.0) para los jugadores, con tus propios checkpoints, y convertir
sus salidas. Los scripts de conversión no forman parte de la v0.1.

## Pasos

1. **Calibrar.** Para cada segmento de cámara, mide ≥ 4 intersecciones de
   líneas de la pista (rol `fit`), algunas más como `heldout`, y la parte
   superior de los dos postes de la red.

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Revisa `heldout_summary` y `net_anchor_sensitivity` antes de continuar.
2. **Revisar.** Escribe `review.json`: instantes de contacto dentro de
   intervalos revisados, píxel del contacto y priors de altura, y para el
   último vuelo de un segmento una zona de caída opcional u `open`.
3. **Analizar y renderizar.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Las entradas incoherentes (PTS no monótono, segmentos no contiguos,
   contactos fuera de su segmento o intervalo, PTS que no coincide con el
   vídeo, …) se detienen con código de salida 2 y un mensaje; nada se repara
   en silencio.

## Qué hace cada comando

- **`calibrate`**: homografía a partir de ≥ 4 puntos del suelo revisados, más
  la columna vertical de la cámara a partir de ≥ 2 anclajes elevados de la red.
  Los puntos del suelo reservados nunca se usan para el ajuste y se informan
  por separado. Se rechazan las entradas degeneradas, duplicadas, colineales y
  no finitas. La homografía del suelo nunca se usa para puntos en el aire.
- **`analyze`**: un vuelo por cada contacto revisado, temporizado desde el
  contacto revisado. Los cortes de cámara se excluyen y los vuelos nunca
  cruzan segmentos. Cada vuelo termina en el siguiente contacto, en una zona
  de caída revisada (una restricción, no una coordenada medida) o en la última
  observación del segmento. Los filtros de suelo y red rechazan ajustes
  inviables. Las detecciones ausentes siguen siendo null.
- **`render`**: verifica cada fotograma original decodificado contra el PTS de
  las pistas y dibuja las cajas de jugadores proporcionadas, los anillos del
  volante observado (verde), los anillos del modelo (naranja) y una vista
  cenital de la pista en un diseño 6:4. El audio original se copia como flujo
  sin recodificar. Las salidas existentes nunca se sobrescriben.
- **`demo`**: genera un peloteo sintético y ejecuta toda la cadena.

## Interpretación de la salida

| Capa | Significado |
| --- | --- |
| `observed_pixel` | detección proporcionada, sin cambios; null cuando no hay |
| `human_review` | tus contactos, zonas de caída y puntos de calibración |
| `conditional_model` | modelo físico ajustado a los píxeles observados bajo tus priors |
| `display_interpolation` | líneas y marcadores dibujados solo por el renderizador |

Las velocidades son la velocidad inicial del modelo ajustado
(`model_speed_km_h`, mostrada redondeada a 5 km/h). Trátalas como valores
aproximados del modelo, no como mediciones.

## Límites

- Sin detección de volante ni de jugadores y sin pesos incluidos.
- Sin búsqueda automática de contactos ni refinamiento del instante de contacto.
- Sin mapas de profundidad densa aprendidos, sin etiquetas de golpe aprendidas,
  sin decisiones automáticas de IN/OUT.
- La salida 3D es condicional, no medida. Los resultados de recuperación
  sintética son sintéticos.
