# 軌道の物理

カメラ 1 台にとって、シャトルは 1 つのピクセルです。そのピクセルを通る視線上の点は、近くても遠くても同じピクセルに写るため、1 フレームだけでは奥行きがわかりません。このページでは、`shuttle-replay` が物理と確認済みの制約を加えることで、ピクセルの列をどのように 3D の飛行に変えるのか、そしてその結果が何を意味し、何を意味しないのかを説明します。

## 逆問題

各検出をカメラから伸びる光線と考えてください。飛行とは、正しい時刻にすべての光線の近くを通らなければならない曲線です。そうした曲線は多数ありえます。遅くて近い飛行と、速くて遠い飛行が、似たピクセル軌跡を生むことがあります。この問題は解が 1 つに定まらない(劣決定)のです。ツールは次の条件を課して 1 本の曲線を選びます。

- 重力と空気抵抗(下記のモデル)に従うこと、
- 確認済みの打球時刻に、確認済みの打球位置と高さの近くから始まること、
- 次の確認済み打球時点または確認済みの着地領域へ緩やかに引き寄せられるか、観測ウィンドウの終わりで止まること(端点残差はペナルティであり、厳格な受理要件ではありません)、そして
- 床面より上にとどまり、越えるべきときにはネットを越えること。

したがって、フィッティングされた 3D 経路は**条件付きモデル**です。キャリブレーションと確認を前提として最も整合的な曲線であって、測定値ではありません([`analysis.py` モジュールの docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L1-L10))。

## 飛行モデル

状態はメートル単位の位置 `r = (x, y, z)` と m/s 単位の速度 `v` です。運動方程式は次のとおりです([`_rhs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L16-L23))。

```text
 dr/dt = v
 dv/dt = -k * |v| * v  -  g * e_z

 g    gravity, default 9.81 m/s^2 (review "physics": "gravity_m_s2")
 k    drag coefficient per flight, units 1/m
 |v|  speed in m/s
 e_z  unit vector pointing up
```

空気抵抗は運動と逆向きに働き、速さの 2 乗に比例して大きくなります。`k` の便利な読み方があります。まっすぐ落下するシャトルは、空気抵抗が重力と等しくなる終端速度 `sqrt(g / k)` で加速しなくなります。既定の事前値 `k = 0.18 1/m` では約 7.4 m/s です。そのため、高速で打たれたシャトルは急激に減速します。モデルには回転、タンブリング、風はありません。

フィッティングされる 7 つのパラメータは、**飛行時刻ゼロ**における `[x, y, z, vx, vy, vz, k]` です。飛行時刻ゼロは最初の検出時刻ではなく、確認済みの打球時刻です([`physics.py` モジュールの docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L1-L8))。ラケットや選手がシャトルを隠すため、検出は打球から数フレーム後に始まることがよくあります。それらのフレームは打球時点からのオフセットとして測られるので、最初の検出が遅れても飛行の開始は動きません(`first_observation_delay_s` がその差を報告します)。

## 数値積分

[`simulate`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L26-L40) は SciPy `solve_ivp`(既定の陽的ルンゲ=クッタ法)で、`t = 0` から `rtol=1e-7`、`atol=1e-8`、`max_step=0.02` 秒、密な出力(dense output)を指定して方程式を積分し、要求された時刻の位置を評価します。有限でない時刻と `-1e-9` s 未満の時刻は拒否され、それより大きいごく小さな負の値はゼロに丸められます。ソルバーの許容誤差は数値積分の誤差を制御するものであり、復元精度の上限ではありません。[`floor_crossing`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L43-L63) は `z` に対するイベント関数(下降方向のみ、終端イベント)を使い、より厳しい許容誤差(`rtol=1e-9`、`atol=1e-10`、`max_step=0.01`)で 10 s の範囲を計算します。

## 何を最小化するか

[`fit_flight`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L57-L151) は 1 つの残差ベクトルを作ります。各要素は差をスケールで割ったものなので、「1」は「想定誤差 1 つ分」を意味します。

```text
 pixels    (project(P, r(t_i)) - uv_i) / pixel_sigma_px            default 3.0 px
 start     (r(0) - contact_prior) / start_sigma                     xy 0.5 m, height 0.3 m
 drag      (k - 0.18) / 0.15
 intercept (r(T) - next_contact_prior) / next_contact_sigma         intercepted only
 landing   z(T) / 0.01   and   distance outside region / 0.02       landing only
 floor     min(z, 0) / 0.01 on 41 samples from 0 to T
 net       max(0, 1.55 - h_net) / 0.02                              only if a crossing is required
```

`T` は飛行時間です。打球の事前値は [`_contact_prior`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L49-L54) から来ます。打球時点に `image_px` があれば、そのピクセルを通る光線を確認済みの `height_m` の高さの平面と交差させ、なければ `court_xy_m` と `height_m` をそのまま使います。シグマは各打球時点の `xy_sigma_m` と `height_sigma_m` から取り、なければ上に示した既定値を使います。

ネット項の `h_net` は、41 サンプルの経路が最初に `Y = 6.70` を横切る地点の補間された高さです。経路が一度も横切らなければ、`h_net` は 0 として扱われます。この項はソースに書かれているとおり 1.55 m(ポストの高さ)を使い、後述の受理ゲートは 1.524 m(ネット中央)を使います。

SciPy `least_squares` は `loss="soft_l1"` と `f_scale=1.5` で合計を最小化するため、少数の悪い検出が引っ張る力は通常の二乗和より小さくなります。開始点は 6 つです。終点の目標へ向かう弾道の推定値に `1.0` または `3.0` m/s の上向き速度を追加したものと、`k` を `0.1, 0.2, 0.35` とするものの組み合わせです。コストが最も低い結果が採用されます。境界は探索を物理的な範囲に保ちます([ソース](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L64-L69))。

```text
 x in [-3, 9.1] m     y in [-3, 16.4] m     z in [0.05, 4.5] m
 vx, vy, vz in [-velocity_bound_m_s, +velocity_bound_m_s]    default 120 m/s
 k in drag_bounds_per_m                                      default [0.015, 0.6] 1/m
 landing time T in the reviewed landing bracket (landing flights only)
```

7 つの状態/空気抵抗パラメータは、境界までの距離が許容範囲の 0.1% 未満のとき `parameters_at_bound` でフラグが立ちます([ソース](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L129-L135))。フラグが立ったフィッティングは拒否されます。着地時刻はこの診断に含まれません。通過しても、識別可能性、一意性、事前値の影響がないことは立証されません。

## 飛行の終わり方

飛行はカメラ区間ごとに、打球時点を時間順にたどって作られます([`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L291))。

- **`intercepted_by_next_contact`**: 同じ区間に別の打球時点が続く場合。飛行時間は打球時点間の時間で、終点は次の打球時点の事前値へ引き寄せられます。2 つの打球事前値がネットの反対側にあるときは、ネット越えが必要です。
- **`landing_region`**: 区間の最後の打球時点に、確認済みの着地の終わりがある場合。打球時点と着地端点の残差が、フィッティングを確認済みの端点へ緩やかに引き寄せます。着地時刻は確認済みの範囲(bracket)で制限されますが、端点の高さと領域への包含は厳格な受理要件ではありません。`landing.within_region` は 1 mm の許容幅で包含を報告するだけで、受理を制御しません。開始点と領域の中心がネットの反対側にあるときは、ネット越えが必要です。
- **`open_segment_end`**: それ以外のすべての場合。ウィンドウは区間の終わりか `until_s` で終わり、フィッティング時間は最後の観測オフセットで、ネット越えは不要です。

ウィンドウ内の検出が `min_observations`(既定値 4)未満の場合は、フィッティングなしで `status: "insufficient_observations"` になります。

## 受理ゲート

フィッティング後、経路は 201 点でサンプリングされ、[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106) で検査されます。`floor_ok` では最も低い点が -0.02 m 以上である必要があります。`net_ok` では、越えることが必要だった場合に越えていること、そして越えることが想定されていたかどうかにかかわらず、隣接サンプル間で検出された**すべての**ネット越えが 1.524 m 以上であることが必要です。飛行が受理されるのは、最適化器が成功を報告し、両方のゲートを通過し、再投影 RMS が `max_accept_rms_px`(既定値 8.0 px)以下で、7 つの状態/空気抵抗パラメータのいずれにもフラグが立っていない場合だけです。拒否された飛行は検査用にパラメータを保持しますが、モデルレイヤーとしては描画されません。

## 速度と反実仮想の着地

`model_speed_km_h` はモデルの初速 `|v(0)| * 3.6` で、`model_speed_coarse_km_h` は表示用にそれを最も近い 5 km/h 単位に丸めた値です。レーダーの測定値ではありません。

着地領域で終わらない飛行について、飛行の終了後にモデルが床面に達する場合、解析は `kind: "counterfactual_if_unreturned"` と `observed: false` を持つ `unreturned_floor_crossing_prediction` を追加します。これはシャトルが実際にどこへ行ったかではなく、「誰も打ち返さなかったら、このモデルはどこに落ちるか」に答えるものです。着地する飛行では、`landing.xy_m` はユーザーの領域へ緩やかに引き寄せられたモデルの終点であり(領域内にあることは保証されません)、`exact_coordinate_measured` は常に `false` です。

関連: `P` については[カメラキャリブレーション](camera-calibration.md)、観測ウィンドウについては[観測とタイミング](observations-timing.md)、`fit` と `gates` の解釈については[検証と限界](validation-limits.md)を参照してください。
