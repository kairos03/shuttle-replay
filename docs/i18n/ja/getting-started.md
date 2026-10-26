# はじめに

## インストール

Python 3.12+ と [uv](https://docs.astral.sh/uv/) が必要です。

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

PyAV の wheel には FFmpeg が含まれているため、システムの FFmpeg は不要です。

## クイックスタート

```bash
uv run shuttle-replay demo --out-dir demo
```

このコマンドは `demo/inputs/`（合成動画、トラック、レビュー、キャリブレーション入力）、`demo/calibration.json`、`demo/analysis.json`、`demo/replay.mp4`、`demo/render_report.json`、`demo/synthetic_recovery.json` を書き出します。

このデモは完全に合成されたものです。2 台の仮想カメラ、1 回のカメラ切り替え、欠落とノイズを含む検出結果、テストトーンで構成されています。その復元レポートは合成の正解値とのみ比較しており、実際の動画での精度については何も示しません。

次へ：[自分の動画で実行する](workflow.md)。
