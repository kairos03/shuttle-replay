<p align="center">
  <img src="docs/assets/header.svg" alt="shuttle-replay" width="100%">
</p>

<p align="center"><b>로컬 배드민턴 영상, 직접 준비한 검출 결과, 직접 검토한 내용을 나란히 보는 코트 리플레이로 만듭니다. 오프라인으로.</b></p>

<p align="center">
  <a href="https://github.com/kairos03/shuttle-replay/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/kairos03/shuttle-replay/ci.yml?branch=main&style=flat-square&label=CI" alt="CI"></a>
  <img src="https://img.shields.io/badge/python-3.12%2B-3776ab?style=flat-square" alt="Python 3.12+">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-c6f04a?style=flat-square" alt="AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/runs-offline-0d2a1f?style=flat-square" alt="Offline">
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ru.md">Русский</a> | <a href="README.ko.md">한국어</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.de.md">Deutsch</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.it.md">Italiano</a>
</p>

<p align="center">
  <a href="#quick-start">빠른 시작</a> |
  <a href="#workflow">작업 흐름</a> |
  <a href="#user-guide">사용 가이드</a> |
  <a href="docs/schemas.md">입력 형식 (영어)</a> |
  <a href="https://kairos03.github.io/shuttle-replay/ko/">문서</a> |
  <a href="https://kairos03.github.io/shuttle-replay/demo/">웹 데모</a>
</p>

## 개요

`shuttle-replay`는 사용자가 검토한 코트 지점으로 카메라를 보정하고, 사용자가
제공한 2D 셔틀콕 검출 결과에 중력 + 2차 항력 비행 모델을 피팅한 뒤, 원본 영상
옆에 코트 탑뷰를 배치한 MP4를 렌더링합니다.

이 도구는 연구와 검토용입니다. 인/아웃 판정 시스템, 샷 분류기, 셔틀콕 검출기,
3D 속도를 실측하는 스피드건이 아닙니다. 모든 3D 위치와 속도는 사용자의 보정과
주석에 따라 달라지는 조건부 모델 출력입니다.

## 설치

Python 3.12+ 와 [uv](https://docs.astral.sh/uv/)가 필요합니다.

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

PyAV 휠에 FFmpeg가 포함되어 있어 시스템 FFmpeg는 필요하지 않습니다.

## 왜 쓰는가

- **완전 오프라인.** 검출기도, 모델 가중치도, 네트워크 호출도 없습니다.
- **사람의 검토가 우선.** 타구 시점, 착지 영역, 보정 지점은 사용자가 정합니다. 아무것도 몰래 보정하지 않습니다.
- **정직한 레이어 구분.** 관측된 픽셀, 사용자의 검토, 조건부 모델이 출력에서 분리되어 있습니다.
- **안전한 렌더링.** 원본 오디오는 재인코딩 없이 스트림 복사되며, 기존 파일은 절대 덮어쓰지 않습니다.

<a id="quick-start"></a>
## 빠른 시작

```bash
uv run shuttle-replay demo --out-dir demo
```

`demo/inputs/`(합성 영상, 트랙, 검토, 보정 입력), `demo/calibration.json`,
`demo/analysis.json`, `demo/replay.mp4`, `demo/render_report.json`,
`demo/synthetic_recovery.json`을 생성합니다.

<p align="center">
  <img src="docs/assets/demo.gif" alt="합성 데모 리플레이: 원본 화면 옆에 코트 탑뷰" width="90%">
  <br><sub><code>demo</code>로 생성한 합성 시연입니다. 실제 환경의 정확도를 나타내지 않습니다.</sub>
</p>

### 웹 데모 (브라우저 전용)

문서 사이트와 함께 <https://kairos03.github.io/shuttle-replay/demo/> 에 대화형 뷰어를
게시합니다. 실제 파이프라인으로 만든 합성 샘플(`web/build_sample.py`, 실제 영상 아님)을
바로 보여 주며, 로컬 영상과 그 `analysis.json`을 업로드 없이 열 수 있습니다. 로컬에서 볼
때는 영상 탐색에 필요한 Range 요청을 지원하는 서버를 쓰세요(`python -m http.server`는
지원하지 않음):

```bash
node web/serve.mjs        # http://127.0.0.1:8000/shuttle-replay/demo/
```

시간 맞춤, 테스트, 샘플 재생성은 [web/README.md](web/README.md)를 참고하세요.

<a id="workflow"></a>
## 작업 흐름

직접 촬영한 영상에 사용하려면 다음을 준비해야 합니다.

- **검출 결과** (`tracks.json`): 디코딩된 프레임마다 항목 하나. PTS, 카메라
  세그먼트 id, 셔틀콕 픽셀 또는 null, 선택 사항인 선수 박스를 담습니다.
  내장 검출기는 없습니다.
- **보정 입력**: 세그먼트마다 최소 4개의 `fit` 코트 지점, 몇 개의 `heldout`
  지점, 양쪽 네트 기둥 꼭대기(1.55 m).
- **검토** (`review.json`): 사용자가 검토한 타구 시각, 픽셀, 높이와 선택 사항인
  착지 영역. 타구 시점은 자동으로 찾지 않습니다.

```bash
uv run shuttle-replay calibrate calibration_input.json -o calibration.json
uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
    --calibration calibration.json --out-dir out
```

<a id="user-guide"></a>

<details>
<summary><b>내 영상에 적용하는 단계별 가이드</b></summary>

1. **검출 결과.** 디코딩된 프레임마다 `tracks.json` 항목을 하나씩 만듭니다.
   프레임의 PTS, 카메라 세그먼트 id(화면 전환이나 클로즈업은 null), 셔틀콕 픽셀
   (또는 null), 선택 사항인 선수 박스를 넣습니다. [docs/schemas.md](docs/schemas.md)(영문)를
   참고하세요. 어떤 트래커든 쓸 수 있습니다. 예를 들어 셔틀콕에는 TrackNetV3(MIT),
   선수에는 Ultralytics YOLO 모델(AGPL-3.0)을 각자의 체크포인트로 직접 실행하고
   그 출력을 변환하면 됩니다. 변환 스크립트는 v0.1에 포함되지 않습니다.
2. **보정 입력.** 카메라 세그먼트마다 코트 라인 교차점을 4개 이상(역할 `fit`),
   추가로 몇 개를 `heldout`으로, 그리고 두 네트 기둥 꼭대기(1.55 m)를 측정합니다.

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   다음 단계로 가기 전에 `heldout_summary`와 `net_anchor_sensitivity`를 확인하세요.
3. **검토.** `review.json`을 작성합니다. 검토한 구간 안의 타구 시각, 타구 픽셀과
   높이 사전값, 그리고 세그먼트의 마지막 비행에는 선택 사항인 착지 영역 또는 `open`을 넣습니다.
4. **분석과 렌더링.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   입력이 일관되지 않으면(단조 증가하지 않는 PTS, 연속되지 않는 세그먼트, 세그먼트나
   구간을 벗어난 타구, 영상과 맞지 않는 PTS 등) 종료 코드 2와 메시지를 내고 멈춥니다.
   아무것도 몰래 보정하지 않습니다.

</details>

<details>
<summary><b>각 명령이 하는 일</b></summary>

- **보정** (`calibrate`): 검토한 바닥 지점 4개 이상으로 호모그래피를 구하고,
  높이가 있는 네트 앵커 2개 이상으로 카메라의 수직 열을 구합니다. 홀드아웃 바닥
  지점은 피팅에 절대 쓰지 않고 별도로(픽셀과 미터 단위로) 보고합니다. 퇴화된 입력,
  중복, 공선 입력, 유한하지 않은 값은 거부합니다. 바닥 호모그래피는 공중 지점에
  절대 쓰지 않습니다.
- **분석** (`analyze`): 검토한 타구마다 비행 하나를 만들며, 첫 검출이 늦게 나와도
  검토한 타구 시점(시간 0)부터 시간을 잽니다. 원본 PTS, 프레임 id, 카메라 세그먼트
  id를 사용합니다. 카메라 전환 구간은 제외하며 비행이 세그먼트를 넘어가지 않습니다.
  각 비행은 다음 타구(가로채기, 강제로 착지시키지 않음), 검토한 착지 영역(측정 좌표가
  아닌 제약 조건), 또는 세그먼트의 마지막 관측에서 끝납니다. 바닥과 네트 게이트가
  불가능한 피팅을 거부합니다. 비행이 가로채진 경우, 원래 도달*했을* 바닥 지점은
  반사실적 값으로 따로 보고합니다. 누락된 검출은 null로 남습니다.
- **렌더링** (`render`): 디코딩된 모든 원본 프레임을 트랙 PTS와 대조해 검증하고,
  제공된 선수 박스, 관측된 셔틀콕 링(초록), 모델 링(주황), 그리고 원본과 탑뷰를
  6:4로 배치한 레이아웃의 코트 탑뷰를 그립니다. 카메라 전환 프레임에는 셔틀콕
  오버레이를 그리지 않습니다. 원본 오디오 패킷은 변경 없이 스트림 복사되므로(재인코딩
  없음) 원본 오디오의 시작 오프셋과 공백이 유지됩니다. 오디오를 MP4로 복사할 수 없거나
  타이밍이 바뀌면 렌더링은 실패합니다. 파일 이름으로 셸 명령을 만들지 않습니다. 출력은
  절대 덮어쓰지 않습니다. 출력이 이미 있거나 원본과 같은 파일을 가리키면 렌더링이
  실패하고, 고유한 임시 파일에 쓴 뒤 전체 디코딩 검사를 통과해야만 게시합니다.
- **데모** (`demo`): 완전히 합성된 랠리(가상 카메라 2대, 카메라 전환 1회, 공백이 있는
  노이즈 섞인 검출, 테스트 톤)를 생성하고, 합성 정답 복원 보고서를 포함해 전체
  파이프라인을 실행합니다.

</details>

<details>
<summary><b>출력 읽는 법</b></summary>

| 레이어 | 의미 |
| --- | --- |
| `observed_pixel` | 제공된 검출 결과 그대로. 없으면 null |
| `human_review` | 사용자의 타구, 착지 영역, 보정 지점 |
| `conditional_model` | 사용자의 사전값 아래에서 관측 픽셀에 피팅한 물리 모델 |
| `display_interpolation` | 렌더러가 그리기만 하는 선과 마커 |

속도는 피팅된 모델의 초기 속도입니다(`model_speed_km_h`, 5 km/h 단위로 반올림해
표시). 대략적인 모델 값으로만 보세요.

</details>

<details>
<summary><b>한계</b></summary>

- 셔틀콕이나 선수 검출 기능이 없습니다. 검출 결과는 사용자가
  [tracks 형식](docs/schemas.md)(영문)으로 제공합니다. 모델 가중치는 내려받지 않습니다.
- 타구 시점 자동 탐지나 타구 타임스탬프 보정이 없습니다.
- 학습된 조밀 깊이 맵, 학습된 샷 라벨, 자동 IN/OUT 판정이 없습니다.
- 3D 출력은 측정값이 아니라 조건부 값입니다. 재투영 오차가 낮다는 것은 2D 검출과
  일관된다는 뜻일 뿐, 3D 정확도를 독립적으로 증명하지 않습니다. 합성 복원 결과는
  합성 데이터에 대한 결과입니다.

</details>

<details>
<summary><b>개발</b></summary>

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

</details>

<details>
<summary><b>라이선스</b></summary>

GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). 제3자 고지는
[LICENSE](LICENSE)와 [NOTICE.md](NOTICE.md)를 참고하세요.

</details>
