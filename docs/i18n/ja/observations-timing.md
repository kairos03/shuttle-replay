# 観測とタイミング

飛行フィッティングは、モデルの位置と検出結果を**特定の時刻で**比較します。その時刻が間違っていると、正しい軌道が誤って見え、誤った軌道が正しく見えることがあります。このページでは、時刻がどこから来るのか、入力の契約が何を要求するのか、根拠と確認がどう分けられているのか、そしてモデルと描画のために時間がどうサンプリングされるのかを説明します。

## 時刻はフレームの数え上げではなく PTS から得る

動画コンテナは、各フレームの表示タイムスタンプ(PTS)を整数のティック数として保存し、1 ティックの長さを表す `time_base` を併せて持ちます。フレームの秒単位の時刻は次のとおりです。

```{math}
\mathrm{time\_s} = \mathrm{pts} \cdot \mathrm{time\_base}
```

例：

```{math}
\begin{aligned}
\mathrm{time\_base} &= \tfrac{1}{30000}\ \mathrm{s}, \quad \mathrm{pts} = 3003 \\
\Rightarrow \mathrm{time\_s} &= 3003 \cdot \tfrac{1}{30000}\ \mathrm{s} = 0.1001\ \mathrm{s}
\end{aligned}
```

スマートフォンの動画や画面録画の多くは**可変フレームレート**(VFR)で、フレームの長さがまちまちです。この場合、`frame_index / fps` で計算すると実際の時刻から徐々にずれていきます。そのためトラック形式は、FFmpeg/PyAV がデコードした `pts_s` をフレームごとに保存します([スキーマ](schemas.md)を参照)。合成デモは意図的に VFR を使っています。`time_base` 1/30000 s で、7 フレームごとに 1 フレームが 1000 ティックではなく 1001 ティック続きます([`frame_pts_ticks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py#L52-L58))。

後でレンダラーは、デコードしたすべてのフレームをユーザーの `pts_s` と照合します。[レンダリングと出力の安全性](rendering-safety.md)を参照してください。

## 入力の契約

[`validate_tracks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L33-L78) と [`validate_review`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L81-L149) は、最初の不整合で `InputError` を送出します。並べ替え、重複除去、修復は一切行いません。

トラック(`shuttle-replay/tracks/v1`):

- `frame_id` は整数で、厳密に増加します。`pts_s` は有限で、厳密に増加します。
- `segment_id` は 1 つの連続したカメラショットを表します。`null` はカメラの切り替え、クローズアップ、リプレイを示します。別の区間の後に再び現れる区間 id は拒否されるため、ショットごとに独自の id とキャリブレーションが必要です。
- `shuttle` は `null`(検出なし)か、有限の `u` と `v` を持つかのどちらかです。選手のボックスは有限の数値 4 つでなければなりません。

各区間の時間範囲は、その最初と最後のフレームの PTS です。すべての区間にキャリブレーションが必要です([`validate_inputs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L152-L162))。

確認(`shuttle-replay/review/v1`):

- 打球時点の id は一意な文字列です。各打球時点は、その区間の PTS 範囲内、かつ自身の `time_bracket_s` 内にあり、その幅は最大 0.5 s です。
- 1 つの区間内の打球時点は、リストの順に時刻が厳密に増加します。
- `height_m` は開区間 (0, 4) m 内にあり、`height_sigma_m` は正です。各打球時点には `image_px` または `court_xy_m` が必要です。
- 区間の最後の打球時点だけが、`open` または `landing_region` 型の `flight_ends` エントリを持てます。着地の範囲(bracket)は打球時点より後に始まる必要があり、領域の `min` は `max` より小さくなければなりません。`open` の終わりの `until_s` は打球時点より後で、区間内に収まる必要があります。

## 根拠と確認

2 種類の入力は異なる役割を担います。

- **観測された根拠**: ユーザーの検出結果。フィッティングにはピクセル残差としてのみ入り、`shuttle_observed_px` にそのままコピーされます。`shuttle: null` のフレームは、すべての出力で `null` のままです。
- **確認済みの制約**: 打球時点、着地領域、キャリブレーション点。打球の位置と高さはシグマで重み付けされた事前値として入り、着地端点は固定のペナルティスケールを使います。キャリブレーション点はカメラを事前に決定します。打球時刻は固定され、着地時刻はその範囲(bracket)内でフィッティングされます。

検出のないフレームをモデルが埋める場合、そのフレームの `layer` は `conditional_model` になりますが、`shuttle_observed_px` は `null` のままです。テスト `test_missing_detection_provenance_is_null_not_filled` がまさにこれを確認しています。

## 飛行の分割

[`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L234) は打球時点を区間ごとにまとめ、各打球時点を 1 つの飛行にします。飛行がカメラ区間をまたぐことはありません。飛行の観測は、検出があり、かつ次の条件を満たす区間内のフレームです。

```{math}
\begin{aligned}
t_0 + \mathtt{contact\_guard\_s} &< \mathrm{pts\_s} \le t_\mathrm{end} - \mathtt{contact\_guard\_s} && (1) \\
t_0 + \mathtt{contact\_guard\_s} &< \mathrm{pts\_s} \le t_\mathrm{end} && (2)
\end{aligned}
```

(1) 飛行の後に別の接触が続く場合。
(2) 着地またはオープンエンドの場合。

| 記号 | 意味 |
|---|---|
| {math}`t_0` | レビュー済みの接触時刻 |
| {math}`t_\mathrm{end}` | 次の接触時刻、着地区間の終端、または min(セグメント終端, `until_s`) |
| `contact_guard_s` | 既定値 0.02 s |

ガードは、シャトルがラケットと重なって見えやすい打球直後の検出を除外します。各飛行レコードの `observation_frame_ids` と `observation_time_offsets_s` は、どのフレームが使われたかを正確に示し、オフセットは `t0` から測られます。

## モデルのサンプリングと表示

3 種類のサンプリングがあり、動画フレーム単位なのは最初のものだけです。

1. **フレーム単位。** 受理された飛行の時間範囲内にあるすべてのフレームで、`shuttle_model_xyz_m` はそのフレーム自身の PTS で評価したモデル値、`shuttle_model_px` はそれを `P` で投影した値です([フレームループ](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L293-L334))。カメラ切り替えのフレームは、生の検出が存在しても(`raw_detection_ignored`)`layer: "excluded_camera_cut"` となり、モデルも選手もありません。
2. **フィッティング内部。** 等間隔の 41 サンプルで床面とネットのペナルティを検査し、201 サンプルを受理ゲートに使います。[軌道の物理](trajectory-physics.md)を参照してください。
3. **表示。** 真上から見た画面の軌跡は、**同じ**飛行の、それ以前のフレーム単位モデルサンプルだけを結ぶポリラインです([`trail_for`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L36-L46))。`model_flight_id` が異なる最初のフレームで止まるので、軌跡が 2 つの飛行をつないだり、カメラの切り替えをまたいだりすることはありません。これらの線はデータではなく `display_interpolation` です。

## 実際に検査される許容誤差

| チェック | 値 | ソース |
|---|---|---|
| 接触区間の幅 | ≤ 0.5 s | `inputs.py` |
| 接触ガード | 0.02 s （既定値） | `analysis.py` |
| レンダラーの PTS 一致 | 1e-3 s フレームごと | `render.py` |
| ODE (`simulate`) | rtol 1e-7, atol 1e-8, max_step 0.02 s | `physics.py` |
| ODE (`floor_crossing`) | rtol 1e-9, atol 1e-10, max_step 0.01 s | `physics.py` |
| 床ゲート | 最低点 ≥ -0.02 m | `physics.py` |
| 着地 `within_region` | 領域を 1e-3 m 拡張 | `analysis.py` |

関連: すべてのフィールドについては[スキーマ](schemas.md)、独自の検出器からトラックを作る方法については[ワークフロー](workflow.md)を参照してください。
