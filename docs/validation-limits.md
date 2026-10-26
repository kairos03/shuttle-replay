# Validation and limits

`shuttle-replay` reports many numbers about its own results. Each one answers a
narrow question. This page says, for each check, what it shows, what it does
not show, and which test in the repository exercises it. No accuracy or speed
figures for real footage are given here, because the project has not measured
any.

## What each check proves

**Held-out ground error** (`heldout_summary`,
[`calibrate_segment`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/calibration.py#L175-L197)).
Proves: the floor homography predicts court points it was not fitted to.
Does not prove: anything about heights, the net anchors, or the shuttle.

**Net anchor residuals and sensitivity** (`net_anchor_residuals_px`,
`net_anchor_sensitivity`). With two anchors the vertical column is almost exactly
determined, so the residual is close to zero almost by construction. The
sensitivity value shows how far one reference point 3 m above the net moves
when one anchor coordinate moves by its stated pixel uncertainty. It is a
what-if, not a confidence interval. See [Camera calibration](camera-calibration.md).

**Reprojection error** (`fit.reprojection_rms_px`, `reprojection_p90_px`,
`reprojection_max_px`). Proves: the model's projection passes near your 2D
detections. Does not prove: the 3D path is right. A different depth with a
different speed can project to almost the same pixels, which is the
underdetermination described in [Trajectory physics](trajectory-physics.md).
The default acceptance limit is 8.0 px RMS.

**Floor and net gates** (`gates`,
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106)).
Passing shows that the 201 sampled heights are at least −0.02 m, every
detected crossing interpolated between adjacent samples is at least 1.524 m,
and a crossing occurs when required. These checks do not establish general
physical plausibility or real-world accuracy.

**`parameters_at_bound` and `optimizer_success`**. An unconverged fit is
rejected. The seven state/drag parameters are flagged when their distance from
a bound is less than 0.1% of their allowed range. A flagged fit is rejected.
Landing time is not included in this diagnostic. Passing does not establish
identifiability, uniqueness, or freedom from prior influence.

**Media checks** (render report). Prove: every source frame was matched by
index and PTS, the output decodes with the right frame count, and the audio
packets kept their times. Do not prove: that your `pts_s` came from the same
file the detections were made on, beyond the PTS match itself.

**Synthetic recovery** (`demo`, `synthetic_recovery.json`). `synthetic_recovery.json`
reports comparisons with synthetic ground truth. Tests assert selected recovery
tolerances for specific synthetic cases; generating the report alone does not
enforce those tolerances. Neither shows accuracy on real video. The file's
`label` says so: "SYNTHETIC ground-truth recovery; not evidence of accuracy on
real video".

## Where uncertainty is qualitative

The fit has sigmas, but the output does not turn them into error bars. There
is no covariance, no bootstrap and no confidence interval on position, speed or
landing point. Uncertainty is expressed by labels instead: `conditional_model`,
`exact_coordinate_measured: false`, `speed_scope`, and the `assumptions` list
in every analysis file
([`ASSUMPTIONS`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L39-L46)).
The coarse 5 km/h speed rounding is a display choice, not an error estimate.

## Why it is not something else

- **Not measured 3D.** One camera gives rays, not points. Depth comes from the
  physics model plus your reviewed contacts.
- **Not dense depth.** There is no per-pixel depth map and no learned depth
  network. Only the shuttle along fitted flights gets a 3D position.
- **Not automatic IN/OUT.** `landing.inside_court` compares a model point with
  the outer court boundary. The point is softly pulled toward the region you
  drew, so the answer mostly reflects your review; region membership is not a
  hard acceptance requirement (`landing.within_region` reports it with a 1 mm
  allowance). There is no line-calling
  logic, no singles/doubles rule and no measurement of where the shuttle touched.

## Debugging order

When a flight looks wrong, read from the bottom of the pipeline up:

1. **Calibration.** Large `heldout_summary` errors or a large
   `max_vertical_shift_m`: fix points or anchors first. Nothing downstream can
   recover.
2. **Inputs.** `observation_frame_ids` and `first_observation_delay_s`: does
   the window contain the detections you expect?
3. **Status.** `insufficient_observations` means too few detections;
   `rejected_by_gates_or_fit` means look at the next two items.
4. **Fit.** `optimizer_success`, `parameters_at_bound`, reprojection RMS and
   max. One huge max with a low RMS points at one bad detection.
5. **Gates.** `minimum_height_m`, `net_crossing_required`,
   `net_crossing_occurred`, `net_crossing_height_m`. A failed net gate often
   means a contact on the wrong side or a wrong contact height.
6. **Render report.** PTS mismatch or frame-count errors mean the tracks do not
   belong to this exact video decode.

## Evidence map

| Claim | Test |
| --- | --- |
| Held-out points reported separately; `H` labelled Z=0 only | `test_calibration_recovers_camera_and_reports_heldout_separately` |
| Bad calibration inputs rejected | `test_calibration_rejects_invalid_inputs`, `test_calibration_rejects_collinear_fit_points` |
| Inconsistent tracks or review rejected, not repaired | `test_inconsistent_inputs_are_rejected_not_repaired`, `test_missing_segment_calibration_is_rejected` |
| Contact, not first detection, is time zero | `test_delayed_first_observation_keeps_contact_as_time_zero` |
| Flights stay inside one segment | `test_flights_never_bridge_camera_segments` |
| Missing detections stay null | `test_missing_detection_provenance_is_null_not_filled` |
| Landing is a constraint, not a measurement | `test_landing_region_is_a_constraint_not_a_measurement` |
| Intercepted flights are not forced to land | `test_intercepted_flight_is_not_forced_to_land` |
| Net and floor gates | `test_physical_gates_reject_net_and_floor_violations`, `test_actual_low_net_crossing_rejected_without_expected_crossing` |
| Bound-pinned fits rejected; `until_s` window | `test_open_flight_window_and_bound_pinned_fits` |
| Court line centres | `test_court_lines_are_line_centres_of_40mm_lines_inside_outer_boundary` |
| PTS and frame-count checks; hostile file names | `test_render_rejects_mismatched_pts_and_handles_hostile_filename` |
| Trails stay inside one flight | `test_trails_stay_inside_one_flight_and_segment` |
| No overwrite of source or existing files | `test_render_never_overwrites_source_or_existing_files`, `test_cli_rejects_output_aliasing_inputs` |
| Audio offset and gaps preserved | `test_audio_is_stream_copied_with_source_relative_offset` |
| End-to-end demo artefacts | `test_demo_end_to_end_creates_verified_artifacts`, `test_run_command_from_existing_inputs` |

All tests live in
[`tests/`](https://github.com/KAIROS03/shuttle-replay/tree/6e9a060b5cc964f02d4017d806e953ffea89c8b4/tests).
Most flight tests run on the synthetic scene from
[`synthetic.py`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/synthetic.py),
so they confirm behaviour and contracts, not real-world accuracy. Not covered
by tests: lens distortion, which the tool does not model, and audio codecs other
than the AAC used in the tests.

Related: [the workflow](workflow.md) for the limits list,
[the user guide](guide.md) for reading results.
