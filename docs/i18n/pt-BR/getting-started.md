# Primeiros passos

## Instalação

Requer Python 3.12+ e [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Os wheels do PyAV incluem o FFmpeg, então não é necessário FFmpeg do sistema.

## Início rápido

```bash
uv run shuttle-replay demo --out-dir demo
```

Isso grava `demo/inputs/` (vídeo sintético, trilhas, revisão, entrada de
calibração), `demo/calibration.json`, `demo/analysis.json`, `demo/replay.mp4`,
`demo/render_report.json` e `demo/synthetic_recovery.json`.

A demo é totalmente sintética: duas câmeras virtuais, um corte de câmera,
detecções ruidosas com lacunas e um tom de teste. Seu relatório de
recuperação compara apenas com a verdade de referência sintética e não diz
nada sobre a exatidão em vídeo real.

Próximo: [execute com seu próprio vídeo](workflow.md).
