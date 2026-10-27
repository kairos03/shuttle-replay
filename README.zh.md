<p align="center">
  <img src="docs/assets/header.svg" alt="shuttle-replay" width="100%">
</p>

<p align="center"><b>将本地羽毛球视频、你的检测结果和你的审阅结果转换为并排显示的球场回放。完全离线。</b></p>

<p align="center">
  <a href="https://github.com/kairos03/shuttle-replay/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/kairos03/shuttle-replay/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/python-3.12%2B-3776ab?style=flat-square" alt="Python 3.12+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-c6f04a?style=flat-square" alt="AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/runs-offline-0d2a1f?style=flat-square" alt="Offline">
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ru.md">Русский</a> | <a href="README.ko.md">한국어</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.de.md">Deutsch</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.it.md">Italiano</a>
</p>

<p align="center">
  <a href="#quick-start">快速开始</a> |
  <a href="#workflow">工作流程</a> |
  <a href="#user-guide">使用指南</a> |
  <a href="docs/schemas.md">数据格式（英文）</a> |
  <a href="https://kairos03.github.io/shuttle-replay/zh/">文档</a> |
  <a href="https://kairos03.github.io/shuttle-replay/demo/"><strong>体验演示</strong></a>
</p>

## 概述

`shuttle-replay` 根据你审阅过的球场点标定相机，对你提供的 2D 羽毛球检测结果拟合
重力 + 二次阻力的飞行模型，并渲染出一个 MP4：原始视频旁边是球场俯视图。

它是一个研究和审阅工具，不是司线判罚系统、击球分类器、羽毛球检测器，也不是实测
3D 速度的测速枪。所有 3D 位置和速度都是条件模型输出，取决于你的标定和标注。

## 安装

需要 Python 3.12+ 和 [uv](https://docs.astral.sh/uv/)。

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

PyAV 的 wheel 包已内置 FFmpeg，因此无需安装系统 FFmpeg。

## 为什么使用它

- **完全离线。** 没有检测器，没有模型权重，没有网络调用。
- **人工审阅优先。** 击球点、落点区域和标定点都由你提供；不会悄悄修复任何内容。
- **诚实的分层。** 输出中观测像素、你的审阅和条件模型彼此分离。
- **安全的渲染。** 原始音频以流复制方式保留，不重新编码；已有文件永远不会被覆盖。

<a id="quick-start"></a>
## 快速开始

```bash
uv run shuttle-replay demo --out-dir demo
```

会写出 `demo/inputs/`（合成视频、轨迹、审阅、标定输入）、
`demo/calibration.json`、`demo/analysis.json`、`demo/replay.mp4`、
`demo/render_report.json` 和 `demo/synthetic_recovery.json`。

<p align="center">
  <img src="docs/assets/demo.gif" alt="合成演示回放：原始画面旁边是球场俯视图" width="90%">
  <br><sub>由 <code>demo</code> 生成的合成演示。不代表真实场景的准确度。</sub>
</p>

<a id="workflow"></a>
## 工作流程

用于你自己的视频时，你必须提供：

- **检测结果**（`tracks.json`）：每个解码帧一条记录，包含 PTS、相机片段 id、
  羽毛球像素或 null，以及可选的球员框。没有内置检测器。
- **标定输入**：每个片段至少 4 个 `fit` 球场点、若干 `heldout` 点，以及两根
  网柱顶端（1.55 m）。
- **审阅**（`review.json`）：你审阅过的击球时间、像素和高度，以及可选的落点区域。
  击球点不会被自动查找。

```bash
uv run shuttle-replay calibrate calibration_input.json -o calibration.json
uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
    --calibration calibration.json --out-dir out
```

<a id="user-guide"></a>

<details>
<summary><b>用于你自己视频的分步指南</b></summary>

1. **检测结果。** 为每个解码帧生成一条 `tracks.json` 记录，包含该帧的 PTS、
   相机片段 id（切镜或特写为 null）、羽毛球像素（或 null）以及可选的球员框。
   参见 [docs/schemas.md](docs/schemas.md)（英文）。可以使用任何跟踪器；例如，
   你可以自行使用自己的检查点运行 TrackNetV3（MIT）跟踪羽毛球、运行 Ultralytics
   YOLO 模型（AGPL-3.0）检测球员，然后转换它们的输出。转换脚本不包含在 v0.1 中。
2. **标定输入。** 对每个相机片段，测量 ≥ 4 个球场线交点（角色 `fit`）、另外若干个
   作为 `heldout`，以及两根网柱顶端（1.55 m）。

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   继续之前，请检查 `heldout_summary` 和 `net_anchor_sensitivity`。
3. **审阅。** 编写 `review.json`：审阅区间内的击球时间、击球像素和高度先验，
   以及片段最后一次飞行的可选落点区域或 `open`。
4. **分析与渲染。**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   输入不一致时（PTS 非单调、片段不连续、击球落在其片段或区间之外、PTS 与视频不匹配等），
   程序以退出码 2 停止并给出提示；不会悄悄修复任何内容。

</details>

<details>
<summary><b>各命令的作用</b></summary>

- **标定**（`calibrate`）：由 ≥ 4 个审阅过的地面点求单应矩阵，并由 ≥ 2 个有高度的
  网柱锚点求相机的竖直列。留出的地面点从不用于拟合，而是单独报告（像素和米）。
  退化、重复、共线和非有限值的输入会被拒绝。地面单应矩阵从不用于空中的点。
- **分析**（`analyze`）：每个审阅过的击球对应一次飞行，计时从审阅的击球时刻（时间零点）
  开始，即使第一次检测出现得更晚也是如此。使用原始 PTS、帧 id 和相机片段 id；
  切镜被排除，飞行从不跨越片段。每次飞行结束于下一次击球（被拦截，不强制落地）、
  审阅过的落点区域（一种约束，而非实测坐标），或片段中的最后一次观测。地面和球网
  门限会拒绝不可行的拟合。若飞行被拦截，它*本应*到达的地面点会作为反事实结果单独报告。
  缺失的检测保持为 null。
- **渲染**（`render`）：将每个解码的原始帧与轨迹 PTS 逐一核对，绘制提供的球员框、
  观测到的羽毛球圆环（绿色）和模型圆环（橙色），以及按 6:4 原始画面/俯视图布局排列的
  球场俯视图。切镜帧不叠加羽毛球。原始音频包原样流复制（不重新编码），因此保留原始音频的
  起始偏移和间隙；如果音频无法复制进 MP4 或其时序发生变化，渲染会失败。不会根据文件名
  构建 shell 命令。输出永远不会被覆盖：如果输出已存在或与源文件是同一文件，渲染失败；
  渲染先写入唯一的临时文件，只有在完整解码检查通过后才发布。
- **演示**（`demo`）：生成完全合成的一个回合（两台虚拟相机、一次切镜、带间隙的含噪
  检测、一段测试音），并运行整个流程，包括合成真值复原报告。

</details>

<details>
<summary><b>解读输出</b></summary>

| 层 | 含义 |
| --- | --- |
| `observed_pixel` | 提供的检测结果，未作改动；缺失时为 null |
| `human_review` | 你的击球、落点区域和标定点 |
| `conditional_model` | 在你的先验下拟合观测像素得到的物理模型 |
| `display_interpolation` | 仅由渲染器绘制的线条和标记 |

速度是拟合模型的初速度（`model_speed_km_h`，显示时四舍五入到 5 km/h）。请把它们
视为粗略的模型值。

</details>

<details>
<summary><b>局限</b></summary>

- 不检测羽毛球或球员。检测结果由你按
  [tracks 格式](docs/schemas.md)（英文）提供；不下载任何模型权重。
- 不自动查找击球点，也不细化击球时间戳。
- 没有学习得到的稠密深度图，没有学习得到的击球标签，没有自动 IN/OUT 判罚。
- 3D 输出是条件结果，而非实测。较低的重投影误差只说明与 2D 检测一致，
  并不能独立证明 3D 准确度。合成复原结果仅针对合成数据。

</details>

<details>
<summary><b>开发</b></summary>

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

</details>

<details>
<summary><b>许可证</b></summary>

GNU Affero General Public License v3.0 only（`AGPL-3.0-only`）。第三方声明参见
[LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。

</details>
