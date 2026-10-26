# Начало работы

## Установка

Требуются Python 3.12+ и [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

Колёса PyAV включают FFmpeg, поэтому системный FFmpeg не нужен.

## Быстрый старт

```bash
uv run shuttle-replay demo --out-dir demo
```

Команда создаёт `demo/inputs/` (синтетическое видео, треки, разметку проверки,
входные данные калибровки), `demo/calibration.json`, `demo/analysis.json`,
`demo/replay.mp4`, `demo/render_report.json` и `demo/synthetic_recovery.json`.

Демо полностью синтетическое: две виртуальные камеры, смена плана, зашумлённые
детекции с пропусками и тестовый тон. Его отчёт о восстановлении сравнивает
результаты только с синтетическими эталонными данными и ничего не говорит о
точности на реальном видео.

Далее: [запустите на своём видео](workflow.md).
