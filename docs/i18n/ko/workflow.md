# 워크플로

## 준비할 것

- **검출 결과**(`tracks.json`): 디코딩된 프레임마다 항목 하나씩, PTS, 카메라 구간 id, 셔틀콕 픽셀 또는 null, 선택 사항인 선수 박스를 담습니다. 내장 검출기는 없습니다. [](schemas.md)를 참고하세요.
- **보정 입력**: 구간마다 최소 4개의 `fit` 코트 점, 몇 개의 `heldout` 점, 양쪽 네트 기둥 꼭대기(1.55 m).
- **검토**(`review.json`): 검토한 타구 시각, 픽셀, 높이와 선택 사항인 착지 영역. 타구는 자동으로 찾지 않습니다.

검출 결과는 어떤 트래커로 만들어도 됩니다. 예를 들어 자신의 체크포인트로 셔틀콕에는 TrackNetV3 (MIT), 선수에는 Ultralytics YOLO 모델 (AGPL-3.0)을 직접 실행하고 출력을 변환할 수 있습니다. 변환 스크립트는 v0.1에 포함되어 있지 않습니다.

## 단계

1. **보정.** 카메라 구간마다 코트 라인 교차점 ≥ 4개(역할 `fit`), `heldout`용으로 몇 개 더, 그리고 네트 기둥 꼭대기 두 개를 측정합니다.

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   다음으로 넘어가기 전에 `heldout_summary`와 `net_anchor_sensitivity`를 확인하세요.
2. **검토.** `review.json`을 작성합니다. 검토한 구간 안의 타구 시각, 타구 픽셀과 높이 사전값, 그리고 구간의 마지막 비행에는 선택 사항인 착지 영역 또는 `open`을 적습니다.
3. **분석과 렌더링.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   일관되지 않은 입력(단조 증가하지 않는 PTS, 연속되지 않은 구간, 구간이나 검토 구간 밖의 타구, 영상과 맞지 않는 PTS 등)은 메시지와 함께 종료 코드 2로 멈춥니다. 몰래 고쳐지는 것은 없습니다.

## 각 명령이 하는 일

- **`calibrate`**: 검토한 바닥 점 ≥ 4개로 호모그래피를 구하고, 바닥에서 떨어진 네트 앵커 ≥ 2개로 카메라 행렬의 수직 열을 구합니다. 홀드아웃 바닥 점은 맞춤에 절대 쓰이지 않고 따로 보고됩니다. 퇴화된 입력, 중복 입력, 한 직선 위에 있는 입력, 유한하지 않은 입력은 거부됩니다. 바닥 호모그래피는 공중의 점에 절대 쓰이지 않습니다.
- **`analyze`**: 검토한 타구마다 비행 하나를 만들고, 검토한 타구 시점부터 시간을 잽니다. 카메라 전환은 제외되며 비행이 구간을 넘나들지 않습니다. 각 비행은 다음 타구, 검토한 착지 영역(실측 좌표가 아닌 제약 조건), 또는 구간의 마지막 관측에서 끝납니다. 바닥과 네트 게이트가 실현 불가능한 맞춤을 거부합니다. 빠진 검출은 null로 남습니다.
- **`render`**: 디코딩한 모든 원본 프레임을 트랙 PTS와 대조해 검증하고, 제공된 선수 박스, 관측된 셔틀콕 원(초록색), 모델 원(주황색), 위에서 본 코트를 6:4 레이아웃으로 그립니다. 원본 오디오는 다시 인코딩하지 않고 스트림 복사합니다. 기존 출력은 절대 덮어쓰지 않습니다.
- **`demo`**: 합성 랠리를 만들고 전체 파이프라인을 실행합니다.

## 출력 읽는 법

| 레이어 | 의미 |
| --- | --- |
| `observed_pixel` | 제공된 검출 결과 그대로, 없으면 null |
| `human_review` | 사용자의 타구, 착지 영역, 보정 점 |
| `conditional_model` | 사용자의 사전값 아래에서 관측 픽셀에 맞춘 물리 모델 |
| `display_interpolation` | 렌더러가 그리기만 하는 선과 마커 |

속도는 맞춘 모델의 초속입니다(`model_speed_km_h`, 5 km/h 단위로 반올림해 표시). 측정값이 아니라 대략적인 모델 값으로 취급하세요.

## 한계

- 셔틀콕이나 선수 검출이 없고 포함된 가중치도 없습니다.
- 타구 자동 찾기나 타구 타임스탬프 보정이 없습니다.
- 학습된 조밀 깊이 맵, 학습된 샷 레이블, 자동 IN/OUT 판정이 없습니다.
- 3D 출력은 조건부 값이며 실측값이 아닙니다. 합성 복원 결과는 합성 데이터에서의 결과일 뿐입니다.
