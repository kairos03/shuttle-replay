# 관측과 타이밍

비행 피팅은 모델 위치와 검출 결과를 **특정 시각에서** 비교합니다. 그 시각이 틀리면 올바른 궤적이 틀려 보이고, 틀린 궤적이 맞아 보일 수 있습니다. 이 페이지는 시각이 어디서 오는지, 입력 계약이 무엇을 요구하는지, 근거와 검토가 어떻게 분리되는지, 그리고 모델과 그리기를 위해 시간이 어떻게 샘플링되는지 설명합니다.

## 시각은 프레임 세기가 아니라 PTS에서 온다

영상 컨테이너는 모든 프레임의 표시 타임스탬프(PTS)를 정수 틱 수로 저장하며, 틱 하나의 길이를 나타내는 `time_base`를 함께 둡니다. 프레임의 초 단위 시각은 다음과 같습니다.

```text
 time_s = pts * time_base

 example: time_base = 1/30000 s, pts = 3003  ->  0.1001 s
```

많은 휴대폰 영상과 화면 녹화는 **가변 프레임 레이트**(VFR)를 가집니다. 프레임 길이가 서로 다릅니다. 이때 `frame_index / fps`로 계산하면 실제 시각에서 점점 벗어납니다. 그래서 트랙 형식은 FFmpeg/PyAV가 디코딩한 `pts_s`를 프레임마다 저장합니다([스키마](schemas.md) 참고). 합성 데모는 의도적으로 VFR을 사용합니다. `time_base` 1/30000 s에서 일곱 번째 프레임마다 1000틱 대신 1001틱 동안 지속됩니다([`frame_pts_ticks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py#L52-L58)).

이후 렌더러는 디코딩된 모든 프레임을 사용자의 `pts_s`와 대조합니다. [렌더링과 출력 안전성](rendering-safety.md)을 참고하세요.

## 입력 계약

[`validate_tracks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L33-L78)와 [`validate_review`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L81-L149)는 첫 번째 불일치에서 `InputError`를 발생시킵니다. 순서를 바꾸거나, 중복을 제거하거나, 고치는 일은 없습니다.

트랙(`shuttle-replay/tracks/v1`):

- `frame_id`는 정수이며 엄격하게 증가합니다. `pts_s`는 유한하며 엄격하게 증가합니다.
- `segment_id`는 하나의 연속된 카메라 샷을 가리킵니다. `null`은 카메라 컷, 클로즈업, 리플레이를 나타냅니다. 다른 구간 뒤에 다시 나타나는 구간 id는 거부되므로, 각 샷에는 고유한 id와 보정이 필요합니다.
- `shuttle`은 `null`(검출 없음)이거나 유한한 `u`와 `v`를 가집니다. 선수 박스는 유한한 숫자 네 개여야 합니다.

각 구간의 시간 범위는 첫 프레임과 마지막 프레임의 PTS입니다. 모든 구간에는 보정이 필요합니다([`validate_inputs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L152-L162)).

검토(`shuttle-replay/review/v1`):

- 타구 시점 id는 고유한 문자열입니다. 각 타구 시점은 해당 구간의 PTS 범위 안과 자신의 `time_bracket_s` 안에 있어야 하며, 이 구간의 폭은 최대 0.5 s입니다.
- 한 구간 안의 타구 시점은 목록 순서대로 시각이 엄격하게 증가합니다.
- `height_m`은 열린 구간 (0, 4) m 안에 있고 `height_sigma_m`은 양수입니다. 각 타구 시점에는 `image_px` 또는 `court_xy_m`이 필요합니다.
- 구간의 마지막 타구 시점만 `open` 또는 `landing_region` 유형의 `flight_ends` 항목을 가질 수 있습니다. 착지 구간(bracket)은 타구 시점 이후에 시작해야 하며, 영역의 `min`은 `max`보다 작아야 합니다. `open` 종료의 `until_s`는 타구 시점 뒤에 와야 하고 구간 안에 있어야 합니다.

## 근거와 검토

두 종류의 입력은 서로 다른 역할을 합니다.

- **관측된 근거**: 사용자의 검출 결과. 피팅에는 픽셀 잔차로만 들어가며 `shuttle_observed_px`에 그대로 복사됩니다. `shuttle: null`인 프레임은 모든 출력에서 `null`로 유지됩니다.
- **검토된 제약**: 타구 시점, 착지 영역, 보정 점. 타구 위치와 높이는 시그마로 가중된 사전값으로 들어가고, 착지 끝점은 고정된 페널티 스케일을 사용합니다. 보정 점은 카메라를 미리 결정합니다. 타구 시각은 고정되며, 착지 시각은 그 구간(bracket) 안에서 피팅됩니다.

검출이 없는 프레임을 모델이 채우면 그 프레임의 `layer`는 `conditional_model`이 되지만 `shuttle_observed_px`는 `null`로 유지됩니다. 테스트 `test_missing_detection_provenance_is_null_not_filled`가 정확히 이것을 확인합니다.

## 비행 분할

[`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L234)는 타구 시점을 구간별로 묶고 각 타구 시점을 비행 하나로 바꿉니다. 비행은 카메라 구간을 넘지 않습니다. 비행의 관측값은 검출이 있으면서 다음 조건을 만족하는 구간의 프레임입니다.

```text
 t0 + contact_guard_s  <  pts_s  <=  t_end - contact_guard_s     (followed by another contact)
 t0 + contact_guard_s  <  pts_s  <=  t_end                       (landing or open end)

 t0             reviewed contact time
 t_end          next contact time, landing bracket end, or min(segment end, until_s)
 contact_guard_s  default 0.02 s
```

가드는 셔틀콕이 라켓과 겹쳐 보이기 쉬운 타구 순간 바로 근처의 검출을 버립니다. 각 비행 기록의 `observation_frame_ids`와 `observation_time_offsets_s`는 어떤 프레임이 쓰였는지 정확히 보여 주며, 오프셋은 `t0`부터 측정됩니다.

## 모델 샘플링과 표시

세 가지 샘플링이 있으며, 첫 번째만 영상 프레임 단위입니다.

1. **프레임 단위.** 수락된 비행의 시간 범위 안에 있는 모든 프레임에서 `shuttle_model_xyz_m`은 그 프레임 자신의 PTS에서 계산한 모델 값이고, `shuttle_model_px`는 그것을 `P`로 투영한 값입니다([프레임 루프](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L293-L334)). 카메라 컷 프레임은 원시 검출이 있더라도(`raw_detection_ignored`) `layer: "excluded_camera_cut"`을 받으며 모델도 선수도 없습니다.
2. **피팅 내부.** 균등 간격 샘플 41개로 바닥과 네트 페널티를 검사하고, 샘플 201개를 수락 게이트에 사용합니다. [궤적 물리](trajectory-physics.md)를 참고하세요.
3. **표시.** 위에서 본 화면의 궤적은 **같은** 비행의 이전 프레임 단위 모델 샘플만 잇는 폴리라인입니다([`trail_for`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L36-L46)). `model_flight_id`가 다른 첫 프레임에서 멈추므로, 궤적이 두 비행을 잇거나 카메라 컷을 건너는 일은 없습니다. 이 선들은 데이터가 아니라 `display_interpolation`입니다.

## 실제로 검사하는 허용 오차

```text
 contact bracket width         <= 0.5 s                  inputs.py
 contact guard                 0.02 s (default)          analysis.py
 renderer PTS match            1e-3 s per frame          render.py
 ODE (simulate)                rtol 1e-7, atol 1e-8, max_step 0.02 s
 ODE (floor_crossing)          rtol 1e-9, atol 1e-10, max_step 0.01 s
 floor gate                    lowest point >= -0.02 m
 landing within_region         region widened by 1e-3 m
```

관련 문서: 모든 필드는 [스키마](schemas.md), 자신의 검출기로 트랙을 만드는 방법은 [워크플로](workflow.md)를 참고하세요.
