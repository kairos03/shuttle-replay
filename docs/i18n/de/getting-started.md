# Erste Schritte

## Installation

Erfordert Python 3.12+ und [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Die PyAV-Wheels enthalten FFmpeg, daher ist kein System-FFmpeg erforderlich.

## Schnellstart

```bash
uv run shuttle-replay demo --out-dir demo
```

Dies schreibt `demo/inputs/` (synthetisches Video, Tracks, Prüfung,
Kalibriereingabe), `demo/calibration.json`, `demo/analysis.json`,
`demo/replay.mp4`, `demo/render_report.json` und
`demo/synthetic_recovery.json`.

Die Demo ist vollständig synthetisch: zwei virtuelle Kameras, ein
Kameraschnitt, verrauschte Detektionen mit Lücken und ein Testton. Ihr
Rekonstruktionsbericht vergleicht nur mit synthetischer Ground Truth und sagt
nichts über die Genauigkeit bei echtem Video aus.

Weiter: [mit Ihrem eigenen Video ausführen](workflow.md).
