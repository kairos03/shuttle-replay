# Trajectory physics

One camera sees a shuttle as a pixel. Every point along the line of sight
through that pixel, near or far, lands on the same pixel, so a single frame
cannot tell depth. This page explains how `shuttle-replay` turns a sequence of
pixels into a 3D flight anyway, by adding physics and reviewed constraints, and
what the result does and does not mean.

## The inverse problem

Think of each detection as a ray from the camera. A flight is a curve that has
to pass near every ray at the right time. Many curves can do that: a slow,
close flight and a fast, distant one can produce similar pixel tracks. The
problem is underdetermined. The tool picks one curve by requiring that it:

- obeys gravity and air drag (the model below),
- starts near the reviewed contact position and height, at the reviewed contact
  time,
- is softly pulled toward the next reviewed contact or a reviewed landing
  region, or stops at the end of the observed window (endpoint residuals are
  penalties, not hard acceptance requirements), and
- stays above the floor and clears the net when it should cross it.

The fitted 3D path is therefore a **conditional model**: the most consistent
curve given your calibration and review, not a measurement
([`analysis.py` module docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L1-L10)).

## The flight model

State is position `r = (x, y, z)` in metres and velocity `v` in m/s. The
equations of motion
([`_rhs`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L16-L23)):

```text
 dr/dt = v
 dv/dt = -k * |v| * v  -  g * e_z

 g    gravity, default 9.81 m/s^2 (review "physics": "gravity_m_s2")
 k    drag coefficient per flight, units 1/m
 |v|  speed in m/s
 e_z  unit vector pointing up
```

Drag points against the motion and grows with the square of speed. A useful
reading of `k`: a shuttle falling straight down stops accelerating when drag
equals gravity, at the terminal speed `sqrt(g / k)`. With the default prior
`k = 0.18 1/m` that is about 7.4 m/s. A shuttle hit at high speed therefore
slows down sharply; the model has no spin, tumbling or wind.

The seven fitted parameters are `[x, y, z, vx, vy, vz, k]` at **flight time
zero**, which is the reviewed contact time, not the time of the first detection
([`physics.py` module docstring](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L1-L8)).
Detections often start a few frames after contact because the racket or a
player hides the shuttle. Those frames are measured as offsets from the
contact, so a late first detection does not move the start of the flight
(`first_observation_delay_s` reports the gap).

## Numerical integration

[`simulate`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L26-L40)
integrates the equations with SciPy `solve_ivp` (its default explicit
Runge-Kutta method) from `t = 0`, with `rtol=1e-7`, `atol=1e-8`, `max_step=0.02`
seconds and dense output, then evaluates positions at the requested times.
Non-finite times and times below `-1e-9` s are rejected; tiny negative values
above that are clamped to zero.
Solver tolerances control numerical integration error; they are not bounds on
reconstruction accuracy.
[`floor_crossing`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L43-L63)
uses an event function on `z` (descending only, terminal) with tighter
tolerances (`rtol=1e-9`, `atol=1e-10`, `max_step=0.01`) over a 10 s horizon.

## What is minimised

[`fit_flight`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L57-L151)
builds one residual vector. Each entry is a difference divided by a scale, so
"1" means "one expected error":

```text
 pixels    (project(P, r(t_i)) - uv_i) / pixel_sigma_px            default 3.0 px
 start     (r(0) - contact_prior) / start_sigma                     xy 0.5 m, height 0.3 m
 drag      (k - 0.18) / 0.15
 intercept (r(T) - next_contact_prior) / next_contact_sigma         intercepted only
 landing   z(T) / 0.01   and   distance outside region / 0.02       landing only
 floor     min(z, 0) / 0.01 on 41 samples from 0 to T
 net       max(0, 1.55 - h_net) / 0.02                              only if a crossing is required
```

`T` is the flight duration. The contact prior comes from
[`_contact_prior`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L49-L54):
if the contact has `image_px`, the ray through that pixel is intersected with
the plane at the reviewed `height_m`; otherwise `court_xy_m` and `height_m` are
used directly. Sigmas come from `xy_sigma_m` and `height_sigma_m` on each
contact, falling back to the defaults shown.

In the net term, `h_net` is the interpolated height where the 41-sample path
first crosses `Y = 6.70`; if the path never crosses, `h_net` counts as 0. This
term uses 1.55 m (post height) as written in the source; the acceptance gate
below uses 1.524 m (net centre).

SciPy `least_squares` minimises the sum with `loss="soft_l1"` and
`f_scale=1.5`, so a few bad detections pull less than with plain squares. It
runs from six starting points: `k` in `0.1, 0.2, 0.35` times an extra upward
speed of `1.0` or `3.0` m/s added to a ballistic guess toward the end target.
The lowest-cost result wins. Bounds keep the search physical
([source](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L64-L69)):

```text
 x in [-3, 9.1] m     y in [-3, 16.4] m     z in [0.05, 4.5] m
 vx, vy, vz in [-velocity_bound_m_s, +velocity_bound_m_s]    default 120 m/s
 k in drag_bounds_per_m                                      default [0.015, 0.6] 1/m
 landing time T in the reviewed landing bracket (landing flights only)
```

The seven state/drag parameters are flagged in `parameters_at_bound` when their
distance from a bound is less than 0.1% of their allowed range
([source](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L129-L135)).
A flagged fit is rejected. Landing time is not included in this diagnostic.
Passing does not establish identifiability, uniqueness, or freedom from prior
influence.

## How a flight ends

Flights are built per camera segment from contacts in time order
([`analyze`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/analysis.py#L154-L291)):

- **`intercepted_by_next_contact`**: another contact follows in the same
  segment. Duration is the time between contacts; the end is pulled toward the
  next contact's prior. A net crossing is required when the two contact priors
  lie on opposite sides of the net.
- **`landing_region`**: the last contact of a segment has a reviewed landing
  end. Contact and landing endpoint residuals softly pull the fit toward the
  reviewed endpoint. Landing time is bounded by the reviewed bracket, but
  endpoint height and region membership are not hard acceptance requirements.
  `landing.within_region` reports membership with a 1 mm allowance; it does not
  control acceptance. A crossing is required when the
  start and the region centre lie on opposite sides of the net.
- **`open_segment_end`**: anything else. The window ends at the segment end or
  at `until_s`, the fit duration is the last observation offset, and no net
  crossing is required.

Fewer than `min_observations` (default 4) detections in the window gives
`status: "insufficient_observations"` with no fit.

## Acceptance gates

After fitting, the path is sampled at 201 points and checked by
[`physical_gates`](https://github.com/KAIROS03/shuttle-replay/blob/6e9a060b5cc964f02d4017d806e953ffea89c8b4/src/shuttle_replay/physics.py#L88-L106):
`floor_ok` needs the lowest point at or above -0.02 m. `net_ok` needs a crossing
when one was required, and **every** crossing detected between adjacent samples must be at
or above 1.524 m, whether or not a crossing was expected. A flight is accepted
only if the optimiser reports success, both gates pass, reprojection RMS is at
most `max_accept_rms_px` (default 8.0 px) and none of the seven state/drag parameters is flagged.
Rejected flights keep their parameters for inspection but are not drawn as the
model layer.

## Speed and the counterfactual landing

`model_speed_km_h` is `|v(0)| * 3.6`, the initial speed of the model, and
`model_speed_coarse_km_h` rounds it to the nearest 5 km/h for display. It is
not a radar reading.

For flights that do not end in a landing region, if the model would reach the
floor after the flight ended, the analysis adds
`unreturned_floor_crossing_prediction` with `kind: "counterfactual_if_unreturned"`
and `observed: false`. It answers "where would this model land if nobody had hit
it back", not where the shuttle went. For landing flights, `landing.xy_m` is the
model end point softly pulled toward your region (not guaranteed to lie in it), and
`exact_coordinate_measured` is always `false`.

Related: [Camera calibration](camera-calibration.md) for `P`,
[Observations and timing](observations-timing.md) for the observation window,
[Validation and limits](validation-limits.md) for interpreting `fit` and `gates`.
