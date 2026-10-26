# Workflow

## What you provide

- **Detections** (`tracks.json`): one entry per decoded frame with PTS, camera
  segment id, shuttle pixel or null, optional player boxes. There is no
  built-in detector. See [](schemas.md).
- **Calibration input**: per segment, at least 4 `fit` court points, a few
  `heldout` points, and both net post tops (1.55 m).
- **Review** (`review.json`): contact times, pixels and heights you reviewed,
  plus optional landing regions. Contacts are not found automatically.

Any tracker can produce the detections; for example you can run TrackNetV3
(MIT) for the shuttle and an Ultralytics YOLO model (AGPL-3.0) for players
yourself, with your own checkpoints, and convert their outputs. Conversion
scripts are not part of v0.1.

## Steps

1. **Calibrate.** For each camera segment, measure ≥ 4 court line intersections
   (role `fit`), a few more as `heldout`, and the two net post tops.

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Check `heldout_summary` and `net_anchor_sensitivity` before going further.
2. **Review.** Write `review.json`: contact times inside reviewed brackets,
   contact pixel and height priors, and for the last flight of a segment an
   optional landing region or `open`.
3. **Analyze and render.**

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

## What each command does

- **`calibrate`**: homography from ≥ 4 reviewed floor points, plus the vertical
  camera column from ≥ 2 elevated net anchors. Held-out floor points are never
  used for fitting and are reported separately. Degenerate, duplicate,
  collinear and non-finite inputs are rejected. The floor homography is never
  used for airborne points.
- **`analyze`**: one flight per reviewed contact, timed from the reviewed
  contact. Camera cuts are excluded and flights never bridge segments. Each
  flight ends at the next contact, at a reviewed landing region (a constraint,
  not a measured coordinate), or at the last observation of the segment. Floor
  and net gates reject infeasible fits. Missing detections stay null.
- **`render`**: verifies every decoded source frame against the track PTS and
  draws supplied player boxes, observed shuttle rings (green), model rings
  (orange) and a top-view court in a 6:4 layout. Source audio is stream-copied
  without re-encoding. Existing outputs are never overwritten.
- **`demo`**: generates a synthetic rally and runs the whole pipeline.

## Reading the output

| Layer | Meaning |
| --- | --- |
| `observed_pixel` | supplied detection, unchanged; null when absent |
| `human_review` | your contacts, landing regions and calibration points |
| `conditional_model` | physics model fitted to observed pixels under your priors |
| `display_interpolation` | lines and markers drawn by the renderer only |

Speeds are the initial speed of the fitted model (`model_speed_km_h`, shown
rounded to 5 km/h). Treat them as rough model values, not measurements.

## Limits

- No shuttle or player detection and no bundled weights.
- No automatic contact finding or contact timestamp refinement.
- No learned dense-depth maps, no learned shot labels, no automatic IN/OUT calls.
- 3D output is conditional, not measured. Synthetic recovery results are synthetic.
