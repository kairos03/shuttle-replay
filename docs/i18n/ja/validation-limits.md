# 検証と限界

`shuttle-replay` は自身の結果について多くの数値を報告します。それぞれの数値は狭い問いに 1 つ答えるものです。このページでは、各チェックについて何を示し、何を示さないのか、そしてリポジトリのどのテストがそれを実行しているのかを説明します。実際の映像に対する精度や速度の数値はここにはありません。プロジェクトがそうした値を測定したことがないためです。

## 各チェックが証明すること

**ホールドアウト地面誤差**(`heldout_summary`、[`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L175-L197))。証明すること: 床面ホモグラフィが、フィッティングに使われていないコート点を予測できること。証明しないこと: 高さ、ネットアンカー、シャトルに関すること全般。

**ネットアンカーの残差と感度**(`net_anchor_residuals_px`、`net_anchor_sensitivity`)。アンカーが 2 つの場合、鉛直列はほぼちょうど決定されるので、残差は構造上ほぼゼロになります。感度の値は、アンカー座標の 1 つが記載されたピクセル不確かさだけ動いたとき、ネット上 3 m の基準点 1 つがどれだけ動くかを示します。これは仮定のシナリオであり、信頼区間ではありません。[カメラキャリブレーション](camera-calibration.md)を参照してください。

**再投影誤差**(`fit.reprojection_rms_px`、`reprojection_p90_px`、`reprojection_max_px`)。証明すること: モデルの投影がユーザーの 2D 検出の近くを通ること。証明しないこと: 3D 経路が正しいこと。異なる奥行きと異なる速度が、ほぼ同じピクセルに投影されることがあります。これが[軌道の物理](trajectory-physics.md)で説明した劣決定です。既定の受理上限は RMS 8.0 px です。

**床面ゲートとネットゲート**(`gates`、[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106))。通過は、サンプリングされた 201 個の高さがすべて −0.02 m 以上であること、隣接サンプル間で補間して検出したすべてのネット越えが 1.524 m 以上であること、そして必要なときにネット越えが起きていることを示します。これらのチェックは、一般的な物理的妥当性や実環境での精度を立証するものではありません。

**`parameters_at_bound` と `optimizer_success`**。収束しなかったフィッティングは拒否されます。7 つの状態/空気抵抗パラメータは、境界までの距離が許容範囲の 0.1% 未満のときにフラグが立ちます。フラグが立ったフィッティングは拒否されます。着地時刻はこの診断に含まれません。通過しても、識別可能性、一意性、事前値の影響がないことは立証されません。

**メディアチェック**(レンダーレポート)。証明すること: すべての元フレームがインデックスと PTS で対応付けられたこと、出力が正しいフレーム数でデコードできること、音声パケットが時刻を保ったこと。証明しないこと: PTS の一致そのものを超えて、ユーザーの `pts_s` が検出に使ったのと同じファイルから得られたものであること。

**合成データでの復元**(`demo`、`synthetic_recovery.json`)。`synthetic_recovery.json` は合成の正解との比較を報告します。テストは特定の合成ケースについて、選ばれた復元許容誤差を検査します。レポートを生成するだけでは、それらの許容誤差は強制されません。どちらも実際の映像での精度を示すものではありません。ファイルの `label` がそれを明記しています: "SYNTHETIC ground-truth recovery; not evidence of accuracy on real video"。

## 不確かさが定性的にしか表現されない部分

フィッティングにはシグマがありますが、出力はそれをエラーバーに変換しません。位置、速度、着地点に対する共分散も、ブートストラップも、信頼区間もありません。代わりに、不確かさはラベルで表現されます。すべての解析ファイルにある `conditional_model`、`exact_coordinate_measured: false`、`speed_scope`、そして `assumptions` リストです([`ASSUMPTIONS`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L39-L46))。5 km/h 単位のおおまかな速度の丸めは表示上の選択であり、誤差の推定ではありません。

## 別の何かではない理由

- **実測の 3D ではありません。** カメラ 1 台が与えるのは点ではなく光線です。奥行きは物理モデルと、ユーザーが確認した打球時点から得られます。
- **密な奥行きではありません。** ピクセルごとの深度マップも、学習済みの深度ネットワークもありません。3D 位置が得られるのは、フィッティングされた飛行上のシャトルだけです。
- **自動 IN/OUT 判定ではありません。** `landing.inside_court` はモデルの点をコートの外側境界と比較します。その点はユーザーが描いた領域へ緩やかに引き寄せられるため、答えは主にユーザーの確認を反映します。領域への包含は厳格な受理要件ではありません(`landing.within_region` が 1 mm の許容幅で報告します)。ライン判定のロジックも、シングルス/ダブルスのルールも、シャトルが触れた位置の測定もありません。

## デバッグの順序

飛行がおかしく見えるときは、パイプラインの下流から上流へ向かって読んでください。

1. **キャリブレーション。** `heldout_summary` の誤差が大きい、または `max_vertical_shift_m` が大きい場合は、まず点かアンカーを直してください。後段では回復できません。
2. **入力。** `observation_frame_ids` と `first_observation_delay_s`: ウィンドウに期待した検出が入っていますか?
3. **ステータス。** `insufficient_observations` は検出が少なすぎることを意味します。`rejected_by_gates_or_fit` なら次の 2 項目を見てください。
4. **フィッティング。** `optimizer_success`、`parameters_at_bound`、再投影の RMS と最大値。RMS が低いのに最大値が 1 つだけ非常に大きい場合は、悪い検出が 1 つあることを示しています。
5. **ゲート。** `minimum_height_m`、`net_crossing_required`、`net_crossing_occurred`、`net_crossing_height_m`。ネットゲートの失敗は、打球時点が間違った側にある、または打球の高さが誤っていることが多いです。
6. **レンダーレポート。** PTS の不一致やフレーム数のエラーは、トラックがまさにこの動画のデコード結果に属していないことを意味します。

## 根拠マップ

| 主張 | テスト |
| --- | --- |
| ホールドアウト点を別に報告し、`H` を Z=0 のみとラベル付け | `test_calibration_recovers_camera_and_reports_heldout_separately` |
| 不正なキャリブレーション入力を拒否 | `test_calibration_rejects_invalid_inputs`, `test_calibration_rejects_collinear_fit_points` |
| 不整合なトラックや確認は修復せず拒否 | `test_inconsistent_inputs_are_rejected_not_repaired`, `test_missing_segment_calibration_is_rejected` |
| 最初の検出ではなく打球時点が時刻ゼロ | `test_delayed_first_observation_keeps_contact_as_time_zero` |
| 飛行は 1 つの区間内にとどまる | `test_flights_never_bridge_camera_segments` |
| 欠けた検出は null のまま | `test_missing_detection_provenance_is_null_not_filled` |
| 着地は測定ではなく制約 | `test_landing_region_is_a_constraint_not_a_measurement` |
| 打ち返された飛行は着地を強制されない | `test_intercepted_flight_is_not_forced_to_land` |
| ネットゲートと床面ゲート | `test_physical_gates_reject_net_and_floor_violations`, `test_actual_low_net_crossing_rejected_without_expected_crossing` |
| 境界に張り付いたフィッティングの拒否、`until_s` ウィンドウ | `test_open_flight_window_and_bound_pinned_fits` |
| コートのライン中心 | `test_court_lines_are_line_centres_of_40mm_lines_inside_outer_boundary` |
| PTS とフレーム数のチェック、悪意のあるファイル名 | `test_render_rejects_mismatched_pts_and_handles_hostile_filename` |
| 軌跡は 1 つの飛行内にとどまる | `test_trails_stay_inside_one_flight_and_segment` |
| 元動画や既存ファイルを上書きしない | `test_render_never_overwrites_source_or_existing_files`, `test_cli_rejects_output_aliasing_inputs` |
| 音声のオフセットと途切れを保持 | `test_audio_is_stream_copied_with_source_relative_offset` |
| エンドツーエンドのデモ成果物 | `test_demo_end_to_end_creates_verified_artifacts`, `test_run_command_from_existing_inputs` |

すべてのテストは [`tests/`](https://github.com/KAIROS03/shuttle-replay/tree/6e9a060b5cc964f02d4017d806e953ffea89c8b4/tests) にあります。飛行に関するテストの多くは [`synthetic.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py) の合成シーンで実行されるため、実環境での精度ではなく、動作と契約を確認するものです。テストでカバーされていないもの: ツールがモデル化していないレンズ歪み、そしてテストで使われている AAC 以外の音声コーデック。

関連: 限界の一覧については[ワークフロー](workflow.md)、結果の読み方については[ユーザーガイド](guide.md)を参照してください。
