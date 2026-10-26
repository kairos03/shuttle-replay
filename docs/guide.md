# shuttle-replay user guide (v0.1)

`shuttle-replay` is an offline tool that builds a badminton shuttle replay from
a local video, detections you have already produced and annotations reviewed
by a person. It calibrates the camera, fits a flight model with gravity and
quadratic air drag to the 2D detection coordinates, and makes an MP4 that
places the source video and a top-view court side by side at 6:4.

This tool is for research and review. It is not an in/out line-calling system,
a shot classifier, a shuttle detector or a measured speed gun. Every 3D
position and speed in the output is a conditional model value that assumes
your calibration and annotations.

## Installation

Requires Python 3.12 or newer and [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/KAIROS03/shuttle-replay
cd shuttle-replay
uv sync
uv run shuttle-replay --help
```

The PyAV wheels bundle FFmpeg, so a system FFmpeg is not needed.

## Synthetic demo

```bash
uv run shuttle-replay demo --out-dir demo
```

This builds a synthetic rally that mixes two virtual cameras, a transition
segment and missing detections, then runs calibration → analysis → rendering
end to end. The values in `demo/synthetic_recovery.json` are compared against
the synthetic ground truth, so they do not indicate accuracy on real video.

## Using your own video

1. **Detections (`tracks.json`)**: one row per decoded frame, with that frame's
   actual PTS (seconds), the camera segment id (`null` for transition and
   close-up segments), the shuttle pixel coordinates (`null` when absent) and
   optional player boxes. `frame_id` must match the decoding order. See
   [docs/schemas.md](schemas.md) for the format.
   v0.1 has no detector. You can run TrackNetV3 (MIT) or Ultralytics YOLO
   (AGPL-3.0) yourself and convert the results, but no conversion script is
   included. No model weights are downloaded.
2. **Calibration input**: for each camera segment, mark in pixels four or more
   court-line intersections (`fit`), a few intersections for validation
   (`heldout`) and the two net-post tops (height 1.55 m).

   ```bash
   uv run shuttle-replay calibrate calibration_input.json -o calibration.json
   ```

   Check `heldout_summary` (the error on points not used for fitting) and
   `net_anchor_sensitivity` (how much the height moves when the net posts are
   shifted by the given pixel error) first. The floor homography is used only
   for floor (Z=0) points and never for the shuttle in the air.
3. **Review annotations (`review.json`)**: enter the racket contact time
   (`time_s`), the review bracket that contains it (`time_bracket_s`), the
   contact pixel and a height estimate. The contact time is second 0 of the
   flight. A late first detection does not change second 0.
   Only the last contact of a segment can have an end condition: a
   `landing_region` (the area and time bracket where the shuttle reaches the
   floor) or `open` (until the last observation of the segment, or until the
   reviewed `until_s`). Any other flight ends at the next contact and is not
   forced to reach the floor. v0.1 does not correct contact times
   automatically, so fix them yourself while looking at the frames.
4. **Analysis and rendering**

   ```bash
   uv run shuttle-replay analyze --tracks tracks.json --review review.json \
       --calibration calibration.json -o analysis.json
   uv run shuttle-replay render --video match.mp4 --analysis analysis.json -o replay.mp4
   # 한 번에:
   uv run shuttle-replay run --video match.mp4 --tracks tracks.json --review review.json \
       --calibration calibration.json --out-dir out
   ```

   The `# 한 번에:` comment means "all in one step:"; `run` performs analysis
   and rendering together.

   The tool stops with exit code 2 if PTS goes backwards, if the same camera
   segment reappears after a gap, if a contact lies outside its camera segment
   or review bracket, or if the video PTS and the tracks PTS differ. It never
   silently fixes the input.

## Reading the results

- Green circle: the input detection coordinates as given. Frames without a
  detection are left empty.
- Orange circle/dots: the conditional physics model. Drawn only within the
  same camera segment and the same flight.
- Blue dashed box: the landing region a person specified. The × mark is the
  model landing point fitted under that region as a condition, not a measured
  coordinate.
- Speed is the model's initial speed rounded to 5 km/h.
- For a returned flight, the "where it would have landed if not returned"
  point is recorded only in the JSON (`unreturned_floor_crossing_prediction`,
  a counterfactual prediction).
- If the source has audio, the audio packets are copied as they are without
  re-encoding, so the source's audio start delay and gaps are preserved. If
  the audio cannot be copied into MP4 or its timing would change, rendering
  fails. The result of decoding the output file to the end for verification
  is written to `render_report.json`.
- Existing files are never overwritten. The tool stops if an output file
  already exists or is the same file as the source video, and rendering writes
  to a temporary file that is moved to the final name only after verification.

## License

GNU AGPL-3.0 only. See [LICENSE](../LICENSE) and [NOTICE.md](../NOTICE.md).
