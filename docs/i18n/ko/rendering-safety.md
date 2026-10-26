# 렌더링과 출력 안전성

렌더러는 리플레이 MP4를 만듭니다. 왼쪽에는 원본 프레임, 오른쪽에는 위에서 본 코트가 놓입니다. 렌더러에는 그리기 자체만큼 중요한 두 가지 일이 있습니다. 원본의 타이밍을 그대로 유지하는 것, 그리고 파일을 손상시키거나 덮어쓰지 않는 것입니다. 이 페이지의 모든 내용은 [`render.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py)에 있습니다.

## 디코딩, 그리기, 인코딩

PyAV는 Python 프로세스 안에서 FFmpeg 라이브러리를 감쌉니다. 렌더러는 원본을 열고, 첫 번째 비디오 스트림과 (있다면) 첫 번째 오디오 스트림을 가져와 파일 순서대로 패킷을 디먹싱합니다([`render`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L128-L279)).

```{figure} assets/technical/ko/render-pipeline.svg
:alt: 렌더 파이프라인: source.mp4를 디먹스하고, 비디오 패킷은 프레임 k로 디코드해 검사, 그리기, staging.mp4 인코드를 거치며, 오디오 패킷은 복사한다
:class: technical-figure
:width: 100%

소스 패킷에서 스테이징 파일까지 프레임별 경로.
```

디코딩된 모든 비디오 프레임 `k`에 대해, 그리기 전에 다음을 확인합니다.

- 분석에 프레임 `k`가 존재하고, 그 `frame_id`가 `k`와 같은지,
- 디코딩된 프레임에 PTS가 있는지,
- 디코딩된 시각과 분석의 `pts_s` 차이가 최대 `1e-3` s인지.

하나라도 실패하면 해당 프레임을 명시한 `RenderError`가 발생합니다. 마지막 패킷 뒤에는 디코딩된 프레임 수가 분석 프레임 수와 같아야 합니다.

인코딩은 로컬 FFmpeg 빌드가 열 수 있는 것을 기준으로 `libx264`, `h264`, `mpeg4` 순서로 시도하며, 픽셀 형식은 `yuv420p`입니다([`_open_encoder`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L77-L90)). 인코더는 원본 비디오의 `time_base`를 사용합니다. `mpeg4`에서 `time_base` 분모가 65535를 넘는 경우에만 1/60000 s로 대체합니다. 각 출력 프레임에는 원본 프레임의 시각을 그 `time_base`로 변환한 값이 부여되므로 가변 프레임 레이트는 가변으로 유지됩니다. 스트림을 만들 때 전달하는 `rate=30`은 명목상의 값이며, 프레임 시각은 원본에서 옵니다.

출력 비디오 타임스탬프는 인코더 틱 단위로 반올림됩니다. 검증은 출력 프레임 수를 확인하지만, 디코딩된 출력 비디오의 PTS를 하나하나 원본과 비교하지는 않습니다. 오디오 검증은 패킷 표시 시각과 첫 번째로 디코딩된 A/V 오프셋을 비교합니다([소스](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L213-L242)).

## 레이아웃

```{figure} assets/technical/ko/render-layout.svg
:alt: 출력 레이아웃 6:4: 왼쪽은 크기 변경 없는 소스 프레임(W x H), 오른쪽은 코트를 폭 4/6 W에 맞춘 탑뷰
:class: technical-figure
:width: 100%

출력 프레임: 소스 패널과 탑뷰의 폭 비율은 6:4.
```

`W`와 `H`는 원본의 너비와 높이를 짝수로 올림한 값입니다(H.264는 짝수 크기가 필요합니다). 위에서 본 화면의 너비는 `2 * round(W * 4 / 6 / 2)`입니다. 원본 프레임은 배율 1.0으로 왼쪽 위 모서리에 붙여지며, 올림 때문에 검은 픽셀 행이나 열이 최대 하나 추가됩니다. 위에서 본 화면([`TopView`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L49-L69))은 6.10 x 13.40 m 코트를 여백을 두고 패널에 맞게 축소하며, 코트의 비율을 유지합니다.

Pillow가 오버레이를 그립니다([`_compose`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L282-L336)).

- 초록색 링: 사용자의 검출(`shuttle_observed_px`);
- 주황색 링: 모델의 투영(`shuttle_model_px`);
- 트랙에 포함되어 있다면 선수 박스;
- 위에서 본 화면: 코트 라인, 네트, 현재 비행의 모델 궤적, 모델 높이에 따라 크기가 커지는 점, `z`, 그리고 대략적인 모델 속도;
- 착지 비행: 검토된 영역을 점선 사각형으로 표시하고, 착지 시각부터는 모델 착지점에 주황색 십자를 표시.

카메라 컷 프레임에는 "camera cut: excluded from replay"가 표시되고 셔틀콕 오버레이는 없습니다. 합성 입력이면 위에서 본 화면 제목에 `SYNTHETIC`이 붙습니다.

## 오디오: 재인코딩이 아닌 스트림 복사

오디오는 디코딩하거나 재인코딩하지 않습니다. 각 오디오 패킷은 원래 타임스탬프를 유지한 채 새 컨테이너로 복사됩니다(`add_stream_from_template` 후 `mux`). DTS가 없는 패킷은 건너뜁니다. 이렇게 하면 원본의 오디오 시작 오프셋과 공백이 유지됩니다. 실제 파일은 오디오가 비디오보다 몇 분의 1초 늦게 시작하는 경우가 많기 때문에 이것이 중요합니다.

스트림 복사는 MP4가 원본 오디오 코덱을 받아들일 때만 동작합니다. 스트림을 만들 수 없거나 패킷을 먹싱할 수 없으면 스트림 복사 실패를 설명하는 `RenderError`와 함께 렌더링이 실패합니다. 스트림 생성 오류에는 코덱이 포함됩니다. 재인코딩으로 대체하는 경로는 없으므로 모든 오디오 형식이 지원되지는 않습니다. 오디오가 없는 원본은 무음 MP4를 만들며, `"source has no audio stream; output is silent"`로 보고됩니다.

## 게시 전 검증

렌더러는 스테이징 파일에 쓰고, 출력 경로에 무엇이든 나타나기 전에 그 파일을 검사합니다.

1. [`verify_mp4`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L339-L361)는 스테이징 파일을 끝까지 디코딩합니다. 디코딩된 비디오 프레임 수는 분석 프레임 수와 같아야 합니다.
2. 오디오가 있으면 첫 오디오 시각에서 첫 비디오 시각을 뺀 값이 `1e-3` s 이내로 원본과 일치해야 합니다([`_first_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L104-L117)).
3. 오디오 패킷 시각 목록이 원본과 동일해야 합니다([`_audio_packet_times`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L120-L125)).

렌더 보고서는 이 결과를 기록합니다. `pts_check.max_abs_diff_s`, `audio.av_offset_error_s`, `audio.packets_copied`, 그리고 `verification` 개수입니다.

## 덮어쓰기 금지 출력

작업을 시작하기 전에 [`_check_paths`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L93-L101)는 존재하지 않는 원본, 원본으로 해석되는 출력(원본을 가리키는 심볼릭 링크나 하드 링크 포함), 그리고 이미 존재하는 모든 출력 경로(끊어진 심볼릭 링크 포함)를 거부합니다. 어떤 것도 덮어쓰지 않습니다.

스테이징 파일은 출력 디렉터리에서 `tempfile.mkstemp`로 `.<stem>.<random>.staging.mp4` 형태의 고유한 이름으로 만들어집니다. 검증 후 `os.link`가 그 파일을 가리키는 하드 링크로 출력을 만듭니다. 하드 링크는 대상 이름이 이미 있으면 실패하므로, 렌더링 중에 나타난 파일을 게시 과정이 대체할 수 없습니다. 스테이징 이름은 성공과 실패 모두에서 `finally` 블록으로 제거되므로, 디렉터리의 관련 없는 파일은 절대 건드리지 않습니다. 이 방식은 출력 디렉터리의 파일 시스템이 하드 링크를 지원한다는 전제에 의존합니다.

CLI는 JSON에도 같은 규칙을 적용합니다. `_refuse_existing`은 모든 출력 경로를 미리 확인하고, `_dump`는 배타적 생성 모드로 파일을 엽니다([`cli.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/cli.py#L34-L63)). `run`은 두 JSON 파일을 쓰기 전에 영상을 게시하므로, 세 출력은 하나의 원자적 트랜잭션이 아닙니다. 세 출력을 모두 먼저 확인하므로, 우연히 `<out-dir>/analysis.json`에 놓인 입력 파일은 덮어쓰이지 않고 거부됩니다. 파일 이름은 셸에 전달되지 않습니다. 테스트 `test_render_rejects_mismatched_pts_and_handles_hostile_filename`은 셸 메타문자가 포함된 이름으로부터 렌더링합니다.

관련 문서: `pts_s`는 [관측과 타이밍](observations-timing.md), 미디어 검사가 증명하는 것은 [검증과 한계](validation-limits.md), 렌더 보고서는 [스키마](schemas.md)를 참고하세요.
