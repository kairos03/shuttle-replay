# 입력과 출력 형식 (v0.1)

미터 단위 좌표는 모두 코트 좌표계를 씁니다. X는 코트를 가로지르는 방향, Y는 코트를 따라가는 방향이며, 코트의 바깥 경계(경계선의 바깥 가장자리)는 X = 0 .. 6.10, Y = 0(먼 쪽) .. 13.40(가까운 쪽)입니다. Z는 위쪽입니다(0 = 바닥). 네트 평면은 Y = 6.70입니다. 라인 폭은 40 mm이므로 바닥 점은 라인 중심으로 입력하세요. 바깥 라인 X = 0.02 / 6.08과 Y = 0.02 / 13.38, 단식 사이드라인 X = 0.48 / 5.62, 숏 서비스 라인 Y = 4.70 / 8.70, 복식 롱 서비스 라인 Y = 0.78 / 12.62, 센터 라인 X = 3.05입니다.
이미지 좌표는 원본 영상의 픽셀입니다(x는 오른쪽, y는 아래쪽). 시간은 FFmpeg/PyAV가 디코딩한 원본 표시 타임스탬프(PTS)를 초 단위로 나타낸 값(`frame.pts * time_base`)이며, 절대 `frame_index / fps`가 아닙니다.

`shuttle-replay demo --out-dir demo`를 실행하면 아래 모든 파일의 완전한 합성 예시를 `demo/inputs/`에서 얻을 수 있습니다.

## 보정 입력 — `shuttle-replay/calibration-input/v1`

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

- `role: "fit"` 점(≥ 4개, 한 직선 위에 있지 않고 중복되지 않음)으로 바닥 호모그래피를 추정합니다. `role: "heldout"` 점(≥ 1개)은 맞춤에 절대 쓰이지 않으며 픽셀과 미터 단위의 홀드아웃 오차로 따로 보고됩니다.
- `net_anchors`(≥ 2개, Z > 0.1 m)로 카메라 행렬의 수직 열을 복원합니다. 앵커가 정확히 두 개이면 이 열이 거의 정확히 결정되므로 그 잔차로 알 수 있는 것은 적습니다. 그래서 출력에는 민감도 보고서(앵커가 `uncertainty_px`만큼 움직일 때 네트 위 3 m 지점이 수직으로 얼마나 이동하는지)가 포함됩니다.
- 유한하지 않은 숫자, 한 직선 위에 있거나 중복된 맞춤 점, 바닥 높이에 있는 앵커, 바닥 아래에 있는 카메라는 거부됩니다.

출력(`shuttle-replay/calibration/v1`)에는 구간마다 `P`(3×4, 미터 → 픽셀), `H_world_to_image` / `H_image_to_world`(바닥 전용), `fit_ground_residuals`, `heldout_ground_errors`, `heldout_summary`, `net_anchor_residuals_px`, `net_anchor_sensitivity`, 그리고 입력의 사본이 들어 있습니다.

## 트랙 — `shuttle-replay/tracks/v1`

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

- 디코딩된 원본 프레임마다 항목 하나를 디코딩 순서대로 둡니다. `frame_id`는 디코딩 인덱스와 같아야 합니다(렌더러가 이것과 모든 프레임의 PTS를 확인합니다).
- `frame_id`와 `pts_s`는 엄격히 증가해야 하며 유한해야 합니다.
- `segment_id`는 보정이 있는 연속된 카메라 샷을 식별합니다. `null`은 카메라 전환/클로즈업/리플레이를 나타내며 제외됩니다. 구간은 연속되어야 하며, 다른 구간 뒤에 다시 나타나는 구간 id는 거부됩니다(나중 샷에는 별도의 id와 보정을 주세요).
- `shuttle: null`은 "검출 없음"을 뜻합니다. 모든 출력에서 null로 남습니다.

## 검토 주석 — `shuttle-replay/review/v1`

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

- 타구는 검토한 라켓 접촉입니다. `time_s`는 검토한 타구 타임스탬프이며, 첫 셔틀콕 검출이 더 늦게 나오더라도 비행 시간 0이 됩니다. 이 값은 해당 카메라 구간 안, 그리고 `time_bracket_s`(폭 ≤ 0.5 s) 안에 있어야 합니다. 한 구간 안의 타구는 엄격히 증가해야 합니다. v0.1은 타구 시각을 자동으로 보정하지 않습니다. 프레임을 검토하고 `time_s`를 편집해 보정하세요.
- 위치 사전값: `image_px`(검토한 타구 픽셀을 전체 카메라 P를 통해 평면 Z = `height_m`과 교차시킨 값) 또는 `court_xy_m`. `height_m`은 `height_sigma_m`을 갖는 검토한 사전값입니다. `xy_sigma_m`은 선택 사항입니다(기본값 0.5 m).
- 비행은 한 타구에서 같은 구간의 다음 타구까지 이어집니다(`intercepted_by_next_contact`, 바닥에 닿도록 절대 강제하지 않음). `flight_ends` 항목을 가질 수 있는 것은 구간의 마지막 타구뿐입니다. `landing_region`(시간 구간 안에서 바닥 접촉을 검토한 상자 안으로 제약) 또는 `open`(구간의 마지막 관측까지, 또는 선택 사항인 검토한 `until_s`까지 맞춤)입니다. 항목이 없으면 open입니다.
- `physics` 키(모두 선택 사항): `gravity_m_s2`, `pixel_sigma_px`, `drag_prior_per_m`, `drag_prior_sigma`, `drag_bounds_per_m`, `contact_guard_s`, `contact_xy_sigma_m`, `min_observations`, `max_accept_rms_px`, `velocity_bound_m_s`.

## 분석 출력 — `shuttle-replay/analysis/v1`

- `flights[]`: `t0_s`(검토한 타구), `t_end_s`, `end_type`, `params`(타구 시점의 `[x, y, z, vx, vy, vz, drag_k]`), `fit`(재투영 RMS / p90 / 최대 px, 관측 수, 최적화기 상태), `gates`(바닥과 네트 실현 가능성. 비행이 네트를 넘을 때 네트 높이 ≥ 1.524 m), `parameters_at_bound`(최적화기 경계에 붙은 맞춤은 거부됨), `accepted`, `model_speed_km_h`와 `model_speed_coarse_km_h`, `first_observation_delay_s`, `observation_frame_ids`, `landing`(착지하는 비행. `exact_coordinate_measured: false`), `unreturned_floor_crossing_prediction`(가로채인/open 비행. `kind: counterfactual_if_unreturned`, `observed: false`).
- `frames[]`: `shuttle_observed_px`(제공된 검출 결과 또는 null), `shuttle_model_xyz_m` / `shuttle_model_px`(채택된 모델만, 같은 구간), `model_flight_id`, `layer`(`conditional_model`, `observed_pixel`, `none`, `excluded_camera_cut`).
- `provenance_vocabulary`, `assumptions`, `calibration_summary`.

## 렌더 보고서

`render_report.json`에는 인코더, 프레임 수, 디코딩한 원본 PTS와 트랙 PTS의 최대 차이, 6:4 레이아웃, 오디오 보존 여부, 그리고 기록한 MP4를 전체 디코딩한 결과가 기록됩니다.
