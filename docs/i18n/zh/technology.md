# 技术概览

`shuttle-replay` 把三类证据转换为回放：本地源视频、由你提供的 2D 羽毛球检测结果，以及经人工复核的约束（标定点、击球时刻和落点区域）。本页是总览图。后面的五个页面会深入讲解每个阶段，并且每个页面都链接到所描述源代码的确切行，链接固定在提交 `6e9a060b5cc964f02d4017d806e953ffea89c8b4`。

## 数据流

```{figure} assets/technical/zh/pipeline.svg
:alt: 数据流：标定、轨迹和复核输入进入 analyze；视频和分析结果进入 render，输出回放 MP4 和渲染报告
:class: technical-figure
:width: 100%

三个命令的输入与输出。
```

CLI 把每个箭头作为一个命令提供：`calibrate`、`analyze`、`render`，以及 `run`（一步完成 analyze 和 render）。`demo` 会构建一个完全合成的场景，并在其上运行同一条流水线（[`cli.py` `build_parser`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L154-L191)）。在 `run` 中，视频会先渲染并通过验证，然后才写入 `analysis.json` 和 `render_report.json`，因此 JSON 结果永远不会描述一个失败的视频（[`_run_pipeline`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L55-L63)）。

每个阶段增加的内容：

1. **标定**把已知球场点经复核的像素位置，转换为每个摄像机片段的地面单应矩阵 `H` 和 3x4 相机矩阵 `P`。参见[相机标定](camera-calibration.md)。
2. **输入验证**检查时间戳、片段、击球时刻和飞行终点，遇到不一致时直接拒绝，而不是修复。参见[观测与时间](observations-timing.md)。
3. **飞行拟合**在经复核的击球时刻之间，对 2D 检测结果拟合重力加二次空气阻力模型。参见[轨迹物理](trajectory-physics.md)。
4. **渲染**解码源视频，绘制叠加层和俯视球场，复制音频数据包，并在发布前验证结果。参见[渲染与输出安全](rendering-safety.md)。
5. **验证**贯穿所有阶段。每项检查证明了什么、没有证明什么，汇总在[验证与局限](validation-limits.md)中。

## 软件栈

| 组件 | 在本项目中的作用 |
| --- | --- |
| Python 3.12+ | 编程语言；`pyproject.toml` 中的 `requires-python = ">=3.12"` |
| NumPy | 线性代数：单应矩阵 DLT、SVD、投影、锚点最小二乘求解 |
| SciPy | `solve_ivp` 积分飞行 ODE；`least_squares` 拟合飞行 |
| PyAV (`av`) | 进程内 FFmpeg 绑定：解码、编码、音频流复制、验证 |
| Pillow | 在每一帧上绘制圆环、轨迹、球场和文字 |
| uv | 安装锁定的环境（`uv.lock`）并运行命令 |
| Sphinx + MyST + Furo | 构建本文档站点（`docs` 依赖组） |

运行时依赖恰好是 `numpy`、`scipy`、`av` 和 `pillow`（[`pyproject.toml`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/pyproject.toml#L10-L15)）。不会用文件名构造任何子进程或 shell 命令；视频处理都在同一个 Python 进程中通过 PyAV 完成（[`render.py` 模块 docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L1-L7)）。

## 为什么不内置模型

在画面中找到羽毛球（检测）与判断它在 3D 空间中的位置（重建）是两个不同的问题。本项目只做第二件事，而且只在明确的假设下进行。没有检测器，没有神经网络，也没有需要下载的模型权重。你可以用任何你信任的工具产生检测结果，并按[数据格式](schemas.md)中描述的 `shuttle-replay/tracks/v1` 格式提供。

这样每个数字都可以追溯。每个分析帧都会为羽毛球位置标注来源层（[`PROVENANCE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L33-L38)）：

- `observed_pixel`：你的检测结果，原样保留；没有检测时为 null。
- `human_review`：由人工输入的击球时刻、落点区域或标定点。
- `conditional_model`：拟合得到的物理模型，其可靠程度不会超过它所依赖的标定和复核。
- `display_interpolation`：渲染器在模型采样点之间绘制的线段。

漏检的帧绝不会被当作观测值来填补，模型也绝不会被标记为测量值。

## 建议阅读顺序

如果你刚接触计算机视觉，请按以下顺序阅读：

1. [相机标定](camera-calibration.md)：像素如何与米对应，以及为什么单个相机本身看不到深度。
2. [轨迹物理](trajectory-physics.md)：物理规律和经复核的击球时刻如何补上缺失的深度。
3. [观测与时间](observations-timing.md)：为什么时间戳来自视频容器，而不是帧计数器。
4. [渲染与输出安全](rendering-safety.md)：MP4 如何生成和保护。
5. [验证与局限](validation-limits.md)：如何解读诊断信息，以及它们的适用边界。

动手操作的步骤请参见[快速开始](getting-started.md)、[用户指南](guide.md)和[工作流程](workflow.md)。
