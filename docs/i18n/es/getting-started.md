# Primeros pasos

## Instalación

Requiere Python 3.12+ y [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Los wheels de PyAV incluyen FFmpeg, así que no hace falta FFmpeg del sistema.

## Inicio rápido

```bash
uv run shuttle-replay demo --out-dir demo
```

Esto escribe `demo/inputs/` (vídeo sintético, pistas, revisión, entrada de
calibración), `demo/calibration.json`, `demo/analysis.json`, `demo/replay.mp4`,
`demo/render_report.json` y `demo/synthetic_recovery.json`.

La demo es totalmente sintética: dos cámaras virtuales, un corte de cámara,
detecciones con ruido y huecos, y un tono de prueba. Su informe de
recuperación compara solo con la verdad de referencia sintética y no dice nada
sobre la exactitud en vídeo real.

Siguiente: [ejecútalo con tu propio vídeo](workflow.md).
