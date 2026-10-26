# 验证与局限

`shuttle-replay` 会报告许多关于自身结果的数字。每个数字只回答一个狭窄的问题。本页针对每项检查说明它显示了什么、没有显示什么，以及仓库中哪个测试覆盖了它。这里不给出任何真实视频的精度或速度数据，因为项目从未测量过。

## 每项检查证明了什么

**留出地面误差**（`heldout_summary`，[`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L175-L197)）。证明：地面单应矩阵能预测未参与拟合的球场点。不能证明：任何关于高度、球网锚点或羽毛球的事情。

**球网锚点残差与敏感度**（`net_anchor_residuals_px`、`net_anchor_sensitivity`）。有两个锚点时，竖直列几乎恰好确定，因此残差几乎在构造上就接近零。敏感度值显示：当一个锚点坐标移动其声明的像素不确定度时，网上方 3 m 的一个参考点会移动多远。它是一种假设推演，不是置信区间。见[相机标定](camera-calibration.md)。

**重投影误差**（`fit.reprojection_rms_px`、`reprojection_p90_px`、`reprojection_max_px`）。证明：模型的投影经过你的 2D 检测附近。不能证明：3D 路径是正确的。不同的深度配上不同的速度可以投影到几乎相同的像素，这就是[轨迹物理](trajectory-physics.md)中描述的欠定性。默认接受上限为 RMS 8.0 px。

**地面与球网门槛**（`gates`，[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106)）。通过表明：201 个采样高度都不低于 −0.02 m，在相邻采样点之间插值检测到的每一次过网都不低于 1.524 m，并且在需要时发生了过网。这些检查不能证明一般意义上的物理合理性或真实世界的精度。

**`parameters_at_bound` 与 `optimizer_success`**。未收敛的拟合会被拒绝。当七个状态/阻力参数与边界的距离小于其允许范围的 0.1% 时会被标记。被标记的拟合会被拒绝。落地时刻不包含在这项诊断中。通过并不能证明可辨识性、唯一性，或不受先验影响。

**媒体检查**（渲染报告）。证明：每个源帧都按索引和 PTS 匹配，输出以正确的帧数解码，音频数据包保留了其时间。不能证明：除 PTS 匹配本身之外，你的 `pts_s` 来自做检测时所用的同一个文件。

**合成恢复**（`demo`、`synthetic_recovery.json`）。`synthetic_recovery.json` 报告与合成真值的比较。测试针对特定合成案例断言选定的恢复容差；仅生成报告并不会强制这些容差。两者都不表示真实视频上的精度。文件的 `label` 也这样说明："SYNTHETIC ground-truth recovery; not evidence of accuracy on real video"。

## 不确定性只是定性的地方

拟合有 sigma，但输出不会把它们转换成误差棒。位置、速度或落点都没有协方差、没有自助法（bootstrap），也没有置信区间。不确定性改由标签表达：每个分析文件中的 `conditional_model`、`exact_coordinate_measured: false`、`speed_scope` 和 `assumptions` 列表（[`ASSUMPTIONS`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L39-L46)）。粗略的 5 km/h 速度舍入只是显示上的选择，不是误差估计。

## 为什么它不是别的东西

- **不是实测 3D。** 一台相机给出的是射线，而不是点。深度来自物理模型加上你复核的击球。
- **不是稠密深度。** 没有逐像素深度图，也没有学习得到的深度网络。只有拟合飞行上的羽毛球获得 3D 位置。
- **不是自动判定界内/界外（IN/OUT）。** `landing.inside_court` 把一个模型点与球场外边界比较。该点被柔性地拉向你画的区域，因此答案主要反映你的复核；区域归属不是硬性的接受条件（`landing.within_region` 以 1 mm 容差报告它）。没有判线逻辑，没有单打/双打规则，也没有测量羽毛球触地的位置。

## 调试顺序

当某次飞行看起来不对时，从管线底部往上读：

1. **标定。** `heldout_summary` 误差很大或 `max_vertical_shift_m` 很大：先修正点或锚点。下游任何环节都无法挽回。
2. **输入。** `observation_frame_ids` 和 `first_observation_delay_s`：窗口里是否包含你预期的检测？
3. **状态。** `insufficient_observations` 表示检测太少；`rejected_by_gates_or_fit` 表示应查看接下来的两项。
4. **拟合。** `optimizer_success`、`parameters_at_bound`、重投影 RMS 和最大值。RMS 低但有一个极大的最大值，说明存在一个坏检测。
5. **门槛。** `minimum_height_m`、`net_crossing_required`、`net_crossing_occurred`、`net_crossing_height_m`。球网门槛失败通常意味着击球放在了错误的一侧或击球高度有误。
6. **渲染报告。** PTS 不匹配或帧数错误意味着轨迹不属于这个视频的这次解码。

## 证据对照表

| 结论 | 测试 |
| --- | --- |
| 留出点单独报告；`H` 标注为仅限 Z=0 | `test_calibration_recovers_camera_and_reports_heldout_separately` |
| 错误的标定输入被拒绝 | `test_calibration_rejects_invalid_inputs`, `test_calibration_rejects_collinear_fit_points` |
| 不一致的轨迹或复核被拒绝而不是修复 | `test_inconsistent_inputs_are_rejected_not_repaired`, `test_missing_segment_calibration_is_rejected` |
| 时间零点是击球而不是首次检测 | `test_delayed_first_observation_keeps_contact_as_time_zero` |
| 飞行保持在一个片段内 | `test_flights_never_bridge_camera_segments` |
| 缺失的检测保持为 null | `test_missing_detection_provenance_is_null_not_filled` |
| 落地是约束，不是测量 | `test_landing_region_is_a_constraint_not_a_measurement` |
| 被拦截的飞行不会被强制落地 | `test_intercepted_flight_is_not_forced_to_land` |
| 球网与地面门槛 | `test_physical_gates_reject_net_and_floor_violations`, `test_actual_low_net_crossing_rejected_without_expected_crossing` |
| 卡在边界的拟合被拒绝；`until_s` 窗口 | `test_open_flight_window_and_bound_pinned_fits` |
| 球场线中心 | `test_court_lines_are_line_centres_of_40mm_lines_inside_outer_boundary` |
| PTS 与帧数检查；恶意文件名 | `test_render_rejects_mismatched_pts_and_handles_hostile_filename` |
| 轨迹线保持在一次飞行内 | `test_trails_stay_inside_one_flight_and_segment` |
| 不覆盖源文件或已有文件 | `test_render_never_overwrites_source_or_existing_files`, `test_cli_rejects_output_aliasing_inputs` |
| 音频偏移与空隙得到保留 | `test_audio_is_stream_copied_with_source_relative_offset` |
| 端到端演示产物 | `test_demo_end_to_end_creates_verified_artifacts`, `test_run_command_from_existing_inputs` |

所有测试都位于 [`tests/`](https://github.com/KAIROS03/shuttle-replay/tree/6e9a060b5cc964f02d4017d806e953ffea89c8b4/tests)。大多数飞行测试在 [`synthetic.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py) 的合成场景上运行，因此它们确认的是行为和约定，而不是真实世界的精度。测试未覆盖：工具不建模的镜头畸变，以及测试所用 AAC 之外的音频编解码器。

相关内容：局限列表见[工作流程](workflow.md)，如何阅读结果见[用户指南](guide.md)。
