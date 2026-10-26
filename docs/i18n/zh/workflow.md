# 工作流程

## 你需要提供的内容

- **检测结果**（`tracks.json`）：每个解码帧一条记录，包含 PTS、摄像机片段 id、羽毛球像素或 null，以及可选的球员框。本工具没有内置检测器。请参见 [](schemas.md)。
- **标定输入**：每个片段至少 4 个 `fit` 球场点、若干 `heldout` 点，以及两个网柱顶端（1.55 m）。
- **审核**（`review.json`）：你审核过的击球时间、像素和高度，以及可选的落点区域。击球不会被自动发现。

任何跟踪器都可以生成检测结果；例如，你可以使用自己的检查点，自行运行 TrackNetV3 (MIT) 检测羽毛球、运行 Ultralytics YOLO 模型 (AGPL-3.0) 检测球员，并转换它们的输出。转换脚本不属于 v0.1 的一部分。

## 步骤

1. **标定。** 对每个摄像机片段，测量 ≥ 4 个球场线交点（角色 `fit`）、再测量几个作为 `heldout`，以及两个网柱顶端。

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   在继续之前，请检查 `heldout_summary` 和 `net_anchor_sensitivity`。
2. **审核。** 编写 `review.json`：位于审核区间内的击球时间、击球像素和高度先验，以及片段中最后一次飞行可选的落点区域或 `open`。
3. **分析与渲染。**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   不一致的输入（PTS 非单调、片段不连续、击球位于其片段或区间之外、PTS 与视频不匹配……）会以退出码 2 停止并给出消息；不会悄悄修复任何内容。

## 各命令的作用

- **`calibrate`**：根据 ≥ 4 个审核过的地面点计算单应性，并根据 ≥ 2 个高于地面的网柱锚点恢复摄像机矩阵的竖直列。保留（held-out）地面点绝不用于拟合，并单独报告。退化、重复、共线以及非有限值的输入会被拒绝。地面单应性绝不用于空中的点。
- **`analyze`**：每个审核过的击球对应一次飞行，计时从审核的击球时刻开始。镜头切换被排除，飞行绝不会跨越片段。每次飞行在下一次击球、审核给定的落点区域（一种约束，而非实测坐标）或片段的最后一次观测处结束。地面和球网检查会拒绝不可行的拟合。缺失的检测结果保持为 null。
- **`render`**：将每一个解码的源帧与轨迹 PTS 进行校验，并以 6:4 布局绘制提供的球员框、观测到的羽毛球圆圈（绿色）、模型圆圈（橙色）和俯视球场图。源音频以流复制方式处理，不重新编码。绝不覆盖已有输出。
- **`demo`**：生成一个合成回合并运行整个流水线。

## 解读输出

| 层 | 含义 |
| --- | --- |
| `observed_pixel` | 提供的检测结果，未作改动；不存在时为 null |
| `human_review` | 你的击球、落点区域和标定点 |
| `conditional_model` | 在你的先验条件下拟合到观测像素的物理模型 |
| `display_interpolation` | 仅由渲染器绘制的线条和标记 |

速度是拟合模型的初速度（`model_speed_km_h`，显示时按 5 km/h 取整）。请将其视为粗略的模型值，而不是测量值。

## 局限

- 不进行羽毛球或球员检测，也不附带权重。
- 不自动发现击球，也不细化击球时间戳。
- 没有学习得到的稠密深度图，没有学习得到的击球标签，也没有自动的 IN/OUT 判定。
- 3D 输出是条件性的，而非实测。合成恢复结果仅是合成的结果。
