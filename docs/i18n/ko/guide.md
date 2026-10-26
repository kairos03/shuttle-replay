# shuttle-replay 사용자 가이드 (v0.1)

`shuttle-replay`는 로컬 영상, 미리 만들어 둔 검출 결과, 사람이 검토한 주석으로 배드민턴 셔틀콕 리플레이를 만드는 오프라인 도구입니다. 카메라를 보정하고, 중력과 2차 공기 저항을 포함한 비행 모델을 2D 검출 좌표에 맞추고, 원본 영상과 위에서 본 코트를 6:4로 나란히 배치한 MP4를 만듭니다.

이 도구는 연구와 검토용입니다. 인/아웃 라인 판정 시스템, 샷 분류기, 셔틀콕 검출기, 실측 스피드건이 아닙니다. 출력에 있는 모든 3D 위치와 속도는 사용자의 보정과 주석을 전제로 한 조건부 모델 값입니다.

## 설치

Python 3.12 이상과 [uv](https://docs.astral.sh/uv/)가 필요합니다.

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

PyAV wheel에 FFmpeg가 들어 있으므로 시스템 FFmpeg는 필요하지 않습니다.

## 합성 데모

```bash
uv run shuttle-replay demo --out-dir demo
```

가상 카메라 두 대, 전환 구간, 빠진 검출을 섞은 합성 랠리를 만든 뒤 보정 → 분석 → 렌더링을 처음부터 끝까지 실행합니다. `demo/synthetic_recovery.json`의 값은 합성 정답값과 비교한 것이므로 실제 영상에서의 정확도를 나타내지 않습니다.

## 내 영상 사용하기

1. **검출 결과(`tracks.json`)**: 디코딩된 프레임마다 한 행씩, 그 프레임의 실제 PTS(초), 카메라 구간 id(전환 구간과 클로즈업 구간은 `null`), 셔틀콕 픽셀 좌표(없으면 `null`), 선택 사항인 선수 박스를 적습니다. `frame_id`는 디코딩 순서와 일치해야 합니다. 형식은 [docs/schemas.md](schemas.md)를 참고하세요.
   v0.1에는 검출기가 없습니다. TrackNetV3 (MIT)나 Ultralytics YOLO (AGPL-3.0)를 직접 실행해 결과를 변환할 수는 있지만 변환 스크립트는 포함되어 있지 않습니다. 모델 가중치는 내려받지 않습니다.
2. **보정 입력**: 카메라 구간마다 코트 라인 교차점 네 개 이상(`fit`), 검증용 교차점 몇 개(`heldout`), 네트 기둥 꼭대기 두 개(높이 1.55 m)를 픽셀로 표시합니다.

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   먼저 `heldout_summary`(맞춤에 쓰지 않은 점에서의 오차)와 `net_anchor_sensitivity`(네트 기둥을 주어진 픽셀 오차만큼 옮겼을 때 높이가 얼마나 움직이는지)를 확인하세요. 바닥 호모그래피는 바닥(Z=0) 위의 점에만 쓰이며 공중에 있는 셔틀콕에는 절대 쓰이지 않습니다.
3. **검토 주석(`review.json`)**: 라켓 타구 시각(`time_s`), 그 시각을 포함하는 검토 구간(`time_bracket_s`), 타구 픽셀, 높이 추정값을 입력합니다. 타구 시각이 그 비행의 0초입니다. 첫 검출이 늦게 나와도 0초는 바뀌지 않습니다.
   종료 조건을 가질 수 있는 것은 구간의 마지막 타구뿐입니다. `landing_region`(셔틀콕이 바닥에 닿는 영역과 시간 구간) 또는 `open`(구간의 마지막 관측까지, 또는 검토한 `until_s`까지)입니다. 그 밖의 비행은 다음 타구에서 끝나며 바닥에 닿도록 강제되지 않습니다. v0.1은 타구 시각을 자동으로 고치지 않으므로 프레임을 보면서 직접 고치세요.
4. **분석과 렌더링**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # 한 번에:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   `# 한 번에:` 주석은 "한 단계로 모두:"라는 뜻이며, `run`은 분석과 렌더링을 함께 수행합니다.

   PTS가 뒤로 가거나, 같은 카메라 구간이 간격을 두고 다시 나타나거나, 타구가 해당 카메라 구간이나 검토 구간 밖에 있거나, 영상 PTS와 트랙 PTS가 다르면 도구는 종료 코드 2로 멈춥니다. 입력을 몰래 고치는 일은 없습니다.

## 결과 읽는 법

- 초록색 원: 주어진 그대로의 입력 검출 좌표입니다. 검출이 없는 프레임은 비워 둡니다.
- 주황색 원/점: 조건부 물리 모델입니다. 같은 카메라 구간, 같은 비행 안에서만 그립니다.
- 파란 점선 상자: 사람이 지정한 착지 영역입니다. × 표시는 그 영역을 조건으로 맞춘 모델 착지점이며 실측 좌표가 아닙니다.
- 속도는 모델의 초속을 5 km/h 단위로 반올림한 값입니다.
- 받아친 비행의 경우 "받아치지 않았다면 떨어졌을 위치"는 JSON에만 기록됩니다(`unreturned_floor_crossing_prediction`, 반사실적 예측).
- 원본에 오디오가 있으면 오디오 패킷을 다시 인코딩하지 않고 그대로 복사하므로 원본 오디오의 시작 지연과 빈 구간이 보존됩니다. 오디오를 MP4로 복사할 수 없거나 타이밍이 바뀌게 되면 렌더링은 실패합니다. 검증을 위해 출력 파일을 끝까지 디코딩한 결과는 `render_report.json`에 기록됩니다.
- 기존 파일은 절대 덮어쓰지 않습니다. 출력 파일이 이미 있거나 원본 영상과 같은 파일이면 도구는 멈추며, 렌더링은 임시 파일에 쓴 뒤 검증이 끝나야 최종 이름으로 옮깁니다.

## 라이선스

GNU AGPL-3.0 only. [LICENSE](../LICENSE)와 [NOTICE.md](../NOTICE.md)를 참고하세요.
