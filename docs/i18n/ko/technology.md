# 기술 개요

`shuttle-replay`는 세 종류의 근거를 리플레이로 바꿉니다. 로컬 원본 영상, 사용자가 제공한 2D 셔틀콕 검출 결과, 그리고 사람이 검토한 제약 조건(보정 점, 타구 시점, 착지 영역)입니다. 이 페이지는 전체 지도입니다. 뒤따르는 다섯 페이지가 각 단계를 깊이 있게 설명하며, 모든 페이지는 설명하는 소스 코드의 정확한 줄로 링크합니다. 링크는 커밋 `6e9a060b5cc964f02d4017d806e953ffea89c8b4`에 고정되어 있습니다.

## 데이터 흐름

```text
 source video (local file) ----------------------------------------+
                                                                   |
 calibration input JSON --> calibrate --> calibration JSON         |
 (ground points + net anchors)              (P, H, errors)         |
                                                 |                 |
 tracks JSON (your detections, PTS) -------------+                 |
 review JSON (contacts, flight ends) ------------+                 |
                                                 v                 v
                                       analyze --> analysis JSON --> render --> replay MP4
                                                                         +--> render report JSON
```

CLI는 각 화살표를 명령으로 제공합니다. `calibrate`, `analyze`, `render`, 그리고 `run`(analyze와 render를 한 번에 수행)입니다. `demo`는 완전히 합성된 장면을 만들고 그 위에서 같은 파이프라인을 실행합니다([`cli.py` `build_parser`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L154-L191)). `run`에서는 `analysis.json`과 `render_report.json`을 쓰기 전에 영상을 렌더링하고 검증합니다. 따라서 JSON 결과가 실패한 영상을 설명하는 일은 없습니다([`_run_pipeline`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L55-L63)).

각 단계가 더하는 것:

1. **보정**은 알려진 코트 점의 검토된 픽셀 위치를 카메라 구간마다 바닥 호모그래피 `H`와 3x4 카메라 행렬 `P`로 바꿉니다. [카메라 보정](camera-calibration.md)을 참고하세요.
2. **입력 검증**은 타임스탬프, 구간, 타구 시점, 비행 종료를 확인하고, 불일치를 고치지 않고 거부합니다. [관측과 타이밍](observations-timing.md)을 참고하세요.
3. **비행 피팅**은 검토된 타구 시점 사이의 2D 검출 결과에 중력과 2차 공기 저항 모델을 맞춥니다. [궤적 물리](trajectory-physics.md)를 참고하세요.
4. **렌더링**은 원본을 디코딩하고, 오버레이와 위에서 본 코트를 그리고, 오디오 패킷을 복사하고, 결과를 게시하기 전에 검증합니다. [렌더링과 출력 안전성](rendering-safety.md)을 참고하세요.
5. **검증**은 모든 단계에 걸쳐 있습니다. 각 검사가 무엇을 증명하고 무엇을 증명하지 않는지는 [검증과 한계](validation-limits.md)에 모아 두었습니다.

## 소프트웨어 스택

| 구성 요소 | 이 프로젝트에서의 역할 |
| --- | --- |
| Python 3.12+ | 언어. `pyproject.toml`의 `requires-python = ">=3.12"` |
| NumPy | 선형대수: 호모그래피 DLT, SVD, 투영, 앵커 최소제곱 풀이 |
| SciPy | `solve_ivp`로 비행 ODE를 적분하고, `least_squares`로 비행을 피팅 |
| PyAV (`av`) | 프로세스 내 FFmpeg 바인딩: 디코딩, 인코딩, 오디오 스트림 복사, 검증 |
| Pillow | 각 프레임에 링, 궤적, 코트, 텍스트를 그림 |
| uv | 잠긴 환경(`uv.lock`)을 설치하고 명령을 실행 |
| Sphinx + MyST + Furo | 이 문서 사이트를 빌드(`docs` 의존성 그룹) |

런타임 의존성은 정확히 `numpy`, `scipy`, `av`, `pillow`입니다([`pyproject.toml`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/pyproject.toml#L10-L15)). 파일 이름으로 서브프로세스나 셸 명령을 만드는 일은 없으며, 영상 작업은 같은 Python 프로세스 안에서 PyAV를 통해 처리됩니다([`render.py` 모듈 docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L1-L7)).

## 모델을 포함하지 않는 이유

프레임에서 셔틀콕을 찾는 일(검출)과 그것이 3D 공간 어디에 있는지 정하는 일(복원)은 서로 다른 문제입니다. 이 프로젝트는 두 번째 문제만 다루며, 그것도 명시적인 가정 아래에서만 다룹니다. 검출기도, 신경망도, 내려받을 모델 가중치도 없습니다. 신뢰하는 어떤 도구로든 만든 검출 결과를 [스키마](schemas.md)에 설명된 `shuttle-replay/tracks/v1` 형식으로 가져오면 됩니다.

이렇게 하면 모든 숫자를 추적할 수 있습니다. 각 분석 프레임은 셔틀콕 위치에 출처 계층을 붙입니다([`PROVENANCE`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L33-L38)).

- `observed_pixel`: 사용자의 검출 결과를 그대로 둔 것. 검출이 없으면 null입니다.
- `human_review`: 사람이 입력한 타구 시점, 착지 영역, 보정 점.
- `conditional_model`: 피팅된 물리 모델. 조건으로 삼은 보정과 검토만큼만 좋습니다.
- `display_interpolation`: 렌더러가 모델 샘플 사이에 그리는 선.

놓친 검출을 관측된 것처럼 채워 넣는 일은 없으며, 모델을 측정값으로 표시하는 일도 없습니다.

## 추천 읽기 순서

컴퓨터 비전이 처음이라면 다음 순서로 읽으세요.

1. [카메라 보정](camera-calibration.md): 픽셀이 미터와 어떻게 연결되는지, 그리고 카메라 한 대만으로는 왜 깊이를 볼 수 없는지.
2. [궤적 물리](trajectory-physics.md): 물리와 검토된 타구 시점이 빠진 깊이를 어떻게 채우는지.
3. [관측과 타이밍](observations-timing.md): 타임스탬프를 왜 프레임 카운터가 아니라 영상 컨테이너에서 가져오는지.
4. [렌더링과 출력 안전성](rendering-safety.md): MP4를 어떻게 만들고 보호하는지.
5. [검증과 한계](validation-limits.md): 진단값을 어떻게 읽고, 그 진단이 어디까지 유효한지.

직접 따라 해 보려면 [시작하기](getting-started.md), [사용자 가이드](guide.md), [워크플로](workflow.md)를 참고하세요.
