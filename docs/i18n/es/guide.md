# Guía de usuario de shuttle-replay (v0.1)

`shuttle-replay` es una herramienta sin conexión que crea una repetición del
volante de bádminton a partir de un vídeo local, detecciones que ya has
generado y anotaciones revisadas por una persona. Calibra la cámara, ajusta un
modelo de vuelo con gravedad y resistencia cuadrática del aire a las
coordenadas de detección 2D, y genera un MP4 que coloca el vídeo original y
una vista cenital de la pista lado a lado en proporción 6:4.

Esta herramienta es para investigación y revisión. No es un sistema de
arbitraje de líneas dentro/fuera, un clasificador de golpes, un detector de
volante ni un radar de velocidad medida. Cada posición y velocidad 3D de la
salida es un valor condicional del modelo que presupone tu calibración y tus
anotaciones.

## Instalación

Requiere Python 3.12 o posterior y [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Los wheels de PyAV incluyen FFmpeg, así que no se necesita FFmpeg del sistema.

## Demo sintética

```bash
uv run shuttle-replay demo --out-dir demo
```

Esto crea un peloteo sintético que mezcla dos cámaras virtuales, un segmento
de transición y detecciones ausentes, y luego ejecuta calibración → análisis →
renderizado de principio a fin. Los valores de `demo/synthetic_recovery.json`
se comparan con la verdad de referencia sintética, así que no indican la
exactitud en vídeo real.

## Uso con tu propio vídeo

1. **Detecciones (`tracks.json`)**: una fila por fotograma decodificado, con el
   PTS real de ese fotograma (segundos), el id del segmento de cámara (`null`
   para segmentos de transición y primeros planos), las coordenadas en píxeles
   del volante (`null` cuando no aparece) y cajas de jugadores opcionales.
   `frame_id` debe coincidir con el orden de decodificación. Consulta
   [docs/schemas.md](schemas.md) para el formato.
   La v0.1 no tiene detector. Puedes ejecutar tú mismo TrackNetV3 (MIT) o
   Ultralytics YOLO (AGPL-3.0) y convertir los resultados, pero no se incluye
   ningún script de conversión. No se descarga ningún peso de modelo.
2. **Entrada de calibración**: para cada segmento de cámara, marca en píxeles
   cuatro o más intersecciones de líneas de la pista (`fit`), algunas
   intersecciones para validación (`heldout`) y la parte superior de los dos
   postes de la red (altura 1.55 m).

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Revisa primero `heldout_summary` (el error en los puntos no usados para el
   ajuste) y `net_anchor_sensitivity` (cuánto se desplaza la altura cuando los
   postes de la red se mueven el error en píxeles indicado). La homografía del
   suelo se usa solo para puntos del suelo (Z=0) y nunca para el volante en el
   aire.
3. **Anotaciones de revisión (`review.json`)**: introduce el instante de
   contacto con la raqueta (`time_s`), el intervalo de revisión que lo contiene
   (`time_bracket_s`), el píxel del contacto y una estimación de altura. El
   instante de contacto es el segundo 0 del vuelo. Una primera detección
   tardía no cambia el segundo 0.
   Solo el último contacto de un segmento puede tener una condición final: un
   `landing_region` (la zona y el intervalo de tiempo en que el volante llega
   al suelo) u `open` (hasta la última observación del segmento, o hasta el
   `until_s` revisado). Cualquier otro vuelo termina en el siguiente contacto y
   no se fuerza a llegar al suelo. La v0.1 no corrige automáticamente los
   instantes de contacto, así que corrígelos tú mirando los fotogramas.
4. **Análisis y renderizado**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # 한 번에:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   El comentario `# 한 번에:` significa "todo en un paso:"; `run` realiza el
   análisis y el renderizado juntos.

   La herramienta se detiene con código de salida 2 si el PTS retrocede, si el
   mismo segmento de cámara reaparece tras un hueco, si un contacto queda fuera
   de su segmento de cámara o de su intervalo de revisión, o si el PTS del
   vídeo y el PTS de las pistas difieren. Nunca corrige la entrada en silencio.

## Interpretación de los resultados

- Círculo verde: las coordenadas de detección de entrada tal como se dieron.
  Los fotogramas sin detección se dejan vacíos.
- Círculo/puntos naranjas: el modelo físico condicional. Solo se dibuja dentro
  del mismo segmento de cámara y del mismo vuelo.
- Caja azul discontinua: la zona de caída que indicó una persona. La marca ×
  es el punto de caída del modelo ajustado con esa zona como condición, no una
  coordenada medida.
- La velocidad es la velocidad inicial del modelo redondeada a 5 km/h.
- Para un vuelo devuelto, el punto "dónde habría caído si no se hubiera
  devuelto" se registra solo en el JSON
  (`unreturned_floor_crossing_prediction`, una predicción contrafactual).
- Si el original tiene audio, los paquetes de audio se copian tal cual sin
  recodificar, así que se conservan el retardo inicial y los huecos del audio
  original. Si el audio no puede copiarse a MP4 o su temporización cambiaría,
  el renderizado falla. El resultado de decodificar el archivo de salida
  hasta el final para verificarlo se escribe en `render_report.json`.
- Los archivos existentes nunca se sobrescriben. La herramienta se detiene si
  un archivo de salida ya existe o es el mismo archivo que el vídeo original,
  y el renderizado escribe en un archivo temporal que solo se mueve al nombre
  final después de la verificación.

## Licencia

Solo GNU AGPL-3.0. Consulta [LICENSE](../LICENSE) y [NOTICE.md](../NOTICE.md).
