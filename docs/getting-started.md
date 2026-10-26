# Getting started

## Install

Requires Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

PyAV wheels include FFmpeg, so no system FFmpeg is required.

## Quick start

```bash
uv run shuttle-replay demo --out-dir demo
```

This writes `demo/inputs/` (synthetic video, tracks, review, calibration input),
`demo/calibration.json`, `demo/analysis.json`, `demo/replay.mp4`,
`demo/render_report.json` and `demo/synthetic_recovery.json`.

The demo is fully synthetic: two virtual cameras, a camera cut, noisy
detections with gaps and a test tone. Its recovery report compares against
synthetic ground truth only and says nothing about accuracy on real video.

Next: [run it on your own video](workflow.md).
