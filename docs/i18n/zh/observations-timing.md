# 观测与时间

飞行拟合在**特定时刻**比较模型位置与检测结果。如果这些时刻有误，正确的轨迹会显得错误，错误的轨迹反而可能显得正确。本页说明时间从哪里来、输入约定要求什么、证据与复核如何区分，以及模型和绘制如何对时间采样。

## 时间来自 PTS，而不是帧计数

视频容器以整数刻度数为每一帧存储一个显示时间戳（PTS），并用 `time_base` 说明一个刻度有多长。帧的秒级时间为：

```text
 time_s = pts * time_base

 example: time_base = 1/30000 s, pts = 3003  ->  0.1001 s
```

许多手机录像和录屏是**可变帧率**（VFR）：各帧时长不同。这时用 `frame_index / fps` 计算会逐渐偏离真实时间。因此轨迹格式按帧存储由 FFmpeg/PyAV 解码得到的 `pts_s`（见[数据格式](schemas.md)）。合成演示有意使用 VFR：在 `time_base` 1/30000 s 下，每第七帧持续 1001 个刻度而不是 1000 个（[`frame_pts_ticks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py#L52-L58)）。

渲染器随后会用你的 `pts_s` 检查每一个解码帧；见[渲染与输出安全](rendering-safety.md)。

## 输入约定

[`validate_tracks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L33-L78) 和 [`validate_review`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L81-L149) 在遇到第一个不一致时抛出 `InputError`。不会重新排序、去重或修复任何内容。

轨迹（`shuttle-replay/tracks/v1`）：

- `frame_id` 是整数且严格递增；`pts_s` 是有限值且严格递增。
- `segment_id` 表示一个连续的相机镜头。`null` 表示镜头切换、特写或回放。在另一个片段之后再次出现的片段 id 会被拒绝，因此每个镜头都需要自己的 id 和标定。
- `shuttle` 要么是 `null`（无检测），要么具有有限的 `u` 和 `v`。球员框必须是四个有限数字。

每个片段的时间范围是其第一帧和最后一帧的 PTS。每个片段都需要标定（[`validate_inputs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L152-L162)）。

复核（`shuttle-replay/review/v1`）：

- 击球 id 是唯一的字符串。每次击球都位于其片段的 PTS 范围内，并位于其自身的 `time_bracket_s` 内，该区间宽度最多 0.5 s。
- 同一片段内的击球按列表顺序在时间上严格递增。
- `height_m` 位于开区间 (0, 4) m 内，`height_sigma_m` 为正。每次击球都需要 `image_px` 或 `court_xy_m`。
- 只有片段的最后一次击球可以有 `flight_ends` 条目，类型为 `open` 或 `landing_region`。落地区间必须在击球之后开始；区域的 `min` 必须小于其 `max`。`open` 结束的 `until_s` 必须在击球之后，并且位于片段内。

## 证据与复核

两类输入扮演不同角色：

- **观测证据**：你的检测结果。它们只以像素残差进入拟合，并原样复制到 `shuttle_observed_px`。`shuttle: null` 的帧在所有输出中都保持 `null`。
- **复核约束**：击球、落地区域、标定点。击球位置和高度作为按 sigma 加权的先验进入；落地端点使用固定的惩罚尺度。标定点事先确定相机。击球时刻是固定的，落地时刻在其区间内拟合。

当模型填补一个没有检测的帧时，该帧的 `layer` 为 `conditional_model`，而 `shuttle_observed_px` 保持 `null`。测试 `test_missing_detection_provenance_is_null_not_filled` 正是检查这一点。

## 飞行分段

[`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L234) 按片段对击球分组，并把每次击球变成一次飞行。飞行从不跨越相机片段。其观测是该片段中有检测且满足以下条件的帧：

```text
 t0 + contact_guard_s  <  pts_s  <=  t_end - contact_guard_s     (followed by another contact)
 t0 + contact_guard_s  <  pts_s  <=  t_end                       (landing or open end)

 t0             reviewed contact time
 t_end          next contact time, landing bracket end, or min(segment end, until_s)
 contact_guard_s  default 0.02 s
```

保护间隔会丢弃紧挨击球的检测，此时羽毛球常常与球拍混在一起。每条飞行记录中的 `observation_frame_ids` 和 `observation_time_offsets_s` 准确显示使用了哪些帧，偏移从 `t0` 开始测量。

## 模型采样与显示

存在三种不同的采样，只有第一种是按视频帧进行的：

1. **按帧。** 对于已接受飞行时间跨度内的每一帧，`shuttle_model_xyz_m` 是在该帧自身 PTS 处计算的模型值，`shuttle_model_px` 是它经 `P` 的投影（[帧循环](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L293-L334)）。镜头切换帧得到 `layer: "excluded_camera_cut"`，没有模型也没有球员，即使存在原始检测（`raw_detection_ignored`）。
2. **拟合内部。** 41 个等间距采样点检查地面和球网惩罚；201 个采样点用于接受门槛。见[轨迹物理](trajectory-physics.md)。
3. **显示。** 俯视图的轨迹线是一条只连接**同一**飞行中更早的按帧模型采样的折线（[`trail_for`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L36-L46)）。它在第一个 `model_flight_id` 不同的帧处停止，因此轨迹线从不连接两次飞行，也不跨越镜头切换。这些线是 `display_interpolation`，不是数据。

## 实际检查的容差

```text
 contact bracket width         <= 0.5 s                  inputs.py
 contact guard                 0.02 s (default)          analysis.py
 renderer PTS match            1e-3 s per frame          render.py
 ODE (simulate)                rtol 1e-7, atol 1e-8, max_step 0.02 s
 ODE (floor_crossing)          rtol 1e-9, atol 1e-10, max_step 0.01 s
 floor gate                    lowest point >= -0.02 m
 landing within_region         region widened by 1e-3 m
```

相关内容：所有字段见[数据格式](schemas.md)，如何用你自己的检测器生成轨迹见[工作流程](workflow.md)。
