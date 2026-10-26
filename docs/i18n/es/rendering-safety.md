# Renderizado y seguridad de la salida

El renderizador produce un MP4 de repetición: el fotograma original a la
izquierda y una vista cenital de la pista a la derecha. Tiene dos tareas que
importan tanto como el propio dibujo: mantener intacta la temporización del
original y no dañar ni sobrescribir nunca un archivo. Todo lo que aparece en
esta página está en
[`render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py).

## Decodificar, dibujar, codificar

PyAV envuelve las bibliotecas de FFmpeg dentro del proceso de Python. El
renderizador abre el original, toma el primer flujo de vídeo y, si existe, el
primer flujo de audio, y demultiplexa sus paquetes en el orden del archivo
([`render`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L128-L279)).

```{figure} assets/technical/es/render-pipeline.svg
:alt: Canal de render: se demultiplexa source.mp4; los paquetes de vídeo se decodifican al fotograma k, se comprueban, se dibujan y se codifican en staging.mp4; el audio se copia
:class: technical-figure
:width: 100%

Recorrido de cada fotograma desde los paquetes de origen hasta el archivo provisional.
```

Para cada fotograma de vídeo decodificado `k`, antes de dibujar, comprueba
que:

- el análisis tiene un fotograma `k`, y su `frame_id` es igual a `k`,
- el fotograma decodificado tiene un PTS, y
- el tiempo decodificado difiere del `pts_s` del análisis como mucho `1e-3` s.

Cualquier fallo lanza `RenderError`, indicando el fotograma. Tras el último
paquete, el número de fotogramas decodificados debe ser igual al número de
fotogramas del análisis.

La codificación prueba `libx264`, después `h264` y después `mpeg4`, el que
pueda abrir la compilación local de FFmpeg, con formato de píxel `yuv420p`
([`_open_encoder`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L77-L90)).
El codificador usa el `time_base` del vídeo original; solo para `mpeg4` con un
denominador de `time_base` superior a 65535 recurre a 1/60000 s. Cada
fotograma de salida recibe el tiempo del fotograma original convertido a ese
`time_base`, así que una tasa de fotogramas variable sigue siendo variable. El
`rate=30` que se pasa al crear el flujo es un valor nominal; los tiempos de los
fotogramas vienen del original.

Las marcas de tiempo del vídeo de salida se redondean a ticks del
codificador. La verificación comprueba el número de fotogramas de salida, pero
no compara cada PTS de vídeo de salida decodificado con el original. La
verificación del audio compara los tiempos de presentación de los paquetes y el
primer desfase A/V decodificado
([código](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L213-L242)).

## Disposición

```{figure} assets/technical/es/render-layout.svg
:alt: Diseño 6:4: a la izquierda el fotograma original sin escalar (W x H); a la derecha la vista cenital con la pista ajustada a 4/6 W
:class: technical-figure
:width: 100%

Fotograma de salida: panel de origen y vista cenital en proporción de ancho 6:4.
```

`W` y `H` son la anchura y la altura del original redondeadas hacia arriba a
números pares (H.264 necesita tamaños pares); la anchura de la vista cenital es
`2 * round(W * 4 / 6 / 2)`. El fotograma original se pega a escala 1.0 en la
esquina superior izquierda; el redondeo hacia arriba añade como mucho una fila
o una columna de píxeles negros. La vista cenital
([`TopView`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L49-L69))
escala la pista de 6.10 x 13.40 m para que quepa en su panel con un margen y
conserva las proporciones de la pista.

Pillow dibuja las superposiciones
([`_compose`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L282-L336)):

- anillo verde: tu detección (`shuttle_observed_px`);
- anillo naranja: la proyección del modelo (`shuttle_model_px`);
- cajas de jugadores, si tus tracks las contienen;
- vista cenital: líneas de la pista, la red, la estela del modelo del vuelo
  actual, un punto cuyo tamaño crece con la altura del modelo, `z` y la
  velocidad aproximada del modelo;
- vuelos con caída: la zona revisada como un rectángulo discontinuo y, a partir
  del tiempo de caída, una cruz naranja en el punto de caída del modelo.

Los fotogramas de corte de cámara muestran "camera cut: excluded from replay"
y ninguna superposición del volante. Las entradas sintéticas añaden
`SYNTHETIC` al título de la vista cenital.

## Audio: copia del flujo, no recodificación

El audio no se decodifica ni se recodifica. Cada paquete de audio se copia al
nuevo contenedor con sus marcas de tiempo originales
(`add_stream_from_template`, y luego `mux`). Los paquetes sin DTS se omiten.
Esto conserva el desfase inicial del audio del original y cualquier hueco, lo
cual importa porque los archivos reales a menudo empiezan el audio una
fracción de segundo después del vídeo.

La copia del flujo solo funciona si MP4 acepta el códec de audio del original.
Si no se puede crear el flujo o no se puede multiplexar un paquete, el
renderizado falla con un `RenderError` que describe el fallo de la copia del
flujo; los errores de creación del flujo incluyen el códec. No hay alternativa
de recodificación, así que no todos los formatos de audio son compatibles. Un
original sin audio produce un MP4 silencioso, reportado como
`"source has no audio stream; output is silent"`.

## Verificación antes de publicar

El renderizador escribe en un archivo de staging y lo comprueba antes de que
aparezca nada en tu ruta de salida:

1. [`verify_mp4`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L339-L361)
   decodifica por completo el archivo de staging; el número de fotogramas de
   vídeo decodificados debe ser igual al número de fotogramas del análisis.
2. Con audio, el primer tiempo de audio menos el primer tiempo de vídeo debe
   coincidir con el del original con un margen de `1e-3` s
   ([`_first_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L104-L117)).
3. La lista de tiempos de los paquetes de audio debe ser idéntica a la del
   original
   ([`_audio_packet_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L120-L125)).

El informe de renderizado registra estos resultados:
`pts_check.max_abs_diff_s`, `audio.av_offset_error_s`, `audio.packets_copied`
y los recuentos de `verification`.

## Salida sin sobrescritura

Antes de cualquier trabajo,
[`_check_paths`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L93-L101)
rechaza un original inexistente, una salida que se resuelve al original
(incluido un enlace simbólico o un enlace duro a él) y cualquier ruta de salida
que ya exista, incluso un enlace simbólico colgante. Nunca se sobrescribe
nada.

El archivo de staging lo crea `tempfile.mkstemp` en el directorio de salida
con un nombre único de la forma `.<stem>.<random>.staging.mp4`. Tras la
verificación, `os.link` crea la salida como enlace duro a él. Un enlace duro
falla si el nombre de destino existe, así que la publicación no puede
reemplazar un archivo que apareciera durante el renderizado. El nombre de
staging se elimina en un bloque `finally` tanto en caso de éxito como de
fallo, así que nunca se toca un archivo ajeno del directorio. Esto depende de
que el sistema de archivos del directorio de salida admita enlaces duros.

La CLI aplica la misma regla al JSON: `_refuse_existing` comprueba cada ruta de
salida de antemano, y `_dump` abre los archivos en modo de creación exclusiva
([`cli.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L34-L63)).
`run` publica el vídeo antes de escribir los dos archivos JSON, así que las
tres salidas no forman una única transacción atómica. Comprueba primero las
tres salidas, de modo que una entrada proporcionada que resulte estar en
`<out-dir>/analysis.json` se rechaza en lugar de sobrescribirse. Los nombres de
archivo nunca llegan a un shell; la prueba
`test_render_rejects_mismatched_pts_and_handles_hostile_filename` renderiza
desde un nombre que contiene metacaracteres del shell.

Relacionado: [Observaciones y tiempo](observations-timing.md) para `pts_s`,
[Validación y límites](validation-limits.md) para lo que demuestran las
comprobaciones de medios, [los esquemas](schemas.md) para el informe de
renderizado.
