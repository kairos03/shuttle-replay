# shuttle-replay

```{image} assets/header.svg
:alt: shuttle-replay
:width: 100%
```

**Convierte un vídeo local de bádminton, tus detecciones y tu revisión en una
repetición con la pista al lado. Sin conexión.**

`shuttle-replay` calibra una cámara a partir de puntos de la pista que has
revisado, ajusta trayectorias con gravedad y resistencia cuadrática del aire a
las detecciones 2D del volante que tú proporcionas, y genera un MP4 con el
vídeo original junto a una vista cenital de la pista.

Es una herramienta de investigación y revisión, no un sistema de arbitraje de
líneas, un clasificador de golpes, un detector de volante ni un radar de
velocidad 3D medida:

- **Tú proporcionas las detecciones.** No se incluye ningún detector de volante
  ni de jugadores y no se descarga ningún peso de modelo.
- **Tú proporcionas la revisión.** Los contactos, las zonas de caída y los
  puntos de calibración los revisa una persona; nada se encuentra ni se repara
  automáticamente.
- **El 3D es condicional, no medido.** Cada posición y velocidad 3D es una
  salida de un modelo físico que depende de tu calibración y tus anotaciones.
  No hay profundidad aprendida, y un error de reproyección bajo no demuestra
  la exactitud 3D.

```{image} assets/demo.gif
:alt: Repetición de demostración sintética, vista original junto a la vista cenital de la pista
:width: 90%
```

*Demostración sintética generada por `shuttle-replay demo`. No es una medida
de la exactitud en el mundo real.*

```{toctree}
:maxdepth: 2
:caption: Guía

getting-started
guide
workflow
schemas
```

```{toctree}
:maxdepth: 1
:caption: Idiomas

languages
```

```{toctree}
:maxdepth: 1
:caption: Proyecto

development
license
```
