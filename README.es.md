<p align="center">
  <img src="docs/assets/header.svg" alt="shuttle-replay" width="100%">
</p>

<p align="center"><b>Convierte un video local de bádminton, tus detecciones y tu revisión en una repetición con la pista al lado. Sin conexión.</b></p>

<p align="center">
  <a href="https://github.com/kairos03/shuttle-replay/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/kairos03/shuttle-replay/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/python-3.12%2B-3776ab?style=flat-square" alt="Python 3.12+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-c6f04a?style=flat-square" alt="AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/runs-offline-0d2a1f?style=flat-square" alt="Sin conexión">
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ru.md">Русский</a> | <a href="README.ko.md">한국어</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.de.md">Deutsch</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.it.md">Italiano</a>
</p>

<p align="center">
  <a href="#quick-start">Inicio rápido</a> |
  <a href="#workflow">Flujo de trabajo</a> |
  <a href="docs/usage.ko.md">Guía en coreano</a> |
  <a href="docs/schemas.md">Esquemas (en inglés)</a>
</p>

## Descripción general

`shuttle-replay` calibra una cámara a partir de puntos de la pista que has
revisado, ajusta vuelos con gravedad y arrastre cuadrático a las detecciones 2D
del volante que proporcionas, y genera un MP4 con el video original junto a una
vista cenital de la pista.

Es una herramienta de investigación y revisión, no un sistema de arbitraje de
líneas, un clasificador de golpes, un detector de volantes ni un radar de
velocidad 3D medida. Cada posición y velocidad 3D es una salida condicional del
modelo que depende de tu calibración y tus anotaciones.

## Instalación

Requiere Python 3.12+ y [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Los wheels de PyAV incluyen FFmpeg, así que no se necesita FFmpeg del sistema.

## Por qué usarlo

- **Totalmente sin conexión.** Sin detector, sin pesos de modelo, sin llamadas de red.
- **La revisión humana primero.** Los contactos, las zonas de caída y los puntos de calibración los aportas tú; nada se corrige en silencio.
- **Capas honestas.** Los píxeles observados, tu revisión y el modelo condicional se mantienen separados en la salida.
- **Renderizado seguro.** El audio original se copia como flujo sin recodificar, y los archivos existentes nunca se sobrescriben.

<a id="quick-start"></a>
## Inicio rápido

```bash
uv run shuttle-replay demo --out-dir demo
```

Escribe `demo/inputs/` (video sintético, pistas, revisión, entrada de calibración),
`demo/calibration.json`, `demo/analysis.json`, `demo/replay.mp4`,
`demo/render_report.json` y `demo/synthetic_recovery.json`.

<p align="center">
  <img src="docs/assets/demo.gif" alt="Repetición de la demo sintética: vista original junto a la pista en vista cenital" width="90%">
  <br><sub>Demostración sintética generada por <code>demo</code>. No es una medida de la precisión en el mundo real.</sub>
</p>

<a id="workflow"></a>
## Flujo de trabajo

Lo que debes proporcionar para tu propio video:

- **Detecciones** (`tracks.json`): una entrada por fotograma decodificado con PTS,
  id de segmento de cámara, píxel del volante o null, y cajas de jugadores
  opcionales. No hay detector integrado.
- **Entrada de calibración**: por segmento, al menos 4 puntos de pista `fit`,
  algunos puntos `heldout` y las puntas de ambos postes de la red (1.55 m).
- **Revisión** (`review.json`): tiempos de contacto, píxeles y alturas que has
  revisado, más zonas de caída opcionales. Los contactos no se detectan
  automáticamente.

```bash
uv run shuttle-replay calibrate calibration_input.json -o calibration.json
uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
    --calibration calibration.json --out-dir out
```

<details>
<summary><b>Guía paso a paso para tu propio video</b></summary>

1. **Detecciones.** Genera una entrada de `tracks.json` por fotograma decodificado
   con el PTS del fotograma, un id de segmento de cámara (null para cortes o
   primeros planos), el píxel del volante (o null) y cajas de jugadores
   opcionales. Consulta [docs/schemas.md](docs/schemas.md) (en inglés).
   Puedes usar cualquier rastreador; por ejemplo, puedes ejecutar tú mismo
   TrackNetV3 (MIT) para el volante y un modelo YOLO de Ultralytics (AGPL-3.0)
   para los jugadores con tus propios checkpoints y convertir sus salidas. Los
   scripts de conversión no forman parte de v0.1.
2. **Entrada de calibración.** Para cada segmento de cámara, mide ≥ 4
   intersecciones de líneas de la pista (rol `fit`), algunas más como `heldout`,
   y las puntas de los dos postes de la red (1.55 m).

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Revisa `heldout_summary` y `net_anchor_sensitivity` antes de continuar.
3. **Revisión.** Escribe `review.json`: tiempos de contacto dentro de intervalos
   revisados, valores previos de píxel y altura del contacto y, para el último
   vuelo de un segmento, una zona de caída opcional u `open`.
4. **Analizar y renderizar.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Las entradas incoherentes (PTS no monótonos, segmentos no contiguos,
   contactos fuera de su segmento o intervalo, PTS que no coinciden con el
   video, …) se detienen con código de salida 2 y un mensaje; nada se corrige en
   silencio.

</details>

<details>
<summary><b>Qué hace cada comando</b></summary>

- **Calibración** (`calibrate`): homografía a partir de ≥ 4 puntos del suelo
  revisados, más la columna vertical de la cámara a partir de ≥ 2 anclajes
  elevados de la red. Los puntos del suelo reservados nunca se usan para el
  ajuste y se informan por separado (en píxeles y metros). Se rechazan las
  entradas degeneradas, duplicadas, colineales y no finitas. La homografía del
  suelo nunca se usa para puntos en el aire.
- **Análisis** (`analyze`): un vuelo por cada contacto revisado, cronometrado
  desde el contacto revisado (tiempo cero) aunque la primera detección llegue
  más tarde. Usa los PTS originales, los ids de fotograma y los ids de segmento
  de cámara; los cortes de cámara se excluyen y los vuelos nunca cruzan
  segmentos. Cada vuelo termina en el siguiente contacto (interceptado, sin
  forzar la caída), en una zona de caída revisada (una restricción, no una
  coordenada medida) o en la última observación del segmento. Las comprobaciones
  de suelo y red rechazan ajustes inviables. Cuando un vuelo fue interceptado,
  el punto del suelo que *habría* alcanzado se informa por separado como
  contrafactual. Las detecciones ausentes siguen siendo null.
- **Renderizado** (`render`): verifica cada fotograma original decodificado
  contra los PTS de las pistas, dibuja las cajas de jugadores proporcionadas,
  los anillos del volante observado (verde) y del modelo (naranja), y una pista
  en vista cenital con una disposición 6:4 entre original y vista cenital. Los
  fotogramas con corte de cámara no reciben superposición del volante. Los
  paquetes de audio originales se copian como flujo sin cambios (sin
  recodificar), así que se conservan el desfase inicial y los huecos del audio
  original; el renderizado falla si el audio no se puede copiar al MP4 o si su
  temporización cambia. No se construyen comandos de shell a partir de nombres
  de archivo. Las salidas nunca se sobrescriben: el renderizado falla si la
  salida ya existe o apunta al archivo original, escribe en un archivo temporal
  único y solo lo publica tras una comprobación completa de decodificación.
- **Demo** (`demo`): genera un peloteo totalmente sintético (dos cámaras
  virtuales, un corte de cámara, detecciones con ruido y huecos, un tono de
  prueba) y ejecuta todo el proceso, incluido un informe de recuperación de la
  verdad de referencia sintética.

</details>

<details>
<summary><b>Cómo leer la salida</b></summary>

| Capa | Significado |
| --- | --- |
| `observed_pixel` | detección proporcionada, sin cambios; null cuando falta |
| `human_review` | tus contactos, zonas de caída y puntos de calibración |
| `conditional_model` | modelo físico ajustado a los píxeles observados bajo tus valores previos |
| `display_interpolation` | líneas y marcadores dibujados solo por el renderizador |

Las velocidades son la velocidad inicial del modelo ajustado (`model_speed_km_h`,
mostrada redondeada a 5 km/h). Trátalas como valores aproximados del modelo.

</details>

<details>
<summary><b>Limitaciones</b></summary>

- Sin detección del volante ni de jugadores. Tú proporcionas las detecciones en
  el [formato de pistas](docs/schemas.md) (en inglés); no se descargan pesos de
  modelo.
- Sin búsqueda automática de contactos ni refinamiento de sus marcas de tiempo.
- Sin mapas de profundidad densa aprendidos, sin etiquetas de golpes aprendidas,
  sin decisiones automáticas de IN/OUT.
- La salida 3D es condicional, no medida. Un error de reproyección bajo muestra
  coherencia con las detecciones 2D, no una prueba independiente de la precisión
  3D. Los resultados de recuperación sintética son sintéticos.

</details>

<details>
<summary><b>Desarrollo</b></summary>

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

</details>

<details>
<summary><b>Licencia</b></summary>

GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). Consulta
[LICENSE](LICENSE) y [NOTICE.md](NOTICE.md) para los avisos de terceros.

</details>
