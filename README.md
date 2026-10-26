# shuttle-replay

Offline, review-driven badminton shuttle replays from a local video, supplied
detections and human-reviewed annotations.

`shuttle-replay` calibrates a broadcast-style camera from reviewed court points
and net-post anchors, fits gravity + quadratic-drag flights to 2D shuttle
detections under explicit contact and landing priors, and renders an MP4 with
the source video (original aspect ratio and timing) beside a top-view court.

It is a research and review tool. It is **not** a line-calling system, a shot
classifier, a shuttle detector, or a measured 3D speed gun. Every 3D position
and speed it reports is a conditional model output that depends on your
calibration and annotations.

한국어 사용 안내: [docs/usage.ko.md](docs/usage.ko.md)

## What v0.1 does

- **Calibration** (`calibrate`): homography from ≥ 4 reviewed floor points,
  plus the vertical camera column from ≥ 2 elevated net anchors. Held-out floor
  points are never used for fitting and are reported separately (pixels and
  metres). Degenerate, duplicate, collinear and non-finite inputs are rejected.
  The floor homography is never used for airborne points.
- **Analysis** (`analyze`): one flight per reviewed contact, timed from the
  reviewed contact (time zero) even when the first detection arrives later.
  Uses source PTS, frame ids and camera segment ids; camera cuts are excluded
  and flights never bridge segments. Each flight ends at the next contact
  (intercepted, not forced to land), at a reviewed landing region (a
  constraint, not a measured coordinate), or at the last observation of the
  segment. Floor and net gates reject infeasible fits. Where a flight was
  intercepted, the floor point it *would* have reached is reported separately
  as a counterfactual. Missing detections stay null.
- **Rendering** (`render`): verifies every decoded source frame against the
  track PTS, draws supplied player boxes, observed shuttle rings (green) and
  model rings (orange), and a top-view court in a 6:4 source/top-view layout.
  Camera-cut frames get no shuttle overlay. Source audio packets are
  stream-copied unchanged (no re-encoding), so the source's audio start offset
  and gaps are kept; the render fails if the audio cannot be copied into MP4 or
  its timing changes. No shell commands are built from file names. Outputs are
  never overwritten: rendering fails if the output exists or aliases the source,
  writes to a unique staging file, and publishes it only after a full decode check.
- **Demo** (`demo`): generates a fully synthetic rally (two virtual cameras, a
  camera cut, noisy detections with gaps, a test tone) and runs the whole
  pipeline, including a synthetic ground-truth recovery report.

## What v0.1 does not do

- It does not detect shuttles or players. You supply detections in the
  [tracks format](docs/schemas.md). There is no built-in detector and no model
  weights are downloaded.
- It does not find contacts or refine contact timestamps automatically. You
  review and enter contact times, heights and positions.
- No learned dense-depth maps, no learned shot labels, no automatic IN/OUT calls.
- Low reprojection error shows the model is consistent with the 2D detections.
  It is not independent proof of 3D accuracy. Synthetic recovery results are
  synthetic.

## Install

Requires Python ≥ 3.12 and [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

PyAV wheels include FFmpeg, so no system FFmpeg is required.

## Quick start (synthetic demo)

```bash
uv run shuttle-replay demo --out-dir demo
```

Writes `demo/inputs/` (synthetic video, tracks, review, calibration input),
`demo/calibration.json`, `demo/analysis.json`, `demo/replay.mp4`,
`demo/render_report.json` and `demo/synthetic_recovery.json`.

## Your own video

1. **Detections.** Produce one `tracks.json` entry per decoded frame with the
   frame's PTS, a camera segment id (null for cuts/close-ups), the shuttle pixel
   (or null) and optional player boxes. See [docs/schemas.md](docs/schemas.md).
   Any tracker can be used; for example you can run TrackNetV3 (MIT) for the
   shuttle and an Ultralytics YOLO model (AGPL-3.0) for players yourself with
   your own checkpoints and convert their outputs. Conversion scripts are not
   part of v0.1.
2. **Calibration input.** For each camera segment, measure ≥ 4 court line
   intersections (role `fit`), a few more as `heldout`, and the two net post
   tops (1.55 m).

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Check `heldout_summary` and `net_anchor_sensitivity` before going further.
3. **Review.** Write `review.json`: contact times inside reviewed brackets,
   contact pixel and height priors, and for the last flight of a segment an
   optional landing region or `open`.
4. **Analyze and render.**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # or both at once:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   Inconsistent inputs (non-monotonic PTS, non-contiguous segments, contacts
   outside their segment or bracket, PTS that do not match the video, …) stop
   with exit code 2 and a message; nothing is silently repaired.

## Reading the output

| Layer | Meaning |
| --- | --- |
| `observed_pixel` | supplied detection, unchanged; null when absent |
| `human_review` | your contacts, landing regions and calibration points |
| `conditional_model` | physics model fitted to observed pixels under your priors |
| `display_interpolation` | lines and markers drawn by the renderer only |

Speeds are the initial speed of the fitted model (`model_speed_km_h`, shown
rounded to 5 km/h). Treat them as rough model values.

## Development

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## License

GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). See
[LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for third-party notices.
