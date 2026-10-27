# shuttle-replay web demo

Browser-only static viewer for `shuttle-replay/analysis/v1` results. Plain HTML, CSS and
ES modules; no framework, CDN, fonts, upload or network API. Published by the Docs workflow:
`docs/build.py` copies `web/demo/` to `demo/` in the Pages artifact
(`https://kairos03.github.io/shuttle-replay/demo/`).

```
web/
  demo/                 static site (copied verbatim)
    index.html, styles.css
    js/analysis-model.js  parsing/validation, time lookup, trail policy (pure)
    js/pair-loader.js     staged (video, analysis) loading; newest request wins
    js/frame-clock.js     requestVideoFrameCallback loop with rAF fallback
    js/app.js             DOM + canvas
    assets/court-data.js  generated from src/shuttle_replay/court.py
    assets/sample/        synthetic sample (see provenance.json)
  build_sample.py       regenerate the sample with the real pipeline
  serve.mjs             local static server with HTTP Range support
  tests/                node --test unit tests
  smoke/                optional Playwright browser smoke test
```

## Sample provenance

`assets/sample/` is **synthetic**. `build_sample.py` runs
`build_scene(seed=7)` → `calibrate` → `analyze` and writes `analysis.json` unchanged
(no local paths). The pipeline's MPEG-4 Part 2 video is not browser-playable, so it is
re-encoded frame by frame with the original PTS into H.264 MP4 and VP9 WebM;
`provenance.json` records codecs, frame counts, PTS drift against the analysis and SHA-256
digests. The audio is a 440 Hz test tone; sound is off by default.

```bash
uv run python web/build_sample.py           # rewrite sample + court-data.js
uv run python web/build_sample.py --check   # verify analysis/court are current
```

## Time matching

`analysis time = video currentTime + offset` (offset defaults to 0, editable in the UI).
Frames are located by binary search over the analysis `pts_s` (variable frame rate is
respected; no fixed fps is assumed). A frame is shown until the next frame's `pts_s`; past
the last frame by more than 1.5 median frame durations nothing is drawn. Frame stepping
seeks to just inside the target frame's PTS. If the source's first PTS was not zero, or the
video was re-encoded with a different start, set the offset; the viewer warns when the
video duration and analysis span disagree and never draws overlays it cannot place.

## Drawing policy

* Green ring: observed pixel (`shuttle_observed_px`), video only.
* Orange dot: conditional model pixel (`shuttle_model_px`) of an accepted flight; the court
  view draws only `shuttle_model_xyz_m` X/Y. Height and coarse initial speed are labelled
  model estimates; no IN/OUT verdicts.
* Trails join only consecutive frames of the same segment and flight; they break at
  `excluded_camera_cut`, null segments, detection gaps, rejected flights and flight or
  segment boundaries. Points outside the video's intrinsic size are not drawn.

## Tests

```bash
node --test web/tests/analysis-model.test.mjs web/tests/loader-clock.test.mjs web/tests/flight-context.test.mjs
uv run pytest -q tests/test_web_demo.py
# optional, needs playwright-core and a Chromium build:
PLAYWRIGHT_CORE=/path/to/playwright-core node web/smoke/browser-smoke.mjs --out smoke-out
```
