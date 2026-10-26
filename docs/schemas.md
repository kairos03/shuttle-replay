# Input and output formats (v0.1)

All coordinates in metres use the court frame: X across the court and Y
along it, with the outer boundary of the court (outer edges of the boundary
lines) at X = 0 .. 6.10 and Y = 0 (far) .. 13.40 (near); Z up (0 = floor).
Net plane is Y = 6.70. Lines are 40 mm wide; enter ground points at line
centres: outer lines X = 0.02 / 6.08 and Y = 0.02 / 13.38, singles sidelines
X = 0.48 / 5.62, short service lines Y = 4.70 / 8.70, doubles long service
lines Y = 0.78 / 12.62, centre line X = 3.05.
Image coordinates are source-video pixels (x right, y down). Times are source
presentation timestamps (PTS) in seconds as decoded by FFmpeg/PyAV
(`frame.pts * time_base`), never `frame_index / fps`.

Run `shuttle-replay demo --out-dir demo` to get a complete, synthetic example
of every file below in `demo/inputs/`.

## Calibration input — `shuttle-replay/calibration-input/v1`

```json
{
  "schema": "shuttle-replay/calibration-input/v1",
  "segments": [
    {
      "segment_id": 0,
      "image_size": [1280, 720],
      "ground_points": [
        {"name": "far_left_corner", "world_m": [0.02, 0.02], "image_px": [412.0, 188.5], "role": "fit"},
        {"name": "single_left_x_short_far", "world_m": [0.48, 4.70], "image_px": [430.1, 260.2], "role": "heldout"}
      ],
      "net_anchors": [
        {"name": "left_post_top", "world_m": [0.0, 6.7, 1.55], "image_px": [380.2, 250.0], "uncertainty_px": 3.0}
      ]
    }
  ]
}
```

- `role: "fit"` points (≥ 4, not collinear, not duplicated) estimate the
  floor homography. `role: "heldout"` points (≥ 1) are never fitted and are
  reported separately as held-out errors in pixels and metres.
- `net_anchors` (≥ 2, Z > 0.1 m) recover the vertical column of the camera
  matrix. With exactly two anchors the column is nearly exactly determined, so
  their residual says little; the output includes a sensitivity report (vertical
  shift of a point 3 m above the net when an anchor moves by `uncertainty_px`).
- Non-finite numbers, collinear/duplicate fit points, anchors at floor level and
  cameras below the floor are rejected.

Output (`shuttle-replay/calibration/v1`) contains per segment `P` (3×4,
metres → pixels), `H_world_to_image` / `H_image_to_world` (floor only),
`fit_ground_residuals`, `heldout_ground_errors`, `heldout_summary`,
`net_anchor_residuals_px`, `net_anchor_sensitivity` and a copy of the inputs.

## Tracks — `shuttle-replay/tracks/v1`

```json
{
  "schema": "shuttle-replay/tracks/v1",
  "source_video": "match.mp4",
  "frames": [
    {"frame_id": 0, "pts_s": 0.0, "segment_id": 0,
     "shuttle": {"u": 315.3, "v": 265.6, "score": 0.91},
     "players": [{"label": "near", "box": [339.8, 350.1, 408.4, 521.7], "score": 0.9}]},
    {"frame_id": 1, "pts_s": 0.0333, "segment_id": 0, "shuttle": null, "players": []}
  ]
}
```

- One entry per decoded source frame, in decode order; `frame_id` must equal
  the decode index (the renderer checks this and the PTS of every frame).
- `frame_id` and `pts_s` must be strictly increasing and finite.
- `segment_id` identifies a continuous camera shot that has a calibration;
  `null` marks camera cuts / close-ups / replays, which are excluded. A segment
  must be contiguous; a segment id that reappears after another segment is
  rejected (give the later shot its own id and calibration).
- `shuttle: null` means "no detection". It stays null in all outputs.

## Review annotations — `shuttle-replay/review/v1`

```json
{
  "schema": "shuttle-replay/review/v1",
  "physics": {"pixel_sigma_px": 3.0, "contact_guard_s": 0.02},
  "contacts": [
    {"id": "c1", "segment_id": 0, "time_s": 0.20, "time_bracket_s": [0.16, 0.24],
     "image_px": [402.0, 300.0], "height_m": 1.05, "height_sigma_m": 0.3,
     "review": "racket contact visible"}
  ],
  "flight_ends": [
    {"contact_id": "c5", "type": "landing_region", "time_bracket_s": [5.1, 5.4],
     "region_xy_m": {"min": [4.2, 0.8], "max": [4.9, 1.6]}, "review": "lands IN"},
    {"contact_id": "c3", "type": "open", "review": "camera cuts away mid-flight"}
  ]
}
```

- Contacts are reviewed racket contacts. `time_s` is the reviewed contact
  timestamp and becomes flight time zero, even when the first shuttle detection
  arrives later. It must lie inside its camera segment and inside
  `time_bracket_s` (≤ 0.5 s wide). Contacts in a segment must be strictly
  increasing. v0.1 does not refine contact times automatically; refine them by
  reviewing frames and editing `time_s`.
- Position prior: `image_px` (reviewed contact pixel, intersected with the
  plane Z = `height_m` through the full camera P) or `court_xy_m`. `height_m`
  is a reviewed prior with `height_sigma_m`; `xy_sigma_m` is optional
  (default 0.5 m).
- A flight runs from a contact to the next contact of the same segment
  (`intercepted_by_next_contact`, never forced to the floor). Only the last
  contact of a segment may have a `flight_ends` entry: `landing_region`
  (floor contact constrained into the reviewed box within the time bracket) or
  `open` (fit up to the last observation in the segment, or up to an optional
  reviewed `until_s`). Missing entry = open.
- `physics` keys (all optional): `gravity_m_s2`, `pixel_sigma_px`,
  `drag_prior_per_m`, `drag_prior_sigma`, `drag_bounds_per_m`,
  `contact_guard_s`, `contact_xy_sigma_m`, `min_observations`,
  `max_accept_rms_px`, `velocity_bound_m_s`.

## Analysis output — `shuttle-replay/analysis/v1`

- `flights[]`: `t0_s` (reviewed contact), `t_end_s`, `end_type`, `params`
  (`[x, y, z, vx, vy, vz, drag_k]` at contact), `fit` (reprojection RMS / p90 /
  max px, observation count, optimizer status), `gates` (floor and net
  feasibility; net height ≥ 1.524 m when the flight crosses the net),
  `parameters_at_bound` (a fit pinned at an optimizer bound is rejected),
  `accepted`, `model_speed_km_h` and `model_speed_coarse_km_h`,
  `first_observation_delay_s`, `observation_frame_ids`, `landing` (landing
  flights; `exact_coordinate_measured: false`) and
  `unreturned_floor_crossing_prediction` (intercepted/open flights;
  `kind: counterfactual_if_unreturned`, `observed: false`).
- `frames[]`: `shuttle_observed_px` (supplied detection or null),
  `shuttle_model_xyz_m` / `shuttle_model_px` (accepted model only, same
  segment), `model_flight_id`, `layer` (`conditional_model`, `observed_pixel`,
  `none`, `excluded_camera_cut`).
- `provenance_vocabulary`, `assumptions`, `calibration_summary`.

## Render report

`render_report.json` records the encoder, frame count, the maximum
difference between decoded source PTS and track PTS, the 6:4 layout, whether
audio was preserved, and a full decode of the written MP4.
