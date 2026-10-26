# shuttle-replay 사용 안내 (v0.1)

`shuttle-replay`는 로컬 영상, 이미 만들어 둔 검출 결과, 사람이 검토한 주석을
받아 배드민턴 셔틀 리플레이를 만드는 오프라인 도구입니다. 카메라를 보정하고,
중력과 2차 공기저항을 넣은 비행 모델을 2D 검출 좌표에 맞추고, 원본 영상과
위에서 본 코트 화면을 6:4로 나란히 놓은 MP4를 만듭니다.

이 도구는 연구 및 검토용입니다. 인/아웃 판정기, 샷 분류기, 셔틀 검출기, 실측
속도계가 아닙니다. 출력되는 3D 위치와 속도는 모두 보정값과 주석을 전제로 한
조건부 모델 값입니다.

## 설치

Python 3.12 이상과 [uv](https://docs.astral.sh/uv/)가 필요합니다.

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

PyAV 휠에 FFmpeg가 들어 있어 시스템 FFmpeg는 없어도 됩니다.

## 합성 데모

```bash
uv run shuttle-replay demo --out-dir demo
```

가상 카메라 두 대, 화면 전환 구간, 빠진 검출이 섞인 합성 랠리를 만들고
보정 → 분석 → 렌더링을 끝까지 실행합니다. `demo/synthetic_recovery.json`의
값은 합성 정답과 비교한 것이라 실제 영상의 정확도를 뜻하지 않습니다.

## 내 영상에 쓰기

1. **검출 결과 (`tracks.json`)**: 디코딩된 프레임마다 한 줄씩, 그 프레임의
   실제 PTS(초), 카메라 구간 id(전환 구간과 클로즈업 구간은 `null`), 셔틀 픽셀 좌표
   (없으면 `null`), 선택 사항인 선수 박스를 넣습니다. `frame_id`는 디코딩
   순서와 같아야 합니다. 형식은 [docs/schemas.md](schemas.md)를 보세요.
   v0.1에는 검출기가 없습니다. TrackNetV3(MIT)나 Ultralytics YOLO(AGPL-3.0)를
   직접 돌려 결과를 변환해 쓸 수 있지만, 변환 스크립트는 포함되어 있지
   않습니다. 모델 가중치는 내려받지 않습니다.
2. **보정 입력**: 카메라 구간마다 코트 선 교차점 4개 이상(`fit`), 검증용
   교차점 몇 개(`heldout`), 네트 기둥 꼭대기 두 점(높이 1.55 m)을 픽셀로
   찍습니다.

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   `heldout_summary`(학습에 쓰지 않은 점의 오차)와 `net_anchor_sensitivity`
   (네트 기둥을 지정한 픽셀 오차만큼 옮겼을 때 높이가 얼마나 흔들리는지)를
   먼저 확인하세요. 바닥 호모그래피는 바닥(Z=0) 점에만 쓰고, 공중의 셔틀에는
   절대 쓰지 않습니다.
3. **검토 주석 (`review.json`)**: 라켓 접촉 시각(`time_s`)과 그 시각이 들어
   있는 검토 구간(`time_bracket_s`), 접촉 픽셀과 높이 추정값을 넣습니다. 접촉
   시각이 비행의 0초입니다. 첫 검출이 늦게 나와도 0초는 바뀌지 않습니다.
   구간의 마지막 접촉에만 끝 조건을 줄 수 있습니다. `landing_region`(바닥에
   닿는 영역과 시간 구간)이나 `open`(구간 마지막 관측까지, 또는 검토한 `until_s`까지)입니다. 그 외의
   비행은 다음 접촉에서 끝나며 바닥에 닿도록 강제하지 않습니다. v0.1은 접촉
   시각을 자동으로 보정하지 않으니, 프레임을 보며 직접 고쳐 주세요.
4. **분석과 렌더링**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # 한 번에:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   PTS가 거꾸로 가거나, 같은 카메라 구간이 떨어져서 다시 나오거나, 접촉이
   카메라 구간이나 검토 구간 밖에 있거나, 영상 PTS와 tracks PTS가 다르면 종료 코드 2와
   함께 멈춥니다. 입력을 몰래 고치지 않습니다.

## 결과 읽기

- 초록 원: 입력된 검출 좌표 그대로. 검출이 없던 프레임은 비어 있습니다.
- 주황 원/점: 조건부 물리 모델. 같은 카메라 구간, 같은 비행 안에서만 그립니다.
- 파란 점선 상자: 사람이 지정한 착지 영역. × 표시는 그 영역을 조건으로 맞춘
  모델 착지점이며 실측 좌표가 아닙니다.
- 속도는 모델의 초기 속도를 5 km/h 단위로 반올림한 값입니다.
- 받아친 비행의 "받아치지 않았다면 떨어졌을 지점"은 JSON에만
  (`unreturned_floor_crossing_prediction`, 반사실 예측) 기록합니다.
- 원본에 오디오가 있으면 다시 인코딩하지 않고 오디오 패킷을 그대로 복사합니다.
  그래서 원본의 오디오 시작 지연과 빈 구간이 유지됩니다. MP4에 복사할 수 없거나
  타이밍이 바뀌면 렌더링을 실패로 끝냅니다. 출력 파일을 끝까지 디코딩해 확인한
  결과를 `render_report.json`에 남깁니다.
- 이미 있는 파일은 덮어쓰지 않습니다. 출력 파일이 이미 있거나 원본 영상과 같은
  파일이면 멈추고, 렌더링은 임시 파일에 쓴 뒤 검증이 끝나야 최종 이름으로 옮깁니다.

## 라이선스

GNU AGPL-3.0 only. [LICENSE](../LICENSE), [NOTICE.md](../NOTICE.md)를 보세요.
