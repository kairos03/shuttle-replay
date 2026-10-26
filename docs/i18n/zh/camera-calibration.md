# 相机标定

标定回答一个问题：球场上的一个点（以米为单位）在相机画面中出现在哪个像素？`shuttle-replay` 用一个由你手工定位的点估计出的线性针孔相机来回答。本页说明坐标系、工具计算的两个矩阵、确切的算法，以及所报告误差的含义。

## 两个坐标系

**图像坐标** `(u, v)` 是源视频的像素：`u` 向右增大，`v` 向下增大。

**世界坐标** `(X, Y, Z)` 是由 BWF 球场尺寸固定的球场坐标系中的米制数值（[`court.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L1-L24)）：

```text
      X = 0                X = 6.10
 Y = 0  +--------------------+   far baseline (outer edge)
        |                    |
        |                    |
 Y=6.70 |====== net =========|   net plane; posts 1.55 m, centre 1.524 m
        |                    |
        |                    |
Y=13.40 +--------------------+   near baseline (outer edge)

 Z is up; Z = 0 is the court surface.
```

线宽为 40 mm，标定点使用**线的中心**：外侧线位于 X = 0.02 / 6.08 和 Y = 0.02 / 13.38，单打边线位于 X = 0.48 / 5.62，前发球线位于 Y = 4.70 / 8.70，双打后发球线位于 Y = 0.78 / 12.62，中线位于 X = 3.05（[`court_lines`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L27-L52)）。在应填中心的位置填入外边缘，会使该点偏移 2 cm。

## 针孔投影

针孔相机用一个 3x4 矩阵 `P` 把世界点映射到像素：

```text
 [a]       [X]
 [b] = P * [Y]        u = a / c ,  v = b / c
 [c]       [Z]
           [1]
```

除以 `c` 就是透视：远处的物体看起来更小。`P` 把相机的位置和旋转（外参）与焦距和图像中心（内参）结合在一起。本项目从不把 `P` 拆分成这些部分，而是把 `P` 当作一个整体矩阵使用（[`project`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L12-L15)）。相机中心 `C` 是唯一满足 `P * [C, 1] = 0` 的点，因此 `C = -inverse(P[:, :3]) * P[:, 3]`（[`camera_center`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L24-L26)）。

## 第 1 步：地面单应矩阵（仅限 Z = 0）

对于地面上的点，`Z = 0`，所以 `P` 的第三列乘以零后消失：

```text
 P = [ p1  p2  p3  p4 ]          (four columns)
 floor point (X, Y, 0):  P * [X, Y, 0, 1] = [ p1 p2 p4 ] * [X, Y, 1] = H * [X, Y, 1]
```

3x3 矩阵 `H = [p1 p2 p4]` 就是**单应矩阵**。它在 [`fit_homography`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L58-L78) 中用归一化直接线性变换（DLT）从你的 `role: "fit"` 地面点拟合得到：

1. 每个点集先平移到其质心，再缩放使其到质心的平均距离为 `sqrt(2)`（[`_normalize`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L36-L39)）。当像素值是几百而米制值只有个位数时，这能保持线性方程组的良好条件。
2. 每对对应点向线性方程组 `A h = 0` 添加两行。
3. `h` 是 `A` 对应最小奇异值的右奇异向量；撤销归一化后，对 `H` 进行缩放使 `H[2, 2] = 1`。

退化输入会以 `CalibrationError` 拒绝，而不是生成一个坏矩阵：拟合点少于四个、坐标重复、点集共线、恰好四个点中有三个共线、第二小奇异值低于最大值的 `1e-9` 倍（解不唯一），或条件数超过 `1e12`（[`_check_spread`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L42-L78)）。

该拟合是对全部拟合点最小化代数残差的归一化 DLT，不做非线性重投影优化。没有离群点剔除（没有 RANSAC），也没有镜头畸变模型：一个输错的点或强烈的桶形畸变都会拉偏整个拟合。

`H` 只描述地面。输出在 `H_scope` 中说明了这一点（[`H_SCOPE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L22)）。把羽毛球的像素通过 `H` 反投影，得到的是“如果这个像素在地面上，它会在哪里”，对任何在空中的物体都是错误的。

## 第 2 步：由球网锚点求竖直列

地面点无法提供关于 `p3`（与高度相乘的那一列）的任何信息。这需要不在地面上且高度已知的点：通常是两根网柱的顶端，`Z = 1.55`。对于位于 `(X, Y, Z)`、在 `(u, v)` 处看到的锚点，记 `q = H * [X, Y, 1]`。投影条件就变成关于 `p3` 的线性方程：

```text
 u * (q3 + Z * p3_3) = q1 + Z * p3_1
 v * (q3 + Z * p3_3) = q2 + Z * p3_2

 rearranged per anchor:
   [ Z  0  -u*Z ] * p3 = u*q3 - q1
   [ 0  Z  -v*Z ] * p3 = v*q3 - q2
```

[`camera_from_anchors`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L81-L92) 把这些行堆叠起来，要求秩为 3，用最小二乘求解，并组装 `P = [h1 h2 p3 h3]`，其中 `h1`、`h2`、`h3` 是 `H` 的列。三个未知数、每个锚点两行，意味着两个锚点给出四个方程：几乎恰好确定。这就是为什么很小的锚点残差（`net_anchor_residuals_px`）几乎证明不了什么。锚点必须高于地面（`Z > 0.1 m`），并且至少需要两个。

最后，[`_check_camera`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L95-L104) 会拒绝中心不在地面上方的相机，或会把部分球场点放在其前方、另一部分放在其后方的相机。

## 拟合点与留出点

每个地面点都有一个角色（[`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L128-L205)）：

- `fit` 点用于构建 `H`。它们的残差（`fit_ground_residuals`）是训练误差，预期较小。
- `heldout` 点从不用于拟合，至少需要一个。`heldout_ground_errors` 为每个点报告 `error_px`（对世界点应用 `H`，与你的像素比较）和 `error_m`（对你的像素应用 `H` 的逆，与世界点比较）。`heldout_summary` 给出两者的数量、均值和最大值。

一个概念性示例：四个外角作为 `fit`，两个发球线交点作为 `heldout`。如果留出误差远大于拟合残差，说明某个点标错了、点击的是线的边缘而不是中心，或者镜头使线条弯曲。留出误差只检查地面映射，对高度什么也说明不了。

## 是敏感度，不是置信区间

高度几乎完全取决于锚点。[`_anchor_sensitivity`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L107-L125) 取参考点 `(3.05, 6.70, 3.0)`，即网中线上方 3 m，用 `P` 投影它。然后对每个锚点，分别针对 `u` 和 `v`，把锚点像素移动 `+uncertainty_px` 和 `-uncertainty_px`（默认 3.0），重新求解 `P`，并把穿过同一参考像素的射线与网平面 `Y = 6.70` 相交。`max_vertical_shift_m` 是高度的最大变化量。如果某次扰动导致求解失败，偏移量报告为无穷大。

这是针对单个点、每次只改变一个量的最坏情况。它不是统计置信区间，不合并多个锚点的误差，也不包含地面点误差。

## 你所做的假设

- 每个 `segment_id` 对应一台固定相机；相机移动或变焦需要新的片段。
- 直线在图像中保持笔直（无镜头畸变）。
- 锚点具有你输入的高度。网柱顶端 1.55 m 与球网中央 1.524 m 是不同的高度。
- 地平面不是羽毛球。`H` 给出地面位置；羽毛球的深度只来自[轨迹物理](trajectory-physics.md)中描述的物理拟合。

完整的输入和输出字段见[数据格式](schemas.md)，如何把这些误差与飞行诊断结合起来阅读见[验证与局限](validation-limits.md)。
