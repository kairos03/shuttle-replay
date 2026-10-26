# 시작하기

## 설치

Python 3.12+와 [uv](https://docs.astral.sh/uv/)가 필요합니다.

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

PyAV wheel에 FFmpeg가 포함되어 있으므로 시스템 FFmpeg는 필요하지 않습니다.

## 빠른 시작

```bash
uv run shuttle-replay demo --out-dir demo
```

이 명령은 `demo/inputs/`(합성 영상, 트랙, 검토, 보정 입력), `demo/calibration.json`, `demo/analysis.json`, `demo/replay.mp4`, `demo/render_report.json`, `demo/synthetic_recovery.json`을 만듭니다.

이 데모는 전부 합성 데이터입니다. 가상 카메라 두 대, 카메라 전환 한 번, 빈 구간과 노이즈가 있는 검출 결과, 테스트 톤으로 구성됩니다. 복원 보고서는 합성 정답값과만 비교하므로 실제 영상에서의 정확도에 대해서는 아무것도 말해 주지 않습니다.

다음: [내 영상으로 실행하기](workflow.md).
