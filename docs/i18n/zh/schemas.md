# 输入与输出格式 (v0.1)

所有以米为单位的坐标都使用球场坐标系：X 横跨球场，Y 沿球场纵向，球场外边界（边界线的外缘）为 X = 0 .. 6.10 和 Y = 0（远端）.. 13.40（近端）；Z 向上（0 = 地面）。球网平面为 Y = 6.70。线宽为 40 mm；地面点请按线的中心输入：外边线 X = 0.02 / 6.08 和 Y = 0.02 / 13.38，单打边线 X = 0.48 / 5.62，前发球线 Y = 4.70 / 8.70，双打后发球线 Y = 0.78 / 12.62，中线 X = 3.05。
图像坐标是源视频像素（x 向右，y 向下）。时间是由 FFmpeg/PyAV 解码得到的源显示时间戳（PTS），单位为秒（`frame.pts * time_base`），绝不是 `frame_index / fps`。

运行 `shuttle-replay demo --out-dir demo`，即可在 `demo/inputs/` 中获得下面每个文件的完整合成示例。

## 标定输入 — `shuttle-replay/calibration-input/v1`

```json
{
  "schema": "shuttle-replay/calibration-input/v1",
  "segments": [
    {
      "segment_id": 0,
      "image_size": [1280, 720],
      "ground_points": [
        {"name": "far_left_corner", "world_m": [0.02, 0.02], "image_px": [412.0, 188.5], "role": "fit"},
        {"name": "single_left_x_short_far", "world_m": [0.48, 4.70], "image_px": [430.1, 260.2], "role": "heldout"}
      ],
      "net_anchors": [
        {"name": "left_post_top", "world_m": [0.0, 6.7, 1.55], "image_px": [380.2, 250.0], "uncertainty_px": 3.0}
      ]
    }
  ]
}
```

- `role: "fit"` 点（≥ 4 个，不共线、不重复）用于估计地面单应性。`role: "heldout"` 点（≥ 1 个）绝不参与拟合，并以像素和米为单位单独报告为保留误差。
- `net_anchors`（≥ 2 个，Z > 0.1 m）用于恢复摄像机矩阵的竖直列。只有两个锚点时，该列几乎是恰好确定的，因此其残差说明不了多少问题；输出中包含一份敏感度报告（当一个锚点移动 `uncertainty_px` 时，球网上方 3 m 处一点的竖直偏移）。
- 非有限数值、共线/重复的拟合点、位于地面高度的锚点以及位于地面以下的摄像机都会被拒绝。

输出（`shuttle-replay/calibration/v1`）按片段包含 `P`（3×4，米 → 像素）、`H_world_to_image` / `H_image_to_world`（仅限地面）、`fit_ground_residuals`、`heldout_ground_errors`、`heldout_summary`、`net_anchor_residuals_px`、`net_anchor_sensitivity` 以及输入的副本。

## 轨迹 — `shuttle-replay/tracks/v1`

```json
{
  "schema": "shuttle-replay/tracks/v1",
  "source_video": "match.mp4",
  "frames": [
    {"frame_id": 0, "pts_s": 0.0, "segment_id": 0,
     "shuttle": {"u": 315.3, "v": 265.6, "score": 0.91},
     "players": [{"label": "near", "box": [339.8, 350.1, 408.4, 521.7], "score": 0.9}]},
    {"frame_id": 1, "pts_s": 0.0333, "segment_id": 0, "shuttle": null, "players": []}
  ]
}
```

- 每个解码的源帧一条记录，按解码顺序排列；`frame_id` 必须等于解码索引（渲染器会检查这一点以及每一帧的 PTS）。
- `frame_id` 和 `pts_s` 必须严格递增且为有限值。
- `segment_id` 标识一个具有标定的连续摄像机镜头；`null` 表示镜头切换/特写/回放，这些会被排除。片段必须是连续的；在另一个片段之后再次出现的片段 id 会被拒绝（请为后来的镜头分配单独的 id 和标定）。
- `shuttle: null` 表示“没有检测结果”。它在所有输出中都保持为 null。

## 审核标注 — `shuttle-replay/review/v1`

```json
{
  "schema": "shuttle-replay/review/v1",
  "physics": {"pixel_sigma_px": 3.0, "contact_guard_s": 0.02},
  "contacts": [
    {"id": "c1", "segment_id": 0, "time_s": 0.20, "time_bracket_s": [0.16, 0.24],
     "image_px": [402.0, 300.0], "height_m": 1.05, "height_sigma_m": 0.3,
     "review": "racket contact visible"}
  ],
  "flight_ends": [
    {"contact_id": "c5", "type": "landing_region", "time_bracket_s": [5.1, 5.4],
     "region_xy_m": {"min": [4.2, 0.8], "max": [4.9, 1.6]}, "review": "lands IN"},
    {"contact_id": "c3", "type": "open", "review": "camera cuts away mid-flight"}
  ]
}
```

- 击球是经过审核的球拍接触。`time_s` 是审核后的击球时间戳，并成为飞行时间零点，即使第一次羽毛球检测出现得更晚也是如此。它必须位于其摄像机片段内，并位于 `time_bracket_s`（宽度 ≤ 0.5 s）内。同一片段中的击球必须严格递增。v0.1 不会自动细化击球时间；请通过审核帧画面并编辑 `time_s` 来细化。
- 位置先验：`image_px`（审核过的击球像素，通过完整的摄像机 P 与平面 Z = `height_m` 求交）或 `court_xy_m`。`height_m` 是带有 `height_sigma_m` 的审核先验；`xy_sigma_m` 可选（默认 0.5 m）。
- 一次飞行从一次击球持续到同一片段的下一次击球（`intercepted_by_next_contact`，绝不强制落地）。只有片段中的最后一次击球可以有 `flight_ends` 条目：`landing_region`（在时间区间内将地面接触约束在审核给定的框内）或 `open`（拟合到该片段的最后一次观测，或到可选的审核给定的 `until_s`）。缺少条目 = open。
- `physics` 键（均为可选）：`gravity_m_s2`、`pixel_sigma_px`、`drag_prior_per_m`、`drag_prior_sigma`、`drag_bounds_per_m`、`contact_guard_s`、`contact_xy_sigma_m`、`min_observations`、`max_accept_rms_px`、`velocity_bound_m_s`。

## 分析输出 — `shuttle-replay/analysis/v1`

- `flights[]`：`t0_s`（审核的击球时刻）、`t_end_s`、`end_type`、`params`（击球时的 `[x, y, z, vx, vy, vz, drag_k]`）、`fit`（重投影 RMS / p90 / 最大 px、观测数、优化器状态）、`gates`（地面与球网的可行性；飞行越过球网时网高 ≥ 1.524 m）、`parameters_at_bound`（停在优化器边界上的拟合会被拒绝）、`accepted`、`model_speed_km_h` 和 `model_speed_coarse_km_h`、`first_observation_delay_s`、`observation_frame_ids`、`landing`（落地飞行；`exact_coordinate_measured: false`）以及 `unreturned_floor_crossing_prediction`（被拦截/open 飞行；`kind: counterfactual_if_unreturned`，`observed: false`）。
- `frames[]`：`shuttle_observed_px`（提供的检测结果或 null）、`shuttle_model_xyz_m` / `shuttle_model_px`（仅限被接受的模型、同一片段）、`model_flight_id`、`layer`（`conditional_model`、`observed_pixel`、`none`、`excluded_camera_cut`）。
- `provenance_vocabulary`、`assumptions`、`calibration_summary`。

## 渲染报告

`render_report.json` 记录编码器、帧数、解码的源 PTS 与轨迹 PTS 之间的最大差值、6:4 布局、音频是否被保留，以及对写出的 MP4 的完整解码结果。
