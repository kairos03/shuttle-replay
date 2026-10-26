# shuttle-replay 用户指南 (v0.1)

`shuttle-replay` 是一个离线工具，它利用本地视频、你事先生成的检测结果以及经人工审核的标注，构建羽毛球回放。它会标定摄像机，将带有重力和二次空气阻力的飞行模型拟合到 2D 检测坐标上，并生成一个按 6:4 比例并排放置源视频与俯视球场图的 MP4。

本工具用于研究和审核。它不是界内/界外司线判罚系统、击球分类器、羽毛球检测器，也不是实测的测速仪。输出中的每一个 3D 位置和速度都是以你的标定和标注为前提的条件性模型值。

## 安装

需要 Python 3.12 或更高版本以及 [uv](https://docs.astral.sh/uv/)。

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

PyAV 的 wheel 包内置了 FFmpeg，因此不需要系统 FFmpeg。

## 合成演示

```bash
uv run shuttle-replay demo --out-dir demo
```

该命令会构建一个合成回合，其中混合了两个虚拟摄像机、一个转场片段和缺失的检测结果，然后端到端地执行标定 → 分析 → 渲染。`demo/synthetic_recovery.json` 中的数值是与合成真值比较得到的，因此并不表示在真实视频上的精度。

## 使用你自己的视频

1. **检测结果（`tracks.json`）**：每个解码帧一行，包含该帧的实际 PTS（秒）、摄像机片段 id（转场和特写片段为 `null`）、羽毛球像素坐标（不存在时为 `null`）以及可选的球员框。`frame_id` 必须与解码顺序一致。格式请参见 [docs/schemas.md](schemas.md)。
   v0.1 不包含检测器。你可以自行运行 TrackNetV3 (MIT) 或 Ultralytics YOLO (AGPL-3.0) 并转换其结果，但本工具不附带转换脚本。不会下载任何模型权重。
2. **标定输入**：对每个摄像机片段，以像素标出四个或更多球场线交点（`fit`）、若干用于验证的交点（`heldout`）以及两个网柱顶端（高度 1.55 m）。

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   请先检查 `heldout_summary`（未用于拟合的点上的误差）和 `net_anchor_sensitivity`（网柱按给定像素误差偏移时高度的变化量）。地面单应性只用于地面（Z=0）上的点，绝不用于空中的羽毛球。
3. **审核标注（`review.json`）**：输入球拍击球时间（`time_s`）、包含该时间的审核区间（`time_bracket_s`）、击球像素和高度估计。击球时间就是该飞行的第 0 秒。即使第一次检测出现得较晚，第 0 秒也不会改变。
   只有片段中的最后一次击球可以带有结束条件：`landing_region`（羽毛球到达地面的区域和时间区间）或 `open`（直到该片段的最后一次观测，或直到审核给定的 `until_s`）。其他任何飞行都在下一次击球处结束，不会被强制落地。v0.1 不会自动修正击球时间，因此请一边查看帧画面一边自行修正。
4. **分析与渲染**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # 한 번에:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   `# 한 번에:` 注释的意思是“一步完成：”；`run` 会同时执行分析和渲染。

   如果 PTS 倒退、同一摄像机片段在间隔后再次出现、击球位于其摄像机片段或审核区间之外，或视频 PTS 与轨迹 PTS 不一致，工具会以退出码 2 停止。它绝不会悄悄修正输入。

## 解读结果

- 绿色圆圈：按原样给出的输入检测坐标。没有检测结果的帧保持空白。
- 橙色圆圈/点：条件性物理模型。只在同一摄像机片段、同一次飞行内绘制。
- 蓝色虚线框：由人工指定的落点区域。× 标记是以该区域为条件拟合得到的模型落点，而不是实测坐标。
- 速度是模型的初速度，按 5 km/h 取整。
- 对于被回击的飞行，“如果没有被回击会落在哪里”的点只记录在 JSON 中（`unreturned_floor_crossing_prediction`，一种反事实预测）。
- 如果源文件带有音频，音频包会原样复制而不重新编码，因此源文件的音频起始延迟和间隙都会被保留。如果音频无法复制到 MP4 中，或其时间会发生变化，渲染就会失败。为验证而将输出文件完整解码的结果会写入 `render_report.json`。
- 绝不会覆盖已有文件。如果输出文件已存在或与源视频是同一个文件，工具会停止；渲染会先写入临时文件，只有在验证通过后才会移动到最终文件名。

## 许可证

仅限 GNU AGPL-3.0。请参见 [LICENSE](../LICENSE) 和 [NOTICE.md](../NOTICE.md)。
