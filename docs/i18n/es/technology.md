# Visión general de la tecnología

`shuttle-replay` convierte tres tipos de evidencia en una repetición: un vídeo
original local, detecciones 2D del volante que tú proporcionas y restricciones
que una persona ha revisado (puntos de calibración, contactos y zonas de
caída). Esta página es el mapa. Las cinco páginas que la siguen explican cada
etapa en profundidad, y cada página enlaza las líneas exactas de código fuente
que describe, fijadas al commit
`6e9a060b5cc964f02d4017d806e953ffea89c8b4`.

## Flujo de datos

```{figure} assets/technical/es/pipeline.svg
:alt: Flujo de datos: calibración, pistas y revisión alimentan analyze; vídeo y análisis alimentan render, que escribe el MP4 y un informe
:class: technical-figure
:width: 100%

Entradas y salidas de los tres comandos.
```

La CLI expone cada flecha como un comando: `calibrate`, `analyze`, `render` y
`run` (analyze + render en un solo paso). `demo` construye una escena totalmente
sintética y ejecuta el mismo pipeline sobre ella
([`cli.py` `build_parser`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L154-L191)).
En `run`, el vídeo se renderiza y se verifica antes de escribir `analysis.json`
y `render_report.json`, de modo que los resultados JSON nunca describen un
vídeo que falló
([`_run_pipeline`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L55-L63)).

Lo que añade cada etapa:

1. **La calibración** convierte las posiciones en píxeles revisadas de puntos
   conocidos de la pista en una homografía del suelo `H` y una matriz de cámara
   3x4 `P` por segmento de cámara. Consulta
   [Calibración de la cámara](camera-calibration.md).
2. **La validación de entradas** comprueba marcas de tiempo, segmentos,
   contactos y finales de vuelo, y rechaza las incoherencias en lugar de
   repararlas. Consulta [Observaciones y tiempo](observations-timing.md).
3. **El ajuste de vuelos** ajusta un modelo de gravedad + resistencia
   cuadrática a las detecciones 2D entre contactos revisados. Consulta
   [Física de la trayectoria](trajectory-physics.md).
4. **El renderizado** decodifica el original, dibuja superposiciones y una
   vista cenital de la pista, copia los paquetes de audio y verifica el
   resultado antes de publicarlo. Consulta
   [Renderizado y seguridad de la salida](rendering-safety.md).
5. **La validación** se reparte entre todas las etapas. Lo que demuestra cada
   comprobación, y lo que no, se recoge en
   [Validación y límites](validation-limits.md).

## Pila de software

| Componente | Papel en este proyecto |
| --- | --- |
| Python 3.12+ | Lenguaje; `requires-python = ">=3.12"` en `pyproject.toml` |
| NumPy | Álgebra lineal: DLT de la homografía, SVD, proyección, resolución de anclajes por mínimos cuadrados |
| SciPy | `solve_ivp` integra la EDO del vuelo; `least_squares` ajusta los vuelos |
| PyAV (`av`) | Bindings de FFmpeg en el mismo proceso: decodificación, codificación, copia del flujo de audio, verificación |
| Pillow | Dibuja anillos, estelas, la pista y texto sobre cada fotograma |
| uv | Instala el entorno bloqueado (`uv.lock`) y ejecuta comandos |
| Sphinx + MyST + Furo | Construye este sitio de documentación (el grupo de dependencias `docs`) |

Las dependencias de ejecución son exactamente `numpy`, `scipy`, `av` y `pillow`
([`pyproject.toml`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/pyproject.toml#L10-L15)).
Ningún subproceso ni comando de shell se construye a partir de nombres de
archivo; el trabajo de vídeo pasa por PyAV dentro del mismo proceso de Python
([docstring del módulo `render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L1-L7)).

## Por qué no se incluye ningún modelo

Encontrar un volante en un fotograma (detección) y decidir dónde está en 3D
(reconstrucción) son problemas distintos. Este proyecto solo hace lo segundo, y
solo bajo supuestos explícitos. No hay detector, ni red neuronal, ni pesos de
modelo que descargar. Tú aportas detecciones de cualquier herramienta en la que
confíes, en el formato `shuttle-replay/tracks/v1` descrito en
[los esquemas](schemas.md).

Así cada número sigue siendo rastreable. Cada fotograma del análisis etiqueta
la posición del volante con una capa de procedencia
([`PROVENANCE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L33-L38)):

- `observed_pixel`: tu detección, sin cambios, o nula cuando no la hubo.
- `human_review`: un contacto, una zona de caída o un punto de calibración que
  introdujo una persona.
- `conditional_model`: el modelo físico ajustado, que solo es tan bueno como la
  calibración y la revisión de las que depende.
- `display_interpolation`: líneas que el renderizador dibuja entre muestras del
  modelo.

Una detección perdida nunca se rellena como si se hubiera observado, y el
modelo nunca se etiqueta como medición.

## Ruta de lectura sugerida

Si eres nuevo en visión por computador, lee en este orden:

1. [Calibración de la cámara](camera-calibration.md): cómo se relacionan los
   píxeles con los metros, y por qué una sola cámara no puede ver la
   profundidad por sí misma.
2. [Física de la trayectoria](trajectory-physics.md): cómo la física y los
   contactos revisados completan la profundidad que falta.
3. [Observaciones y tiempo](observations-timing.md): por qué las marcas de
   tiempo vienen del contenedor de vídeo y no de un contador de fotogramas.
4. [Renderizado y seguridad de la salida](rendering-safety.md): cómo se
   construye y se protege el MP4.
5. [Validación y límites](validation-limits.md): cómo leer los diagnósticos y
   dónde dejan de valer.

Para pasos prácticos, consulta [Primeros pasos](getting-started.md),
[la guía de usuario](guide.md) y [el flujo de trabajo](workflow.md).
