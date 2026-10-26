# 轨迹物理

单台相机看到的羽毛球只是一个像素。穿过该像素的视线上的每一个点，无论远近，都会落在同一个像素上，因此单帧无法判断深度。本页说明 `shuttle-replay` 如何通过加入物理规律和经过复核的约束，把一串像素变成 3D 飞行轨迹，以及这个结果意味着什么、不意味着什么。

## 逆问题

把每个检测看作从相机发出的一条射线。一次飞行是一条必须在正确时刻经过每条射线附近的曲线。满足这一点的曲线可以有很多：一次慢而近的飞行和一次快而远的飞行可能产生相似的像素轨迹。这个问题是欠定的。工具通过要求曲线满足以下条件来选出一条：

- 遵守重力和空气阻力（见下方模型），
- 在复核的击球时刻，从复核的击球位置和高度附近出发，
- 被柔性地拉向下一个复核的击球或复核的落地区域，或在观测窗口结束处停止（端点残差是惩罚项，不是硬性的接受条件），并且
- 保持在地面以上，并在应当过网时越过球网。

因此，拟合出的 3D 路径是一个**条件模型**：在给定你的标定和复核的情况下最一致的曲线，而不是测量值（[`analysis.py` 模块 docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L1-L10)）。

## 飞行模型

状态是以米为单位的位置 `r = (x, y, z)` 和以 m/s 为单位的速度 `v`。运动方程（[`_rhs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L16-L23)）：

```text
 dr/dt = v
 dv/dt = -k * |v| * v  -  g * e_z

 g    gravity, default 9.81 m/s^2 (review "physics": "gravity_m_s2")
 k    drag coefficient per flight, units 1/m
 |v|  speed in m/s
 e_z  unit vector pointing up
```

阻力方向与运动方向相反，并随速度的平方增长。理解 `k` 的一个有用方式：竖直下落的羽毛球在阻力等于重力时停止加速，此时达到终端速度 `sqrt(g / k)`。在默认先验 `k = 0.18 1/m` 下约为 7.4 m/s。因此高速击出的羽毛球会急剧减速；模型不包含旋转、翻滚或风。

七个拟合参数是**飞行时间零点**处的 `[x, y, z, vx, vy, vz, k]`，零点是复核的击球时刻，而不是首次检测的时刻（[`physics.py` 模块 docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L1-L8)）。由于球拍或球员遮挡羽毛球，检测常常在击球后几帧才开始。这些帧以相对击球时刻的偏移来度量，因此首次检测较晚不会移动飞行的起点（`first_observation_delay_s` 报告这段间隔）。

## 数值积分

[`simulate`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L26-L40) 使用 SciPy `solve_ivp`（其默认的显式 Runge-Kutta 方法），从 `t = 0` 开始，以 `rtol=1e-7`、`atol=1e-8`、`max_step=0.02` 秒和稠密输出积分方程，然后在请求的时刻计算位置。非有限的时刻和小于 `-1e-9` s 的时刻会被拒绝；高于该值的微小负值被截断为零。求解器容差控制的是数值积分误差，不是重建精度的界限。[`floor_crossing`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L43-L63) 对 `z` 使用事件函数（仅下降方向，终止型），并在 10 s 范围内使用更严格的容差（`rtol=1e-9`、`atol=1e-10`、`max_step=0.01`）。

## 最小化的对象

[`fit_flight`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L57-L151) 构建一个残差向量。每一项都是差值除以一个尺度，因此“1”表示“一个预期误差”：

```text
 pixels    (project(P, r(t_i)) - uv_i) / pixel_sigma_px            default 3.0 px
 start     (r(0) - contact_prior) / start_sigma                     xy 0.5 m, height 0.3 m
 drag      (k - 0.18) / 0.15
 intercept (r(T) - next_contact_prior) / next_contact_sigma         intercepted only
 landing   z(T) / 0.01   and   distance outside region / 0.02       landing only
 floor     min(z, 0) / 0.01 on 41 samples from 0 to T
 net       max(0, 1.55 - h_net) / 0.02                              only if a crossing is required
```

`T` 是飞行时长。击球先验来自 [`_contact_prior`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L49-L54)：如果击球有 `image_px`，则把穿过该像素的射线与复核的 `height_m` 高度平面相交；否则直接使用 `court_xy_m` 和 `height_m`。sigma 取自每个击球的 `xy_sigma_m` 和 `height_sigma_m`，缺省时使用上面显示的默认值。

在球网项中，`h_net` 是 41 个采样点的路径第一次穿过 `Y = 6.70` 处的插值高度；如果路径从未穿过，`h_net` 按 0 计算。该项按源代码中所写使用 1.55 m（网柱高度）；下面的接受门槛使用 1.524 m（球网中央）。

SciPy `least_squares` 以 `loss="soft_l1"` 和 `f_scale=1.5` 最小化总和，因此少数坏检测的拉动比普通平方和更小。它从六个起点运行：`k` 取 `0.1, 0.2, 0.35`，乘以在朝向终点目标的弹道猜测上额外加的 `1.0` 或 `3.0` m/s 向上速度。代价最低的结果胜出。边界使搜索保持在物理范围内（[源代码](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L64-L69)）：

```text
 x in [-3, 9.1] m     y in [-3, 16.4] m     z in [0.05, 4.5] m
 vx, vy, vz in [-velocity_bound_m_s, +velocity_bound_m_s]    default 120 m/s
 k in drag_bounds_per_m                                      default [0.015, 0.6] 1/m
 landing time T in the reviewed landing bracket (landing flights only)
```

当七个状态/阻力参数与边界的距离小于其允许范围的 0.1% 时，会在 `parameters_at_bound` 中被标记（[源代码](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L129-L135)）。被标记的拟合会被拒绝。落地时刻不包含在这项诊断中。通过并不能证明可辨识性、唯一性，或不受先验影响。

## 飞行如何结束

飞行按相机片段、依击球的时间顺序构建（[`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L291)）：

- **`intercepted_by_next_contact`**：同一片段中后面还有另一次击球。时长是两次击球之间的时间；终点被拉向下一次击球的先验。当两个击球先验位于球网两侧时，需要过网。
- **`landing_region`**：片段的最后一次击球带有复核的落地结束。击球和落地端点残差会把拟合柔性地拉向复核的端点。落地时刻受复核区间（bracket）限制，但端点高度和区域归属不是硬性的接受条件。`landing.within_region` 以 1 mm 容差报告归属情况；它不控制接受与否。当起点与区域中心位于球网两侧时，需要过网。
- **`open_segment_end`**：其他所有情况。窗口在片段结束处或 `until_s` 处结束，拟合时长为最后一个观测偏移，不需要过网。

窗口内检测少于 `min_observations`（默认 4）个时，结果为 `status: "insufficient_observations"`，不进行拟合。

## 接受门槛

拟合后，路径以 201 个点采样，并由 [`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106) 检查：`floor_ok` 要求最低点不低于 -0.02 m。`net_ok` 要求在需要过网时确实过网，并且无论是否预期过网，在相邻采样点之间检测到的**每一次**过网都必须不低于 1.524 m。只有当优化器报告成功、两个门槛都通过、重投影 RMS 不超过 `max_accept_rms_px`（默认 8.0 px），且七个状态/阻力参数都未被标记时，飞行才会被接受。被拒绝的飞行保留其参数以供检查，但不会作为模型层绘制。

## 速度与反事实落点

`model_speed_km_h` 是 `|v(0)| * 3.6`，即模型的初速度；`model_speed_coarse_km_h` 将其四舍五入到最接近的 5 km/h 用于显示。它不是雷达读数。

对于不以落地区域结束的飞行，如果模型会在飞行结束后才触地，分析会添加带有 `kind: "counterfactual_if_unreturned"` 和 `observed: false` 的 `unreturned_floor_crossing_prediction`。它回答的是“如果没人回击，这个模型会落在哪里”，而不是羽毛球实际去了哪里。对于落地飞行，`landing.xy_m` 是被柔性拉向你的区域的模型终点（不保证位于区域内），并且 `exact_coordinate_measured` 始终为 `false`。

相关内容：`P` 见[相机标定](camera-calibration.md)，观测窗口见[观测与时间](observations-timing.md)，`fit` 和 `gates` 的解读见[验证与局限](validation-limits.md)。
