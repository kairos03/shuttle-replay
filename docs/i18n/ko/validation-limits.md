# 검증과 한계

`shuttle-replay`는 자신의 결과에 대해 많은 숫자를 보고합니다. 각 숫자는 좁은 질문 하나에 답합니다. 이 페이지는 각 검사마다 무엇을 보여 주는지, 무엇을 보여 주지 않는지, 저장소의 어떤 테스트가 그것을 실행하는지 설명합니다. 실제 영상에 대한 정확도나 속도 수치는 여기에 없습니다. 프로젝트가 그런 값을 측정한 적이 없기 때문입니다.

## 각 검사가 증명하는 것

**홀드아웃 지면 오차** (`heldout_summary`, [`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L175-L197)). 증명하는 것: 바닥 호모그래피가 피팅에 쓰이지 않은 코트 점을 예측한다는 것. 증명하지 않는 것: 높이, 네트 앵커, 셔틀콕에 관한 어떤 것도.

**네트 앵커 잔차와 민감도** (`net_anchor_residuals_px`, `net_anchor_sensitivity`). 앵커가 두 개이면 수직 열이 거의 정확히 결정되므로, 잔차는 구조상 거의 0에 가깝습니다. 민감도 값은 앵커 좌표 하나가 명시된 픽셀 불확실성만큼 움직일 때 네트 위 3 m의 기준점 하나가 얼마나 움직이는지 보여 줍니다. 이는 가정적 시나리오이며 신뢰 구간이 아닙니다. [카메라 보정](camera-calibration.md)을 참고하세요.

**재투영 오차** (`fit.reprojection_rms_px`, `reprojection_p90_px`, `reprojection_max_px`). 증명하는 것: 모델의 투영이 사용자의 2D 검출 가까이를 지난다는 것. 증명하지 않는 것: 3D 경로가 맞다는 것. 다른 깊이와 다른 속도가 거의 같은 픽셀로 투영될 수 있으며, 이것이 [궤적 물리](trajectory-physics.md)에서 설명한 과소결정입니다. 기본 수락 한도는 RMS 8.0 px입니다.

**바닥 게이트와 네트 게이트** (`gates`, [`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106)). 통과는 샘플링된 201개 높이가 모두 −0.02 m 이상이고, 인접 샘플 사이에서 보간해 검출한 모든 통과가 1.524 m 이상이며, 필요할 때 통과가 일어났다는 것을 보여 줍니다. 이 검사들은 일반적인 물리적 타당성이나 실제 환경에서의 정확도를 입증하지 않습니다.

**`parameters_at_bound`와 `optimizer_success`**. 수렴하지 않은 피팅은 거부됩니다. 일곱 개의 상태/공기 저항 파라미터는 경계까지의 거리가 허용 범위의 0.1% 미만이면 표시됩니다. 표시된 피팅은 거부됩니다. 착지 시각은 이 진단에 포함되지 않습니다. 통과했다고 해서 식별 가능성, 유일성, 또는 사전값 영향이 없음이 입증되지는 않습니다.

**미디어 검사** (렌더 보고서). 증명하는 것: 모든 원본 프레임이 인덱스와 PTS로 대응되었고, 출력이 올바른 프레임 수로 디코딩되며, 오디오 패킷이 시각을 유지했다는 것. 증명하지 않는 것: PTS 일치 자체를 넘어, 사용자의 `pts_s`가 검출에 사용한 바로 그 파일에서 왔다는 것.

**합성 복원** (`demo`, `synthetic_recovery.json`). `synthetic_recovery.json`은 합성 정답과의 비교를 보고합니다. 테스트는 특정 합성 사례에 대해 선택된 복원 허용 오차를 검사합니다. 보고서를 생성하는 것만으로는 그 허용 오차가 강제되지 않습니다. 둘 다 실제 영상에서의 정확도를 보여 주지 않습니다. 파일의 `label`이 이를 밝힙니다: "SYNTHETIC ground-truth recovery; not evidence of accuracy on real video".

## 불확실성이 정성적으로만 표현되는 부분

피팅에는 시그마가 있지만 출력은 그것을 오차 막대로 바꾸지 않습니다. 위치, 속도, 착지점에 대한 공분산도, 부트스트랩도, 신뢰 구간도 없습니다. 대신 불확실성은 라벨로 표현됩니다. 모든 분석 파일에 있는 `conditional_model`, `exact_coordinate_measured: false`, `speed_scope`, 그리고 `assumptions` 목록입니다([`ASSUMPTIONS`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L39-L46)). 5 km/h 단위의 대략적인 속도 반올림은 표시 방식일 뿐 오차 추정이 아닙니다.

## 다른 무엇이 아닌 이유

- **실측 3D가 아닙니다.** 카메라 한 대는 점이 아니라 광선을 줍니다. 깊이는 물리 모델과 사용자가 검토한 타구 시점에서 나옵니다.
- **조밀한 깊이가 아닙니다.** 픽셀 단위 깊이 맵도, 학습된 깊이 신경망도 없습니다. 피팅된 비행 위의 셔틀콕만 3D 위치를 얻습니다.
- **자동 IN/OUT 판정이 아닙니다.** `landing.inside_court`는 모델 점을 코트 바깥 경계와 비교합니다. 그 점은 사용자가 그린 영역 쪽으로 부드럽게 당겨지므로 답은 대부분 사용자의 검토를 반영합니다. 영역 포함 여부는 엄격한 수락 요건이 아닙니다(`landing.within_region`이 1 mm 허용치로 보고합니다). 라인 판정 로직도, 단식/복식 규칙도, 셔틀콕이 닿은 위치의 측정도 없습니다.

## 디버깅 순서

비행이 이상해 보이면 파이프라인의 아래쪽부터 위로 읽으세요.

1. **보정.** `heldout_summary` 오차가 크거나 `max_vertical_shift_m`이 크면 점이나 앵커부터 고치세요. 이후 단계에서는 복구할 수 없습니다.
2. **입력.** `observation_frame_ids`와 `first_observation_delay_s`: 구간에 예상한 검출이 들어 있나요?
3. **상태.** `insufficient_observations`는 검출이 너무 적다는 뜻입니다. `rejected_by_gates_or_fit`이면 다음 두 항목을 보세요.
4. **피팅.** `optimizer_success`, `parameters_at_bound`, 재투영 RMS와 최댓값. RMS는 낮은데 최댓값 하나가 매우 크다면 나쁜 검출 하나를 가리킵니다.
5. **게이트.** `minimum_height_m`, `net_crossing_required`, `net_crossing_occurred`, `net_crossing_height_m`. 네트 게이트 실패는 타구 시점이 잘못된 쪽에 있거나 타구 높이가 틀린 경우가 많습니다.
6. **렌더 보고서.** PTS 불일치나 프레임 수 오류는 트랙이 바로 이 영상의 디코딩 결과에 속하지 않는다는 뜻입니다.

## 근거 지도

| 주장 | 테스트 |
| --- | --- |
| 홀드아웃 점을 별도로 보고하고 `H`를 Z=0 전용으로 표시 | `test_calibration_recovers_camera_and_reports_heldout_separately` |
| 잘못된 보정 입력 거부 | `test_calibration_rejects_invalid_inputs`, `test_calibration_rejects_collinear_fit_points` |
| 일관되지 않은 트랙이나 검토는 고치지 않고 거부 | `test_inconsistent_inputs_are_rejected_not_repaired`, `test_missing_segment_calibration_is_rejected` |
| 첫 검출이 아니라 타구 시점이 시각 0 | `test_delayed_first_observation_keeps_contact_as_time_zero` |
| 비행은 한 구간 안에 머묾 | `test_flights_never_bridge_camera_segments` |
| 빠진 검출은 null로 유지 | `test_missing_detection_provenance_is_null_not_filled` |
| 착지는 측정이 아니라 제약 | `test_landing_region_is_a_constraint_not_a_measurement` |
| 가로채인 비행은 착지를 강제하지 않음 | `test_intercepted_flight_is_not_forced_to_land` |
| 네트 게이트와 바닥 게이트 | `test_physical_gates_reject_net_and_floor_violations`, `test_actual_low_net_crossing_rejected_without_expected_crossing` |
| 경계에 고정된 피팅 거부, `until_s` 구간 | `test_open_flight_window_and_bound_pinned_fits` |
| 코트 라인 중심 | `test_court_lines_are_line_centres_of_40mm_lines_inside_outer_boundary` |
| PTS와 프레임 수 검사, 악의적인 파일 이름 | `test_render_rejects_mismatched_pts_and_handles_hostile_filename` |
| 궤적은 한 비행 안에 머묾 | `test_trails_stay_inside_one_flight_and_segment` |
| 원본이나 기존 파일을 덮어쓰지 않음 | `test_render_never_overwrites_source_or_existing_files`, `test_cli_rejects_output_aliasing_inputs` |
| 오디오 오프셋과 공백 유지 | `test_audio_is_stream_copied_with_source_relative_offset` |
| 처음부터 끝까지의 데모 산출물 | `test_demo_end_to_end_creates_verified_artifacts`, `test_run_command_from_existing_inputs` |

모든 테스트는 [`tests/`](https://github.com/KAIROS03/shuttle-replay/tree/6e9a060b5cc964f02d4017d806e953ffea89c8b4/tests)에 있습니다. 대부분의 비행 테스트는 [`synthetic.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py)의 합성 장면에서 실행되므로, 실제 환경의 정확도가 아니라 동작과 계약을 확인합니다. 테스트가 다루지 않는 것: 도구가 모델링하지 않는 렌즈 왜곡, 그리고 테스트에 사용된 AAC 이외의 오디오 코덱.

관련 문서: 한계 목록은 [워크플로](workflow.md), 결과 읽는 방법은 [사용자 가이드](guide.md)를 참고하세요.
