# shuttle-replay browser demo

Static HTML/CSS/ES-module replay viewer, published at
https://kairos03.github.io/shuttle-replay/demo/ by the Docs workflow.
`docs/build.py` copies `web/demo/` verbatim into the Pages artifact.

## Entry and local video

The first visit is empty. Choose **영상 업로드** or **샘플 보기** inside the
left video area. No sample video or analysis is requested before that choice.
Playback controls stay disabled until a video is ready. The sample does not autoplay.

A selected video plays using a browser-local blob URL and is analyzed
automatically **inside this browser**: MP4/MOV demux (mp4box.js) and WebCodecs
decode with container presentation timestamps, TrackNetV3 shuttle and YOLO11s-pose
player models (onnxruntime-web), automatic court-line calibration and the shared-contact
trajectory fit (R5 Python on Pyodide), all in page workers. Nothing is uploaded and no
server inference is used. One progress overlay covers both panels with a cancel button;
the validated result then autoplays. Requires desktop Chrome with WebGPU hardware acceleration (no CPU fallback; analysis is refused with a message). Limits: ≤ 30 s, ≤ 900 frames, ≤ 4K,
≤ 512 MB; other browsers/containers fail explicitly and the video stays playable. If
analysis fails or is cancelled the page shows `자동 분석 실패…` / `분석을 취소했습니다…`
and plays the video without overlays. The small `데모 영상` action restores
the bundled sample. Desktop video/court widths remain 3:2; narrow screens stack.

## Real sample and limitations

`demo/assets/real/source_clip.mp4` is a 7.007-second, 210-frame excerpt of
[Pexels video 35427619](https://www.pexels.com/video/intense-indoor-badminton-match-in-action-35427619/),
used under the [Pexels License](https://www.pexels.com/license/).
The media retains that license, not the repository's AGPL code license.
No endorsement by Pexels or the depicted people is implied. See `NOTICE.md`.

`demo/assets/real/analysis.json` contains precomputed TrackNetV3 shuttle
observations and four-player pose tracking. It is not browser inference or
independently validated ground truth. Player floor coordinates use a manual
reference calibration. The separate shuttle court-map layer is a conditional
camera/flight reference, marked `≈`; it includes interpolated and held positions.
Raw missing observations remain null; strict flights remain empty.

`demo/assets/sample/` is the earlier pipeline-generated synthetic regression
fixture, not the UI's default or a real recording. `web/build_sample.py`
regenerates that fixture and court geometry; it does not regenerate the real
sample's detections. The licensed ONNX model weights and the onnxruntime-web/Pyodide runtimes are self-hosted with the demo (see `NOTICE.md`); private research logs are not shipped.

## Verification

```sh
node --test web/tests/*.test.mjs
uv run pytest -q tests/test_web_demo.py
uv run --only-group docs python docs/build.py
uv run --only-group docs python docs/verify_i18n.py
node web/serve.mjs
```

The viewer uses actual `pts_s`, not a fixed frame-rate index. Source-image
observations, player floor estimates and shuttle map references are separate
layers. Missing detection coverage is not a measured location or accuracy claim.
