# Per iniziare

## Installazione

Richiede Python 3.12+ e [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

I wheel di PyAV includono FFmpeg, quindi non serve un FFmpeg di sistema.

## Avvio rapido

```bash
uv run shuttle-replay demo --out-dir demo
```

Questo scrive `demo/inputs/` (video sintetico, tracce, revisione, input di
calibrazione), `demo/calibration.json`, `demo/analysis.json`, `demo/replay.mp4`,
`demo/render_report.json` e `demo/synthetic_recovery.json`.

La demo è interamente sintetica: due telecamere virtuali, un cambio di
inquadratura, rilevazioni rumorose con lacune e un tono di prova. Il suo
report di recupero confronta solo con la verità di riferimento sintetica e non
dice nulla sull'accuratezza su video reali.

Prossimo passo: [eseguilo sul tuo video](workflow.md).
