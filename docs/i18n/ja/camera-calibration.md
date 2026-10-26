# カメラキャリブレーション

キャリブレーションは 1 つの問いに答えます。コート上の点(メートル単位)は、カメラ画像のどのピクセルに映るのか。`shuttle-replay` は、ユーザーが手で位置を指定した点から推定した線形ピンホールカメラでこの問いに答えます。このページでは、座標系、ツールが計算する 2 つの行列、正確なアルゴリズム、そして報告される誤差の意味を説明します。

## 2 つの座標系

**画像座標** `(u, v)` は元動画のピクセルです。`u` は右へ、`v` は下へ向かって増えます。

**ワールド座標** `(X, Y, Z)` は、BWF のコート寸法で固定されたコート座標系のメートル単位の値です([`court.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L1-L24))。

```{figure} assets/technical/ja/court.svg
:alt: コートモデル：X は 0 から 6.10 m、Y は 0（奥のベースライン）から 13.40 m（手前のベースライン）、ネット面 Y = 6.70 m、支柱 1.55 m、中央 1.524 m、Z は床面から上向き
:class: technical-figure
:width: 100%

コート座標（メートル）。Z は上向きで、Z = 0 がコート面。
```

ラインの幅は 40 mm で、キャリブレーション点には**ラインの中心**を使います。外側のラインは X = 0.02 / 6.08 と Y = 0.02 / 13.38、シングルスのサイドラインは X = 0.48 / 5.62、ショートサービスラインは Y = 4.70 / 8.70、ダブルスのロングサービスラインは Y = 0.78 / 12.62、センターラインは X = 3.05 です([`court_lines`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/court.py#L27-L52))。中心を指定すべきところに外側の縁を入力すると、その点は 2 cm ずれます。

## ピンホール投影

ピンホールカメラは 3x4 行列 `P` でワールドの点をピクセルに写します。

```{math}
\begin{gathered}
\begin{bmatrix} a \\ b \\ c \end{bmatrix} = P \begin{bmatrix} X \\ Y \\ Z \\ 1 \end{bmatrix} \\
u = \frac{a}{c}, \qquad v = \frac{b}{c}
\end{gathered}
```

`c` で割ることが透視効果です。遠くのものは小さく見えます。`P` は、カメラの位置と回転(外部パラメータ)を、焦点距離と画像中心(内部パラメータ)と組み合わせたものです。このプロジェクトは `P` をこれらの部分に分解しません。代わりに `P` を1 つの行列として使います([`project`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L12-L15))。カメラ中心 `C` は `P * [C, 1] = 0` を満たす唯一の点なので、`C = -inverse(P[:, :3]) * P[:, 3]` です([`camera_center`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/geometry.py#L24-L26))。

## ステップ 1: 床面ホモグラフィ(Z = 0 のみ)

床面上の点では `Z = 0` なので、`P` の 3 列目にはゼロが掛かって消えます。

```{math}
P = \begin{bmatrix} p_1 & p_2 & p_3 & p_4 \end{bmatrix}
```

{math}`p_1, \dots, p_4` は {math}`P` の 4 つの列。

```{math}
\begin{aligned}
P \begin{bmatrix} X \\ Y \\ 0 \\ 1 \end{bmatrix}
&= \begin{bmatrix} p_1 & p_2 & p_4 \end{bmatrix} \begin{bmatrix} X \\ Y \\ 1 \end{bmatrix} \\
&= H \begin{bmatrix} X \\ Y \\ 1 \end{bmatrix}
\end{aligned}
```

3x3 行列 `H = [p1 p2 p4]` が**ホモグラフィ**です。これは [`fit_homography`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L58-L78) で、正規化された直接線形変換(DLT)により `role: "fit"` の地面点からフィッティングされます。

1. 各点集合を重心へ平行移動し、重心からの平均距離が `sqrt(2)` になるようにスケーリングします([`_normalize`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L36-L39))。ピクセル値が数百でメートル値が 1 桁のときに、線形系の条件を良好に保つためです。
2. 対応点 1 つにつき、線形系 `A h = 0` に 2 行が加わります。
3. `h` は最小特異値に対応する `A` の右特異ベクトルです。正規化を元に戻し、`H[2, 2] = 1` となるよう `H` をスケーリングします。

退化した入力は、悪い行列を作る代わりに `CalibrationError` で拒否されます。フィット点が 4 個未満、重複した座標、一直線上に並ぶ点集合、ちょうど 4 点のうち 3 点が一直線上にある場合、2 番目に小さい特異値が最大値の `1e-9` 倍未満(解が一意でない)、条件数が `1e12` を超える場合です([`_check_spread`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L42-L78))。

このフィッティングは、すべてのフィット点に対する代数的残差を最小化する正規化 DLT であり、非線形の再投影による精密化は行いません。外れ値の除去(RANSAC なし)も、レンズ歪みモデルもありません。打ち間違えた点や強い樽型歪みは、フィッティング全体を引っ張ります。

`H` が記述するのは床面だけです。出力の `H_scope` がそれを明示します([`H_SCOPE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L22))。シャトルのピクセルを `H` で逆投影すると「このピクセルが床面上にあったらどこか」の答えになり、空中にあるものに対しては誤りです。

## ステップ 2: ネットアンカーから求める鉛直列

床面の点は、高さに掛かる列 `p3` について何も教えてくれません。これを求めるには、床面上にない、高さが既知の点が必要です。通常は `Z = 1.55` の 2 本のネットポストの上端です。`(u, v)` に見える `(X, Y, Z)` のアンカーについて `q = H * [X, Y, 1]` とおくと、投影条件は `p3` について線形になります。

```{math}
\begin{aligned}
u \, (q_3 + Z \, p_{3,3}) &= q_1 + Z \, p_{3,1} \\
v \, (q_3 + Z \, p_{3,3}) &= q_2 + Z \, p_{3,2}
\end{aligned}
```

アンカーごとに整理すると：

```{math}
\begin{bmatrix} Z & 0 & -u Z \\ 0 & Z & -v Z \end{bmatrix} p_3
= \begin{bmatrix} u \, q_3 - q_1 \\ v \, q_3 - q_2 \end{bmatrix}
```

[`camera_from_anchors`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L81-L92) はこれらの行を積み重ね、ランク 3 を要求し、最小二乗で解き、`P = [h1 h2 p3 h3]` を組み立てます。ここで `h1`、`h2`、`h3` は `H` の列です。未知数が 3 つでアンカーあたり 2 行なので、2 つのアンカーで 4 つの方程式が得られ、ほぼちょうど決定されます。そのため、アンカー残差(`net_anchor_residuals_px`)が小さくてもほとんど何も証明されません。アンカーは高い位置(`Z > 0.1 m`)にあり、少なくとも 2 つ必要です。

最後に [`_check_camera`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L95-L104) が、中心が床面より上にないカメラや、一部のコート点を前方に、他の点を後方に置いてしまうカメラを拒否します。

## フィット点とホールドアウト点

すべての地面点には役割があります([`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L128-L205))。

- `fit` 点は `H` を作ります。その残差(`fit_ground_residuals`)は学習誤差であり、小さいことが期待されます。
- `heldout` 点はフィッティングに一切使われません。少なくとも 1 つ必要です。`heldout_ground_errors` は点ごとに、`error_px`(ワールド点に `H` を適用し、ユーザーのピクセルと比較)と `error_m`(ユーザーのピクセルに逆 `H` を適用し、ワールド点と比較)を報告します。`heldout_summary` は両者の個数、平均、最大値を示します。

概念的な例: 外側の 4 隅を `fit`、サービスラインの交点 2 つを `heldout` にします。ホールドアウト誤差がフィット残差よりずっと大きい場合は、点のラベル付けが誤っているか、ラインの中心ではなく縁をクリックしたか、レンズがラインを曲げています。ホールドアウト誤差が確認するのは床面への写像だけで、高さについては何も示しません。

## 信頼区間ではなく感度

高さはほぼ完全にアンカーに依存します。[`_anchor_sensitivity`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L107-L125) は、ネットのセンターライン上 3 m の基準点 `(3.05, 6.70, 3.0)` を取り、`P` で投影します。次に、各アンカーについて `u` と `v` を別々に、アンカーのピクセルを `+uncertainty_px` と `-uncertainty_px`(既定値 3.0)だけ動かし、`P` を解き直し、同じ基準ピクセルを通る光線をネット平面 `Y = 6.70` と交差させます。`max_vertical_shift_m` は高さの変化の最大値です。摂動によって解が求まらなくなった場合、ずれは無限大として報告されます。

これは 1 点について、一度に 1 つずつ動かしたときの最悪ケースです。統計的な信頼区間ではなく、複数のアンカーの誤差を組み合わせず、地面点の誤差も含みません。

## ユーザーが置いている仮定

- `segment_id` ごとに固定カメラが 1 台。カメラが動いたりズームしたりしたら、新しい区間が必要です。
- 直線は画像上でも直線のまま(レンズ歪みなし)。
- アンカーは入力した高さを持つ。ポスト上端の 1.55 m とネット中央の 1.524 m は異なる高さです。
- 地面平面はシャトルではない。`H` が与えるのは床面上の位置であり、シャトルの奥行きは[軌道の物理](trajectory-physics.md)で説明する物理フィッティングからのみ得られます。

入力と出力の全フィールドは[スキーマ](schemas.md)を、誤差を飛行の診断と合わせて読む方法は[検証と限界](validation-limits.md)を参照してください。
