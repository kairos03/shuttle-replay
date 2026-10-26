# 入力と出力の形式 (v0.1)

メートル単位の座標はすべてコート座標系を使います。X はコートの横方向、Y は縦方向で、コートの外側の境界（境界ラインの外縁）が X = 0 .. 6.10、Y = 0（奥）.. 13.40（手前）です。Z は上向き（0 = 床）です。ネット面は Y = 6.70 です。ラインの幅は 40 mm なので、地面の点はラインの中心で入力してください。外側のライン X = 0.02 / 6.08 と Y = 0.02 / 13.38、シングルスのサイドライン X = 0.48 / 5.62、ショートサービスライン Y = 4.70 / 8.70、ダブルスのロングサービスライン Y = 0.78 / 12.62、センターライン X = 3.05 です。
画像座標は元動画のピクセル（x は右、y は下）です。時刻は FFmpeg/PyAV がデコードした元動画の表示タイムスタンプ（PTS）を秒で表したもの（`frame.pts * time_base`）であり、決して `frame_index / fps` ではありません。

`shuttle-replay demo --out-dir demo` を実行すると、以下のすべてのファイルの完全な合成例が `demo/inputs/` に作成されます。

## キャリブレーション入力 — `shuttle-replay/calibration-input/v1`

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

- `role: "fit"` の点（≥ 4 点、同一直線上になく、重複しない）で床面ホモグラフィを推定します。`role: "heldout"` の点（≥ 1 点）はフィッティングに決して使われず、ピクセルとメートルでのホールドアウト誤差として別途報告されます。
- `net_anchors`（≥ 2 点、Z > 0.1 m）でカメラ行列の鉛直列を復元します。アンカーがちょうど 2 点の場合、この列はほぼ厳密に決まってしまうため、その残差からわかることはわずかです。そのため出力には感度レポート（アンカーが `uncertainty_px` だけ動いたときに、ネットの 3 m 上の点が鉛直方向にどれだけずれるか）が含まれます。
- 有限でない数値、同一直線上または重複したフィット点、床の高さにあるアンカー、床より下にあるカメラは拒否されます。

出力（`shuttle-replay/calibration/v1`）には、セグメントごとに `P`（3×4、メートル → ピクセル）、`H_world_to_image` / `H_image_to_world`（床面のみ）、`fit_ground_residuals`、`heldout_ground_errors`、`heldout_summary`、`net_anchor_residuals_px`、`net_anchor_sensitivity`、および入力のコピーが含まれます。

## トラック — `shuttle-replay/tracks/v1`

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

- デコードされた元フレームごとに 1 エントリを、デコード順に並べます。`frame_id` はデコードのインデックスと等しくなければなりません（レンダラーはこれと、すべてのフレームの PTS を確認します）。
- `frame_id` と `pts_s` は厳密に増加し、有限でなければなりません。
- `segment_id` は、キャリブレーションを持つ連続したカメラショットを識別します。`null` はカメラの切り替え/クローズアップ/リプレイを示し、これらは除外されます。セグメントは連続していなければならず、別のセグメントの後に再登場したセグメント id は拒否されます（後のショットには独自の id とキャリブレーションを与えてください）。
- `shuttle: null` は「検出なし」を意味します。これはすべての出力で null のままです。

## レビューアノテーション — `shuttle-replay/review/v1`

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

- 打点はレビュー済みのラケット接触です。`time_s` はレビューした打点のタイムスタンプで、最初のシャトル検出がそれより後に来た場合でも、飛行時間のゼロになります。これはそのカメラセグメントの中、かつ `time_bracket_s`（幅 ≤ 0.5 s）の中になければなりません。セグメント内の打点は厳密に増加しなければなりません。v0.1 は打点時刻を自動で補正しません。フレームをレビューして `time_s` を編集することで補正してください。
- 位置の事前情報：`image_px`（レビューした打点のピクセルを、完全なカメラ P を通して平面 Z = `height_m` と交差させたもの）または `court_xy_m`。`height_m` は `height_sigma_m` を伴うレビュー済みの事前情報です。`xy_sigma_m` は任意です（既定値 0.5 m）。
- 飛行はある打点から同じセグメントの次の打点まで続きます（`intercepted_by_next_contact`、床への到達は決して強制されません）。`flight_ends` エントリを持てるのはセグメントの最後の打点だけです。`landing_region`（時間区間内で、床との接触をレビュー済みの枠内に制約）または `open`（セグメント内の最後の観測まで、あるいは任意のレビュー済み `until_s` までフィッティング）です。エントリがなければ open です。
- `physics` のキー（すべて任意）：`gravity_m_s2`、`pixel_sigma_px`、`drag_prior_per_m`、`drag_prior_sigma`、`drag_bounds_per_m`、`contact_guard_s`、`contact_xy_sigma_m`、`min_observations`、`max_accept_rms_px`、`velocity_bound_m_s`。

## 解析出力 — `shuttle-replay/analysis/v1`

- `flights[]`：`t0_s`（レビュー済みの打点）、`t_end_s`、`end_type`、`params`（打点時の `[x, y, z, vx, vy, vz, drag_k]`）、`fit`（再投影 RMS / p90 / 最大 px、観測数、オプティマイザの状態）、`gates`（床面とネットの実現可能性。飛行がネットを越える場合はネット高さ ≥ 1.524 m）、`parameters_at_bound`（オプティマイザの境界に張り付いたフィットは拒否されます）、`accepted`、`model_speed_km_h` と `model_speed_coarse_km_h`、`first_observation_delay_s`、`observation_frame_ids`、`landing`（着地する飛行。`exact_coordinate_measured: false`）、`unreturned_floor_crossing_prediction`（インターセプトされた/open の飛行。`kind: counterfactual_if_unreturned`、`observed: false`）。
- `frames[]`：`shuttle_observed_px`（与えられた検出結果または null）、`shuttle_model_xyz_m` / `shuttle_model_px`（採用されたモデルのみ、同じセグメント）、`model_flight_id`、`layer`（`conditional_model`、`observed_pixel`、`none`、`excluded_camera_cut`）。
- `provenance_vocabulary`、`assumptions`、`calibration_summary`。

## レンダーレポート

`render_report.json` には、エンコーダ、フレーム数、デコードした元動画の PTS とトラックの PTS の最大差、6:4 のレイアウト、音声が保持されたかどうか、そして書き出した MP4 を完全にデコードした結果が記録されます。
