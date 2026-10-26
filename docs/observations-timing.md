# Observations and timing

A flight fit compares model positions with detections **at specific times**.
If those times are wrong, a correct trajectory looks wrong and a wrong one can
look right. This page explains where times come from, what the input contracts
require, how evidence is separated from review, and how time is sampled for the
model and for drawing.

## Time comes from PTS, not frame counting

Video containers store a presentation timestamp (PTS) for every frame as an
integer tick count, with a `time_base` that says how long one tick is. The
frame's time in seconds is:

```text
 time_s = pts * time_base

 example: time_base = 1/30000 s, pts = 3003  ->  0.1001 s
```

Many phone and screen recordings have a **variable frame rate** (VFR): frame
durations differ. Computing `frame_index / fps` then drifts away from the real
time. The tracks format therefore stores `pts_s` per frame, as decoded by
FFmpeg/PyAV (see [the schemas](schemas.md)). The synthetic demo deliberately
uses VFR: at `time_base` 1/30000 s, every seventh frame lasts 1001 ticks instead
of 1000
([`frame_pts_ticks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py#L52-L58)).

The renderer later checks every decoded frame against your `pts_s`; see
[Rendering and output safety](rendering-safety.md).

## Input contracts

[`validate_tracks`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L33-L78)
and
[`validate_review`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L81-L149)
raise `InputError` on the first inconsistency. Nothing is reordered,
deduplicated or repaired.

Tracks (`shuttle-replay/tracks/v1`):

- `frame_id` is an integer and strictly increasing; `pts_s` is finite and
  strictly increasing.
- `segment_id` names one continuous camera shot. `null` marks a camera cut,
  close-up or replay. A segment id that reappears after a different segment is
  rejected, so each shot needs its own id and calibration.
- `shuttle` is either `null` (no detection) or has finite `u` and `v`. Player
  boxes must be four finite numbers.

Each segment's time range is the PTS of its first and last frame. Every segment
needs a calibration
([`validate_inputs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/inputs.py#L152-L162)).

Review (`shuttle-replay/review/v1`):

- Contact ids are unique strings. Each contact lies inside its segment's PTS
  range and inside its own `time_bracket_s`, which may be at most 0.5 s wide.
- Contacts in one segment are strictly increasing in time, in list order.
- `height_m` is in the open interval (0, 4) m and `height_sigma_m` is positive.
  Each contact needs `image_px` or `court_xy_m`.
- Only the last contact of a segment may have a `flight_ends` entry, of type
  `open` or `landing_region`. A landing bracket must start after the contact;
  the region's `min` must be below its `max`. An `open` end's `until_s` must
  follow the contact and stay inside the segment.

## Evidence versus review

Two kinds of input play different roles:

- **Observed evidence**: your detections. They enter the fit only as pixel
  residuals and are copied unchanged into `shuttle_observed_px`. A frame with
  `shuttle: null` stays `null` in every output.
- **Reviewed constraints**: contacts, landing regions, calibration points. Contact
  positions and heights enter as sigma-weighted priors; landing endpoints use
  fixed penalty scales. Calibration points determine the camera beforehand.
  Contact times are fixed, and landing time is fitted within its bracket.

When the model fills a frame without a detection, that frame's `layer` is
`conditional_model` while `shuttle_observed_px` stays `null`. The test
`test_missing_detection_provenance_is_null_not_filled` checks exactly this.

## Flight segmentation

[`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L234)
groups contacts by segment and turns each contact into one flight. A flight
never crosses a camera segment. Its observations are the segment's frames with
a detection and

```text
 t0 + contact_guard_s  <  pts_s  <=  t_end - contact_guard_s     (followed by another contact)
 t0 + contact_guard_s  <  pts_s  <=  t_end                       (landing or open end)

 t0             reviewed contact time
 t_end          next contact time, landing bracket end, or min(segment end, until_s)
 contact_guard_s  default 0.02 s
```

The guard drops detections right at a contact, where the shuttle is often
merged with the racket. `observation_frame_ids` and
`observation_time_offsets_s` in each flight record show exactly which frames
were used, with offsets measured from `t0`.

## Model sampling versus display

Three different samplings exist, and only the first is per video frame:

1. **Per frame.** For every frame inside an accepted flight's time span,
   `shuttle_model_xyz_m` is the model evaluated at that frame's own PTS, and
   `shuttle_model_px` is its projection through `P`
   ([frame loop](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L293-L334)).
   Camera-cut frames get `layer: "excluded_camera_cut"`, no model and no
   players, even if a raw detection exists (`raw_detection_ignored`).
2. **Inside the fit.** 41 evenly spaced samples check the floor and net
   penalties; 201 samples feed the acceptance gates. See
   [Trajectory physics](trajectory-physics.md).
3. **Display.** The top-view trail is a polyline through earlier per-frame model
   samples of the **same** flight only
   ([`trail_for`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/render.py#L36-L46)).
   It stops at the first frame with a different `model_flight_id`, so a trail
   never connects two flights or bridges a camera cut. These lines are
   `display_interpolation`, not data.

## Tolerances that are actually checked

```text
 contact bracket width         <= 0.5 s                  inputs.py
 contact guard                 0.02 s (default)          analysis.py
 renderer PTS match            1e-3 s per frame          render.py
 ODE (simulate)                rtol 1e-7, atol 1e-8, max_step 0.02 s
 ODE (floor_crossing)          rtol 1e-9, atol 1e-10, max_step 0.01 s
 floor gate                    lowest point >= -0.02 m
 landing within_region         region widened by 1e-3 m
```

Related: [the schemas](schemas.md) for every field,
[the workflow](workflow.md) for producing tracks from your own detector.
