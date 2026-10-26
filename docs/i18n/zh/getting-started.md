# 快速入门

## 安装

需要 Python 3.12+ 和 [uv](https://docs.astral.sh/uv/)。

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

PyAV 的 wheel 包已包含 FFmpeg，因此无需安装系统 FFmpeg。

## 快速开始

```bash
uv run shuttle-replay demo --out-dir demo
```

该命令会写出 `demo/inputs/`（合成视频、轨迹、审核、标定输入）、`demo/calibration.json`、`demo/analysis.json`、`demo/replay.mp4`、`demo/render_report.json` 和 `demo/synthetic_recovery.json`。

该演示完全是合成的：两个虚拟摄像机、一次镜头切换、带有缺失和噪声的检测结果以及一段测试音。其恢复报告只与合成真值进行比较，并不说明在真实视频上的精度。

下一步：[在你自己的视频上运行](workflow.md)。
